import OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/completions.js'
import type { AIProvider, ToolDefinition, ToolResult, TurnResult } from './types.js'

export function createOpenAIProvider(
  apiKey: string,
  model: string,
  systemPrompt: string,
  tools: ToolDefinition[],
  options?: { baseURL?: string; name?: string },
): AIProvider {
  const client = new OpenAI({ apiKey, ...(options?.baseURL ? { baseURL: options.baseURL } : {}) })
  const providerName = options?.name ?? 'OpenAI'
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ]

  const openaiTools = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([k, s]) => [
            k,
            {
              type: s.type,
              description: s.description,
              ...(s.enum ? { enum: s.enum } : {}),
            },
          ]),
        ),
        required: t.parameters.required,
      },
    },
  }))

  async function callAPI(): Promise<TurnResult> {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      tools: openaiTools,
      messages,
    })

    const choice = response.choices[0]
    if (!choice) return { textBlocks: [], toolCalls: [], abortReason: `no response from ${providerName}` }

    messages.push(choice.message)

    const textBlocks = choice.message.content ? [choice.message.content] : []

    if (choice.finish_reason === 'length') {
      return { textBlocks, toolCalls: [], abortReason: 'max_tokens reached' }
    }

    const toolCalls = (choice.message.tool_calls ?? [])
      .filter((tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }))

    return { textBlocks, toolCalls }
  }

  return {
    name: providerName,
    async sendMessage(text: string): Promise<TurnResult> {
      messages.push({ role: 'user', content: text })
      return callAPI()
    },
    async sendToolResults(results: ToolResult[]): Promise<TurnResult> {
      for (const r of results) {
        messages.push({ role: 'tool', tool_call_id: r.id, content: r.content })
      }
      return callAPI()
    },
  }
}
