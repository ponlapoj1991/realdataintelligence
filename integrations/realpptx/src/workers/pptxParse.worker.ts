import { parse } from 'pptxtojson'

type ParseMessage = { type: 'parse-pptx'; buffer: ArrayBuffer }
type ParseResponse = { ok: true; json: any } | { ok: false; error: string }

const serializeError = (err: unknown) => {
  if (err instanceof Error) return err.message || 'Unknown error'
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}

// eslint-disable-next-line no-restricted-globals
self.onmessage = async (event: MessageEvent<ParseMessage>) => {
  const data = event.data
  if (!data || data.type !== 'parse-pptx' || !data.buffer) return

  try {
    const json = await parse(data.buffer)
    ;(self as any).postMessage({ ok: true, json } satisfies ParseResponse)
  } catch (err) {
    ;(self as any).postMessage({ ok: false, error: serializeError(err) } satisfies ParseResponse)
  }
}

