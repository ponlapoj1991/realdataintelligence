
import React, { useLayoutEffect, useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, X } from 'lucide-react';

interface TableColumnFilterProps {
  column: string;
  data: any[]; // The full dataset to extract unique values from
  options?: string[]; // Optional precomputed options list
  activeFilters: string[] | null; // Current selected values (null means all)
  onApply: (selected: string[] | null) => void;
  onClose: () => void;
  anchorRect?: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'> | null;
}

const TableColumnFilter: React.FC<TableColumnFilterProps> = ({
  column,
  data,
  options,
  activeFilters,
  onApply,
  onClose,
  anchorRect
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());
  const [isDirty, setIsDirty] = useState(false);
  const [portalPos, setPortalPos] = useState<{ left: number; top: number } | null>(null);

  // Extract unique values from data
  const uniqueValues = useMemo(() => {
    if (Array.isArray(options) && options.length > 0) {
      return options;
    }
    const values = new Set<string>();
    data.forEach(row => {
      const val = row[column];
      // Convert to string for filtering consistencies
      const strVal = val === null || val === undefined || val === '' ? '(Blank)' : String(val);
      values.add(strVal);
    });
    return Array.from(values).sort();
  }, [data, column, options]);

  const isLoadingOptions = options === undefined && data.length === 0;

  // Initialize selection
  useEffect(() => {
    setIsDirty(false);
    if (activeFilters) {
      setSelectedValues(new Set(activeFilters));
    } else {
      setSelectedValues(new Set(uniqueValues));
    }
  }, [activeFilters, column]);

  useEffect(() => {
    if (activeFilters) return;
    if (isDirty) return;
    setSelectedValues(new Set(uniqueValues));
  }, [activeFilters, isDirty, uniqueValues]);

  useLayoutEffect(() => {
    if (!anchorRect) {
      setPortalPos(null);
      return;
    }
    const POPOVER_WIDTH = 256; // w-64
    const margin = 8;
    const left = Math.max(margin, Math.min(anchorRect.left, window.innerWidth - POPOVER_WIDTH - margin));
    const top = Math.max(margin, anchorRect.bottom + 6);
    setPortalPos({ left, top });
  }, [anchorRect]);

  const filteredOptions = uniqueValues.filter(v => 
    v.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleValue = (val: string) => {
    const newSet = new Set(selectedValues);
    if (newSet.has(val)) {
      newSet.delete(val);
    } else {
      newSet.add(val);
    }
    setSelectedValues(newSet);
    setIsDirty(true);
  };

  const handleSelectAll = () => {
    if (selectedValues.size === filteredOptions.length) {
      // Deselect visible
      const newSet = new Set(selectedValues);
      filteredOptions.forEach(v => newSet.delete(v));
      setSelectedValues(newSet);
    } else {
      // Select visible
      const newSet = new Set(selectedValues);
      filteredOptions.forEach(v => newSet.add(v));
      setSelectedValues(newSet);
    }
    setIsDirty(true);
  };

  const applyFilter = () => {
    // If all unique values are selected, treat as "no filter" (null)
    if (selectedValues.size === uniqueValues.length) {
      onApply(null);
    } else {
      onApply(Array.from(selectedValues));
    }
    onClose();
  };

  const content = (
    <div
      className="w-64 bg-white border border-gray-300 shadow-xl rounded-lg flex flex-col text-gray-800 font-normal animate-in fade-in zoom-in duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="p-3 border-b border-gray-100 flex items-center justify-between bg-gray-50 rounded-t-lg">
        <span className="text-xs font-bold text-gray-600 uppercase">Filter: {column}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-gray-100">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search..." 
            className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:border-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {/* Options List */}
      <div className="flex-1 overflow-y-auto max-h-60 p-1 custom-scrollbar">
        <button 
          onClick={handleSelectAll}
          disabled={isLoadingOptions}
          className="flex items-center w-full px-2 py-1.5 hover:bg-blue-50 rounded text-xs text-blue-600 font-medium mb-1"
        >
           {selectedValues.size === filteredOptions.length ? 'Deselect Visible' : 'Select Visible'}
        </button>
        
        {isLoadingOptions ? (
          <div className="flex items-center justify-center gap-2 text-xs text-gray-400 text-center py-4">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading...
          </div>
        ) : filteredOptions.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-4">No matches found</div>
        ) : null}

        {!isLoadingOptions && filteredOptions.map(val => (
          <label key={val} className="flex items-center px-2 py-1 hover:bg-gray-50 cursor-pointer rounded">
            <input 
              type="checkbox"
              className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={selectedValues.has(val)}
              onChange={() => toggleValue(val)}
            />
            <span className="ml-2 text-xs truncate select-none" title={val}>{val}</span>
          </label>
        ))}
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t border-gray-100 flex justify-end items-center bg-gray-50 rounded-b-lg">
        <button 
          onClick={applyFilter}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded shadow-sm hover:bg-blue-700"
        >
          Apply
        </button>
      </div>
    </div>
  )

  if (anchorRect && portalPos) {
    return createPortal(
      <div style={{ position: 'fixed', left: portalPos.left, top: portalPos.top, zIndex: 1000 }}>
        {content}
      </div>,
      document.body
    );
  }

  return (
    <div
      className="absolute top-full left-0 mt-1 z-50"
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>
  );
};

export default TableColumnFilter;
