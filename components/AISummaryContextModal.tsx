import React, { useEffect, useMemo, useState } from 'react';
import { X, Save, Sparkles, Table2, Calendar, Columns3, PlayCircle, FileText } from 'lucide-react';
import { AIProvider, type AISummaryContext, type AISettings, type ColumnConfig, type DataSource, type RawRow, type TransformationRule } from '../types';
import VirtualTable from './VirtualTable';
import { AiSummarySort, loadFilteredDataSourceRows } from '../utils/aiSummary';

const MODELS: Record<AIProvider, string[]> = {
  [AIProvider.GEMINI]: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  [AIProvider.OPENAI]: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  [AIProvider.CLAUDE]: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'],
};

type Props = {
  isOpen: boolean;
  context: AISummaryContext | null;
  projectId: string;
  dataSources: DataSource[];
  transformRules: TransformationRule[];
  globalAiSettings: AISettings;
  onClose: () => void;
  onPickDataSource: (selectedId: string | null, onSelect: (sourceId: string) => void) => void;
  onSave: (context: AISummaryContext) => void;
  onCreateText: (contextId: string, elementId?: string) => void;
  onAnalyze: (contextId: string) => void;
};

const getColumnsForSource = (src: DataSource | undefined | null, transformRules: TransformationRule[]) => {
  if (transformRules && transformRules.length > 0) {
    return transformRules.map((r) => r.targetName).filter(Boolean);
  }
  return (src?.columns || []).map((c) => c.key).filter(Boolean);
};

const buildVisibleColumns = (allColumns: string[], hiddenColumns: string[] | undefined): ColumnConfig[] => {
  const hidden = new Set(Array.isArray(hiddenColumns) ? hiddenColumns : []);
  return allColumns.map((key) => ({ key, label: key, type: 'string' as const, visible: !hidden.has(key) }));
};

const isAnalyzeReady = (draft: AISummaryContext) => {
  const hasPeriod = !!(draft.periodStart || draft.periodEnd);
  return !!draft.dataSourceId && !!draft.prompt?.trim() && !!draft.dateColumn && hasPeriod;
};

