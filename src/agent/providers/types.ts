export interface ToolParamSchema {
  type: 'string' | 'number' | 'boolean'
  description?: string
  enum?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParamSchema>
    required: string[]
  }
}

export interface ToolCallRequest {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  name: string
  content: string
}

export interface TurnResult {
  textBlocks: string[]
  toolCalls: ToolCallRequest[]
  abortReason?: string
}

export interface AIProvider {
  name: string
  sendMessage(text: string): Promise<TurnResult>
  sendToolResults(results: ToolResult[]): Promise<TurnResult>
}
