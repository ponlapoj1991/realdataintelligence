/**
 * Project Backup & Restore Utility
 *
 * Export: Creates a .zip file containing all project data
 * Import: Restores a project from a .zip backup file
 *
 * File structure inside .zip:
 * - manifest.json     - Version info and project metadata
 * - metadata.json     - Full project configuration
 * - data/chunk_0.json - Data chunks (1000 rows each)
 * - data/chunk_1.json
 * - ...
 */

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  getProjectMetadata,
  saveProjectMetadata,
  getDataChunk,
  saveDataChunk,
  getDataSourceChunk,
  saveDataSourceChunk,
  deleteProjectV2,
} from './storage-v2';
import type { RawRow } from '../types';

const BACKUP_VERSION = 2;
const CHUNK_SIZE = 1000;

interface DataSourceManifestEntry {
  id: string;
  name: string;
  kind: string;
  rowCount: number;
  chunkCount: number;
}

interface BackupManifest {
  version: number;
  exportedAt: number;
  appVersion: string;
  projectId: string;
  projectName: string;
  rowCount: number;
  chunkCount: number;
  dataSources?: DataSourceManifestEntry[];
}

export interface ExportProgress {
  phase: 'preparing' | 'metadata' | 'data' | 'compressing' | 'done';
  percent: number;
  message: string;
}

export interface ImportProgress {
  phase: 'reading' | 'validating' | 'metadata' | 'data' | 'done';
  percent: number;
  message: string;
}

/**
 * Export a project to a downloadable .zip file
 */
