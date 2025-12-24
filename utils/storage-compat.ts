/**
 * Storage Compatibility Layer
 *
 * Purpose: Seamless migration from storage.ts (v1) to storage-v2.ts
 * - Maintains backward compatibility
 * - Auto-migrates old projects
 * - Provides unified API
 * - Falls back to v1 if v2 fails
 *
 * Usage: Drop-in replacement for storage.ts
 */

import { DataSource, Project, ProjectTab, RawRow } from '../types';
import {
  getProjectMetadata,
  saveProjectMetadata,
  getAllDataChunks,
  batchInsertData,
  getAllDataSourceChunks,
  batchInsertDataSource,
  deleteProjectV2,
  getProjectsV2,
  appendData,
  clearCache,
  saveLastStateV2,
  getLastStateV2
} from './storage-v2';
import { ensureDataSources } from './dataSources';
import { ensureDashboards, ensureMagicDashboards } from './dashboards';
import { ensurePresentations } from './reportPresentations';

// V1 imports (legacy)
import {
  getProjects as getProjectsV1,
  saveProject as saveProjectV1,
  deleteProject as deleteProjectV1
} from './storage';

const normalizeProject = (project: Project): Project => {
  const { project: withSources } = ensureDataSources(project);
  const { project: withDashboards } = ensureDashboards(withSources);
  const { project: withMagicDash } = ensureMagicDashboards(withDashboards);
  const { project: withPresentations } = ensurePresentations(withMagicDash);
  return withPresentations;
};

const toLightProjectFromMetadata = (metadata: any): Project => {
  // IMPORTANT: for listing purposes only (Landing). Avoid loading chunked rows.
  // Also strip any embedded rows in metadata.dataSources to reduce memory pressure.
  const lightSources = Array.isArray(metadata?.dataSources)
    ? metadata.dataSources.map((s: any) => ({ ...s, rows: Array.isArray(s?.rows) ? [] : [] }))
    : undefined;

  return normalizeProject({
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    lastModified: metadata.lastModified,
    data: [],
    columns: metadata.columns || [],
    rowCount: typeof metadata.rowCount === 'number' ? metadata.rowCount : undefined,
    dataSources: lightSources,
    activeDataSourceId: metadata.activeDataSourceId,
    transformRules: metadata.transformRules,
    buildStructureConfigs: metadata.buildStructureConfigs,
    activeBuildConfigId: metadata.activeBuildConfigId,
    dashboards: metadata.dashboards,
    activeDashboardId: metadata.activeDashboardId,
    magicDashboards: metadata.magicDashboards,
    activeMagicDashboardId: metadata.activeMagicDashboardId,
    dashboard: metadata.dashboard,
    reportConfig: metadata.reportConfig,
    reportPresentations: metadata.reportPresentations,
    activePresentationId: metadata.activePresentationId,
    aiPresets: metadata.aiPresets,
    aiSettings: metadata.aiSettings,
  });
};

// --- Type Guards ---

interface ProjectMetadataV2 {
  storageVersion: 2;
  rowCount: number;
  chunkCount: number;
}

const isProjectV2 = (project: any): project is ProjectMetadataV2 => {
  return project && project.storageVersion === 2;
};

const CHUNK_SIZE = 1000;

const stripDataSourceRowsForMetadata = (source: DataSource): DataSource => {
  const rowCount =
    typeof source.rowCount === 'number'
      ? source.rowCount
      : Array.isArray(source.rows)
        ? source.rows.length
        : 0;
  const chunkCount = Math.ceil(rowCount / CHUNK_SIZE);
  return {
    ...source,
    rows: [],
    rowCount,
    chunkCount,
  };
};

// --- Migration Functions ---

/**
 * Migrate v1 project to v2
 */
