
import { DashboardWidget, AISettings, AIProvider } from "../types";

export interface DataSummary {
  totalRows: number;
  channelDistribution: Record<string, number>;
  sentimentDistribution: Record<string, number>;
  topTags: { name: string; value: number }[];
  projectName: string;
}

// --- FACTORY: Dynamic AI Client Handling ---

const getDefaultModel = (provider: AIProvider) => {
  switch (provider) {
    case AIProvider.OPENAI:
      return 'gpt-4.1-mini'
    case AIProvider.GEMINI:
      return 'gemini-1.5-flash'
    case AIProvider.CLAUDE:
      return 'claude-3-5-sonnet-20240620'
    default:
      return 'gemini-1.5-flash'
  }
}

const callAiProxy = async (params: {
  provider: AIProvider
  model: string
  prompt: string
  jsonMode: boolean
  temperature: number
  maxTokens: number
}) => {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const payload = await response.json().catch(() => ({} as any))
  if (!response.ok) {
    const msg = payload?.error || response.statusText || 'AI request failed'
    throw new Error(String(msg))
  }

  return String(payload?.text || '')
}

// Main Dispatcher
const generateAIContent = async (settings: AISettings | undefined, prompt: string, jsonMode = false): Promise<string | null> => {
  const provider = settings?.provider || AIProvider.GEMINI
  const model = (settings?.model || getDefaultModel(provider)).trim()
  const temperature = typeof settings?.temperature === 'number' ? settings.temperature : 0.4
  const maxTokens = typeof settings?.maxTokens === 'number' ? settings.maxTokens : 1200

  try {
    return await callAiProxy({
      provider,
      model,
      prompt,
      jsonMode,
      temperature,
      maxTokens,
    })
  } catch (error) {
    console.error('AI Generation Error:', error)
    throw error
  }
};


// --- EXPORTED FUNCTIONS ---

export const generateAIText = async (prompt: string, settings?: AISettings): Promise<string> => {
  const text = await generateAIContent(settings, prompt, false)
  return text || ''
}

