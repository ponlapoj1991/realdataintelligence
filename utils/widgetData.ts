import { DashboardWidget, RawRow, DashboardFilter } from '../types';

export interface AggregatedWidgetData {
  data: any[];
  isStack: boolean;
  stackKeys?: string[];
}

const MAX_TOP_N = 500;

const normalizeKey = (raw: any, emptyLabel: string = '(Empty)') => {
  const s = String(raw ?? '').trim();
  return s ? s : emptyLabel;
};

const splitByString = (value: string) => {
  const tokens = value.split(/[,\n;|]+/).map((t) => t.trim()).filter(Boolean);
  return tokens.length ? tokens : ['(Empty)'];
};

const clampTopN = (value?: number | null) => {
  if (!value || value <= 0) return null;
  return Math.min(Math.max(1, value), MAX_TOP_N);
};

const normalizeLimit = (value?: number | null) => {
  if (!value || value <= 0) return null;
  return Math.min(Math.max(1, value), MAX_TOP_N);
};

export const toDate = (value: any): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2]);
      const day = Number(isoMatch[3]);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        const d = new Date(year, month - 1, day);
        return isNaN(d.getTime()) ? null : d;
      }
    }

    const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s].*)?$/);
    if (dmyMatch) {
      const day = Number(dmyMatch[1]);
      const month = Number(dmyMatch[2]);
      const year = Number(dmyMatch[3]);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
        const d = new Date(year, month - 1, day);
        return isNaN(d.getTime()) ? null : d;
      }
    }
  }

  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
};

