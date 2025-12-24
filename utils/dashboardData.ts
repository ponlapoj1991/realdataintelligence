import { Project, ProjectDashboard, RawRow } from '../types';
import { ensureDataSources } from './dataSources';
import { applyTransformation } from './transform';

export interface ResolvedDashboardData {
  rows: RawRow[];
  availableColumns: string[];
  dataSourceId?: string;
}

/**
 * Resolve base rows for a given dashboard.
 * - Uses dashboard.dataSourceId (fallback: project.activeDataSourceId / first source)
 * - Applies transformRules if present (same rule as Analytics/ReportBuilder)
 *
 * NOTE: This is "base data" only (no global filters). Widget filters are applied later.
 */
export const resolveDashboardBaseData = (
  project: Project,
  dashboard?: ProjectDashboard | null
): ResolvedDashboardData => {
  const { project: withSources } = ensureDataSources(project);

  const desiredSourceId = dashboard?.dataSourceId || withSources.activeDataSourceId;
  const source =
    (desiredSourceId && withSources.dataSources?.find((s) => s.id === desiredSourceId)) ||
    withSources.dataSources?.[0];

  const sourceRows = source?.rows || [];
  const transformedRows =
    project.transformRules && project.transformRules.length > 0
      ? applyTransformation(sourceRows, project.transformRules)
      : sourceRows;

  const availableColumns =
    project.transformRules && project.transformRules.length > 0
      ? project.transformRules.map((r) => r.targetName)
      : source?.columns?.length
        ? source.columns.map((c) => c.key)
        : transformedRows[0]
          ? Object.keys(transformedRows[0])
          : [];

  return {
    rows: transformedRows,
    availableColumns,
    dataSourceId: source?.id,
  };
};
