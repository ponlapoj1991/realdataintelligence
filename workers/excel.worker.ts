/// <reference lib="webworker" />

/**
 * Excel Parser Web Worker (Bundled)
 *
 * Purpose: Parse large Excel/CSV files in a background thread.
 * - Prevents UI blocking
 * - Reports progress to main thread
 *
 * Implementation notes:
 * - Uses bundled `xlsx` (no CDN) for reliability in enterprise environments.
 * - Parsing still returns full rows (stage 1). Further streaming/chunking is handled in later stages.
 */

import * as XLSX from 'xlsx';

// Type for raw data rows
interface RawRow {
  [key: string]: string | number | boolean | null | undefined;
}

interface WorkerMessage {
  type: 'parse';
  data: ArrayBuffer | string;
  fileType: 'excel' | 'csv';
}

interface ProgressMessage {
  type: 'progress';
  percent: number;
  message: string;
}

interface CompleteMessage {
  type: 'complete';
  data: RawRow[];
  totalRows: number;
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

type WorkerResponse = ProgressMessage | CompleteMessage | ErrorMessage;

const postProgress = (percent: number, message: string) => {
  self.postMessage({ type: 'progress', percent, message } satisfies ProgressMessage);
};

const parseExcel = (data: ArrayBuffer | string, fileType: 'excel' | 'csv'): void => {
  try {
    postProgress(10, 'Reading file...');

    const readType = fileType === 'excel' ? 'array' : 'string';
    const workbook = XLSX.read(data, { type: readType });

    postProgress(40, 'Parsing spreadsheet...');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    postProgress(60, 'Converting to data...');
    const json = XLSX.utils.sheet_to_json(worksheet, {
      raw: false,
      defval: '',
    }) as RawRow[];

    postProgress(90, 'Finalizing...');
    self.postMessage({
      type: 'complete',
      data: json,
      totalRows: json.length,
    } satisfies CompleteMessage);
  } catch (error: any) {
    self.postMessage({
      type: 'error',
      error: error?.message || 'Failed to parse file',
    } satisfies ErrorMessage);
  }
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, data, fileType } = event.data;
  if (type === 'parse') parseExcel(data, fileType);
};

export type { WorkerMessage, WorkerResponse, ProgressMessage, CompleteMessage, ErrorMessage };
