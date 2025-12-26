type AIProvider = 'OPENAI' | 'GEMINI' | 'CLAUDE'

type AiRequestBody = {
  provider?: AIProvider
  model?: string
  prompt?: string
  jsonMode?: boolean
  temperature?: number
  maxTokens?: number
}

const readJsonBody = async (req: any): Promise<AiRequestBody> => {
  const body = req?.body
  if (body && typeof body === 'object') return body as AiRequestBody
  if (typeof body === 'string' && body.trim()) return JSON.parse(body) as AiRequestBody

  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve())
    req.on('error', (err: any) => reject(err))
  })
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw) as AiRequestBody
}

const respondJson = (res: any, status: number, payload: any) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const openaiChat = async (opts: {
  apiKey: string
  model: string
  prompt: string
  jsonMode: boolean
  temperature: number
  maxTokens: number
}) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'user', content: opts.prompt }],
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const msg = payload?.error?.message || response.statusText || 'OpenAI request failed'
    const err = new Error(msg)
    ;(err as any).status = response.status
    throw err
  }

  return String(payload?.choices?.[0]?.message?.content || '')
}

const geminiGenerate = async (opts: {
  apiKey: string
  model: string
  prompt: string
  jsonMode: boolean
  temperature: number
}) => {
  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: opts.apiKey })
  const config: any = {
    temperature: opts.temperature,
  }
  if (opts.jsonMode) config.responseMimeType = 'application/json'

  const response = await ai.models.generateContent({
    model: opts.model,
    contents: opts.prompt,
    config,
  })

  return String(response.text || '')
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return respondJson(res, 405, { error: 'Method not allowed' })
    }

    const body = await readJsonBody(req)
    const provider = (body.provider || 'GEMINI') as AIProvider
    const model = String(body.model || '').trim()
    const prompt = String(body.prompt || '').trim()
    const jsonMode = !!body.jsonMode
    const temperature = clamp(body.temperature, 0, 2, 0.4)
    const maxTokens = clamp(body.maxTokens, 64, 8192, 1200)

    if (!model) return respondJson(res, 400, { error: 'Missing model' })
    if (!prompt) return respondJson(res, 400, { error: 'Missing prompt' })

    if (provider === 'OPENAI') {
      const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
      if (!apiKey) return respondJson(res, 401, { error: 'Missing OPENAI_API_KEY' })
      const text = await openaiChat({ apiKey, model, prompt, jsonMode, temperature, maxTokens })
      return respondJson(res, 200, { text })
    }

    if (provider === 'GEMINI') {
      const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
      if (!apiKey) return respondJson(res, 401, { error: 'Missing GEMINI_API_KEY' })
      const text = await geminiGenerate({ apiKey, model, prompt, jsonMode, temperature })
      return respondJson(res, 200, { text })
    }

    if (provider === 'CLAUDE') {
      return respondJson(res, 400, { error: 'Claude not enabled' })
    }

    return respondJson(res, 400, { error: 'Unsupported provider' })
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500
    return respondJson(res, status, { error: e?.message || 'AI request failed' })
  }
}