export const exportProject = async (
  projectId: string,
  onProgress?: (progress: ExportProgress) => void
): Promise<void> => {
  const report = (phase: ExportProgress['phase'], percent: number, message: string) => {
    onProgress?.({ phase, percent, message });
  };

  try {
    report('preparing', 0, 'Preparing export...');

    // Get project metadata
    const metadata = await getProjectMetadata(projectId);
    if (!metadata) {
      throw new Error('Project not found');
    }

    report('metadata', 10, 'Loading project configuration...');

    report('data', 20, 'Preparing data chunks...');

    const rawSources = Array.isArray((metadata as any).dataSources) ? ((metadata as any).dataSources as any[]) : [];
    const sources: DataSourceManifestEntry[] = rawSources
      .filter((s) => s && s.id)
      .map((s) => {
        const rowCount = typeof s.rowCount === 'number' ? s.rowCount : 0;
        const chunkCount = typeof s.chunkCount === 'number' ? s.chunkCount : Math.ceil(rowCount / CHUNK_SIZE);
        return {
          id: String(s.id),
          name: String(s.name || 'Table'),
          kind: String(s.kind || 'ingestion'),
          rowCount,
          chunkCount,
        };
      });

    // Create ZIP file
    const zip = new JSZip();

    // Add manifest
    const manifest: BackupManifest = {
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      appVersion: '2.0.0',
      projectId: metadata.id,
      projectName: metadata.name,
      rowCount: typeof (metadata as any).rowCount === 'number' ? (metadata as any).rowCount : 0,
      chunkCount: typeof (metadata as any).chunkCount === 'number' ? (metadata as any).chunkCount : 0,
      dataSources: sources.length ? sources : undefined,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    report('metadata', 30, 'Saving project configuration...');

    // Add metadata (without the raw data - that's in chunks)
    const metadataForExport = {
      ...metadata,
      // Clear data-related fields that will be reconstructed on import
      rowCount: manifest.rowCount,
      chunkCount: manifest.chunkCount,
    };
    zip.file('metadata.json', JSON.stringify(metadataForExport, null, 2));

    if (sources.length > 0) {
      const root = zip.folder('data-sources');
      if (!root) throw new Error('Failed to create data-sources folder in ZIP');

      const totalChunks = sources.reduce((sum, s) => sum + (s.chunkCount || 0), 0) || 1;
      let written = 0;

      for (const src of sources) {
        const srcFolder = root.folder(src.id);
        if (!srcFolder) throw new Error(`Failed to create folder for source ${src.id}`);

        for (let i = 0; i < src.chunkCount; i++) {
          const chunkData = await getDataSourceChunk(projectId, src.id, i);
          srcFolder.file(`chunk_${i}.json`, JSON.stringify(chunkData));

          written += 1;
          const percent = 30 + Math.round((written / totalChunks) * 50);
          report('data', percent, `Saving data chunk ${written}/${totalChunks}...`);
        }
      }
    } else {
      // Fallback: export legacy active data chunks (v2)
      const dataFolder = zip.folder('data');
      if (!dataFolder) throw new Error('Failed to create data folder in ZIP');

      const totalChunks = typeof (metadata as any).chunkCount === 'number' ? (metadata as any).chunkCount : 0;
      for (let i = 0; i < totalChunks; i++) {
        const chunkData = await getDataChunk(projectId, i);
        dataFolder.file(`chunk_${i}.json`, JSON.stringify(chunkData));

        const percent = 30 + Math.round(((i + 1) / Math.max(1, totalChunks)) * 50);
        report('data', percent, `Saving data chunk ${i + 1}/${totalChunks}...`);
      }
    }

    report('compressing', 85, 'Compressing backup file...');

    // Generate ZIP blob
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    report('compressing', 95, 'Preparing download...');

    // Trigger download
    const filename = `${metadata.name.replace(/[^a-z0-9]/gi, '_')}_backup_${formatDate(new Date())}.zip`;
    saveAs(blob, filename);

    report('done', 100, 'Export complete!');
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
};

/**
 * Import a project from a .zip backup file
 */
export const importProject = async (
  file: File,
  options: {
    overwriteExisting?: boolean;
    newProjectId?: string;
    newProjectName?: string;
  } = {},
  onProgress?: (progress: ImportProgress) => void
): Promise<string> => {
  const report = (phase: ImportProgress['phase'], percent: number, message: string) => {
    onProgress?.({ phase, percent, message });
  };

  try {
    report('reading', 0, 'Reading backup file...');

    // Read ZIP file
    const zip = await JSZip.loadAsync(file);

    report('validating', 10, 'Validating backup format...');

    // Read and validate manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid backup file: missing manifest.json');
    }

    const manifestText = await manifestFile.async('string');
    const manifest: BackupManifest = JSON.parse(manifestText);

    if (!manifest.version || manifest.version > BACKUP_VERSION) {
      throw new Error(`Unsupported backup version: ${manifest.version}`);
    }

    report('validating', 20, 'Validating project metadata...');

    // Read metadata
    const metadataFile = zip.file('metadata.json');
    if (!metadataFile) {
      throw new Error('Invalid backup file: missing metadata.json');
    }

    const metadataText = await metadataFile.async('string');
    const metadata = JSON.parse(metadataText);

    // Determine project ID and name
    const projectId = options.newProjectId || `imported_${Date.now()}`;
    const projectName = options.newProjectName || `${metadata.name} (Imported)`;

    report('metadata', 30, 'Preparing project...');

    // Check if we need to delete existing project
    if (options.overwriteExisting && options.newProjectId) {
      try {
        await deleteProjectV2(options.newProjectId);
      } catch (e) {
        // Ignore if project doesn't exist
      }
    }

    report('data', 40, 'Loading data chunks...');

    const sourceEntries: DataSourceManifestEntry[] = Array.isArray(manifest.dataSources) ? manifest.dataSources : [];

    const activeSourceId: string | undefined =
      (metadata && metadata.activeDataSourceId) ||
      (sourceEntries.length ? sourceEntries[0].id : undefined);

    let activeRowCount = 0;
    let activeChunkCount = 0;

    if (manifest.version >= 2 && sourceEntries.length > 0) {
      const root = zip.folder('data-sources');
      if (!root) throw new Error('Invalid backup file: missing data-sources folder');

      const totalChunks = sourceEntries.reduce((sum, s) => sum + (s.chunkCount || 0), 0) || 1;
      let processed = 0;

      for (const src of sourceEntries) {
        const srcFolder = root.folder(src.id);
        if (!srcFolder) continue;

        if (src.id === activeSourceId) {
          activeRowCount = src.rowCount;
          activeChunkCount = src.chunkCount;
        }

        for (let i = 0; i < src.chunkCount; i++) {
          const fileObj = srcFolder.file(`chunk_${i}.json`);
          if (!fileObj) continue;
          const chunkText = await fileObj.async('string');
          const chunkData: RawRow[] = JSON.parse(chunkText);

          await saveDataSourceChunk(projectId, src.id, i, chunkData);
          if (src.id === activeSourceId) {
            await saveDataChunk(projectId, i, chunkData);
          }

          processed += 1;
          const percent = 40 + Math.round((processed / totalChunks) * 45);
          report('data', percent, `Loading chunk ${processed}/${totalChunks}...`);
        }
      }
    } else {
      // Legacy v1 backup: data/chunk_*.json -> active project data store
      const dataFolder = zip.folder('data');
      const chunkFiles: { index: number; file: JSZip.JSZipObject }[] = [];

      if (dataFolder) {
        dataFolder.forEach((relativePath, file) => {
          const match = relativePath.match(/chunk_(\d+)\.json$/);
          if (match) {
            chunkFiles.push({ index: parseInt(match[1], 10), file });
          }
        });
      }

      chunkFiles.sort((a, b) => a.index - b.index);
      activeChunkCount = chunkFiles.length;
      activeRowCount = typeof manifest.rowCount === 'number' ? manifest.rowCount : 0;

      for (let i = 0; i < chunkFiles.length; i++) {
        const { file } = chunkFiles[i];
        const chunkText = await file.async('string');
        const chunkData: RawRow[] = JSON.parse(chunkText);
        await saveDataChunk(projectId, i, chunkData);

        const percent = 40 + Math.round(((i + 1) / Math.max(1, chunkFiles.length)) * 45);
        report('data', percent, `Loading chunk ${i + 1}/${chunkFiles.length}...`);
      }
    }

    report('metadata', 92, 'Saving project configuration...');

    // Save metadata with new ID and name (ensure no embedded rows)
    const newMetadata = {
      ...metadata,
      id: projectId,
      name: projectName,
      lastModified: Date.now(),
      rowCount: activeRowCount,
      chunkCount: activeChunkCount,
      dataSources: Array.isArray(metadata?.dataSources)
        ? metadata.dataSources.map((s: any) => ({ ...s, rows: [], rowCount: s.rowCount ?? 0, chunkCount: s.chunkCount ?? 0 }))
        : metadata?.dataSources,
      storageVersion: 2,
    };

    await saveProjectMetadata(newMetadata);

    report('done', 100, 'Import complete!');

    return projectId;
  } catch (error) {
    console.error('Import failed:', error);
    throw error;
  }
};

/**
 * Validate a backup file without importing
 */
export const validateBackupFile = async (
  file: File
): Promise<{
  valid: boolean;
  manifest?: BackupManifest;
  error?: string;
}> => {
  try {
    const zip = await JSZip.loadAsync(file);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      return { valid: false, error: 'Missing manifest.json' };
    }

    const manifestText = await manifestFile.async('string');
    const manifest: BackupManifest = JSON.parse(manifestText);

    if (!manifest.version) {
      return { valid: false, error: 'Invalid manifest: missing version' };
    }

    if (manifest.version > BACKUP_VERSION) {
      return { valid: false, error: `Backup version ${manifest.version} is newer than supported (${BACKUP_VERSION})` };
    }

    const metadataFile = zip.file('metadata.json');
    if (!metadataFile) {
      return { valid: false, error: 'Missing metadata.json' };
    }

    return { valid: true, manifest };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
};

/**
 * Get estimated storage size for a project
 */
export const getProjectStorageSize = async (projectId: string): Promise<number> => {
  const metadata = await getProjectMetadata(projectId);
  if (!metadata) return 0;

  // Rough estimate: metadata + first chunk as a proxy for average row size
  const metadataSize = JSON.stringify(metadata).length;
  const firstChunk = await getDataChunk(projectId, 0);
  const sampleSize = JSON.stringify(firstChunk).length;
  const chunkCount = typeof (metadata as any).chunkCount === 'number' ? (metadata as any).chunkCount : 0;
  const approxDataSize = sampleSize * Math.max(1, chunkCount);

  return metadataSize + approxDataSize;
};

/**
 * Format bytes to human-readable string
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format date for filename
 */
const formatDate = (date: Date): string => {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
};
