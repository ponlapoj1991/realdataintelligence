import { DashboardWidget, Project, ProjectDashboard } from '../types';

const now = () => Date.now();

const normalizeDashboard = (dashboard: ProjectDashboard): ProjectDashboard => ({
  ...dashboard,
  widgets: dashboard.widgets || [],
  globalFilters: dashboard.globalFilters || [],
  createdAt: dashboard.createdAt || now(),
  updatedAt: dashboard.updatedAt || now(),
});

const createDashboard = (name: string, dataSourceId?: string, widgets: DashboardWidget[] = []): ProjectDashboard => ({
  id: crypto.randomUUID(),
  name: name?.trim() || 'Untitled Dashboard',
  description: '',
  widgets,
  globalFilters: [],
  dataSourceId,
  createdAt: now(),
  updatedAt: now(),
});

const syncLegacyWidgets = (project: Project, active?: ProjectDashboard): Project => {
  if (!active) return project;
  return {
    ...project,
    dashboard: active.widgets,
  };
};

export const ensureDashboards = (
  project: Project
): {
  project: Project;
  dashboards: ProjectDashboard[];
  activeDashboard?: ProjectDashboard;
  changed: boolean;
} => {
  let dashboards = (project.dashboards || []).map(normalizeDashboard);
  let changed = !project.dashboards;

  const hasLegacyWidgets = (project.dashboard && project.dashboard.length > 0);
  if (dashboards.length === 0 && hasLegacyWidgets) {
    dashboards = [
      {
        id: `${project.id}-legacy`,
        name: 'Legacy Dashboard',
        description: 'Migrated from classic analytics',
        widgets: project.dashboard!,
        createdAt: project.lastModified || now(),
        updatedAt: project.lastModified || now(),
      },
    ];
    changed = true;
  }

  const activeDashboardId =
    dashboards.length === 0
      ? undefined
      : dashboards.find((d) => d.id === project.activeDashboardId)
        ? project.activeDashboardId
        : dashboards[0].id;

  if (activeDashboardId !== project.activeDashboardId) {
    changed = true;
  }

  let normalized = project;
  if (changed) {
    normalized = {
      ...project,
      dashboards,
      activeDashboardId,
    };
    if (activeDashboardId) {
      const active = dashboards.find((d) => d.id === activeDashboardId);
      normalized = syncLegacyWidgets(normalized, active);
    }
  }

  const activeDashboard =
    dashboards.find((d) => d.id === (normalized.activeDashboardId || dashboards[0]?.id)) || dashboards[0];

  return {
    project: normalized,
    dashboards,
    activeDashboard,
    changed,
  };
};

export const addDashboard = (project: Project, name: string, dataSourceId?: string): { project: Project; dashboard: ProjectDashboard } => {
  const { project: normalized } = ensureDashboards(project);
  const dashboard = createDashboard(name, dataSourceId);
  const dashboards = [...(normalized.dashboards || []), dashboard];
  const updated: Project = {
    ...normalized,
    dashboards,
    activeDashboardId: dashboard.id,
    activeDataSourceId: dataSourceId || normalized.activeDataSourceId, // Auto-switch to new dashboard's source
    dashboard: dashboard.widgets,
    lastModified: now(),
  };
  return { project: updated, dashboard };
};

export const renameDashboard = (project: Project, dashboardId: string, name: string): Project => {
  const { project: normalized } = ensureDashboards(project);
  const dashboards = (normalized.dashboards || []).map((d) =>
    d.id === dashboardId ? { ...d, name: name.trim() || d.name, updatedAt: now() } : d
  );
  return {
    ...normalized,
    dashboards,
    lastModified: now(),
  };
};

export const updateDashboardWidgets = (
  project: Project,
  dashboardId: string,
  widgets: DashboardWidget[]
): Project => {
  const { project: normalized } = ensureDashboards(project);
  const dashboards = (normalized.dashboards || []).map((d) =>
    d.id === dashboardId ? { ...d, widgets, updatedAt: now() } : d
  );
  const updated: Project = {
    ...normalized,
    dashboards,
    lastModified: now(),
  };
  if (normalized.activeDashboardId === dashboardId) {
    return syncLegacyWidgets(updated, dashboards.find((d) => d.id === dashboardId));
  }
  return updated;
};

export const setActiveDashboard = (project: Project, dashboardId: string): Project => {
  const { project: normalized } = ensureDashboards(project);
  const target = (normalized.dashboards || []).find((d) => d.id === dashboardId);
  if (!target) return normalized;
  return syncLegacyWidgets(
    {
      ...normalized,
      activeDashboardId: dashboardId,
      activeDataSourceId: target.dataSourceId || normalized.activeDataSourceId, // Switch data source
      lastModified: now(),
    },
    target
  );
};