const AISummaryContextModal: React.FC<Props> = ({
  isOpen,
  context,
  projectId,
  dataSources,
  transformRules,
  globalAiSettings,
  onClose,
  onPickDataSource,
  onSave,
  onCreateText,
  onAnalyze,
}) => {
  const [draft, setDraft] = useState<AISummaryContext | null>(null);
  const [previewRows, setPreviewRows] = useState<RawRow[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const activeSource = useMemo(() => {
    if (!draft?.dataSourceId) return null;
    return dataSources.find((s) => s.id === draft.dataSourceId) || null;
  }, [dataSources, draft?.dataSourceId]);

  const allColumns = useMemo(() => getColumnsForSource(activeSource, transformRules), [activeSource, transformRules]);
  const tableColumns = useMemo(() => buildVisibleColumns(allColumns, draft?.hiddenColumns), [allColumns, draft?.hiddenColumns]);

  const sort: AiSummarySort = useMemo(() => {
    const s = draft?.sort;
    if (!s || !s.column) return null;
    return { column: s.column, direction: s.direction === 'asc' ? 'asc' : 'desc' };
  }, [draft?.sort]);

  useEffect(() => {
    if (!isOpen) return;
    if (!context) return;
    setDraft({ ...context });
    setPreviewRows([]);
    setPreviewError(null);
    setShowColumns(false);
  }, [context, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!draft?.dataSourceId) return;
    const src = activeSource;
    if (!src) return;

    const totalRows = typeof src.rowCount === 'number' ? src.rowCount : src.rows.length;
    const limit = typeof draft.limit === 'number' ? draft.limit : 200;
    const previewLimit = Math.min(Math.max(1, limit), 300);

    setPreviewError(null);
    setIsLoadingPreview(true);

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const rows = await loadFilteredDataSourceRows({
            projectId,
            dataSourceId: draft.dataSourceId,
            totalRows,
            transformRules,
            dateColumn: draft.dateColumn,
            periodStart: draft.periodStart,
            periodEnd: draft.periodEnd,
            limit: previewLimit,
            sort,
          });
          setPreviewRows(rows);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Preview failed';
          setPreviewRows([]);
          setPreviewError(msg);
        } finally {
          setIsLoadingPreview(false);
        }
      })();
    }, 250);

    return () => window.clearTimeout(t);
  }, [
    activeSource,
    draft?.dataSourceId,
    draft?.dateColumn,
    draft?.periodEnd,
    draft?.periodStart,
    draft?.limit,
    isOpen,
    projectId,
    sort,
    transformRules,
  ]);

  const provider = (draft?.provider || globalAiSettings.provider) as AIProvider;
  const models = MODELS[provider] || MODELS[AIProvider.GEMINI];
  const model = (draft?.model || globalAiSettings.model || models[0] || '').trim();

  if (!isOpen) return null;
  if (!draft) return null;

  const handleSave = () => {
    const next: AISummaryContext = {
      ...draft,
      name: draft.name?.trim() || 'Untitled Context',
      provider,
      model,
      temperature: typeof draft.temperature === 'number' ? draft.temperature : globalAiSettings.temperature,
      maxTokens: typeof draft.maxTokens === 'number' ? draft.maxTokens : globalAiSettings.maxTokens,
      limit: typeof draft.limit === 'number' && draft.limit > 0 ? Math.floor(draft.limit) : 200,
      hiddenColumns: Array.isArray(draft.hiddenColumns) ? draft.hiddenColumns : [],
      sort: draft.sort && draft.sort.column ? draft.sort : null,
    };
    onSave(next);
    setDraft(next);
  };

  const handlePickDataSource = () => {
    onPickDataSource(draft.dataSourceId || null, (sourceId) => {
      setDraft((prev) => (prev ? { ...prev, dataSourceId: sourceId } : prev));
    });
  };

  const toggleColumnVisible = (key: string, nextVisible: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const hidden = new Set(Array.isArray(prev.hiddenColumns) ? prev.hiddenColumns : []);
      if (nextVisible) hidden.delete(key);
      else hidden.add(key);
      return { ...prev, hiddenColumns: Array.from(hidden) };
    });
  };

  const selectedSourceLabel = activeSource
    ? `${activeSource.name} (${activeSource.kind})`
    : draft.dataSourceId
      ? `Unknown (${draft.dataSourceId})`
      : 'Select Data Source';

  const ready = isAnalyzeReady(draft);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-gray-800 flex items-center">
            <Sparkles className="w-5 h-5 mr-2 text-gray-600" /> {draft.name || 'AI Summary'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full" aria-label="Close">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="p-5 border-b lg:border-b-0 lg:border-r border-gray-100 overflow-hidden flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
                <Table2 className="w-4 h-4 text-gray-500" /> Data
              </div>
              <button
                type="button"
                onClick={handlePickDataSource}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:border-gray-300 bg-white"
              >
                {selectedSourceLabel}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Date Column</label>
                <select
                  value={draft.dateColumn || ''}
                  onChange={(e) => setDraft({ ...draft, dateColumn: e.target.value || undefined })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                >
                  <option value=""></option>
                  {allColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" /> Period
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={draft.periodStart || ''}
                    onChange={(e) => setDraft({ ...draft, periodStart: e.target.value || undefined })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    type="date"
                    value={draft.periodEnd || ''}
                    onChange={(e) => setDraft({ ...draft, periodEnd: e.target.value || undefined })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Limit</label>
                <input
                  type="number"
                  value={typeof draft.limit === 'number' ? draft.limit : 200}
                  min={1}
                  max={2000}
                  onChange={(e) => setDraft({ ...draft, limit: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Sort</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={draft.sort?.column || ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sort: e.target.value
                          ? { column: e.target.value, direction: draft.sort?.direction === 'asc' ? 'asc' : 'desc' }
                          : null,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                  >
                    <option value=""></option>
                    {allColumns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={draft.sort?.direction || 'desc'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sort: draft.sort?.column
                          ? { column: draft.sort.column, direction: e.target.value === 'asc' ? 'asc' : 'desc' }
                          : null,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                  >
                    <option value="desc">DESC</option>
                    <option value="asc">ASC</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowColumns((v) => !v)}
                className="inline-flex items-center px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:border-gray-300 bg-white"
              >
                <Columns3 className="w-4 h-4 mr-2 text-gray-500" />
                Columns
              </button>
              <div className="text-xs text-gray-500">{isLoadingPreview ? 'Loading…' : `${previewRows.length} rows`}</div>
            </div>

            {showColumns && (
              <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allColumns.map((c) => {
                    const visible = !(draft.hiddenColumns || []).includes(c);
                    return (
                      <label key={c} className="flex items-center gap-2 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={(e) => toggleColumnVisible(c, e.target.checked)}
                        />
                        <span className="truncate" title={c}>
                          {c}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {previewError && <div className="text-xs text-red-600">{previewError}</div>}

            <div className="flex-1 overflow-hidden">
              <VirtualTable data={previewRows} columns={tableColumns} height={360} emptyMessage="No data" />
            </div>
          </div>

          <div className="p-5 overflow-hidden flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
                <FileText className="w-4 h-4 text-gray-500" /> Prompt
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={provider}
                  onChange={(e) => setDraft({ ...draft, provider: e.target.value as AIProvider })}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                >
                  <option value={AIProvider.GEMINI}>Gemini</option>
                  <option value={AIProvider.OPENAI}>OpenAI</option>
                  <option value={AIProvider.CLAUDE}>Claude</option>
                </select>
                <select
                  value={model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <textarea
              value={draft.prompt || ''}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              className="w-full flex-1 min-h-[280px] px-4 py-3 border border-gray-300 rounded-xl text-sm outline-none resize-none"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Name</label>
                <input
                  value={draft.name || ''}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  handleSave();
                  onCreateText(draft.id, draft.textElementId);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 hover:border-gray-300 bg-white"
              >
                Create Context
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  handleSave();
                  onAnalyze(draft.id);
                }}
                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white disabled:bg-gray-300 bg-indigo-600 hover:bg-indigo-700"
              >
                <PlayCircle className="w-4 h-4 mr-2" />
                Analyze
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 hover:border-gray-300 bg-white"
              >
                <Save className="w-4 h-4 mr-2 text-gray-600" />
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AISummaryContextModal;