const migrateProjectToV2 = async (projectV1: Project): Promise<void> => {
  console.log(`[Migration] Migrating project ${projectV1.id} to v2...`);

  const startTime = Date.now();
  const normalized = normalizeProject(projectV1);

  const sources = normalized.dataSources || [];
  const sourcesForMetadata = sources.map(stripDataSourceRowsForMetadata);

  // Save metadata (avoid embedding full rows)
  await saveProjectMetadata({
    id: normalized.id,
    name: normalized.name,
    description: normalized.description,
    lastModified: normalized.lastModified,
    rowCount: normalized.data.length,
    chunkCount: Math.ceil(normalized.data.length / 1000),
    columns: normalized.columns,
    dataSources: sourcesForMetadata,
    activeDataSourceId: normalized.activeDataSourceId,
    transformRules: normalized.transformRules,
    buildStructureConfigs: normalized.buildStructureConfigs,
    activeBuildConfigId: normalized.activeBuildConfigId,
    dashboards: normalized.dashboards,
    activeDashboardId: normalized.activeDashboardId,
    dashboard: normalized.dashboard,
    reportConfig: normalized.reportConfig,
    reportPresentations: normalized.reportPresentations,
    activePresentationId: normalized.activePresentationId,
    aiPresets: normalized.aiPresets,
    storageVersion: 2
  });

  // Save each DataSource in chunks (v3+)
  await Promise.all(
    sources.map(async (s) => {
      if (Array.isArray(s.rows) && s.rows.length > 0) {
        await batchInsertDataSource(normalized.id, s.id, s.rows);
      }
    })
  );

  // Save data in chunks
  await batchInsertData(normalized.id, normalized.data);

  // Delete v1 project
  try {
    await deleteProjectV1(projectV1.id);
  } catch (e) {
    // Ignore if already deleted
  }

  const duration = Date.now() - startTime;
  console.log(`[Migration] Project ${projectV1.id} migrated in ${duration}ms`);
};

/**
 * Convert v2 metadata + chunks back to v1 Project format
 * (for components that still expect full Project object)
 */
const convertV2ToProject = async (projectId: string): Promise<Project | null> => {
  const metadata = await getProjectMetadata(projectId);
  if (!metadata) return null;

  const sourceMetas = (metadata.dataSources || []) as DataSource[];
  const activeId = metadata.activeDataSourceId || sourceMetas[0]?.id;

  const hydratedSources: DataSource[] = [];
  let activeRows: RawRow[] = [];

  for (const src of sourceMetas) {
    const rowCount = typeof (src as any).rowCount === 'number' ? (src as any).rowCount : 0;
    const chunkCount =
      typeof (src as any).chunkCount === 'number' ? (src as any).chunkCount : Math.ceil(rowCount / CHUNK_SIZE);

    let rows: RawRow[] = [];
    if (src.id === activeId) {
      try {
        rows = await getAllDataSourceChunks(projectId, src.id);
      } catch (e) {
        rows = [];
      }

      // Fallback for legacy metadata that still embeds rows (pre-v3)
      if (rows.length === 0 && Array.isArray((src as any).rows) && (src as any).rows.length > 0) {
        rows = (src as any).rows as RawRow[];
      }

      activeRows = rows;
    }

    hydratedSources.push({
      ...src,
      rows,
      rowCount: typeof (src as any).rowCount === 'number' ? (src as any).rowCount : rows.length,
      chunkCount: typeof (src as any).chunkCount === 'number' ? (src as any).chunkCount : Math.ceil(rows.length / CHUNK_SIZE),
    });
  }

  const active = (activeId && hydratedSources.find((s) => s.id === activeId)) || hydratedSources[0];
  const data = active ? activeRows : await getAllDataChunks(projectId);

  return {
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    lastModified: metadata.lastModified,
    data,
    columns: metadata.columns,
    dataSources: hydratedSources.length ? hydratedSources : metadata.dataSources,
    activeDataSourceId: metadata.activeDataSourceId,
    transformRules: metadata.transformRules,
    buildStructureConfigs: metadata.buildStructureConfigs,
    activeBuildConfigId: metadata.activeBuildConfigId,
    dashboards: metadata.dashboards,
    activeDashboardId: metadata.activeDashboardId,
    magicDashboards: metadata.magicDashboards,
    activeMagicDashboardId: metadata.activeMagicDashboardId,
    dashboard: metadata.dashboard,
    reportConfig: metadata.reportConfig,
    reportPresentations: metadata.reportPresentations,
    activePresentationId: metadata.activePresentationId,
    aiPresets: metadata.aiPresets,
    rowCount: metadata.rowCount,
  };
};

/**
 * Hydrate a single DataSource's rows into an in-memory Project object.
 * Used by UI flows that still depend on `source.rows` for editing or preview.
 */