export const removeDashboard = (project: Project, dashboardId: string): Project => {
  const { project: normalized } = ensureDashboards(project);
  const dashboards = (normalized.dashboards || []).filter((d) => d.id !== dashboardId);
  let activeDashboardId = normalized.activeDashboardId;

  if (dashboardId === normalized.activeDashboardId) {
    activeDashboardId = dashboards[0]?.id;
  }

  const updated: Project = {
    ...normalized,
    dashboards,
    activeDashboardId,
    lastModified: now(),
  };

  return syncLegacyWidgets(updated, dashboards.find((d) => d.id === activeDashboardId));
};

// Magic Dashboard (ECharts) helpers
export const ensureMagicDashboards = (
  project: Project
): {
  project: Project;
  dashboards: ProjectDashboard[];
  activeDashboard?: ProjectDashboard;
  changed: boolean;
} => {
  let dashboards = (project.magicDashboards || []).map(normalizeDashboard);
  let changed = !project.magicDashboards;

  const activeDashboardId =
    dashboards.length === 0
      ? undefined
      : dashboards.find((d) => d.id === project.activeMagicDashboardId)
        ? project.activeMagicDashboardId
        : dashboards[0].id;

  if (activeDashboardId !== project.activeMagicDashboardId) {
    changed = true;
  }

  const normalized: Project = changed
    ? {
        ...project,
        magicDashboards: dashboards,
        activeMagicDashboardId: activeDashboardId,
      }
    : project;

  const activeDashboard =
    dashboards.find((d) => d.id === (normalized.activeMagicDashboardId || dashboards[0]?.id)) || dashboards[0];

  return {
    project: normalized,
    dashboards,
    activeDashboard,
    changed,
  };
};

export const addMagicDashboard = (
  project: Project,
  name: string,
  dataSourceId?: string
): { project: Project; dashboard: ProjectDashboard } => {
  const { project: normalized } = ensureMagicDashboards(project);
  const dashboard = createDashboard(name, dataSourceId);
  const dashboards = [...(normalized.magicDashboards || []), dashboard];
  const updated: Project = {
    ...normalized,
    magicDashboards: dashboards,
    activeMagicDashboardId: dashboard.id,
    activeDataSourceId: dataSourceId || normalized.activeDataSourceId,
    lastModified: now(),
  };
  return { project: updated, dashboard };
};

export const renameMagicDashboard = (project: Project, dashboardId: string, name: string): Project => {
  const { project: normalized } = ensureMagicDashboards(project);
  const dashboards = (normalized.magicDashboards || []).map((d) =>
    d.id === dashboardId ? { ...d, name: name.trim() || d.name, updatedAt: now() } : d
  );
  return {
    ...normalized,
    magicDashboards: dashboards,
    lastModified: now(),
  };
};

export const updateMagicDashboardWidgets = (
  project: Project,
  dashboardId: string,
  widgets: DashboardWidget[]
): Project => {
  const { project: normalized } = ensureMagicDashboards(project);
  const dashboards = (normalized.magicDashboards || []).map((d) =>
    d.id === dashboardId ? { ...d, widgets, updatedAt: now() } : d
  );
  return {
    ...normalized,
    magicDashboards: dashboards,
    lastModified: now(),
  };
};

export const updateMagicDashboardGlobalFilters = (
  project: Project,
  dashboardId: string,
  globalFilters: ProjectDashboard['globalFilters']
): Project => {
  const { project: normalized } = ensureMagicDashboards(project);
  const dashboards = (normalized.magicDashboards || []).map((d) =>
    d.id === dashboardId ? { ...d, globalFilters: globalFilters || [], updatedAt: now() } : d
  );
  return {
    ...normalized,
    magicDashboards: dashboards,
    lastModified: now(),
  };
};

export const setActiveMagicDashboard = (project: Project, dashboardId: string): Project => {
  const { project: normalized } = ensureMagicDashboards(project);
  const target = (normalized.magicDashboards || []).find((d) => d.id === dashboardId);
  if (!target) return normalized;
  return {
    ...normalized,
    activeMagicDashboardId: dashboardId,
    activeDataSourceId: target.dataSourceId || normalized.activeDataSourceId,
    lastModified: now(),
  };
};

export const setMagicDashboardDataSource = (project: Project, dashboardId: string, dataSourceId: string): Project => {
  const { project: normalized } = ensureMagicDashboards(project);
  const dashboards = (normalized.magicDashboards || []).map((d) =>
    d.id === dashboardId ? { ...d, dataSourceId, updatedAt: now() } : d
  );

  return {
    ...normalized,
    magicDashboards: dashboards,
    activeDataSourceId: dataSourceId || normalized.activeDataSourceId,
    lastModified: now(),
  };
};

export const removeMagicDashboard = (project: Project, dashboardId: string): Project => {
  const { project: normalized } = ensureMagicDashboards(project);
  const dashboards = (normalized.magicDashboards || []).filter((d) => d.id !== dashboardId);
  let activeDashboardId = normalized.activeMagicDashboardId;

  if (dashboardId === normalized.activeMagicDashboardId) {
    activeDashboardId = dashboards[0]?.id;
  }

  return {
    ...normalized,
    magicDashboards: dashboards,
    activeMagicDashboardId: activeDashboardId,
    lastModified: now(),
  };
};
