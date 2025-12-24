import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List } from 'react-window';
import { Plus, Save, Loader2, Search, Eraser, Trash2, Filter, X, Table2, Sparkles } from 'lucide-react';
import { ColumnConfig, DataSource, Project, RawRow } from '../types';
import {
  ensureDataSources,
  getDataSourcesByKind,
  updateDataSourceRows,
  addDerivedDataSource,
  isDataSourceNameTaken,
} from '../utils/dataSources';
import { getProjectLight, hydrateProjectDataSourceRows, saveProject } from '../utils/storage-compat';
import { useToast } from '../components/ToastProvider';
import { useTransformPipelineWorker } from '../hooks/useTransformPipelineWorker';
import TableColumnFilter from '../components/TableColumnFilter';

interface CleansingDataProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
}

const ROW_HEIGHT = 40;
const PAGE_SIZE = 200;
const COL_WIDTH = 220;
const ROWNUM_WIDTH = 56;
const ACTION_WIDTH = 56;

type PageEntry = { rows: RawRow[]; rowIndices: number[] };

const renderCellValue = (val: any) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
};

const CleansingRow = React.memo(function CleansingRow(props: any) {
  const { index, style, columns, pages, pageSize, onDelete, tableWidth, scrollLeft } = props as {
    index: number;
    style: React.CSSProperties;
    columns: ColumnConfig[];
    pages: Record<number, PageEntry>;
    pageSize: number;
    onDelete: (rowIndex: number) => void;
    tableWidth: number;
    scrollLeft: number;
  };

  const page = Math.floor(index / pageSize);
  const offset = index % pageSize;
  const entry = pages[page];
  const row = entry?.rows?.[offset];
  const rowIndex = entry?.rowIndices?.[offset];

  return (
    <div style={{ ...style, width: '100%' }} className="border-b border-gray-100 bg-white hover:bg-gray-50 text-sm text-gray-700 overflow-x-hidden">
      <div className="flex items-center" style={{ width: tableWidth, transform: `translateX(-${scrollLeft}px)` }}>
        <div className="flex-shrink-0 px-3 text-xs font-mono text-gray-400" style={{ width: ROWNUM_WIDTH }}>
          {typeof rowIndex === 'number' ? rowIndex + 1 : ''}
        </div>
        {columns.map((col) => {
          const v = row ? (row as any)[col.key] : '';
          const rendered = row ? renderCellValue(v) : '';
          return (
            <div
              key={col.key}
              className="px-3 truncate"
              style={{ width: COL_WIDTH }}
              title={rendered}
            >
              {rendered}
            </div>
          );
        })}
        <div className="flex-shrink-0 flex items-center justify-center" style={{ width: ACTION_WIDTH }}>
          <button
            onClick={() => {
              if (typeof rowIndex === 'number') onDelete(rowIndex);
            }}
            disabled={typeof rowIndex !== 'number'}
            className="text-gray-300 hover:text-red-500 disabled:opacity-40"
            aria-label="Delete row"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

const CleansingData: React.FC<CleansingDataProps> = ({ project, onUpdateProject }) => {
  const needsNormalization = !project.dataSources?.length || !project.activeDataSourceId;
  const { project: normalizedProject } = useMemo(() => ensureDataSources(project), [project]);
  useEffect(() => {
    if (needsNormalization) {
      onUpdateProject(normalizedProject);
    }
  }, [needsNormalization, normalizedProject, onUpdateProject]);

  const ingestionSources = useMemo(() => getDataSourcesByKind(normalizedProject, 'ingestion'), [normalizedProject]);
  const preparedSources = useMemo(() => getDataSourcesByKind(normalizedProject, 'prepared'), [normalizedProject]);

  const allSources: DataSource[] = useMemo(
    () => [...ingestionSources, ...preparedSources].sort((a, b) => b.updatedAt - a.updatedAt),
    [ingestionSources, preparedSources]
  );

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [tableName, setTableName] = useState('');
  const [nameError, setNameError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeToolMode, setActiveToolMode] = useState<'none' | 'cleaner'>('none');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [targetCol, setTargetCol] = useState<string>('all');
  const [isSaving, setIsSaving] = useState(false);
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'> | null>(null);
  const [filters, setFilters] = useState<Record<string, string[] | null>>({});
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});

  const { showToast } = useToast();
  const transformWorker = useTransformPipelineWorker();

  const selectedSource = useMemo(() => allSources.find((s) => s.id === selectedSourceId) || null, [allSources, selectedSourceId]);
  // REMOVED: Auto-select logic to respect Pro UX
  // useEffect(() => {
  //   if (!selectedSource && allSources.length) {
  //     setSelectedSourceId(allSources[0].id);
  //   }
  // }, [allSources, selectedSource]);

  const workingRows = selectedSource?.rows || [];
  const workingColumns = selectedSource?.columns || [];

  const [queryVersion, setQueryVersion] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const hasActiveFilters = Object.values(filters).some((v) => Array.isArray(v) && v.length > 0);

  const [totalRows, setTotalRows] = useState(0);
  const [hasResultCount, setHasResultCount] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [pageCache, setPageCache] = useState<Record<number, { rows: RawRow[]; rowIndices: number[] }>>({});
  const pageCacheRef = useRef<Record<number, { rows: RawRow[]; rowIndices: number[] }>>({});
  useEffect(() => {
    pageCacheRef.current = pageCache;
  }, [pageCache]);

  const queryReqRef = useRef(0);
  const loadingPagesRef = useRef<Set<number>>(new Set());
  const lastErrorReqRef = useRef<number | null>(null);

  const queryKey = useMemo(() => {
    return JSON.stringify({
      sourceId: selectedSource?.id ?? null,
      q: String(debouncedSearch || '').trim(),
      filters,
      v: queryVersion,
    });
  }, [selectedSource?.id, debouncedSearch, filters, queryVersion]);

  const loadPage = useCallback(
    async (page: number) => {
      if (!selectedSource) return;
      if (pageCacheRef.current[page]) return;
      if (loadingPagesRef.current.has(page)) return;

      loadingPagesRef.current.add(page);
      const reqId = queryReqRef.current;

      try {
        if (transformWorker.isSupported) {
          const resp = await transformWorker.cleanQueryPage({
            projectId: normalizedProject.id,
            sourceId: selectedSource.id,
            searchQuery: debouncedSearch,
            page,
            pageSize: PAGE_SIZE,
            filters,
          });
          if (reqId !== queryReqRef.current) return;
          setTotalRows(resp.totalRows);
          setHasResultCount(true);
          if (page === 0) {
            setQueryError(null);
            lastErrorReqRef.current = null;
          }
          setPageCache((prev) => ({ ...prev, [page]: { rows: resp.rows, rowIndices: resp.rowIndices } }));
          return;
        }

        const q = String(debouncedSearch || '').trim().toLowerCase();
        const activeFilters = Object.entries(filters).filter(([, v]) => Array.isArray(v) && v.length > 0) as Array<
          [string, string[]]
        >;

        const allRowIndices: number[] = [];
        for (let i = 0; i < workingRows.length; i++) {
          const row = workingRows[i];
          const match = !q || Object.values(row).some((val) => String(val ?? '').toLowerCase().includes(q));
          if (!match) continue;

          if (activeFilters.length > 0) {
            let ok = true;
            for (const [colKey, allowed] of activeFilters) {
              const raw = (row as any)[colKey];
              const normalized = raw === null || raw === undefined || raw === '' ? '(Blank)' : String(raw);
              if (!allowed.includes(normalized)) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
          }

          allRowIndices.push(i);
        }

        const start = page * PAGE_SIZE;
        const slice = allRowIndices.slice(start, start + PAGE_SIZE);
        const rows = slice.map((idx) => workingRows[idx]);
        setTotalRows(allRowIndices.length);
        setHasResultCount(true);
        if (page === 0) {
          setQueryError(null);
          lastErrorReqRef.current = null;
        }
        setPageCache((prev) => ({ ...prev, [page]: { rows, rowIndices: slice } }));
      } catch (e) {
        if (reqId !== queryReqRef.current) return;
        console.error('[CleansingData] query page failed:', e);
        if (page === 0) {
          setTotalRows(0);
          setPageCache({});
          setHasResultCount(true);
          setQueryError('Query failed');
        }
        if (lastErrorReqRef.current !== reqId) {
          lastErrorReqRef.current = reqId;
          showToast('Query failed', 'Unable to load rows.', 'error');
        }
      } finally {
        loadingPagesRef.current.delete(page);
      }
    },
    [selectedSource, transformWorker.isSupported, transformWorker.cleanQueryPage, normalizedProject.id, debouncedSearch, filters, workingRows, showToast]
  );

  useEffect(() => {
    queryReqRef.current += 1;
    loadingPagesRef.current.clear();
    setPageCache({});
    setTotalRows(0);
    setHasResultCount(false);
    setQueryError(null);
    if (!selectedSource) return;
    void loadPage(0);
  }, [queryKey, selectedSource?.id, loadPage]);

  const tableWidth = useMemo(() => ROWNUM_WIDTH + workingColumns.length * COL_WIDTH + ACTION_WIDTH, [workingColumns.length]);
  const [listHeight, setListHeight] = useState(520);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollBarRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const scheduleScrollLeftUpdate = useCallback((next: number) => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollLeft(next);
    });
  }, []);

  useEffect(() => {
    const node = listContainerRef.current;
    if (!node) return;

    const apply = () => {
      const next = node.clientHeight || 520;
      setListHeight(next);
    };

    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(node);
    return () => ro.disconnect();
  }, [selectedSource?.id]);

  useEffect(() => {
    const node = scrollBarRef.current;
    if (!node) return;
    node.scrollLeft = scrollLeft;
  }, [tableWidth]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setScrollLeft(0);
    if (scrollBarRef.current) scrollBarRef.current.scrollLeft = 0;
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
  }, [selectedSource?.id]);

  useEffect(() => {
    if (!openFilterCol) return;
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
  }, [scrollLeft]);

  const handleItemsRendered = useCallback(
    (_visible: { startIndex: number; stopIndex: number }, all: { startIndex: number; stopIndex: number }) => {
      const startPage = Math.floor((all?.startIndex ?? 0) / PAGE_SIZE);
      const endPage = Math.floor((all?.stopIndex ?? 0) / PAGE_SIZE);
      for (let p = startPage; p <= endPage; p++) {
        void loadPage(p);
      }
    },
    [loadPage]
  );

  const sourceRowCount =
    typeof selectedSource?.rowCount === 'number' ? selectedSource.rowCount : selectedSource?.rows.length || 0;

  useEffect(() => {
    if (!openFilterCol || !selectedSource) return;
    if (filterOptions[openFilterCol]?.length) return;

    const run = async () => {
      try {
        if (transformWorker.isSupported) {
          const options = await transformWorker.cleanColumnOptions({
            projectId: normalizedProject.id,
            sourceId: selectedSource.id,
            columnKey: openFilterCol,
            limitRows: 20000,
            limitValues: 500,
          });
          setFilterOptions((prev) => ({ ...prev, [openFilterCol]: options }));
          return;
        }

        const values = new Set<string>();
        let sawBlank = false;
        for (const row of workingRows) {
          const raw = (row as any)[openFilterCol];
          if (raw === null || raw === undefined || raw === '') sawBlank = true;
          else values.add(String(raw));
          if (values.size >= 500) break;
        }
        const out = Array.from(values).sort();
        if (sawBlank) out.unshift('(Blank)');
        setFilterOptions((prev) => ({ ...prev, [openFilterCol]: out }));
      } catch (e) {
        console.error('[CleansingData] filter options failed:', e);
      }
    };

    void run();
  }, [openFilterCol, selectedSource, filterOptions, transformWorker.isSupported, transformWorker.cleanColumnOptions, normalizedProject.id, workingRows]);

  const persistSource = async (rows: RawRow[], columns: ColumnConfig[] = workingColumns) => {
    if (!selectedSource) return;
    const updated = updateDataSourceRows(normalizedProject, selectedSource.id, rows, columns, 'replace');
    await saveProject(updated);
    onUpdateProject(updated);
  };

  const handleSelect = (source: DataSource) => {
    setSelectedSourceId(source.id);
    setShowPicker(false);
    setOpenFilterCol(null);
    setFilters({});
    setFilterOptions({});
    setSearchQuery('');
    setActiveToolMode('none');
    setFindText('');
    setReplaceText('');
    setTargetCol('all');
    setQueryVersion((v) => v + 1);
    if (!transformWorker.isSupported) {
      void (async () => {
        const hydrated = await hydrateProjectDataSourceRows(normalizedProject, source.id);
        onUpdateProject(hydrated);
      })();
    }
  };

  const handleFindReplace = async () => {
    if (!findText.trim()) return;
    if (selectedSource && transformWorker.isSupported) {
      try {
        await transformWorker.cleanApplyFindReplace({
          projectId: normalizedProject.id,
          sourceId: selectedSource.id,
          targetCol,
          findText,
          replaceText,
        });
        const refreshed = await getProjectLight(normalizedProject.id);
        if (refreshed) onUpdateProject(refreshed);
        setOpenFilterCol(null);
        setFilterOptions({});
        setFilters({});
        setSearchQuery('');
        setQueryVersion((v) => v + 1);
      } catch (e: any) {
        console.error('[CleansingData] Find & Replace failed:', e);
        showToast('Apply failed', e?.message || 'Unable to update rows.', 'error');
      }
      return;
    }
    const colsToSearch = targetCol === 'all' ? workingColumns.map((c) => c.key) : [targetCol];
    const newRows = workingRows.map((row) => {
      const next = { ...row };
      colsToSearch.forEach((key) => {
        const val = next[key];
        if (typeof val === 'string' && val.includes(findText)) {
          next[key] = val.split(findText).join(replaceText);
        }
      });
      return next;
    });
    await persistSource(newRows, workingColumns);
    setOpenFilterCol(null);
    setFilterOptions({});
    setFilters({});
    setSearchQuery('');
    setQueryVersion((v) => v + 1);
  };

  const handleDeleteRow = async (index: number) => {
    if (selectedSource && transformWorker.isSupported) {
      try {
        await transformWorker.cleanDeleteRow({
          projectId: normalizedProject.id,
          sourceId: selectedSource.id,
          rowIndex: index,
        });
        const refreshed = await getProjectLight(normalizedProject.id);
        if (refreshed) onUpdateProject(refreshed);
        setOpenFilterCol(null);
        setFilterOptions({});
        setQueryVersion((v) => v + 1);
      } catch (e: any) {
        console.error('[CleansingData] delete row failed:', e);
        showToast('Delete failed', e?.message || 'Unable to delete row.', 'error');
      }
      return;
    }
    const next = workingRows.filter((_, i) => i !== index);
    await persistSource(next, workingColumns);
    setOpenFilterCol(null);
    setFilterOptions({});
    setQueryVersion((v) => v + 1);
  };

  const openNameModal = () => {
    if (!selectedSource) return;
    setTableName(`${selectedSource.name} - Cleansed`);
    setNameError('');
    setShowNameModal(true);
  };

  const confirmSave = async () => {
    const trimmed = tableName.trim();
    if (!trimmed) {
      setNameError('Name required.');
      return;
    }
    if (isDataSourceNameTaken(normalizedProject, { kind: 'prepared', name: trimmed })) {
      setNameError('Name exists.');
      return;
    }
    if (!selectedSource) return;
    setIsSaving(true);
    try {
      if (transformWorker.isSupported) {
        await transformWorker.cloneSource({
          projectId: normalizedProject.id,
          sourceId: selectedSource.id,
          name: trimmed,
          kind: 'prepared',
        });
        const refreshed = await getProjectLight(normalizedProject.id);
        if (refreshed) onUpdateProject(refreshed);
        showToast('Saved', 'Table stored under Preparation Data.', 'success');
        setShowNameModal(false);
        setTimeout(() => setIsSaving(false), 300);
        return;
      }

      const hydrated = selectedSource.rows.length
        ? normalizedProject
        : await hydrateProjectDataSourceRows(normalizedProject, selectedSource.id);
      const src = (hydrated.dataSources || []).find((s) => s.id === selectedSource.id) || selectedSource;
      const updated = addDerivedDataSource(hydrated, trimmed, src.rows, src.columns, 'prepared');
      await saveProject(updated);
      onUpdateProject(updated);
      showToast('Saved', 'Table stored under Preparation Data.', 'success');
      setTimeout(() => setIsSaving(false), 300);
      setShowNameModal(false);
    } catch (e: any) {
      console.error('[CleansingData] Save failed:', e);
      showToast('Save failed', e?.message || 'Unable to save table.', 'error');
      setTimeout(() => setIsSaving(false), 300);
    }
  };

  return (
    <div className="h-full flex flex-col px-10 py-8 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Cleansing Data</h1>
        </div>
        <div className="flex items-center space-x-3">
          {selectedSource && (
            <button
              onClick={openNameModal}
              disabled={isSaving}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save to Preparation
            </button>
          )}
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            <Plus className="w-4 h-4 mr-2" />
            Tables
          </button>
        </div>
      </div>

      {!selectedSource && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <div className="flex flex-col items-center space-y-2">
            <p className="text-sm font-medium text-gray-500">No data source selected</p>
          </div>
        </div>
      )}

      {selectedSource && (
        <div className="flex-1 flex flex-col border border-gray-200 rounded-xl bg-white shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs uppercase tracking-wide text-gray-500">Working source</p>
              <div className="flex items-center space-x-2 text-gray-900 font-semibold">
                <span>{selectedSource.name}</span>
                <span className="text-xs font-medium text-gray-500">
                  {(hasResultCount ? totalRows : sourceRowCount).toLocaleString()} rows
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Search rows"
                />
              </div>
              {hasActiveFilters && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-700">
                  <Filter className="w-3.5 h-3.5 text-gray-400" />
                  <span>Filters</span>
                </div>
              )}
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setActiveToolMode(activeToolMode === 'cleaner' ? 'none' : 'cleaner')}
                  className={`px-3 py-1 text-xs font-medium rounded-md flex items-center ${
                    activeToolMode === 'cleaner' ? 'bg-white shadow text-blue-700' : 'text-gray-600'
                  }`}
                >
                  <Eraser className="w-3 h-3 mr-1" />
                  Find & Replace
                </button>
              </div>
            </div>
          </div>

          {activeToolMode === 'cleaner' && (
            <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center space-x-3">
              <span className="text-sm font-semibold text-blue-900">Find & Replace</span>
              <input
                className="px-3 py-2 text-sm border rounded-lg w-40"
                placeholder="Find"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
              />
              <input
                className="px-3 py-2 text-sm border rounded-lg w-40"
                placeholder="Replace"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
              />
              <select
                className="px-3 py-2 text-sm border rounded-lg"
                value={targetCol}
                onChange={(e) => setTargetCol(e.target.value)}
              >
                <option value="all">All columns</option>
                {workingColumns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.key}
                  </option>
                ))}
              </select>
              <button
                onClick={handleFindReplace}
                className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                Apply
              </button>
            </div>
          )}

          <div className="flex-1 overflow-x-hidden overflow-y-visible" onClick={() => setOpenFilterCol(null)}>
            <div
              className="h-full flex flex-col"
              onWheel={(e) => {
                if (!scrollBarRef.current) return;
                if (!e.deltaX) return;
                scrollBarRef.current.scrollLeft += e.deltaX;
                scheduleScrollLeftUpdate(scrollBarRef.current.scrollLeft);
              }}
            >
              <div className="flex text-xs text-gray-600 uppercase bg-gray-50 border-b border-gray-200 sticky top-0 z-10 overflow-x-hidden">
                <div className="flex" style={{ width: tableWidth, transform: `translateX(-${scrollLeft}px)` }}>
                  <div className="px-3 py-3 border-r border-gray-200" style={{ width: ROWNUM_WIDTH }}>
                    #
                  </div>
                  {workingColumns.map((col) => (
                    <div
                      key={col.key}
                      className="px-3 py-3 border-r border-gray-200 font-semibold whitespace-nowrap relative flex items-center justify-between gap-2"
                      style={{ width: COL_WIDTH }}
                    >
                      <span className="truncate">{col.key}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setFilterAnchorRect({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
                            setOpenFilterCol((prev) => {
                              const next = prev === col.key ? null : col.key;
                              if (!next) setFilterAnchorRect(null);
                              return next;
                            });
                          }}
                          className={`p-1 rounded hover:bg-gray-100 ${
                            Array.isArray(filters[col.key]) && (filters[col.key] || []).length > 0
                              ? 'text-blue-600'
                              : 'text-gray-400 hover:text-gray-600'
                          }`}
                          aria-label={`Filter ${col.key}`}
                        >
                          <Filter className="w-3.5 h-3.5" />
                        </button>
                      {openFilterCol === col.key && (
                        <TableColumnFilter
                          column={col.key}
                          data={workingRows}
                          options={filterOptions[col.key]}
                          activeFilters={Array.isArray(filters[col.key]) ? (filters[col.key] as string[]) : null}
                          anchorRect={filterAnchorRect}
                          onApply={(selected) => {
                            setFilters((prev) => {
                              const next = { ...prev } as typeof prev;
                              if (!selected || selected.length === 0) {
                                delete (next as any)[col.key];
                                return next;
                              }
                              (next as any)[col.key] = selected;
                              return next;
                            });
                            setQueryVersion((v) => v + 1);
                          }}
                          onClose={() => {
                            setOpenFilterCol(null);
                            setFilterAnchorRect(null);
                          }}
                        />
                      )}
                    </div>
                  ))}
                  <div className="px-3 py-3" style={{ width: ACTION_WIDTH }} />
                </div>
              </div>

              <div ref={listContainerRef} className="flex-1 overflow-hidden">
                {queryError ? (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                    {queryError}
                  </div>
                ) : !hasResultCount ? (
                  <div className="h-full flex items-center justify-center text-gray-300">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : totalRows === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                    No records
                  </div>
                ) : (
                  <List
                    defaultHeight={listHeight}
                    rowCount={totalRows}
                    rowHeight={ROW_HEIGHT}
                    overscanCount={5}
                    rowComponent={CleansingRow as any}
                    rowProps={{ columns: workingColumns, pages: pageCache, pageSize: PAGE_SIZE, onDelete: handleDeleteRow, tableWidth, scrollLeft }}
                    onRowsRendered={handleItemsRendered as any}
                    style={{ height: listHeight, width: '100%', overflowX: 'hidden' }}
                  />
                )}
              </div>

              <div className="border-t border-gray-100 bg-gray-50">
                <div
                  ref={scrollBarRef}
                  className="h-4 overflow-x-auto overflow-y-hidden"
                  onScroll={(e) => scheduleScrollLeftUpdate((e.currentTarget as HTMLDivElement).scrollLeft)}
                >
                  <div style={{ width: tableWidth, height: 1 }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-gray-800">Select Data Source</h3>
              <button onClick={() => setShowPicker(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Ingestion Data</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ingestionSources.length === 0 ? (
                    <div className="col-span-full text-center py-4 text-gray-400 text-sm bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      No ingestion data
                    </div>
                  ) : (
                    ingestionSources.map((src) => (
                      <button
                        key={src.id}
                        onClick={() => handleSelect(src)}
                        className={`flex items-start p-3 rounded-lg border text-left transition-all hover:shadow-md ${
                          selectedSourceId === src.id
                            ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                            : 'border-gray-200 hover:border-indigo-300 bg-white'
                        }`}
                      >
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg mr-3">
                          <Table2 className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">{src.name}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {(typeof src.rowCount === 'number' ? src.rowCount : src.rows.length).toLocaleString()} rows
                          </div>
                          <div className="text-[10px] text-gray-400 mt-1">Updated: {new Date(src.updatedAt).toLocaleDateString()}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Prepared Data</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {preparedSources.length === 0 ? (
                    <div className="col-span-full text-center py-4 text-gray-400 text-sm bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      No prepared data
                    </div>
                  ) : (
                    preparedSources.map((src) => (
                      <button
                        key={src.id}
                        onClick={() => handleSelect(src)}
                        className={`flex items-start p-3 rounded-lg border text-left transition-all hover:shadow-md ${
                          selectedSourceId === src.id
                            ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                            : 'border-gray-200 hover:border-indigo-300 bg-white'
                        }`}
                      >
                        <div className="p-2 bg-purple-100 text-purple-600 rounded-lg mr-3">
                          <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">{src.name}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {(typeof src.rowCount === 'number' ? src.rowCount : src.rows.length).toLocaleString()} rows
                          </div>
                          <div className="text-[10px] text-gray-400 mt-1">Updated: {new Date(src.updatedAt).toLocaleDateString()}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNameModal && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center px-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-wide text-blue-600 font-semibold">Prepared table</p>
              <h3 className="text-xl font-bold text-gray-900">Table Name</h3>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Table name</label>
              <input
                autoFocus
                value={tableName}
                onChange={(e) => {
                  setTableName(e.target.value);
                  setNameError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmSave();
                  }
                }}
                className={`w-full rounded-lg border ${nameError ? 'border-red-300 focus:ring-red-200' : 'border-gray-200 focus:ring-blue-200'} px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2`}
                placeholder="Table"
              />
              {nameError && <p className="text-xs text-red-600">{nameError}</p>}
            </div>
            <div className="flex justify-end space-x-3 pt-2">
              <button onClick={() => setShowNameModal(false)} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={confirmSave}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CleansingData;
