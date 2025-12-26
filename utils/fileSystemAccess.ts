export type SaveFilePickerResult =
  | { kind: 'picked'; handle: any }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' };

const isAbortError = (err: unknown) => {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'AbortError'
  );
};

export const pickSaveFileHandle = async (opts: {
  suggestedName: string;
  description: string;
  mime: string;
  extensions: string[];
}): Promise<SaveFilePickerResult> => {
  const picker = (window as any).showSaveFilePicker as undefined | ((options: any) => Promise<any>);
  if (!picker) return { kind: 'unsupported' };
  try {
    const handle = await picker({
      suggestedName: opts.suggestedName,
      types: [
        {
          description: opts.description,
          accept: { [opts.mime]: opts.extensions },
        },
      ],
      excludeAcceptAllOption: false,
    });
    return { kind: 'picked', handle };
  } catch (err) {
    if (isAbortError(err)) return { kind: 'cancelled' };
    throw err;
  }
};

export const writeBlobToFileHandle = async (handle: any, blob: Blob) => {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
};