export const normalizeDateStart = (value?: string | null) => {
  if (!value) return null;
  const date = toDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

export const normalizeDateEnd = (value?: string | null) => {
  if (!value) return null;
  const date = toDate(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

export const applyWidgetFilters = (rows: RawRow[], filters?: DashboardFilter[]) => {
  if (!filters || filters.length === 0) return rows;
  return rows.filter(row =>
    filters.every(filter => {
      if (!filter.column) return true;
      const val = row[filter.column];
      if (filter.dataType === 'date') {
        const rowDate = toDate(val);
        if (!rowDate) return false;
        const start = normalizeDateStart(filter.value);
        const end = normalizeDateEnd(filter.endValue);
        if (start && rowDate < start) return false;
        if (end && rowDate > end) return false;
        if (!start && !end) return true;
        return true;
      }
      if (filter.value === undefined || filter.value === '') return true;
      if (val === null || val === undefined) return false;
      return String(val).toLowerCase() === filter.value.toLowerCase();
    })
  );
};

const applySorting = (data: any[], order: string | undefined, valueKey: string) => {
  const sortBy = order || 'value-desc';
  const stableSort = <T,>(arr: T[], compare: (a: T, b: T) => number) => {
    return arr
      .map((item, idx) => ({ item, idx }))
      .sort((a, b) => {
        const cmp = compare(a.item, b.item);
        return cmp !== 0 ? cmp : a.idx - b.idx;
      })
      .map(({ item }) => item);
  };

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  const parseRangeStartNumber = (s: string) => {
    const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*-\s*/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  const parseRangeStartDate = (s: string) => {
    const parts = s.split(' - ');
    if (parts.length < 2) return null;
    const d = toDate(parts[0].trim());
    return d ? d.getTime() : null;
  };

  const parseDateLabel = (raw: any) => {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const rangeStart = parseRangeStartDate(s);
    if (rangeStart !== null) return rangeStart;
    const d = toDate(s);
    return d ? d.getTime() : null;
  };

  const compareName = (aName: any, bName: any) => {
    const aStr = String(aName ?? '').trim();
    const bStr = String(bName ?? '').trim();

    const aRangeNum = parseRangeStartNumber(aStr);
    const bRangeNum = parseRangeStartNumber(bStr);
    if (aRangeNum !== null && bRangeNum !== null) return aRangeNum - bRangeNum;

    const aRangeDate = parseRangeStartDate(aStr);
    const bRangeDate = parseRangeStartDate(bStr);
    if (aRangeDate !== null && bRangeDate !== null) return aRangeDate - bRangeDate;

    const aNum = Number(aStr);
    const bNum = Number(bStr);
    const aNumOk = Number.isFinite(aNum);
    const bNumOk = Number.isFinite(bNum);
    if (aNumOk && bNumOk) return aNum - bNum;

    const aDate = toDate(aStr);
    const bDate = toDate(bStr);
    if (aDate && bDate) return aDate.getTime() - bDate.getTime();

    return collator.compare(aStr, bStr);
  };

  const compareDate = (aName: any, bName: any) => {
    const aMs = parseDateLabel(aName);
    const bMs = parseDateLabel(bName);
    if (aMs !== null && bMs !== null) return aMs - bMs;
    if (aMs !== null) return -1;
    if (bMs !== null) return 1;
    return compareName(aName, bName);
  };
  switch (sortBy) {
    case 'value-desc':
      return stableSort([...data], (a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
    case 'value-asc':
      return stableSort([...data], (a, b) => (a[valueKey] || 0) - (b[valueKey] || 0));
    case 'name-asc':
      return stableSort([...data], (a, b) => compareName(a.name, b.name));
    case 'name-desc':
      return stableSort([...data], (a, b) => compareName(b.name, a.name));
    case 'date-asc':
      return stableSort([...data], (a, b) => compareDate(a.name, b.name));
    case 'date-desc':
      return stableSort([...data], (a, b) => compareDate(b.name, a.name));
    case 'original':
      return data;
    default:
      return data;
  }
};

const inferTemporalOrSequential = (values: Array<any>) => {
  const sample = values.filter(v => v !== null && v !== undefined && v !== '').slice(0, 50);
  if (sample.length < 3) return null;
  const dateCount = sample.filter(v => !!toDate(v)).length;
  if (dateCount / sample.length >= 0.6) return 'date' as const;
  const numCount = sample.filter(v => Number.isFinite(Number(String(v)))).length;
  if (numCount / sample.length >= 0.6) return 'number' as const;
  return null;
};

const toISODate = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createMajorBucketMapper = (rows: RawRow[], column: string, major: number) => {
  if (!Number.isFinite(major) || major <= 0) return null;
  const values = rows.map(r => r[column]);
  const kind = inferTemporalOrSequential(values);
  if (!kind) return null;

  if (kind === 'date') {
    let minMs = Infinity;
    for (const v of values) {
      const d = toDate(v);
      if (!d) continue;
      const ms = d.getTime();
      if (ms < minMs) minMs = ms;
    }
    if (!Number.isFinite(minMs)) return null;
    const min = new Date(minMs);
    min.setHours(0, 0, 0, 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    return (raw: any) => {
      const d = toDate(raw);
      if (!d) return '(Empty)';
      const date = new Date(d);
      date.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((date.getTime() - min.getTime()) / msPerDay);
      const bucketIndex = Math.max(0, Math.floor(diffDays / major));
      const start = new Date(min.getTime() + bucketIndex * major * msPerDay);
      const end = new Date(start.getTime() + (major - 1) * msPerDay);
      return `${toISODate(start)} - ${toISODate(end)}`;
    };
  }

  let min = Infinity;
  for (const v of values) {
    const n = Number(String(v));
    if (!Number.isFinite(n)) continue;
    if (n < min) min = n;
  }
  if (!Number.isFinite(min)) return null;
  return (raw: any) => {
    const n = Number(String(raw));
    if (!Number.isFinite(n)) return '(Empty)';
    const bucketIndex = Math.max(0, Math.floor((n - min) / major));
    const start = min + bucketIndex * major;
    const end = start + (major - 1);
    const startText = Number.isInteger(start) ? String(start) : start.toFixed(2);
    const endText = Number.isInteger(end) ? String(end) : end.toFixed(2);
    return `${startText}-${endText}`;
  };
};

const applyTopNLimiter = (
  rows: any[],
  widget: DashboardWidget,
  buildOthersRow?: (overflow: any[]) => any
) => {
  const limit = clampTopN(widget.topN);
  if (!limit || rows.length <= limit) return rows;

  const kept = rows.slice(0, limit);
  if (widget.groupOthers !== false && buildOthersRow) {
    const overflow = rows.slice(limit);
    if (overflow.length > 0) {
      const others = buildOthersRow(overflow);
      if (others) kept.push(others);
    }
  }
  return kept;
};

const sortMultiSeriesRows = (rows: any[], widget: DashboardWidget, orderOverride?: string) => {
  if (!rows || rows.length === 0 || !widget.series || widget.series.length === 0) return rows;
  const specified = widget.sortSeriesId && widget.series.find(s => s.id === widget.sortSeriesId);
  const fallback = widget.series.find(s => s.type === 'bar') || widget.series[0];
  const target = specified || fallback;
  if (!target) return rows;
  return applySorting(rows, orderOverride ?? widget.sortBy, target.id);
};

export const aggregateWidgetData = (
  widget: DashboardWidget,
  rows: RawRow[]
): AggregatedWidgetData => {
  if (widget.type === 'table') {
    let processed = [...rows];
    if (widget.measureCol) {
      processed.sort((a, b) => {
        const valA = a[widget.measureCol!];
        const valB = b[widget.measureCol!];
        if (typeof valA === 'number' && typeof valB === 'number') return (valB as number) - (valA as number);
        return String(valB).localeCompare(String(valA));
      });
    }
    const limit = normalizeLimit(widget.limit) ?? 20;
    return { data: processed.slice(0, limit), isStack: false };
  }

  if (widget.type === 'kpi') {
    const measure = widget.measure || 'count';
    let value = 0;
    if (measure === 'count') {
      const col = widget.measureCol;
      if (!col) {
        // Backward compatibility: old KPI count = row count
        value = rows.length;
      } else if (widget.kpiCountMode === 'group') {
        const excluded = new Set(widget.categoryFilter || []);
        const counts: Record<string, number> = {};

        rows.forEach((row) => {
          const raw = row[col];
          if (raw === null || raw === undefined) return;
          const s = String(raw).trim();
          if (!s) return;
          const tokens = widget.groupByString ? splitByString(s) : [s];
          for (const token of tokens) {
            counts[token] = (counts[token] || 0) + 1;
          }
        });

        value = Object.entries(counts).reduce((sum, [cat, cnt]) => {
          if (excluded.has(cat)) return sum;
          return sum + cnt;
        }, 0);
      } else {
        value = rows.reduce((acc, row) => {
          const raw = row[col];
          if (raw === null || raw === undefined) return acc;
          if (typeof raw === 'string' && raw.trim() === '') return acc;
          return acc + 1;
        }, 0);
      }
    } else if ((measure === 'sum' || measure === 'avg') && widget.measureCol) {
      let sum = 0;
      let count = 0;
      rows.forEach((row) => {
        const raw = row[widget.measureCol!];
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        sum += n;
        count += 1;
      });
      value = measure === 'avg' ? (count > 0 ? sum / count : 0) : sum;
    }
    return { data: [{ name: 'Value', value }], isStack: false };
  }

  if (widget.type === 'scatter' || widget.type === 'bubble') {
    // Check if using dual aggregation mode (xMeasure/yMeasure with dimension)
    if (widget.dimension && (widget.xMeasure || widget.yMeasure)) {
      // Group by dimension and aggregate X/Y values
      const groups: Record<string, { count: number; xSum: number; ySum: number; sizeSum: number }> = {};
      const excluded = new Set(widget.categoryFilter || []);

      rows.forEach(row => {
        const base = normalizeKey(row[widget.dimension!]);
        const dimValues = widget.groupByString ? splitByString(base) : [base];

        for (const dimVal of dimValues) {
          if (excluded.has(dimVal)) continue;
          if (!groups[dimVal]) {
            groups[dimVal] = { count: 0, xSum: 0, ySum: 0, sizeSum: 0 };
          }
          groups[dimVal].count++;

          // X value aggregation
          if (widget.xMeasureCol) {
            groups[dimVal].xSum += parseFloat(String(row[widget.xMeasureCol])) || 0;
          }

          // Y value aggregation
          if (widget.yMeasureCol) {
            groups[dimVal].ySum += parseFloat(String(row[widget.yMeasureCol])) || 0;
          }

          // Size (for bubble)
          if (widget.sizeDimension) {
            groups[dimVal].sizeSum += parseFloat(String(row[widget.sizeDimension])) || 0;
          }
        }
      });

      const result = Object.entries(groups).map(([name, data]) => {
        // Calculate X based on xMeasure
        let x = 0;
        if (widget.xMeasure === 'count') {
          x = data.count;
        } else if (widget.xMeasure === 'sum') {
          x = data.xSum;
        } else if (widget.xMeasure === 'avg') {
          x = data.count > 0 ? data.xSum / data.count : 0;
        }

        // Calculate Y based on yMeasure
        let y = 0;
        if (widget.yMeasure === 'count') {
          y = data.count;
        } else if (widget.yMeasure === 'sum') {
          y = data.ySum;
        } else if (widget.yMeasure === 'avg') {
          y = data.count > 0 ? data.ySum / data.count : 0;
        }

        return {
          name,
          x,
          y,
          size: widget.type === 'bubble' ? (data.sizeSum / data.count || 10) : 10,
          color: name
        };
      });

      return { data: result, isStack: false };
    }

    // Legacy mode: direct X/Y from columns
    const result = rows.map((row, idx) => ({
      name: `Point ${idx + 1}`,
      x: parseFloat(String(row[widget.xDimension!])) || 0,
      y: parseFloat(String(row[widget.yDimension!])) || 0,
      size: widget.type === 'bubble' ? (parseFloat(String(row[widget.sizeDimension!])) || 1) : 1,
      color: widget.colorBy ? String(row[widget.colorBy]) : 'default'
    }));
    return { data: result, isStack: false };
  }

  const isStackedChart = [
    'stacked-column', '100-stacked-column',
    'stacked-bar', '100-stacked-bar',
    'stacked-area', '100-stacked-area'
  ].includes(widget.type);

  const isLineFamily = ['line', 'smooth-line', 'area', 'stacked-area', '100-stacked-area'].includes(widget.type);
  const major = widget.xAxis?.major ?? 0;
  const majorBucket =
    isLineFamily && widget.dimension
      ? createMajorBucketMapper(rows, widget.dimension, major)
      : null;
  const getDimensionKey = (row: RawRow) => {
    const raw = row[widget.dimension];
    const base = majorBucket ? majorBucket(raw) : normalizeKey(raw);
    return base ? String(base) : '(Empty)';
  };
  const getDimensionKeys = (row: RawRow) => {
    const key = getDimensionKey(row);
    if (!widget.groupByString) return [key];
    return splitByString(key);
  };

  const inferredForLine = isLineFamily && widget.dimension
    ? inferTemporalOrSequential(rows.map(r => r[widget.dimension]))
    : null;

  const resolvedSortBy =
    inferredForLine && (!widget.sortBy || widget.sortBy === 'original')
      ? (inferredForLine === 'date' ? 'date-asc' : 'name-asc')
      : widget.sortBy;

  const is100Stacked = [
    '100-stacked-column', '100-stacked-bar', '100-stacked-area'
  ].includes(widget.type);

  if (isStackedChart && widget.stackBy) {
    const stackKeys = new Set<string>();
    const groups: Record<string, Record<string, number>> = {};

    rows.forEach(row => {
      const stackVal = normalizeKey(row[widget.stackBy!] ?? '(Other)');

      stackKeys.add(stackVal);
      const dimValues = getDimensionKeys(row);
      for (const dimVal of dimValues) {
        if (widget.categoryFilter && widget.categoryFilter.length > 0 && widget.categoryFilter.includes(dimVal)) {
          continue;
        }

        if (!groups[dimVal]) groups[dimVal] = {};
        if (!groups[dimVal][stackVal]) groups[dimVal][stackVal] = 0;

        if (widget.measure === 'count') {
          groups[dimVal][stackVal]++;
        } else if (widget.measure === 'sum' && widget.measureCol) {
          const val = Number(row[widget.measureCol]) || 0;
          groups[dimVal][stackVal] += val;
        } else if (widget.measure === 'avg' && widget.measureCol) {
          groups[dimVal][stackVal] += Number(row[widget.measureCol]) || 0;
        }
      }
    });

    const result = Object.keys(groups).map(dim => {
      const row: any = { name: dim };
      let total = 0;
      Object.keys(groups[dim]).forEach(stack => {
        row[stack] = groups[dim][stack];
        total += groups[dim][stack];
      });
      row.__total = total;
      return row;
    });

    const stackKeyList = Array.from(stackKeys);

    let finalRows = applySorting(result, resolvedSortBy, '__total');
    finalRows = applyTopNLimiter(finalRows, widget, (overflow) => {
      if (overflow.length === 0) return null;
      const othersRow: any = { name: 'Others', __total: 0 };
      stackKeyList.forEach(key => {
        const value = overflow.reduce((sum, row) => sum + (row[key] || 0), 0);
        othersRow[key] = value;
        othersRow.__total += value;
      });
      return othersRow;
    });

    if (is100Stacked) {
      finalRows = finalRows.map(row => {
        const total = row.__total || 0;
        const normalized: any = { name: row.name };
        stackKeyList.forEach(key => {
          normalized[key] = total === 0 ? 0 : (row[key] || 0) / total;
        });
        return normalized;
      });
    } else {
      finalRows = finalRows.map(row => {
        const clone = { ...row };
        delete clone.__total;
        return clone;
      });
    }

    return { data: finalRows, isStack: isStackedChart, stackKeys: stackKeyList };
  }

  const measure = widget.measure || 'count';
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};

  rows.forEach(row => {
    const dimValues = getDimensionKeys(row);
    for (const key of dimValues) {
      if (widget.categoryFilter && widget.categoryFilter.length > 0 && widget.categoryFilter.includes(key)) continue;

      if (measure === 'count') {
        sums[key] = (sums[key] || 0) + 1;
      } else if ((measure === 'sum' || measure === 'avg') && widget.measureCol) {
        sums[key] = (sums[key] || 0) + (Number(row[widget.measureCol]) || 0);
      }

      if (measure === 'avg') {
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  });

  let result = Object.keys(sums).map(key => ({
    name: key,
    value: measure === 'avg' ? (counts[key] ? sums[key] / counts[key] : 0) : sums[key]
  }));

  result = applySorting(result, resolvedSortBy, 'value');

  result = applyTopNLimiter(result, widget, (overflow) => {
    const total = overflow.reduce((acc, curr) => acc + (curr.value || 0), 0);
    return total > 0 ? { name: 'Others', value: total } : null;
  });

  if (!widget.topN) {
    const defaultLimit = inferredForLine ? MAX_TOP_N : 20;
    const limit = normalizeLimit(widget.limit) ?? defaultLimit;

    if (result.length > limit) {
      if (inferredForLine) {
        // For line/area (date/sequence), keep series (up to MAX_TOP_N) without grouping to "Others"
        result = result.slice(0, limit);
      } else if (!widget.categoryFilter && widget.type !== 'wordcloud') {
        const others = result.slice(limit).reduce((acc, curr) => acc + curr.value, 0);
        result = result.slice(0, limit);
        result.push({ name: 'Others', value: others });
      } else {
        result = result.slice(0, limit);
      }
    }
  }

  return { data: result, isStack: false };
};

export const processMultiSeriesData = (widget: DashboardWidget, rows: RawRow[]) => {
  if (!widget.series || widget.series.length === 0 || !widget.dimension) return [];

  const majorBucket = createMajorBucketMapper(rows, widget.dimension, widget.xAxis?.major ?? 0);
  const getDimKey = (row: RawRow) => {
    const raw = row[widget.dimension!];
    const base = majorBucket ? majorBucket(raw) : normalizeKey(raw);
    return base ? String(base) : '(Empty)';
  };
  const getDimKeys = (row: RawRow) => {
    const key = getDimKey(row);
    if (!widget.groupByString) return [key];
    return splitByString(key);
  };

  const result: Record<string, any> = {};

  widget.series.forEach(series => {
    let seriesRows = applyWidgetFilters(rows, widget.filters);
    if (series.filters && series.filters.length > 0) {
      seriesRows = applyWidgetFilters(seriesRows, series.filters);
    }

    seriesRows.forEach(row => {
      const dimValues = getDimKeys(row);
      for (const dimValue of dimValues) {
        if (widget.categoryFilter && widget.categoryFilter.length > 0 && widget.categoryFilter.includes(dimValue)) {
          continue;
        }

        if (!result[dimValue]) {
          result[dimValue] = { [widget.dimension!]: dimValue, name: dimValue };
        }

        if (series.measure === 'count') {
          result[dimValue][series.id] = (result[dimValue][series.id] || 0) + 1;
        } else if (series.measure === 'sum' && series.measureCol) {
          const val = parseFloat(String(row[series.measureCol])) || 0;
          result[dimValue][series.id] = (result[dimValue][series.id] || 0) + val;
        } else if (series.measure === 'avg' && series.measureCol) {
          if (!result[dimValue][`${series.id}_sum`]) {
            result[dimValue][`${series.id}_sum`] = 0;
            result[dimValue][`${series.id}_count`] = 0;
          }
          const val = parseFloat(String(row[series.measureCol])) || 0;
          result[dimValue][`${series.id}_sum`] += val;
          result[dimValue][`${series.id}_count`] += 1;
        }
      }
    });
  });

  Object.values(result).forEach(item => {
    widget.series!.forEach(series => {
      if (series.measure === 'avg') {
        const count = item[`${series.id}_count`] || 0;
        if (count > 0) {
          item[series.id] = item[`${series.id}_sum`] / count;
        }
      }
    });
  });

  const rowEntries = Object.values(result);
  const isLineFamily = ['line', 'smooth-line', 'area', 'stacked-area', '100-stacked-area'].includes(widget.type);
  const inferredForLine = isLineFamily && widget.dimension
    ? inferTemporalOrSequential(rows.map(r => r[widget.dimension!]))
    : null;
  const resolvedSortBy =
    inferredForLine && (!widget.sortBy || widget.sortBy === 'original')
      ? (inferredForLine === 'date' ? 'date-asc' : 'name-asc')
      : widget.sortBy;
  const sorted = sortMultiSeriesRows(rowEntries, widget, resolvedSortBy);
  const dimensionKey = widget.dimension!;
  const limited = applyTopNLimiter(sorted, widget, (overflow) => {
    if (!overflow.length) return null;
    const othersRow: any = { [dimensionKey]: 'Others', name: 'Others' };
    widget.series!.forEach(series => {
      if (series.measure === 'avg') {
        const sumKey = `${series.id}_sum`;
        const countKey = `${series.id}_count`;
        const totalSum = overflow.reduce((sum, row) => sum + (row[sumKey] || 0), 0);
        const totalCount = overflow.reduce((sum, row) => sum + (row[countKey] || 0), 0);
        othersRow[sumKey] = totalSum;
        othersRow[countKey] = totalCount;
        othersRow[series.id] = totalCount === 0 ? 0 : totalSum / totalCount;
      } else {
        othersRow[series.id] = overflow.reduce((sum, row) => sum + (row[series.id] || 0), 0);
      }
    });
    return othersRow;
  });
  return limited.map(row => {
    const clean = { ...row };
    widget.series!.forEach(series => {
      delete clean[`${series.id}_sum`];
      delete clean[`${series.id}_count`];
    });
    return clean;
  });
};

export const getTopNOverflowDimensionValues = (widget: DashboardWidget, rows: RawRow[]) => {
  const limit = clampTopN(widget.topN);
  if (!limit) return [];
  if (widget.groupOthers === false) return [];
  if (!widget.dimension) return [];

  const excluded = new Set(widget.categoryFilter || []);

  const isStackedChart = [
    'stacked-column', '100-stacked-column',
    'stacked-bar', '100-stacked-bar',
    'stacked-area', '100-stacked-area'
  ].includes(widget.type);

  const isLineFamily = ['line', 'smooth-line', 'area', 'stacked-area', '100-stacked-area'].includes(widget.type);
  const major = widget.xAxis?.major ?? 0;
  const majorBucket =
    isLineFamily && widget.dimension
      ? createMajorBucketMapper(rows, widget.dimension, major)
      : null;
  const getDimensionKey = (row: RawRow) => {
    const raw = row[widget.dimension];
    const base = majorBucket ? majorBucket(raw) : normalizeKey(raw);
    return base ? String(base) : '(Empty)';
  };

  const inferredForLine = isLineFamily && widget.dimension
    ? inferTemporalOrSequential(rows.map(r => r[widget.dimension]))
    : null;

  const resolvedSortBy =
    inferredForLine && (!widget.sortBy || widget.sortBy === 'original')
      ? (inferredForLine === 'date' ? 'date-asc' : 'name-asc')
      : widget.sortBy;

  if (widget.series && widget.series.length > 0) {
    const result: Record<string, any> = {};
    widget.series.forEach(series => {
      let seriesRows = rows;
      if (series.filters && series.filters.length > 0) {
        seriesRows = applyWidgetFilters(seriesRows, series.filters);
      }

      seriesRows.forEach(row => {
        const dimValues = getDimensionKeys(row);
        for (const dimValue of dimValues) {
          if (excluded.has(dimValue)) continue;

          if (!result[dimValue]) {
            result[dimValue] = { [widget.dimension!]: dimValue, name: dimValue };
          }

          if (series.measure === 'count') {
            result[dimValue][series.id] = (result[dimValue][series.id] || 0) + 1;
          } else if (series.measure === 'sum' && series.measureCol) {
            const val = parseFloat(String(row[series.measureCol])) || 0;
            result[dimValue][series.id] = (result[dimValue][series.id] || 0) + val;
          } else if (series.measure === 'avg' && series.measureCol) {
            if (!result[dimValue][`${series.id}_sum`]) {
              result[dimValue][`${series.id}_sum`] = 0;
              result[dimValue][`${series.id}_count`] = 0;
            }
            const val = parseFloat(String(row[series.measureCol])) || 0;
            result[dimValue][`${series.id}_sum`] += val;
            result[dimValue][`${series.id}_count`] += 1;
          }
        }
      });
    });

    Object.values(result).forEach(item => {
      widget.series!.forEach(series => {
        if (series.measure === 'avg') {
          const count = item[`${series.id}_count`] || 0;
          if (count > 0) {
            item[series.id] = item[`${series.id}_sum`] / count;
          }
        }
      });
    });

    const rowEntries = Object.values(result);
    const sorted = sortMultiSeriesRows(rowEntries, widget, resolvedSortBy);
    return sorted.slice(limit).map((row: any) => String(row.name));
  }

  if (isStackedChart && widget.stackBy) {
    const stackKeys = new Set<string>();
    const groups: Record<string, Record<string, number>> = {};

    rows.forEach(row => {
      const stackVal = normalizeKey(row[widget.stackBy!] ?? '(Other)');

      stackKeys.add(stackVal);
      const dimValues = getDimensionKeys(row);
      for (const dimVal of dimValues) {
        if (excluded.has(dimVal)) continue;

        if (!groups[dimVal]) groups[dimVal] = {};
        if (!groups[dimVal][stackVal]) groups[dimVal][stackVal] = 0;

        if (widget.measure === 'count') {
          groups[dimVal][stackVal]++;
        } else if (widget.measure === 'sum' && widget.measureCol) {
          const val = Number(row[widget.measureCol]) || 0;
          groups[dimVal][stackVal] += val;
        } else if (widget.measure === 'avg' && widget.measureCol) {
          // Keep behavior consistent with aggregateWidgetData (sum-based for stacked avg).
          groups[dimVal][stackVal] += Number(row[widget.measureCol]) || 0;
        }
      }
    });

    const result = Object.keys(groups).map(dim => {
      const row: any = { name: dim };
      let total = 0;
      Object.keys(groups[dim]).forEach(stack => {
        row[stack] = groups[dim][stack];
        total += groups[dim][stack];
      });
      row.__total = total;
      return row;
    });

    const sorted = applySorting(result, resolvedSortBy, '__total');
    return sorted.slice(limit).map((row: any) => String(row.name));
  }

  const measure = widget.measure || 'count';
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};

  rows.forEach(row => {
    const dimValues = getDimensionKeys(row);
    for (const key of dimValues) {
      if (excluded.has(key)) continue;

      if (measure === 'count') {
        sums[key] = (sums[key] || 0) + 1;
        continue;
      }

      if ((measure === 'sum' || measure === 'avg') && widget.measureCol) {
        const n = Number(row[widget.measureCol]) || 0;
        sums[key] = (sums[key] || 0) + n;
        if (measure === 'avg') {
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    }
  });

  let result = Object.keys(sums).map(key => ({
    name: key,
    value: measure === 'avg' ? (counts[key] ? sums[key] / counts[key] : 0) : sums[key]
  }));

  result = applySorting(result, resolvedSortBy, 'value');

  return result.slice(limit).map(r => String(r.name));
};
