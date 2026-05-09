import { GoogleGenerativeAI, SchemaType, FinishReason } from '@google/generative-ai'
import type { Tool, FunctionDeclarationSchema, Part } from '@google/generative-ai'
import type { AIProvider, ToolDefinition, ToolResult, TurnResult } from './types.js'

function toGeminiTools(tools: ToolDefinition[]): Tool[] {
  return [
    {
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: SchemaType.OBJECT,
          properties: Object.fromEntries(
            Object.entries(t.parameters.properties).map(([k, s]) => [
              k,
              {
                type: s.type as SchemaType,
                description: s.description,
                ...(s.enum ? { format: 'enum' as const, enum: s.enum } : {}),
              },
            ]),
          ),
          required: t.parameters.required,
        } as FunctionDeclarationSchema,
      })),
    },
  ]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTurnResult(response: any): TurnResult {
  const candidate = response.candidates?.[0]
  if (!candidate) return { textBlocks: [], toolCalls: [], abortReason: 'no candidate in response' }

  const textBlocks: string[] = (candidate.content?.parts ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => typeof p.text === 'string' && p.text.trim() !== '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => p.text as string)

  if (candidate.finishReason && candidate.finishReason !== FinishReason.STOP) {
    return { textBlocks, toolCalls: [], abortReason: `finish reason: ${candidate.finishReason}` }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCalls = ((response.functionCalls?.() ?? []) as any[]).map((fc: any, i: number) => ({
    id: `${fc.name}_${i}`,
    name: fc.name as string,
    args: (fc.args ?? {}) as Record<string, unknown>,
  }))

  return { textBlocks, toolCalls }
}

export function createGeminiProvider(
  apiKey: string,
  model: string,
  systemPrompt: string,
  tools: ToolDefinition[],
): AIProvider {
  const genAI = new GoogleGenerativeAI(apiKey)
  const geminiModel = genAI.getGenerativeModel({
    model,
    tools: toGeminiTools(tools),
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: 4096 },
  })
  const chat = geminiModel.startChat()

  return {
    name: 'Gemini',
    async sendMessage(text: string): Promise<TurnResult> {
      const result = await chat.sendMessage(text)
      return parseTurnResult(result.response)
    },
    async sendToolResults(results: ToolResult[]): Promise<TurnResult> {
      const parts: Part[] = results.map(r => ({
        functionResponse: { name: r.name, response: { result: r.content } },
      } as Part))
      const result = await chat.sendMessage(parts)
      return parseTurnResult(result.response)
    },
  }
}
