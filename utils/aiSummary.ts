import type { RawRow, TransformationRule } from '../types';
import { getDataSourcePaginated } from './storage-v2';
import { applyTransformation } from './transform';
import { normalizeDateEnd, normalizeDateStart, toDate } from './widgetData';

export type AiSummarySort = { column: string; direction: 'asc' | 'desc' } | null;

export const loadFilteredDataSourceRows = async (params: {
  projectId: string;
  dataSourceId: string;
  totalRows: number;
  transformRules: TransformationRule[];
  dateColumn?: string;
  periodStart?: string;
  periodEnd?: string;
  limit: number;
  sort?: AiSummarySort;
}): Promise<RawRow[]> => {
  const {
    projectId,
    dataSourceId,
    totalRows,
    transformRules,
    dateColumn,
    periodStart,
    periodEnd,
    limit,
    sort,
  } = params;

  const safeLimit = Math.min(Math.max(1, Math.floor(limit || 1)), 2000);

  const start = normalizeDateStart(periodStart);
  const end = normalizeDateEnd(periodEnd);
  const hasDateFilter = !!dateColumn && (!!start || !!end);

  const matches = (row: RawRow) => {
    if (!hasDateFilter || !dateColumn) return true;
    const d = toDate((row as any)[dateColumn]);
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  };

  const rows: RawRow[] = [];
  const pageSize = 1200;
  let page = 0;

  while (rows.length < safeLimit) {
    const result = await getDataSourcePaginated(projectId, dataSourceId, page, pageSize, { totalRows });
    const pageRows = result.rows || [];
    if (pageRows.length === 0) break;

    const transformed =
      transformRules && transformRules.length > 0 ? applyTransformation(pageRows, transformRules) : pageRows;

    for (const row of transformed) {
      if (!matches(row)) continue;
      rows.push(row);
      if (rows.length >= safeLimit) break;
    }

    if (!result.hasMore) break;
    page += 1;
  }

  if (sort && sort.column) {
    const dir = sort.direction === 'asc' ? 1 : -1;
    const col = sort.column;
    rows.sort((a, b) => {
      const av = (a as any)?.[col];
      const bv = (b as any)?.[col];

      const ad = toDate(av);
      const bd = toDate(bv);
      if (ad && bd) return (ad.getTime() - bd.getTime()) * dir;

      const an = typeof av === 'number' ? av : Number(av);
      const bn = typeof bv === 'number' ? bv : Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;

      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }

  return rows;
};

const escapeText = (input: string) => input.replace(/\r/g, ' ').replace(/\t/g, ' ').trim();

export const rowsToPlainTable = (rows: RawRow[], columns: string[], maxRows = 200): string => {
  const safeColumns = (columns || []).filter(Boolean).slice(0, 40);
  if (safeColumns.length === 0) return '';

  const header = safeColumns.join('\t');
  const body = rows.slice(0, Math.max(0, maxRows)).map((row) => safeColumns.map((c) => escapeText(String((row as any)?.[c] ?? ''))).join('\t'));
  return [header, ...body].join('\n');
};