export const analyzeProjectData = async (summary: DataSummary, settings?: AISettings): Promise<string> => {
  try {
    const prompt = `
      Acting as a Senior Data Analyst for a Social Listening Agency in Thailand.
      Analyze the following dataset summary for project: "${summary.projectName}".
      
      Dataset Summary:
      ${JSON.stringify(summary, null, 2)}

      Please provide a strategic insight report in Thai Language (ภาษาไทย) covering:
      1. **Executive Summary**: Overview of the data volume and main platform sources.
      2. **Sentiment Deep Dive**: Analyze the public sentiment ratio. Why is it positive/negative? (Hypothetical based on stats).
      3. **Top Interest (Tags)**: What are people talking about most? Group related tags if possible.
      4. **Recommendations**: Actionable steps for the client.

      Format the output using Markdown with clear headers and bullet points. Keep it professional, concise, and insightful.
    `;

    const text = await generateAIContent(settings, prompt);
    return text || "ไม่สามารถสร้างบทวิเคราะห์ได้ในขณะนี้";
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
};

export const generateWidgetFromPrompt = async (
  userPrompt: string, 
  availableColumns: string[],
  sampleData: any[],
  settings?: AISettings
): Promise<DashboardWidget | null> => {
  try {
    const prompt = `
      You are an expert Data Visualization Architect using a custom dashboard engine.
      
      Your goal: Create a JSON configuration for a dashboard widget based on the user's request.
      
      User Request: "${userPrompt}"
      
      Available Data Columns: ${JSON.stringify(availableColumns)}
      Sample Data (First 3 rows): ${JSON.stringify(sampleData.slice(0, 3))}
      
      Widget Schema Rules:
      - id: Generate a random string.
      - title: A professional short title for the chart.
      - type: One of ['bar', 'pie', 'line', 'area', 'kpi', 'wordcloud', 'table'].
      - dimension: The column to group by (X-Axis). MUST be one of the Available Columns.
      - measure: One of ['count', 'sum', 'avg'].
      - measureCol: The column to calculate (Y-Axis). Required if measure is 'sum' or 'avg'. MUST be a numeric column from Available Columns.
      - stackBy: Optional. Only for 'bar' type. A column to stack the bars by (e.g., Sentiment).
      - limit: Number of rows to display (e.g., 5, 10, 20).
      - width: 'half' or 'full'.
      
      Heuristics:
      - If user asks for "Trend" or "Time", use 'line' or 'area' type and find a Date column.
      - If user asks for "Ratio" or "Proportion", use 'pie'.
      - If user asks for "Sentiment", try to stack by Sentiment if possible, or group by Sentiment.
      - If the request is ambiguous, pick the best visualization type.
      
      RETURN ONLY THE RAW JSON OBJECT. NO MARKDOWN BLOCK. NO EXPLANATION.
    `;

    const jsonText = await generateAIContent(settings, prompt, true);
    if (!jsonText) return null;

    // Clean potential markdown wrappers if non-Gemini providers add them despite instructions
    const cleanJson = jsonText.replace(/```json\n?|\n?```/g, '').trim();
    
    const widgetConfig = JSON.parse(cleanJson) as DashboardWidget;
    
    if (!widgetConfig.id) widgetConfig.id = `gen-${Date.now()}`;
    
    return widgetConfig;

  } catch (error) {
    console.error("AI Chart Gen Error:", error);
    return null;
  }
};

export const processAiAgentAction = async (
  inputData: string[],
  userInstruction: string,
  settings?: AISettings
): Promise<string[]> => {
  try {
    if (inputData.length === 0) return [];
    
    const BATCH_SIZE = 30; 
    const results: string[] = [];
    
    for (let i = 0; i < inputData.length; i += BATCH_SIZE) {
        const batch = inputData.slice(i, i + BATCH_SIZE);
        
        const prompt = `
          Task: ${userInstruction}
          
          Input Data (JSON Array):
          ${JSON.stringify(batch)}
          
          Requirements:
          1. Analyze each item in the input array based on the Task.
          2. Return ONLY a JSON Array of strings containing the result for each item.
          3. The output array MUST have exactly ${batch.length} items.
          4. If an item is empty or cannot be analyzed, return null or an empty string for that index.
          5. Do not include any markdown formatting, just the raw JSON array.
        `;
    
        // Retry logic
        let retries = 2;
        let batchSuccess = false;
        
        while (retries > 0 && !batchSuccess) {
            try {
                const jsonText = await generateAIContent(settings, prompt, true);
                if (!jsonText) throw new Error("Empty response");
            
                // Cleanup
                const cleanJson = jsonText.replace(/```json\n?|\n?```/g, '').trim();
                const batchResult = JSON.parse(cleanJson);
                
                if (Array.isArray(batchResult) && batchResult.length === batch.length) {
                    results.push(...batchResult.map(String));
                    batchSuccess = true;
                } else {
                    throw new Error("Invalid array length returned");
                }
            } catch (e) {
                console.warn(`Batch failed, retrying... (${retries} left)`, e);
                retries--;
                if (retries === 0) {
                    results.push(...Array(batch.length).fill("Error")); 
                }
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return results;

  } catch (error) {
    console.error("AI Agent Action Error:", error);
    throw error;
  }
};

export const askAiAgent = async (
    contextData: string[],
    question: string,
    settings?: AISettings
): Promise<string> => {
  const safeContext = contextData.slice(0, 200)

  const prompt = `
    Context Data (First 200 rows of selection):
    ${JSON.stringify(safeContext)}

    User Question: "${question}"

    Answer the user's question based strictly on the provided Context Data.
    Answer in Thai (ภาษาไทย).
  `

  const text = await generateAIContent(settings, prompt)
  return text || 'ไม่สามารถวิเคราะห์ข้อมูลได้'
};
