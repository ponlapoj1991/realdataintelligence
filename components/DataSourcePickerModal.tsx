import React from 'react';
import { X, Table2, Sparkles } from 'lucide-react';
import type { DataSource } from '../types';

interface DataSourcePickerModalProps {
  isOpen: boolean;
  title: string;
  ingestionSources: DataSource[];
  preparedSources: DataSource[];
  selectedSourceId?: string | null;
  onSelect: (source: DataSource) => void;
  onClose: () => void;
}

const DataSourcePickerModal: React.FC<DataSourcePickerModalProps> = ({
  isOpen,
  title,
  ingestionSources,
  preparedSources,
  selectedSourceId,
  onSelect,
  onClose,
}) => {
  if (!isOpen) return null;

  const renderCard = (src: DataSource, kind: 'ingestion' | 'prepared') => {
    const selected = selectedSourceId === src.id;
    const rowCount = typeof src.rowCount === 'number' ? src.rowCount : src.rows.length;
    const Icon = kind === 'ingestion' ? Table2 : Sparkles;
    const iconClass = kind === 'ingestion' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600';
    const activeClass =
      kind === 'ingestion'
        ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
        : 'border-purple-500 bg-purple-50 ring-1 ring-purple-500';

    return (
      <button
        key={src.id}
        onClick={() => onSelect(src)}
        className={`flex items-start p-3 rounded-lg border text-left transition-all hover:shadow-md ${
          selected ? activeClass : 'border-gray-200 hover:border-gray-300 bg-white'
        }`}
      >
        <div className={`p-2 rounded-lg mr-3 ${iconClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm truncate">{src.name}</div>
          <div className="text-xs text-gray-500 mt-1">{rowCount.toLocaleString()} rows</div>
          <div className="text-[10px] text-gray-400 mt-1">Updated: {new Date(src.updatedAt).toLocaleDateString()}</div>
        </div>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-bold text-lg text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full" aria-label="Close">
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
      </div>
    </div>
  );
};

export default DataSourcePickerModal;

