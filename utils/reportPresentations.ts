import { AISummaryContext, CanvasWidgetTable, Project, ReportPresentation, ReportSlide } from '../types';

const now = () => Date.now();

const normalizeCanvasTables = (tables: CanvasWidgetTable[] | undefined): CanvasWidgetTable[] => {
  const src = Array.isArray(tables) ? tables : [];
  return src.map((t) => ({
    ...t,
    name: t.name?.trim() || 'Untitled Table',
    dataSourceId: t.dataSourceId,
    filters: Array.isArray(t.filters) ? t.filters : [],
    createdAt: t.createdAt || now(),
    updatedAt: t.updatedAt || now(),
  }));
};

const normalizeAiSummaryContexts = (contexts: AISummaryContext[] | undefined): AISummaryContext[] => {
  const src = Array.isArray(contexts) ? contexts : [];
  return src.map((c) => {
    const sort =
      c.sort && typeof c.sort === 'object' && typeof (c.sort as any).column === 'string'
        ? { column: String((c.sort as any).column), direction: ((c.sort as any).direction === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc' }
        : null;

    const limit = typeof c.limit === 'number' && Number.isFinite(c.limit) && c.limit > 0 ? Math.floor(c.limit) : 200;

    return {
      ...c,
      name: c.name?.trim() || 'Untitled Context',
      dataSourceId: typeof c.dataSourceId === 'string' ? c.dataSourceId : '',
      prompt: typeof c.prompt === 'string' ? c.prompt : '',
      dateColumn: typeof c.dateColumn === 'string' ? c.dateColumn : undefined,
      periodStart: typeof c.periodStart === 'string' ? c.periodStart : undefined,
      periodEnd: typeof c.periodEnd === 'string' ? c.periodEnd : undefined,
      hiddenColumns: Array.isArray(c.hiddenColumns) ? c.hiddenColumns.filter(Boolean) : [],
      sort,
      limit,
      createdAt: c.createdAt || now(),
      updatedAt: c.updatedAt || now(),
    };
  });
};

const normalizePresentation = (presentation: ReportPresentation): ReportPresentation => {
  const canvasTables = normalizeCanvasTables(presentation.canvasTables);
  const canvasActiveTableId =
    canvasTables.length === 0
      ? undefined
      : canvasTables.find((t) => t.id === presentation.canvasActiveTableId)
        ? presentation.canvasActiveTableId
        : canvasTables[0].id;

  const aiSummaryContexts = normalizeAiSummaryContexts(presentation.aiSummaryContexts);

  return {
    ...presentation,
    name: presentation.name?.trim() || 'Untitled Presentation',
    slides: presentation.slides || [],
    createdAt: presentation.createdAt || now(),
    updatedAt: presentation.updatedAt || now(),
    canvasTables,
    canvasActiveTableId,
    aiSummaryContexts,
  };
};

const createPresentation = (name: string, slides: ReportSlide[] = []): ReportPresentation => ({
  id: crypto.randomUUID(),
  name: name?.trim() || 'Untitled Presentation',
  slides,
  createdAt: now(),
  updatedAt: now(),
  canvasTables: [],
  canvasActiveTableId: undefined,
  aiSummaryContexts: [],
});

const syncLegacySlides = (project: Project, active?: ReportPresentation): Project => {
  if (!active) return project;
  return {
    ...project,
    reportConfig: active.slides,
  };
};

export const ensurePresentations = (
  project: Project
): {
  project: Project;
  presentations: ReportPresentation[];
  activePresentation?: ReportPresentation;
  changed: boolean;
} => {
  let presentations = (project.reportPresentations || []).map(normalizePresentation);
  let changed = !project.reportPresentations;

  if (presentations.length === 0 && project.reportConfig && project.reportConfig.length > 0) {
    presentations = [
      {
        id: `${project.id}-legacy-presentation`,
        name: 'Legacy Presentation',
        slides: project.reportConfig,
        createdAt: project.lastModified || now(),
        updatedAt: project.lastModified || now(),
      },
    ];
    changed = true;
  }

  const activePresentationId =
    presentations.length === 0
      ? undefined
      : presentations.find((p) => p.id === project.activePresentationId)
        ? project.activePresentationId
        : presentations[0].id;

  if (activePresentationId !== project.activePresentationId) {
    changed = true;
  }

  let normalized = project;
  if (changed) {
    normalized = {
      ...project,
      reportPresentations: presentations,
      activePresentationId,
    };
    if (activePresentationId) {
      const active = presentations.find((p) => p.id === activePresentationId);
      normalized = syncLegacySlides(normalized, active);
    }
  }

  const activePresentation =
    presentations.find((p) => p.id === (normalized.activePresentationId || presentations[0]?.id)) || presentations[0];

  return {
    project: normalized,
    presentations,
    activePresentation,
    changed,
  };
};

export const addPresentation = (project: Project, name: string): { project: Project; presentation: ReportPresentation } => {
  const { project: normalized } = ensurePresentations(project);
  const presentation = createPresentation(name);
  const presentations = [...(normalized.reportPresentations || []), presentation];

  const updated: Project = syncLegacySlides(
    {
      ...normalized,
      reportPresentations: presentations,
      activePresentationId: presentation.id,
      lastModified: now(),
    },
    presentation
  );

  return { project: updated, presentation };
};

export const renamePresentation = (project: Project, presentationId: string, name: string): Project => {
  const { project: normalized } = ensurePresentations(project);
  const presentations = (normalized.reportPresentations || []).map((p) =>
    p.id === presentationId ? { ...p, name: name.trim() || p.name, updatedAt: now() } : p
  );
  return {
    ...normalized,
    reportPresentations: presentations,
    lastModified: now(),
  };
};

export const updatePresentationSlides = (
  project: Project,
  presentationId: string,
  slides: ReportSlide[]
): Project => {
  const { project: normalized } = ensurePresentations(project);
  const presentations = (normalized.reportPresentations || []).map((p) =>
    p.id === presentationId ? { ...p, slides, updatedAt: now() } : p
  );

  const updated: Project = {
    ...normalized,
    reportPresentations: presentations,
    lastModified: now(),
  };

  if (normalized.activePresentationId === presentationId) {
    return syncLegacySlides(updated, presentations.find((p) => p.id === presentationId));
  }

  return updated;
};

export const updatePresentationCanvasTables = (
  project: Project,
  presentationId: string,
  canvasTables: CanvasWidgetTable[]
): Project => {
  const { project: normalized } = ensurePresentations(project);
  const presentations = (normalized.reportPresentations || []).map((p) =>
    p.id === presentationId ? { ...p, canvasTables, updatedAt: now() } : p
  );

  const updated: Project = {
    ...normalized,
    reportPresentations: presentations,
    lastModified: now(),
  };

  if (normalized.activePresentationId === presentationId) {
    return syncLegacySlides(updated, presentations.find((p) => p.id === presentationId));
  }

  return updated;
};

export const updatePresentationCanvasActiveTable = (
  project: Project,
  presentationId: string,
  canvasActiveTableId: string | undefined
): Project => {
  const { project: normalized } = ensurePresentations(project);
  const presentations = (normalized.reportPresentations || []).map((p) =>
    p.id === presentationId ? { ...p, canvasActiveTableId, updatedAt: now() } : p
  );

  const updated: Project = {
    ...normalized,
    reportPresentations: presentations,
    lastModified: now(),
  };

  if (normalized.activePresentationId === presentationId) {
    return syncLegacySlides(updated, presentations.find((p) => p.id === presentationId));
  }

  return updated;
};

export const updatePresentationAiSummaryContexts = (
  project: Project,
  presentationId: string,
  aiSummaryContexts: AISummaryContext[]
): Project => {
  const { project: normalized } = ensurePresentations(project);
  const presentations = (normalized.reportPresentations || []).map((p) =>
    p.id === presentationId ? { ...p, aiSummaryContexts, updatedAt: now() } : p
  );

  const updated: Project = {
    ...normalized,
    reportPresentations: presentations,
    lastModified: now(),
  };

  if (normalized.activePresentationId === presentationId) {
    return syncLegacySlides(updated, presentations.find((p) => p.id === presentationId));
  }

  return updated;
};

export const setActivePresentation = (project: Project, presentationId: string): Project => {
  const { project: normalized } = ensurePresentations(project);
  const target = (normalized.reportPresentations || []).find((p) => p.id === presentationId);
  if (!target) return normalized;
  return syncLegacySlides(
    {
      ...normalized,
      activePresentationId: presentationId,
      lastModified: now(),
    },
    target
  );
};

export const removePresentation = (project: Project, presentationId: string): Project => {
  const { project: normalized } = ensurePresentations(project);
  const presentations = (normalized.reportPresentations || []).filter((p) => p.id !== presentationId);
  let activePresentationId = normalized.activePresentationId;

  if (presentationId === normalized.activePresentationId) {
    activePresentationId = presentations[0]?.id;
  }

  const updated: Project = {
    ...normalized,
    reportPresentations: presentations,
    activePresentationId,
    lastModified: now(),
  };

  return syncLegacySlides(updated, presentations.find((p) => p.id === activePresentationId));
};