export const hydrateProjectDataSourceRows = async (project: Project, sourceId: string): Promise<Project> => {
  try {
    const rows = await getAllDataSourceChunks(project.id, sourceId);

    const dataSources = (project.dataSources || []).map((s) => {
      if (s.id !== sourceId) return s;
      return {
        ...s,
        rows,
        rowCount: typeof s.rowCount === 'number' ? s.rowCount : rows.length,
        chunkCount: typeof s.chunkCount === 'number' ? s.chunkCount : Math.ceil(rows.length / CHUNK_SIZE),
      };
    });

    const activeId = project.activeDataSourceId;
    const active = dataSources.find((s) => s.id === (activeId || sourceId)) || dataSources[0];

    return normalizeProject({
      ...project,
      dataSources,
      data: active?.rows || project.data,
      columns: active?.columns || project.columns,
    });
  } catch (e) {
    console.error('[Storage] Failed to hydrate DataSource rows:', e);
    return project;
  }
};

// --- Unified API (Drop-in replacement for storage.ts) ---

/**
 * Get all projects (auto-migrates v1 projects)
 */
export const getProjects = async (): Promise<Project[]> => {
  try {
    // Try v2 first
    const projectsV2 = await getProjectsV2();

    // NOTE: Do NOT load chunked rows for listing (Landing).
    const validProjects = projectsV2.map((meta: any) => toLightProjectFromMetadata(meta));

    // Background cleanup: strip embedded rows from metadata (older v2 writes)
    Promise.all(
      projectsV2.map(async (meta: any) => {
        const sources = Array.isArray(meta?.dataSources) ? (meta.dataSources as DataSource[]) : [];
        const hasEmbeddedRows = sources.some((s) => Array.isArray((s as any).rows) && (s as any).rows.length > 0);
        if (!hasEmbeddedRows) return;

        try {
          await Promise.all(
            sources.map(async (s) => {
              if (Array.isArray((s as any).rows) && (s as any).rows.length > 0) {
                await batchInsertDataSource(meta.id, s.id, (s as any).rows as RawRow[]);
              }
            })
          );
          await saveProjectMetadata({
            ...meta,
            dataSources: sources.map(stripDataSourceRowsForMetadata),
          });
        } catch (e) {
          console.error('[Storage] Background metadata cleanup failed:', e);
        }
      })
    ).catch(() => {
      // ignore
    });

    // Check for v1 projects
    let projectsV1: Project[] = [];
    try {
      projectsV1 = await getProjectsV1();
    } catch (e) {
      // No v1 projects or v1 store doesn't exist
    }

    // Migrate v1 projects in background
    if (projectsV1.length > 0) {
      console.log(`[Migration] Found ${projectsV1.length} v1 projects, migrating...`);

      // Migrate asynchronously
      Promise.all(
        projectsV1.map(async (project) => {
          // Check if already migrated
          const existing = await getProjectMetadata(project.id);
          if (!existing) {
            await migrateProjectToV2(project);
          }
        })
      ).catch(err => {
        console.error('[Migration] Error migrating projects:', err);
      });

      // Return v1 projects for now (will be v2 on next load)
      return [...validProjects, ...projectsV1.map((p) => normalizeProject(p))];
    }

    return validProjects;

  } catch (err) {
    console.error('[Storage] Error loading v2 projects, falling back to v1:', err);

    // Fallback to v1
    try {
      return (await getProjectsV1()).map((p) => normalizeProject(p));
    } catch (v1Err) {
      console.error('[Storage] Error loading v1 projects:', v1Err);
      return [];
    }
  }
};

/**
 * Save project (auto-uses v2)
 */
