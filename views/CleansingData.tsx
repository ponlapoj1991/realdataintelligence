import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Loader2, Search, Eraser, Trash2, Filter } from 'lucide-react';
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

  const [previewRows, setPreviewRows] = useState<RawRow[]>([]);
  const [previewRowIndices, setPreviewRowIndices] = useState<number[]>([]);
  const [previewVersion, setPreviewVersion] = useState(0);
  const previewReqRef = useRef(0);

  useEffect(() => {
    if (!selectedSource) {
      setPreviewRows([]);
      setPreviewRowIndices([]);
      return;
    }

    const reqId = (previewReqRef.current += 1);
    const run = async () => {
      try {
        if (transformWorker.isSupported) {
          const resp = await transformWorker.cleanPreview({
            projectId: normalizedProject.id,
            sourceId: selectedSource.id,
            searchQuery,
            limit: 50,
            filters,
          });
          if (reqId !== previewReqRef.current) return;
          setPreviewRows(resp.rows);
          setPreviewRowIndices(resp.rowIndices);
          return;
        }

        const q = searchQuery.trim().toLowerCase();
        const activeFilters = Object.entries(filters).filter(([, v]) => Array.isArray(v) && v.length > 0) as Array<
          [string, string[]]
        >;
        const rows: RawRow[] = [];
        const indices: number[] = [];
        for (let i = 0; i < workingRows.length && rows.length < 50; i++) {
          const row = workingRows[i];
          const match =
            !q || Object.values(row).some((val) => String(val ?? '').toLowerCase().includes(q));
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
          rows.push(row);
          indices.push(i);
        }
        if (reqId !== previewReqRef.current) return;
        setPreviewRows(rows);
        setPreviewRowIndices(indices);
      } catch (e) {
        if (reqId !== previewReqRef.current) return;
        console.error('[CleansingData] preview failed:', e);
        setPreviewRows([]);
        setPreviewRowIndices([]);
      }
    };

    void run();
  }, [
    selectedSource?.id,
    searchQuery,
    filters,
    previewVersion,
    normalizedProject.id,
    transformWorker.isSupported,
    transformWorker.cleanPreview,
    workingRows,
    selectedSource,
  ]);

  const displayRows = previewRows;
  const hasActiveFilters = Object.values(filters).some((v) => Array.isArray(v) && v.length > 0);

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
      await transformWorker.cleanApplyFindReplace({
        projectId: normalizedProject.id,
        sourceId: selectedSource.id,
        targetCol,
        findText,
        replaceText,
      });
      const refreshed = await getProjectLight(normalizedProject.id);
      if (refreshed) onUpdateProject(refreshed);
      setPreviewVersion((v) => v + 1);
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
  };

  const handleDeleteRow = async (index: number) => {
    if (selectedSource && transformWorker.isSupported) {
      await transformWorker.cleanDeleteRow({
        projectId: normalizedProject.id,
        sourceId: selectedSource.id,
        rowIndex: index,
      });
      const refreshed = await getProjectLight(normalizedProject.id);
      if (refreshed) onUpdateProject(refreshed);
      setPreviewVersion((v) => v + 1);
      return;
    }
    const next = workingRows.filter((_, i) => i !== index);
    await persistSource(next, workingColumns);
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
                  {(typeof selectedSource.rowCount === 'number' ? selectedSource.rowCount : selectedSource.rows.length).toLocaleString()} rows
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
                  <button
                    onClick={() => {
                      setFilters({});
                      setPreviewVersion((v) => v + 1);
                    }}
                    className="text-red-600 hover:text-red-700 font-medium"
                  >
                    Clear
                  </button>
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

          <div className="flex-1 overflow-auto" onClick={() => setOpenFilterCol(null)}>
            <table className="w-full text-sm text-left text-gray-700">
              <thead className="text-xs text-gray-600 uppercase bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 w-10 border-b border-gray-200">#</th>
                  {workingColumns.map((col) => (
                    <th
                      key={col.key}
                      className="px-6 py-3 border-b border-gray-200 font-semibold whitespace-nowrap min-w-[140px] relative"
                    >
                      <div className="flex items-center justify-between">
                        <span>{col.key}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenFilterCol((prev) => (prev === col.key ? null : col.key));
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
                      </div>
                      {openFilterCol === col.key && (
                        <TableColumnFilter
                          column={col.key}
                          data={workingRows}
                          options={filterOptions[col.key]}
                          activeFilters={filters[col.key] ?? null}
                          onApply={(selected) => {
                            setFilters((prev) => ({ ...prev, [col.key]: selected }));
                            setPreviewVersion((v) => v + 1);
                          }}
                          onClose={() => setOpenFilterCol(null)}
                        />
                      )}
                    </th>
                  ))}
                  <th className="px-4 py-3 border-b border-gray-200 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">{idx + 1}</td>
                    {workingColumns.map((col) => (
                      <td key={col.key} className="px-6 py-3 truncate max-w-xs" title={String(row[col.key])}>
                        {typeof row[col.key] === 'object' && row[col.key] !== null
                          ? JSON.stringify(row[col.key])
                          : row[col.key] ?? ''}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDeleteRow(previewRowIndices[idx] ?? idx)}
                        className="text-gray-300 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showPicker && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-30">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Select a source table</h3>
              <button onClick={() => setShowPicker(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {allSources.map((src) => (
                <button
                  key={src.id}
                  onClick={() => handleSelect(src)}
                  className={`w-full border rounded-lg px-4 py-3 text-left transition ${
                    selectedSourceId === src.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{src.name}</p>
                      <p className="text-xs text-gray-500">{src.kind === 'ingestion' ? 'Ingestion' : 'Preparation'} data</p>
                    </div>
                    <span className="text-xs text-gray-500">
                      {(typeof src.rowCount === 'number' ? src.rowCount : src.rows.length).toLocaleString()} rows
                    </span>
                  </div>
                </button>
              ))}
              {allSources.length === 0 && <p className="text-sm text-gray-500">No tables</p>}
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowPicker(false)}
                className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
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
