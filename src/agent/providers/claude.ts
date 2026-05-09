import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js'
import type { AIProvider, ToolDefinition, ToolResult, TurnResult } from './types.js'

export function createClaudeProvider(
  apiKey: string,
  model: string,
  systemPrompt: string,
  tools: ToolDefinition[],
): AIProvider {
  const client = new Anthropic({ apiKey })
  const messages: MessageParam[] = []

  const anthropicTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
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
  }))

  async function callAPI(): Promise<TurnResult> {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: anthropicTools,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    const textBlocks = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .filter(t => t.trim() !== '')

    if (response.stop_reason === 'max_tokens') {
      return { textBlocks, toolCalls: [], abortReason: 'max_tokens reached' }
    }

    const toolCalls = response.content
      .filter((b): b is ToolUseBlock => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, args: b.input as Record<string, unknown> }))

    return { textBlocks, toolCalls }
  }

  return {
    name: 'Claude',
    async sendMessage(text: string): Promise<TurnResult> {
      messages.push({ role: 'user', content: text })
      return callAPI()
    },
    async sendToolResults(results: ToolResult[]): Promise<TurnResult> {
      messages.push({
        role: 'user',
        content: results.map(r => ({
          type: 'tool_result' as const,
          tool_use_id: r.id,
          content: r.content,
        })),
      })
      return callAPI()
    },
  }
}