export const saveProject = async (project: Project): Promise<void> => {
  const normalized = normalizeProject(project);
  try {
    // Check if already v2
    const existing = await getProjectMetadata(normalized.id);

    if (existing) {
      const sources = normalized.dataSources || [];
      const sourcesForMetadata = sources.map(stripDataSourceRowsForMetadata);

      // Update metadata
      await saveProjectMetadata({
        ...existing,
        name: normalized.name,
        description: normalized.description,
        columns: normalized.columns,
        dataSources: sourcesForMetadata,
        activeDataSourceId: normalized.activeDataSourceId,
        transformRules: normalized.transformRules,
        buildStructureConfigs: normalized.buildStructureConfigs,
        activeBuildConfigId: normalized.activeBuildConfigId,
        dashboards: normalized.dashboards,
        activeDashboardId: normalized.activeDashboardId,
        magicDashboards: normalized.magicDashboards,
        activeMagicDashboardId: normalized.activeMagicDashboardId,
        dashboard: normalized.dashboard,
        reportConfig: normalized.reportConfig,
        reportPresentations: normalized.reportPresentations,
        activePresentationId: normalized.activePresentationId,
        aiPresets: normalized.aiPresets
      });

      // Persist DataSources into per-DataSource chunks (v3+)
      await Promise.all(
        sources.map(async (s) => {
          if (Array.isArray(s.rows) && s.rows.length > 0) {
            await batchInsertDataSource(normalized.id, s.id, s.rows);
          }
        })
      );

      // Check if data changed (row count different)
      if (existing.rowCount !== normalized.data.length) {
        // Clear old data and re-insert
        await clearCache(normalized.id);
        await batchInsertData(normalized.id, normalized.data);

        // Update row count
        await saveProjectMetadata({
          ...existing,
          rowCount: normalized.data.length,
          chunkCount: Math.ceil(normalized.data.length / 1000)
        });
      }
    } else {
      const sources = normalized.dataSources || [];
      const sourcesForMetadata = sources.map(stripDataSourceRowsForMetadata);

      // New project - create as v2
      await saveProjectMetadata({
        id: normalized.id,
        name: normalized.name,
        description: normalized.description,
        lastModified: Date.now(),
        rowCount: normalized.data.length,
        chunkCount: Math.ceil(normalized.data.length / 1000),
        columns: normalized.columns,
        dataSources: sourcesForMetadata,
        activeDataSourceId: normalized.activeDataSourceId,
        transformRules: normalized.transformRules,
        buildStructureConfigs: normalized.buildStructureConfigs,
        activeBuildConfigId: normalized.activeBuildConfigId,
        dashboards: normalized.dashboards,
        activeDashboardId: normalized.activeDashboardId,
        magicDashboards: normalized.magicDashboards,
        activeMagicDashboardId: normalized.activeMagicDashboardId,
        dashboard: normalized.dashboard,
        reportConfig: normalized.reportConfig,
        reportPresentations: normalized.reportPresentations,
        activePresentationId: normalized.activePresentationId,
        aiPresets: normalized.aiPresets,
        storageVersion: 2
      });

      await Promise.all(
        sources.map(async (s) => {
          if (Array.isArray(s.rows) && s.rows.length > 0) {
            await batchInsertDataSource(normalized.id, s.id, s.rows);
          }
        })
      );

      await batchInsertData(normalized.id, normalized.data);
    }

  } catch (err) {
    console.error('[Storage] Error saving v2 project, falling back to v1:', err);

    // Fallback to v1
    await saveProjectV1(normalized);
  }
};

/**
 * Delete project (deletes from both v1 and v2)
 */
export const deleteProject = async (id: string): Promise<void> => {
  try {
    // Try v2 first
    await deleteProjectV2(id);
  } catch (err) {
    console.error('[Storage] Error deleting v2 project:', err);
  }

  try {
    // Also try v1 (in case it exists)
    await deleteProjectV1(id);
  } catch (err) {
    // Ignore - project might not exist in v1
  }
};

/**
 * Save last state (uses v2)
 */
export const saveLastState = (projectId: string, tab: ProjectTab) => {
  saveLastStateV2(projectId, tab);
};

/**
 * Get last state (tries v2, falls back to v1)
 */
export const getLastState = (): { projectId: string | null; tab: ProjectTab } => {
  return getLastStateV2();
};

// --- Extended API (v2-specific features) ---

/**
 * Load project data lazily (only metadata)
 * Use this for listing projects without loading all data
 */
export const getProjectMetadataOnly = async (projectId: string) => {
  return await getProjectMetadata(projectId);
};

/**
 * Load project data fully
 * Use this when you need the complete Project object
 */
export const getProjectFull = async (projectId: string): Promise<Project | null> => {
  return await convertV2ToProject(projectId);
};

/**
 * Append new data to existing project (efficient)
 * Better than reloading full project + saving
 */
export const appendProjectData = async (projectId: string, newData: RawRow[]): Promise<void> => {
  await appendData(projectId, newData);
  await clearCache(projectId); // Invalidate cache
};

/**
 * Check if project is using v2 storage
 */
export const isProjectUsingV2 = async (projectId: string): Promise<boolean> => {
  const metadata = await getProjectMetadata(projectId);
  return metadata !== null && metadata.storageVersion === 2;
};
