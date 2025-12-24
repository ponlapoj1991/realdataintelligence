import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Play, Loader2, Table2, Sparkles, Layers, ChevronUp, ChevronDown, ChevronLeft, X, ArrowRight, Trash2 } from 'lucide-react';
import {
  BuildStructureConfig,
  ColumnConfig,
  DataSource,
  Project,
  RawRow,
  StructureRule,
  TransformationRule,
  TransformMethod,
} from '../types';
import { diffColumns, ensureDataSources, getDataSourcesByKind, isDataSourceNameTaken } from '../utils/dataSources';
import { getProjectLight, saveProject } from '../utils/storage-compat';
import { analyzeSourceColumn, applyTransformation, getAllUniqueValues } from '../utils/transform';
import { useToast } from '../components/ToastProvider';
import EmptyState from '../components/EmptyState';
import { useTransformPipelineWorker } from '../hooks/useTransformPipelineWorker';

const safeRender = (val: any) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
};

interface BuildStructureProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
}

const TableSourceMultiSelect: React.FC<{
  ingestionSources: DataSource[];
  preparedSources: DataSource[];
  selectedSourceIds: string[];
  onToggle: (id: string, checked: boolean) => void;
}> = ({ ingestionSources, preparedSources, selectedSourceIds, onToggle }) => {
  const renderCard = (src: DataSource, kind: 'ingestion' | 'prepared') => {
    const checked = selectedSourceIds.includes(src.id);
    const rowCount = typeof src.rowCount === 'number' ? src.rowCount : src.rows.length;
    const Icon = kind === 'ingestion' ? Table2 : Sparkles;
    const iconClass = kind === 'ingestion' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600';
    const borderClass = checked
      ? kind === 'ingestion'
        ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
        : 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
      : 'border-gray-200 hover:border-gray-300 bg-white';

    return (
      <label key={src.id} className={`flex items-start p-3 rounded-lg border text-left transition-all hover:shadow-md cursor-pointer ${borderClass}`}>
        <div className={`p-2 rounded-lg mr-3 ${iconClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm truncate">{src.name}</div>
          <div className="text-xs text-gray-500 mt-1">{rowCount.toLocaleString()} rows</div>
          <div className="text-[10px] text-gray-400 mt-1">Updated: {new Date(src.updatedAt).toLocaleDateString()}</div>
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(src.id, e.target.checked)}
          className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded"
        />
      </label>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      <div>
        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Ingestion Data</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ingestionSources.length === 0 ? (
            <div className="col-span-full text-center py-4 text-gray-400 text-sm bg-gray-50 rounded-lg border border-dashed border-gray-200">
              No ingestion data
            </div>
          ) : (
            ingestionSources.map((src) => renderCard(src, 'ingestion'))
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
            preparedSources.map((src) => renderCard(src, 'prepared'))
          )}
        </div>
      </div>
    </div>
  );
};

const BuildStructure: React.FC<BuildStructureProps> = ({ project, onUpdateProject }) => {
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

  const [configs, setConfigs] = useState<BuildStructureConfig[]>(normalizedProject.buildStructureConfigs || []);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(normalizedProject.activeBuildConfigId || null);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configName, setConfigName] = useState('');

  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  const [rules, setRules] = useState<StructureRule[]>([]);
  const [resultRows, setResultRows] = useState<RawRow[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const transformWorker = useTransformPipelineWorker();

  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingTargetName, setEditingTargetName] = useState<string | null>(null);
  const [newRuleName, setNewRuleName] = useState('');

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveMode, setSaveMode] = useState<'new' | 'overwrite'>('new');
  const [saveName, setSaveName] = useState('');
  const [overwriteTargetId, setOverwriteTargetId] = useState<string>('');
  const [overwriteWriteMode, setOverwriteWriteMode] = useState<'append' | 'replace'>('replace');
  const [saveError, setSaveError] = useState<string>('');

  const [isQueryModalOpen, setIsQueryModalOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    lines: string[];
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  type RuleDraft = {
    sourceId: string;
    sourceKey: string;
    method: TransformMethod;
    autoMethod: boolean;
    params: any;
    valueMap: Record<string, string>;
    manualKey: string;
    manualValue: string;
    analysis: {
      isArrayLikely: boolean;
      isDateLikely: boolean;
      uniqueTags: string[];
      sampleValues: string[];
    } | null;
    uniqueValues: string[];
  };

  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>({});

  const groupedRules = useMemo(
    () => {
      const order: string[] = [];
      const grouping: Record<string, StructureRule[]> = {};
      rules.forEach((rule) => {
        if (!grouping[rule.targetName]) {
          grouping[rule.targetName] = [];
          order.push(rule.targetName);
        }
        grouping[rule.targetName].push(rule);
      });
      return order.map((targetName) => ({ targetName, rules: grouping[targetName] || [] }));
    },
    [rules]
  );

  const { showToast } = useToast();

  // Sync configs from project changes
  useEffect(() => {
    const nextConfigs = normalizedProject.buildStructureConfigs || [];
    const nextActiveId = normalizedProject.activeBuildConfigId || nextConfigs[0]?.id || null;
    setConfigs(nextConfigs);
    setActiveConfigId(nextActiveId);
    if (!nextActiveId) {
      setView('list');
    }
  }, [normalizedProject.buildStructureConfigs, normalizedProject.activeBuildConfigId]);

  const activeConfig = useMemo(
    () => configs.find((c) => c.id === activeConfigId) || configs[0] || null,
    [configs, activeConfigId]
  );

  useEffect(() => {
    if (activeConfig) {
      setSelectedSources(activeConfig.sourceIds);
      setRules(activeConfig.rules);
    } else {
      setSelectedSources([]);
      setRules([]);
    }
    setResultRows([]);
    const sum = (activeConfig?.sourceIds || []).reduce((acc, id) => {
      const src = allSources.find((s) => s.id === id);
      const count = src ? (typeof src.rowCount === 'number' ? src.rowCount : src.rows.length) : 0;
      return acc + count;
    }, 0);
    setPreviewTotal(sum);
  }, [activeConfig]);

  const draftRequestRef = useRef<Record<string, number>>({});

  const bumpDraftRequest = (sourceId: string) => {
    draftRequestRef.current[sourceId] = (draftRequestRef.current[sourceId] || 0) + 1;
    return draftRequestRef.current[sourceId];
  };

  const buildDraftForSource = (sourceId: string, sources: DataSource[], existing?: StructureRule): RuleDraft => {
    const src = sources.find((s) => s.id === sourceId);
    const firstCol = existing?.sourceKey || src?.columns[0]?.key || '';
    const inferredMethod: TransformMethod = existing?.method ? existing.method : 'copy';
    return {
      sourceId,
      sourceKey: firstCol,
      method: inferredMethod,
      autoMethod: !existing,
      params: existing?.params || (inferredMethod === 'date_extract' ? { datePart: 'date_only' } : {}),
      valueMap: existing?.valueMap || {},
      manualKey: '',
      manualValue: '',
      analysis: null,
      uniqueValues: [],
    };
  };

  const refreshDraftAsync = (draft: RuleDraft) => {
    const sourceId = draft.sourceId;
    const sourceKey = draft.sourceKey;
    const requestId = bumpDraftRequest(sourceId);

    if (!sourceKey) {
      setRuleDrafts((prev) => ({ ...prev, [sourceId]: { ...(prev[sourceId] || draft), analysis: null, uniqueValues: [] } }));
      return;
    }

    const run = async () => {
      try {
        const projectId = normalizedProject.id;

        const analysis = transformWorker.isSupported
          ? await transformWorker.analyzeColumn({ projectId, sourceId, key: sourceKey })
          : (() => {
              const src = allSources.find((s) => s.id === sourceId);
              return src ? analyzeSourceColumn(src.rows, sourceKey) : null;
            })();

        let nextMethod = draft.method;
        let nextParams = draft.params || {};
        let nextValueMap = draft.valueMap;
        if (draft.autoMethod && analysis) {
          if (analysis.isDateLikely) {
            nextMethod = 'date_extract';
            nextParams = { datePart: 'date_only' };
          } else if (analysis.isArrayLikely) {
            nextMethod = 'array_count';
            nextParams = {};
          } else {
            nextMethod = 'copy';
            nextParams = {};
          }
          nextValueMap = {};
        }

        const uniqueValues = transformWorker.isSupported
          ? await transformWorker.uniqueValues({
              projectId,
              sourceId,
              key: sourceKey,
              method: nextMethod,
              limit: 5000,
              params: nextParams,
            })
          : (() => {
              const src = allSources.find((s) => s.id === sourceId);
              return src ? getAllUniqueValues(src.rows, sourceKey, nextMethod, 5000, nextParams) : [];
            })();

        setRuleDrafts((prev) => {
          if ((draftRequestRef.current[sourceId] || 0) !== requestId) return prev;
          const current = prev[sourceId] || draft;
          if (current.sourceKey !== sourceKey) return prev;

          const shouldAuto = current.autoMethod;
          const next: RuleDraft = {
            ...current,
            analysis: analysis || null,
            uniqueValues,
          };
          if (shouldAuto) {
            next.method = nextMethod;
            next.params = nextParams;
            next.valueMap = nextValueMap;
          }
          return { ...prev, [sourceId]: next };
        });
      } catch (e) {
        console.error('[BuildStructure] draft refresh failed:', e);
        setRuleDrafts((prev) => {
          if ((draftRequestRef.current[sourceId] || 0) !== requestId) return prev;
          const current = prev[sourceId] || draft;
          if (current.sourceKey !== sourceKey) return prev;
          return { ...prev, [sourceId]: { ...current, analysis: null, uniqueValues: [] } };
        });
      }
    };

    void run();
  };

  const persistConfigs = async (nextConfigs: BuildStructureConfig[], nextActiveId?: string | null) => {
    setConfigs(nextConfigs);
    const updatedProject = {
      ...normalizedProject,
      buildStructureConfigs: nextConfigs,
      activeBuildConfigId: nextActiveId ?? activeConfigId ?? nextConfigs[0]?.id,
    } as Project;
    onUpdateProject(updatedProject);
    await saveProject(updatedProject);
  };

  const submitNewConfig = async () => {
    const name = configName.trim() || `Structure ${configs.length + 1}`;
    if (selectedSources.length === 0) return;
    const newConfig: BuildStructureConfig = {
      id: crypto.randomUUID(),
      name,
      sourceIds: selectedSources,
      rules: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const nextConfigs = [...configs, newConfig];
    setActiveConfigId(newConfig.id);
    setView('detail');
    setShowConfigModal(false);
    await persistConfigs(nextConfigs, newConfig.id);
  };

  const updateActiveConfig = async (nextSources = selectedSources, nextRules = rules) => {
    if (!activeConfig) return;
    const updatedConfig: BuildStructureConfig = {
      ...activeConfig,
      sourceIds: nextSources,
      rules: nextRules,
      updatedAt: Date.now(),
    };
    const nextConfigs = configs.map((c) => (c.id === activeConfig.id ? updatedConfig : c));
    await persistConfigs(nextConfigs, activeConfig.id);
  };

  const handleSourceToggle = (id: string, checked: boolean) => {
    setSelectedSources((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const openAddRule = () => {
    if (!selectedSources.length) {
      showToast('Setup incomplete', 'Tables required.', 'warning');
      return;
    }
    setEditingTargetName(null);
    setNewRuleName('');
    const drafts: Record<string, RuleDraft> = {};
    selectedSources.forEach((srcId) => {
      drafts[srcId] = buildDraftForSource(srcId, allSources);
    });
    setRuleDrafts(drafts);
    setIsRuleModalOpen(true);
    Object.values(drafts).forEach((draft) => refreshDraftAsync(draft));
  };

  const closeRuleModal = () => {
    setIsRuleModalOpen(false);
    setRuleDrafts({});
    setNewRuleName('');
    setEditingTargetName(null);
  };

  const openEditRule = (targetName: string) => {
    const relevant = rules.filter((r) => r.targetName === targetName);
    setEditingTargetName(targetName);
    setNewRuleName(targetName);
    const drafts: Record<string, RuleDraft> = {};
    selectedSources.forEach((srcId) => {
      const existing = relevant.find((r) => r.sourceId === srcId);
      drafts[srcId] = buildDraftForSource(srcId, allSources, existing);
    });
    setRuleDrafts(drafts);
    setIsRuleModalOpen(true);
    Object.values(drafts).forEach((draft) => refreshDraftAsync(draft));
  };

  const updateDraft = (srcId: string, updater: (draft: RuleDraft) => RuleDraft) => {
    setRuleDrafts((prev) => {
      const current = prev[srcId];
      if (!current) return prev;
      return { ...prev, [srcId]: updater(current) };
    });
  };

  const updateDraftWithRefresh = (srcId: string, updater: (draft: RuleDraft) => RuleDraft) => {
    const current = ruleDrafts[srcId];
    if (!current) return;
    const nextDraft = updater(current);
    setRuleDrafts((prev) => ({ ...prev, [srcId]: nextDraft }));
    refreshDraftAsync(nextDraft);
  };

  const saveRule = async () => {
    const trimmedName = newRuleName.trim();
    if (!trimmedName) return;

    const draftEntries = Object.values(ruleDrafts).filter((d) => d.sourceKey);
    if (!draftEntries.length) return;

    const newRules: StructureRule[] = draftEntries.map((draft) => ({
      id: crypto.randomUUID(),
      sourceId: draft.sourceId,
      targetName: trimmedName,
      sourceKey: draft.sourceKey,
      method: draft.method,
      params: draft.params,
      valueMap: Object.keys(draft.valueMap).length ? draft.valueMap : undefined,
    }));

    const existingOrder = groupedRules.map((g) => g.targetName);
    let nextRules: StructureRule[] = [];

    if (editingTargetName) {
      const filteredExisting = rules.filter(
        (r) => r.targetName !== editingTargetName && r.targetName !== trimmedName
      );
      const orderWithout = existingOrder.filter((name) => name !== editingTargetName && name !== trimmedName);
      const insertIndex = Math.max(existingOrder.indexOf(editingTargetName), 0);
      const nextOrder = [...orderWithout];
      nextOrder.splice(insertIndex, 0, trimmedName);

      const bundle: Record<string, StructureRule[]> = {};
      filteredExisting.forEach((r) => {
        if (!bundle[r.targetName]) bundle[r.targetName] = [];
        bundle[r.targetName].push(r);
      });
      bundle[trimmedName] = newRules;
      const dedupedOrder: string[] = [];
      nextOrder.forEach((name) => {
        if (!dedupedOrder.includes(name)) dedupedOrder.push(name);
      });
      nextRules = dedupedOrder.flatMap((name) => bundle[name] || []);
    } else {
      const filteredExisting = rules.filter((r) => r.targetName !== trimmedName);
      const orderWithout = existingOrder.filter((name) => name !== trimmedName);
      const nextOrder = [...orderWithout, trimmedName];
      const bundle: Record<string, StructureRule[]> = {};
      filteredExisting.forEach((r) => {
        if (!bundle[r.targetName]) bundle[r.targetName] = [];
        bundle[r.targetName].push(r);
      });
      bundle[trimmedName] = newRules;
      nextRules = nextOrder.flatMap((name) => bundle[name] || []);
    }

    setRules(nextRules);
    closeRuleModal();
    await updateActiveConfig(selectedSources, nextRules);
    await runQuery(true, nextRules);
  };

  const removeRule = async (targetName: string) => {
    const nextRules = rules.filter((r) => r.targetName !== targetName);
    setRules(nextRules);
    await updateActiveConfig(selectedSources, nextRules);
  };

  const moveRule = async (targetName: string, direction: 'up' | 'down') => {
    const order = groupedRules.map((g) => g.targetName);
    const idx = order.indexOf(targetName);
    if (idx === -1) return;
    if ((direction === 'up' && idx === 0) || (direction === 'down' && idx === order.length - 1)) return;
    const swapIndex = direction === 'up' ? idx - 1 : idx + 1;
    [order[idx], order[swapIndex]] = [order[swapIndex], order[idx]];
    const bundle: Record<string, StructureRule[]> = {};
    groupedRules.forEach((g) => {
      bundle[g.targetName] = g.rules;
    });
    const next = order.flatMap((name) => bundle[name] || []);
    setRules(next);
    await updateActiveConfig(selectedSources, next);
  };

  const runQuery = async (silent = false, overrideRules?: StructureRule[]) => {
    const workingRules = overrideRules || rules;
    if (!selectedSources.length || !workingRules.length) {
      showToast('Setup incomplete', 'Mappings required.', 'warning');
      return;
    }
    if (!silent) {
      setIsRunning(true);
      setIsQueryModalOpen(true);
    }

    const sourcesPayload = selectedSources
      .map((sourceId) => {
        const scopedRules = workingRules.filter((r) => r.sourceId === sourceId);
        if (!scopedRules.length) return null;
        const baseRules = scopedRules.map(({ sourceId: _sid, ...rest }) => rest) as TransformationRule[];
        return { sourceId, rules: baseRules };
      })
      .filter((v): v is { sourceId: string; rules: TransformationRule[] } => !!v);

    if (sourcesPayload.length === 0) {
      showToast('Setup incomplete', 'Mappings required.', 'warning');
      if (!silent) setIsRunning(false);
      return;
    }

    try {
      const preview = await transformWorker.previewMulti({
        projectId: normalizedProject.id,
        sources: sourcesPayload,
        limit: 50,
      });
      setResultRows(preview.rows);
      setPreviewTotal(preview.totalRows);
    } catch (e: any) {
      console.error('[BuildStructure] query failed:', e);
      showToast('Query failed', e?.message || 'Failed to query', 'error');
      setResultRows([]);
      setPreviewTotal(0);
    } finally {
      if (!silent) {
        setIsQueryModalOpen(false);
        setTimeout(() => setIsRunning(false), 150);
      }
    }
    if (!silent) {
      // handled above
    }
  };

  const buildSourcesPayload = (workingRules: StructureRule[]) => {
    return selectedSources
      .map((sourceId) => {
        const scopedRules = workingRules.filter((r) => r.sourceId === sourceId);
        if (!scopedRules.length) return null;
        const baseRules = scopedRules.map(({ sourceId: _sid, ...rest }) => rest) as TransformationRule[];
        return { sourceId, rules: baseRules };
      })
      .filter((v): v is { sourceId: string; rules: TransformationRule[] } => !!v);
  };

  const buildOutputColumns = (sourcesPayload: Array<{ sourceId: string; rules: TransformationRule[] }>): ColumnConfig[] => {
    const seen = new Set<string>();
    const cols: ColumnConfig[] = [];
    for (const src of sourcesPayload) {
      for (const r of src.rules) {
        const key = r.targetName;
        if (seen.has(key)) continue;
        seen.add(key);
        cols.push({ key, type: 'string', visible: true, label: key });
      }
    }
    return cols;
  };

  const openSaveModal = () => {
    if (!activeConfig) return;
    if (!selectedSources.length || !rules.length) {
      showToast('Setup incomplete', 'Query required.', 'warning');
      return;
    }
    if (!resultRows.length) {
      showToast('No preview', 'Query required.', 'warning');
      return;
    }
    setSaveMode('new');
    setSaveName('');
    setSaveError('');
    setOverwriteTargetId('');
    setOverwriteWriteMode('replace');
    setShowSaveModal(true);
  };

  const handleSave = async () => {
    const sourcesPayload = buildSourcesPayload(rules);
    if (sourcesPayload.length === 0) {
      showToast('Setup incomplete', 'Mappings required.', 'warning');
      return;
    }

    if (saveMode === 'new') {
      const trimmed = saveName.trim();
      if (!trimmed) {
        setSaveError('Name required');
        return;
      }
      if (isDataSourceNameTaken(normalizedProject, { kind: 'prepared', name: trimmed })) {
        setSaveError('Name exists');
        return;
      }

      setIsSaving(true);
      try {
        await transformWorker.buildMulti({
          projectId: normalizedProject.id,
          name: trimmed,
          kind: 'prepared',
          sources: sourcesPayload,
        });
        const refreshed = await getProjectLight(normalizedProject.id);
        if (refreshed) onUpdateProject(refreshed);
        showToast('Saved', trimmed, 'success');
        setShowSaveModal(false);
      } catch (e: any) {
        showToast('Save failed', e?.message || 'Failed to save', 'error');
      } finally {
        setTimeout(() => setIsSaving(false), 400);
      }
      return;
    }

    const target = preparedSources.find((s) => s.id === overwriteTargetId) || null;
    if (!target) {
      setSaveError('Target required');
      return;
    }

    const outputColumns = buildOutputColumns(sourcesPayload);
    const existingColumns = Array.isArray(target.columns) ? target.columns : [];
    const diff = diffColumns({ expected: existingColumns, actual: outputColumns });
    const columnsMatch = diff.missing.length === 0 && diff.extra.length === 0 && diff.typeMismatches.length === 0;

    const openConfirm = (payload: { title: string; lines: string[]; confirmLabel: string; onConfirm: () => void }) => {
      setConfirm(payload);
    };

    if (overwriteWriteMode === 'replace') {
      openConfirm({
        title: 'Replace',
        lines: ['Table will be cleared and rewritten.'],
        confirmLabel: 'Replace',
        onConfirm: () => {
          setConfirm(null);
          void (async () => {
            setIsSaving(true);
            try {
              await transformWorker.buildMultiToTarget({
                projectId: normalizedProject.id,
                targetSourceId: target.id,
                mode: 'replace',
                sources: sourcesPayload,
              });
              const refreshed = await getProjectLight(normalizedProject.id);
              if (refreshed) onUpdateProject(refreshed);
              showToast('Saved', target.name, 'success');
              setShowSaveModal(false);
            } catch (e: any) {
              showToast('Save failed', e?.message || 'Failed to save', 'error');
            } finally {
              setTimeout(() => setIsSaving(false), 400);
            }
          })();
        },
      });
      return;
    }

    const lines: string[] = [];
    if (columnsMatch) {
      lines.push('Columns match.');
    } else {
      lines.push('Columns mismatch.');
      if (diff.missing.length) lines.push(`Missing: ${diff.missing.join(', ')}`);
      if (diff.extra.length) lines.push(`Extra: ${diff.extra.join(', ')}`);
      if (diff.typeMismatches.length) {
        const types = diff.typeMismatches.map((m) => `${m.key} (${m.expectedType} → ${m.actualType})`);
        lines.push(`Types: ${types.join(', ')}`);
      }
    }

    openConfirm({
      title: columnsMatch ? 'Columns Match' : 'Columns Mismatch',
      lines,
      confirmLabel: 'Append',
      onConfirm: () => {
        setConfirm(null);
        void (async () => {
          setIsSaving(true);
          try {
            await transformWorker.buildMultiToTarget({
              projectId: normalizedProject.id,
              targetSourceId: target.id,
              mode: 'append',
              sources: sourcesPayload,
            });
            const refreshed = await getProjectLight(normalizedProject.id);
            if (refreshed) onUpdateProject(refreshed);
            showToast('Saved', target.name, 'success');
            setShowSaveModal(false);
          } catch (e: any) {
            showToast('Save failed', e?.message || 'Failed to save', 'error');
          } finally {
            setTimeout(() => setIsSaving(false), 400);
          }
        })();
      },
    });
  };

  const hasConfig = Boolean(activeConfig);
  const previewRowCount = resultRows.length || previewTotal || 0;
  const activeName = activeConfig?.name || 'Config';

  const currentSourcesPayload = useMemo(() => buildSourcesPayload(rules), [rules, selectedSources]);
  const currentOutputColumns = useMemo(() => buildOutputColumns(currentSourcesPayload), [currentSourcesPayload]);
  const overwriteTarget = useMemo(
    () => preparedSources.find((s) => s.id === overwriteTargetId) || null,
    [preparedSources, overwriteTargetId]
  );
  const overwriteSchema = useMemo(() => {
    if (!overwriteTarget) return null;
    const expected = Array.isArray(overwriteTarget.columns) ? overwriteTarget.columns : [];
    return diffColumns({ expected, actual: currentOutputColumns });
  }, [overwriteTarget, currentOutputColumns]);
  const overwriteSchemaMatch = Boolean(
    overwriteSchema &&
      overwriteSchema.missing.length === 0 &&
      overwriteSchema.extra.length === 0 &&
      overwriteSchema.typeMismatches.length === 0
  );

  const openConfig = async (id: string) => {
    setActiveConfigId(id);
    setView('detail');
    await persistConfigs(configs, id);
  };

  const requestDeleteConfig = (id: string) => {
    const cfg = configs.find((c) => c.id === id);
    if (!cfg) return;
    setConfirm({
      title: 'Delete Config',
      lines: [cfg.name],
      confirmLabel: 'Delete',
      onConfirm: () => {
        setConfirm(null);
        void (async () => {
          const nextConfigs = configs.filter((c) => c.id !== id);
          const nextActiveId =
            activeConfigId === id ? (nextConfigs[0]?.id || null) : activeConfigId;
          setConfigs(nextConfigs);
          setActiveConfigId(nextActiveId);
          if (!nextActiveId) setView('list');
          await persistConfigs(nextConfigs, nextActiveId);
        })();
      },
    });
  };

  return (
    <div className="h-full flex flex-col px-10 py-8 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          {view === 'detail' && (
            <button
              onClick={() => setView('list')}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </button>
          )}
          <h1 className="text-xl font-semibold text-gray-900">Build Structure</h1>
          {view === 'detail' && hasConfig && (
            <span className="text-sm font-medium text-gray-500 truncate max-w-[320px]" title={activeName}>
              {activeName}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-3">
          {view === 'detail' && hasConfig && (
            <button
              onClick={openSaveModal}
              disabled={isSaving}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save to Preparation
            </button>
          )}
          <button
            onClick={() => {
              setConfigName(`Structure ${configs.length + 1}`);
              setSelectedSources([]);
              setShowConfigModal(true);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create
          </button>
        </div>
      </div>

      {view === 'list' && (
        <div className="flex-1">
          {configs.length === 0 ? (
            <div className="border border-dashed border-gray-200 rounded-xl bg-white/60">
              <EmptyState
                icon={Table2}
                title="No configs"
                description=""
                actionLabel="Create"
                onAction={() => {
                  setConfigName(`Structure ${configs.length + 1}`);
                  setSelectedSources([]);
                  setShowConfigModal(true);
                }}
                className="border-0 bg-transparent"
              />
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
              <div className="grid grid-cols-12 gap-3 text-sm font-semibold text-gray-500 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span className="col-span-6">Config</span>
                <span className="col-span-3">Tables</span>
                <span className="col-span-3 text-right">Actions</span>
              </div>
              <div className="divide-y divide-gray-100">
                {configs
                  .slice()
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((cfg) => (
                    <div key={cfg.id} className="grid grid-cols-12 gap-3 items-center px-5 py-3 hover:bg-gray-50">
                      <div className="col-span-6">
                        <p className="font-medium text-gray-900 truncate" title={cfg.name}>
                          {cfg.name}
                        </p>
                        <p className="text-xs text-gray-500">{new Date(cfg.updatedAt).toLocaleString()}</p>
                      </div>
                      <div className="col-span-3 text-sm text-gray-800">
                        {(cfg.sourceIds || []).length.toLocaleString()}
                      </div>
                      <div className="col-span-3 flex items-center justify-end space-x-3 text-sm">
                        <button onClick={() => void openConfig(cfg.id)} className="text-blue-600 hover:text-blue-700 font-medium">
                          Open
                        </button>
                        <button onClick={() => requestDeleteConfig(cfg.id)} className="text-gray-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'detail' && hasConfig && (
        <div className="space-y-6">
          <div className="border border-gray-200 rounded-xl bg-white shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-0.5">
                <p className="text-sm text-gray-500">Sources</p>
                <h2 className="font-semibold text-gray-900">{selectedSources.length} tables selected</h2>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowSourcePicker(true)}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  <Layers className="w-4 h-4 mr-2" />
                  Choose tables
                </button>
                <button
                  onClick={openAddRule}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  <Plus className="w-4 h-4 mr-2" /> Add column
                </button>
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3 text-sm font-semibold text-gray-500 px-2">
              <span className="col-span-1 text-center">#</span>
              <span className="col-span-5">Target column</span>
              <span className="col-span-4">Sources</span>
              <span className="col-span-2 text-right">Actions</span>
            </div>
            <div className="space-y-2 mt-2">
              {groupedRules.map((group, idx) => {
                const sourceLabels = group.rules
                  .map((r) => allSources.find((s) => s.id === r.sourceId)?.name || 'Source removed')
                  .join(', ');
                const methods = Array.from(new Set(group.rules.map((r) => r.method.replace('_', ' '))));
                return (
                  <div key={group.targetName} className="grid grid-cols-12 gap-3 items-center px-2 py-2 rounded-lg hover:bg-gray-50">
                    <div className="col-span-1 text-center text-sm text-gray-500">{idx + 1}</div>
                    <div className="col-span-5">
                      <p className="font-medium text-gray-900 truncate">{group.targetName}</p>
                      <p className="text-xs text-gray-500 uppercase tracking-wide truncate">{methods.join(' • ')}</p>
                    </div>
                    <div className="col-span-4 text-sm text-gray-800 truncate" title={sourceLabels}>
                      {sourceLabels || 'Sources removed'}
                    </div>
                    <div className="col-span-2 flex items-center justify-end space-x-2 text-xs text-gray-500">
                      <button onClick={() => openEditRule(group.targetName)} className="hover:text-blue-600">
                        Edit
                      </button>
                      <span className="text-gray-300">|</span>
                      <button onClick={() => moveRule(group.targetName, 'up')} disabled={idx === 0} className="hover:text-gray-700 disabled:opacity-30">
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveRule(group.targetName, 'down')}
                        disabled={idx === groupedRules.length - 1}
                        className="hover:text-gray-700 disabled:opacity-30"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <span className="text-gray-300">|</span>
                      <button onClick={() => removeRule(group.targetName)} className="hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {groupedRules.length === 0 && (
                <div className="px-2 py-6">
                  <EmptyState
                    icon={Table2}
                    title="No columns"
                    description=""
                    actionLabel="Add column"
                    onAction={openAddRule}
                    className="border-0 bg-transparent"
                  />
                </div>
              )}
            </div>
            {selectedSources.length > 0 && (
              <div className="flex justify-end mt-4">
                <button
                  onClick={() => {
                    void runQuery();
                  }}
                  disabled={isRunning}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition disabled:opacity-60"
                >
                  {isRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Query
                </button>
              </div>
            )}
          </div>

            <div className="border border-gray-200 rounded-xl bg-white shadow-sm">
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Preview</p>
                <h3 className="font-semibold text-gray-900">{previewRowCount.toLocaleString()} rows</h3>
                {selectedSources.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {selectedSources
                      .map((id) => {
                        const src = allSources.find((s) => s.id === id);
                        if (!src) return null;
                        return `${src.name} (${(typeof src.rowCount === 'number' ? src.rowCount : src.rows.length).toLocaleString()})`;
                      })
                      .filter(Boolean)
                      .join(' + ')}
                  </p>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-gray-700">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    {Object.keys(resultRows[0] || {}).map((key) => (
                      <th key={key} className="px-4 py-3 font-semibold text-gray-500 whitespace-nowrap">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultRows.slice(0, 20).map((row, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      {Object.keys(row).map((key) => (
                        <td key={key} className="px-4 py-2 text-gray-800">
                          {row[key] as any}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {resultRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-center text-gray-400" colSpan={Math.max(Object.keys(resultRows[0] || {}).length, 1)}>
                        No preview.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showSourcePicker && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-30">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-gray-800">Select Tables</h3>
              <button onClick={() => setShowSourcePicker(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <TableSourceMultiSelect
              ingestionSources={ingestionSources}
              preparedSources={preparedSources}
              selectedSourceIds={selectedSources}
              onToggle={handleSourceToggle}
            />

            <div className="p-4 border-t border-gray-100 flex justify-end space-x-3">
              <button onClick={() => setShowSourcePicker(false)} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowSourcePicker(false);
                  await updateActiveConfig(selectedSources, rules.filter((r) => selectedSources.includes(r.sourceId)));
                  setRules((prev) => prev.filter((r) => selectedSources.includes(r.sourceId)));
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-60"
                disabled={!selectedSources.length}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfigModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-30">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">New structure config</h3>
              <button onClick={() => setShowConfigModal(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Name</label>
                <input
                  value={configName}
                  onChange={(e) => setConfigName(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Structure config"
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Tables</p>
                <div className="border border-gray-200 rounded-xl overflow-hidden bg-white max-h-[420px]">
                  <TableSourceMultiSelect
                    ingestionSources={ingestionSources}
                    preparedSources={preparedSources}
                    selectedSourceIds={selectedSources}
                    onToggle={handleSourceToggle}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={submitNewConfig}
                disabled={!selectedSources.length}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-60"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {isRuleModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center px-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-blue-600 font-semibold">{editingTargetName ? 'Edit' : 'Add'} column</p>
                <h3 className="text-xl font-bold text-gray-900">Column mapping</h3>
              </div>
              <button onClick={closeRuleModal} className="text-gray-400 hover:text-gray-600">×</button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Target column name</label>
                <input
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Date"
                />
              </div>
            </div>

            <div className="space-y-4">
              {selectedSources.map((srcId) => {
                const draft = ruleDrafts[srcId];
                const src = allSources.find((s) => s.id === srcId);
                if (!src || !draft) return null;
                return (
                  <div key={draft.sourceId} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Source</p>
                        <h4 className="font-semibold text-gray-900">{src.name}</h4>
                      </div>
                      <div className="text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1">
                        {(typeof src.rowCount === 'number' ? src.rowCount : src.rows.length).toLocaleString()} rows
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Source column</label>
                        <select
                          value={draft.sourceKey}
                          onChange={(e) => {
                            const nextKey = e.target.value;
                            updateDraftWithRefresh(draft.sourceId, (curr) => ({
                              ...curr,
                              sourceKey: nextKey,
                              autoMethod: editingTargetName ? curr.autoMethod : true,
                              method: editingTargetName ? curr.method : 'copy',
                              params: editingTargetName ? curr.params : {},
                              valueMap: editingTargetName ? curr.valueMap : {},
                            }));
                          }}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        >
                          {(src.columns || []).map((col) => (
                            <option key={col.key} value={col.key}>
                              {col.key}
                            </option>
                          ))}
                        </select>
                        {draft.analysis?.sampleValues?.length ? (
                          <p className="text-xs text-gray-500">Sample: {draft.analysis.sampleValues.slice(0, 3).join(', ')}</p>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Extraction logic</label>
                        <select
                          value={draft.method}
                          onChange={(e) => {
                            const method = e.target.value as TransformMethod;
                            updateDraftWithRefresh(draft.sourceId, (curr) => ({
                              ...curr,
                              method,
                              autoMethod: false,
                              params:
                                method === 'date_extract'
                                  ? { datePart: curr.params?.datePart || 'date_only' }
                                  : method === 'date_format'
                                  ? { format: curr.params?.format || 'YYYY-MM-DD' }
                                  : method === 'array_join'
                                  ? { delimiter: curr.params?.delimiter || ', ' }
                                  : method === 'array_extract'
                                  ? { index: curr.params?.index ?? 0 }
                                  : method === 'array_extract_by_prefix'
                                  ? { prefix: curr.params?.prefix || 'A-' }
                                  : method === 'array_includes'
                                  ? { keyword: curr.params?.keyword || '' }
                                  : {},
                              valueMap: editingTargetName ? curr.valueMap : {},
                            }));
                          }}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        >
                          <option value="copy">Direct Copy</option>
                          <option value="array_count">Count Items</option>
                          <option value="array_extract">Extract item by index</option>
                          <option value="extract_serialize">Extract Serialize (Recommended)</option>
                          <option value="array_extract_by_prefix">Extract item by prefix (ทดลอง)</option>
                          <option value="array_join">Join to String</option>
                          <option value="array_includes">Check presence (Boolean)</option>
                          <option value="date_extract">Extract Date/Time</option>
                          <option value="date_format">Date format</option>
                        </select>
                      </div>
                    </div>

                    {draft.method === 'array_join' && (
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">Delimiter</label>
                          <input
                            value={draft.params?.delimiter || ', '}
                            onChange={(e) => updateDraftWithRefresh(draft.sourceId, (curr) => ({
                              ...curr,
                              autoMethod: false,
                              params: { ...curr.params, delimiter: e.target.value },
                            }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                    )}

                    {draft.method === 'array_extract' && (
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">Index</label>
                          <input
                            type="number"
                            value={draft.params?.index ?? 0}
                            onChange={(e) => updateDraftWithRefresh(draft.sourceId, (curr) => ({
                              ...curr,
                              autoMethod: false,
                              params: { ...curr.params, index: Number(e.target.value) },
                            }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                    )}

                    {draft.method === 'array_extract_by_prefix' && (
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">Prefix</label>
                          <input
                            value={draft.params?.prefix ?? 'A-'}
                            onChange={(e) =>
                              updateDraftWithRefresh(draft.sourceId, (curr) => ({
                                ...curr,
                                autoMethod: false,
                                params: { ...curr.params, prefix: e.target.value },
                              }))
                            }
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="เช่น A-"
                          />
                          <p className="text-[11px] text-gray-500">
                            ระบบจะเลือก “ตัวแรก” ที่ขึ้นต้นด้วย prefix นี้ แล้วค่อยเอาไป Map ต่อ
                          </p>
                        </div>
                      </div>
                    )}

                    {draft.method === 'array_includes' && (
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">Keyword</label>
                          <input
                            value={draft.params?.keyword || ''}
                            onChange={(e) => updateDraftWithRefresh(draft.sourceId, (curr) => ({
                              ...curr,
                              autoMethod: false,
                              params: { ...curr.params, keyword: e.target.value },
                            }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                    )}

                    {draft.method === 'date_extract' && (
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">Date part</label>
                          <select
                            value={draft.params?.datePart || 'date_only'}
                            onChange={(e) => updateDraftWithRefresh(draft.sourceId, (curr) => ({
                              ...curr,
                              autoMethod: false,
                              params: { ...curr.params, datePart: e.target.value },
                            }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="date_only">Date only</option>
                            <option value="time_only">Time only</option>
                            <option value="year">Year</option>
                            <option value="month">Month</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {draft.method === 'date_format' && (
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">Format</label>
                          <input
                            value={draft.params?.format || 'YYYY-MM-DD'}
                            onChange={(e) => updateDraftWithRefresh(draft.sourceId, (curr) => ({
                              ...curr,
                              autoMethod: false,
                              params: { ...curr.params, format: e.target.value },
                            }))}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                      <div className="border border-gray-200 rounded-lg bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-800 flex items-center space-x-2">
                            <Play className="w-4 h-4 text-blue-500" />
                            <span>Live preview</span>
                          </span>
                          <span className="text-xs text-gray-400">Sample values</span>
                        </div>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {draft.analysis?.sampleValues.slice(0, 5).map((val, i) => {
                            const tempRule: TransformationRule = {
                              id: 'temp',
                              targetName: 'Preview',
                              sourceKey: draft.sourceKey,
                              method: draft.method,
                              params: draft.params,
                              valueMap: Object.keys(draft.valueMap).length ? draft.valueMap : undefined,
                            };
                            const mockRow: RawRow = { [draft.sourceKey]: val } as RawRow;
                            const result = applyTransformation([mockRow], [tempRule])[0]?.Preview;

                            return (
                              <div key={`${draft.sourceId}-${i}`} className="text-sm grid grid-cols-2 gap-3 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                                <div className="text-gray-500 truncate" title={String(val)}>
                                  {safeRender(val)}
                                </div>
                                <div className="font-medium text-gray-900 truncate flex items-center" title={safeRender(result)}>
                                  <ArrowRight className="w-3 h-3 mr-2 text-blue-400" />
                                  {safeRender(result)}
                                </div>
                              </div>
                            );
                          })}
                          {!draft.analysis?.sampleValues?.length && (
                            <p className="text-xs text-gray-400">No sample values available for this source.</p>
                          )}
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                          <div>
                            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Map values</h4>
                            <p className="text-[10px] text-gray-400">Found {draft.uniqueValues.length} unique items</p>
                          </div>
                          <button
                            onClick={() => updateDraft(draft.sourceId, (curr) => ({ ...curr, valueMap: {} }))}
                            className="text-xs text-gray-500 hover:text-red-500"
                          >
                            Clear
                          </button>
                        </div>

                        {/* Special UI for Extract Serialize */}
                        {draft.method === 'extract_serialize' ? (
                          <div className="p-4 space-y-4">
                            {/* 1. Selector */}
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-gray-500">Source Value</label>
                              <div className="flex space-x-2">
                                <select
                                  className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  value={draft.manualKey}
                                  onChange={(e) => updateDraft(draft.sourceId, (curr) => ({ ...curr, manualKey: e.target.value }))}
                                >
                                  <option value="">None</option>
                                  {draft.uniqueValues
                                    .filter((v) => !draft.valueMap.hasOwnProperty(v))
                                    .map((v) => (
                                      <option key={v} value={v}>
                                        {v}
                                      </option>
                                    ))}
                                  {!draft.valueMap.hasOwnProperty('__NULL_VALUE__') && (
                                    <option value="__NULL_VALUE__" className="text-red-600 font-semibold">
                                      Null (No match)
                                    </option>
                                  )}
                                </select>
                              </div>
                              {draft.manualKey && (
                                <div className="flex items-center space-x-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                                  <span
                                    className={`text-xs font-mono px-2 py-1 rounded ${
                                      draft.manualKey === '__NULL_VALUE__'
                                        ? 'bg-red-100 text-red-700 border border-red-200'
                                        : 'bg-white text-gray-700 border border-gray-200'
                                    }`}
                                  >
                                    {draft.manualKey === '__NULL_VALUE__' ? 'Null value' : draft.manualKey}
                                  </span>
                                  <ArrowRight className="w-3 h-3 text-gray-400" />
                                  <input
                                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                                    placeholder={draft.manualKey === '__NULL_VALUE__' ? 'Fallback' : 'Mapped value'}
                                    value={draft.manualValue}
                                    onChange={(e) =>
                                      updateDraft(draft.sourceId, (curr) => ({ ...curr, manualValue: e.target.value }))
                                    }
                                  />
                                  <button
                                    onClick={() => {
                                      if (draft.manualKey) {
                                        updateDraft(draft.sourceId, (curr) => ({
                                          ...curr,
                                          valueMap: { ...curr.valueMap, [draft.manualKey]: draft.manualValue },
                                          manualKey: '',
                                          manualValue: '',
                                        }));
                                      }
                                    }}
                                    className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
                                  >
                                    Add
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* 2. List of Active Mappings */}
                            <div className="space-y-1 max-h-48 overflow-y-auto border-t border-gray-100 pt-2">
                              {Object.entries(draft.valueMap).map(([key, val]) => (
                                <div
                                  key={key}
                                  className="grid grid-cols-12 gap-2 items-center text-xs p-2 hover:bg-gray-50 rounded border border-transparent hover:border-gray-200"
                                >
                                  <div className="col-span-5 truncate font-mono text-gray-600" title={key}>
                                    {key === '__NULL_VALUE__' ? (
                                      <span className="text-red-600 font-semibold bg-red-50 px-1 rounded">Null value</span>
                                    ) : (
                                      key
                                    )}
                                  </div>
                                  <div className="col-span-1 text-center text-gray-400">
                                    <ArrowRight className="w-3 h-3 inline" />
                                  </div>
                                  <div className="col-span-5 truncate font-medium text-gray-900" title={val}>
                                    {val || <span className="text-gray-300 italic">(Empty)</span>}
                                  </div>
                                  <div className="col-span-1 text-right">
                                    <button
                                      onClick={() =>
                                        updateDraft(draft.sourceId, (curr) => {
                                          const next = { ...curr.valueMap };
                                          delete next[key];
                                          return { ...curr, valueMap: next };
                                        })
                                      }
                                      className="text-gray-400 hover:text-red-500"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {Object.keys(draft.valueMap).length === 0 && (
                                <p className="text-center text-xs text-gray-400 py-2">No mappings yet.</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* Original Mapping Table for other methods */
                          <>
                            <div className="max-h-48 overflow-y-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0">
                                  <tr>
                                    <th className="px-4 py-2 text-left font-medium">Original found</th>
                                    <th className="px-4 py-2 text-left font-medium">Map to</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {draft.uniqueValues.map((val) => (
                                    <tr key={`${draft.sourceId}-${val}`}>
                                      <td className="px-4 py-2 text-gray-600 font-mono text-xs truncate max-w-[120px]" title={val}>
                                        {val}
                                      </td>
                                      <td className="px-4 py-2">
                                        <input
                                          className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:border-blue-500 outline-none"
                                          placeholder={val}
                                          value={draft.valueMap[val] || ''}
                                          onChange={(e) =>
                                            updateDraft(draft.sourceId, (curr) => ({
                                              ...curr,
                                              valueMap: { ...curr.valueMap, [val]: e.target.value },
                                            }))
                                          }
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                  {Object.keys(draft.valueMap)
                                    .filter((k) => !draft.uniqueValues.includes(k))
                                    .map((k) => (
                                      <tr key={`${draft.sourceId}-custom-${k}`}>
                                        <td className="px-4 py-2 text-gray-600 font-mono text-xs truncate max-w-[120px]" title={k}>
                                          {k} (Custom)
                                        </td>
                                        <td className="px-4 py-2">
                                          <div className="flex items-center">
                                            <input
                                              className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:border-blue-500 outline-none"
                                              value={draft.valueMap[k]}
                                              onChange={(e) =>
                                                updateDraft(draft.sourceId, (curr) => ({
                                                  ...curr,
                                                  valueMap: { ...curr.valueMap, [k]: e.target.value },
                                                }))
                                              }
                                            />
                                            <button
                                              onClick={() =>
                                                updateDraft(draft.sourceId, (curr) => {
                                                  const nextMap = { ...curr.valueMap };
                                                  delete nextMap[k];
                                                  return { ...curr, valueMap: nextMap };
                                                })
                                              }
                                              className="ml-2 text-gray-400 hover:text-red-500"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  {draft.uniqueValues.length === 0 && Object.keys(draft.valueMap).length === 0 && (
                                    <tr>
                                      <td className="px-4 py-3 text-xs text-gray-400" colSpan={2}>
                                        No mapped values.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>

                            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                              <div className="text-[10px] text-gray-500 mb-2 font-medium">Custom Map</div>
                              <div className="flex space-x-2">
                                <input
                                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none"
                                  placeholder="Original value"
                                  value={draft.manualKey}
                                  onChange={(e) => updateDraft(draft.sourceId, (curr) => ({ ...curr, manualKey: e.target.value }))}
                                />
                                <ArrowRight className="w-4 h-4 text-gray-400 self-center" />
                                <input
                                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none"
                                  placeholder="New value"
                                  value={draft.manualValue}
                                  onChange={(e) => updateDraft(draft.sourceId, (curr) => ({ ...curr, manualValue: e.target.value }))}
                                />
                                <button
                                  onClick={() => {
                                    if (draft.manualKey && draft.manualValue) {
                                      updateDraft(draft.sourceId, (curr) => ({
                                        ...curr,
                                        valueMap: { ...curr.valueMap, [draft.manualKey]: draft.manualValue },
                                        manualKey: '',
                                        manualValue: '',
                                      }));
                                    }
                                  }}
                                  disabled={!draft.manualKey || !draft.manualValue}
                                  className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 text-xs font-medium disabled:opacity-50"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button onClick={closeRuleModal} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={saveRule}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700"
              >
                {editingTargetName ? 'Update' : 'Add column'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold">Save</p>
                <h3 className="text-lg font-semibold text-gray-900">Preparation Data</h3>
              </div>
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex bg-gray-100 p-1 rounded-lg">
                <button
                  onClick={() => {
                    setSaveMode('new');
                    setSaveError('');
                  }}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                    saveMode === 'new' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Save As New
                </button>
                <button
                  onClick={() => {
                    setSaveMode('overwrite');
                    setSaveError('');
                  }}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                    saveMode === 'overwrite' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Overwrite
                </button>
              </div>

              {saveMode === 'new' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Table Name</label>
                  <input
                    value={saveName}
                    onChange={(e) => {
                      setSaveName(e.target.value);
                      setSaveError('');
                    }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Target Table</label>
                    <select
                      value={overwriteTargetId}
                      onChange={(e) => {
                        setOverwriteTargetId(e.target.value);
                        setSaveError('');
                      }}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="">None</option>
                      {preparedSources
                        .slice()
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                        .map((src) => (
                          <option key={src.id} value={src.id}>
                            {src.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Write Mode</label>
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                      <button
                        onClick={() => setOverwriteWriteMode('append')}
                        className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                          overwriteWriteMode === 'append'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Append
                      </button>
                      <button
                        onClick={() => setOverwriteWriteMode('replace')}
                        className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                          overwriteWriteMode === 'replace'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Replace
                      </button>
                    </div>
                  </div>

                  {overwriteTarget && overwriteWriteMode === 'append' && overwriteSchema && (
                    <div
                      className={`rounded-lg border p-3 text-xs ${
                        overwriteSchemaMatch
                          ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                          : 'bg-amber-50 border-amber-100 text-amber-700'
                      }`}
                    >
                      <div className="font-semibold mb-1">
                        {overwriteSchemaMatch ? 'Columns Match' : 'Columns Mismatch'}
                      </div>
                      {!overwriteSchemaMatch && (
                        <div className="space-y-1">
                          {overwriteSchema.missing.length > 0 && (
                            <div>Missing: {overwriteSchema.missing.join(', ')}</div>
                          )}
                          {overwriteSchema.extra.length > 0 && <div>Extra: {overwriteSchema.extra.join(', ')}</div>}
                          {overwriteSchema.typeMismatches.length > 0 && (
                            <div>
                              Types:{' '}
                              {overwriteSchema.typeMismatches
                                .map((m) => `${m.key} (${m.expectedType} → ${m.actualType})`)
                                .join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 disabled:opacity-60 flex items-center"
              >
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{confirm.title}</h3>
              <button onClick={() => setConfirm(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              {confirm.lines.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={confirm.onConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg shadow-sm hover:bg-blue-700 flex items-center"
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {isQueryModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 flex items-center space-x-3">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            <div className="text-sm font-medium text-gray-900">Processing Query</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BuildStructure;
