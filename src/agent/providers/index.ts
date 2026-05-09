import { createGeminiProvider } from './gemini.js'
import { createClaudeProvider } from './claude.js'
import { createOpenAIProvider } from './openai.js'
import type { AIProvider, ToolDefinition } from './types.js'

export type { AIProvider, ToolDefinition, ToolCallRequest, ToolResult, TurnResult } from './types.js'

export function createProvider(
  model: string,
  systemPrompt: string,
  tools: ToolDefinition[],
): AIProvider {
  if (model.startsWith('gemini-')) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY is required for Gemini models')
    return createGeminiProvider(apiKey, model, systemPrompt, tools)
  }

  if (model.startsWith('claude-')) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for Claude models')
    return createClaudeProvider(apiKey, model, systemPrompt, tools)
  }

  if (model.startsWith('gpt-') || /^o[0-9]/.test(model)) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI models')
    return createOpenAIProvider(apiKey, model, systemPrompt, tools)
  }

  // Groq-hosted open-source models (free tier) — uses OpenAI-compatible API
  if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma')) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new Error('GROQ_API_KEY is required for Groq models (llama, mixtral, gemma)')
    return createOpenAIProvider(apiKey, model, systemPrompt, tools, {
      baseURL: 'https://api.groq.com/openai/v1',
      name: 'Groq',
    })
  }

  throw new Error(
    `Unrecognized model: "${model}". Supported prefixes: gemini- (Google), claude- (Anthropic), gpt-/o1/o3/o4 (OpenAI), llama/mixtral/gemma (Groq — free)`,
  )
}
