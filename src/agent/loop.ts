import Anthropic from '@anthropic-ai/sdk'
import { TOOLS } from './definitions.js'
import { SYSTEM_PROMPT } from './prompt.js'
import { getPrices } from '../tools/prices.js'
import { getWalletBalance } from '../tools/balance.js'
import { estimateGas } from '../tools/gas.js'
import { executeSwap } from '../tools/swap.js'
import type { Clients } from '../config/chains.js'
import type { Network } from '../config/addresses.js'

const client = new Anthropic()

function wrapResult(toolName: string, data: unknown): string {
  return JSON.stringify({ tool: toolName, data })
}

function wrapError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return JSON.stringify({ tool: toolName, error: message })
}

export async function dispatchTool(
  block: Anthropic.ToolUseBlock,
  clients: Clients,
  walletAddress: `0x${string}`,
  maxTradeUsdc: number,
): Promise<string> {
  const { name, input } = block
  const args = input as Record<string, string>

  try {
    switch (name) {
      case 'get_prices': {
        const result = await getPrices(clients)
        return wrapResult(name, result)
      }
      case 'get_wallet_balance': {
        const result = await getWalletBalance(walletAddress, clients)
        return wrapResult(name, result)
      }
      case 'estimate_gas': {
        const result = await estimateGas(
          args.network as Network,
          args.dex as 'v2' | 'v3',
          clients,
        )
        return wrapResult(name, {
          gasCostUsd: result.gasCostUsd,
          gasLimit: result.gasLimit.toString(),
          gasPriceWei: result.gasPriceWei.toString(),
        })
      }
      case 'execute_swap': {
        const result = await executeSwap(
          {
            network: args.network as Network,
            dex: args.dex as 'v2' | 'v3',
            token_in: args.token_in,
            token_out: args.token_out,
            amount_in: args.amount_in,
            min_amount_out: args.min_amount_out,
          },
          maxTradeUsdc,
          clients,
          walletAddress,
        )
        return wrapResult(name, result)
      }
      default:
        return wrapError(name, `Unknown tool: ${name}`)
    }
  } catch (err) {
    return wrapError(name, err)
  }
}

export async function runIteration(
  clients: Clients,
  walletAddress: `0x${string}`,
  maxTradeUsdc: number,
  model: string,
): Promise<void> {
  console.log('\n--- Iteration start', new Date().toISOString(), '---')

  const messages: Anthropic.MessageParam[] = []
  let swapExecuted = false

  // Initial Claude invocation
  let response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages,
  })

  // Agentic loop
  while (true) {
    if (response.stop_reason === 'max_tokens') {
      console.warn('[WARN] Claude hit max_tokens — aborting iteration')
      break
    }

    // Log Claude's reasoning text
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        console.log('[Claude]', block.text)
      }
    }

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason !== 'tool_use') {
      console.warn('[WARN] Unexpected stop_reason:', response.stop_reason)
      break
    }

    // Collect tool use blocks from this turn
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )

    // Separate execute_swap from other tools — run non-swap in parallel, swap sequentially
    const nonSwapBlocks = toolUseBlocks.filter(b => b.name !== 'execute_swap')
    const swapBlocks = toolUseBlocks.filter(b => b.name === 'execute_swap')

    const toolResults: Anthropic.ToolResultBlockParam[] = []

    // Run non-swap tools in parallel
    const parallelResults = await Promise.all(
      nonSwapBlocks.map(async block => {
        const content = await dispatchTool(block, clients, walletAddress, maxTradeUsdc)
        console.log(`[tool:${block.name}]`, content)
        return { type: 'tool_result' as const, tool_use_id: block.id, content }
      }),
    )
    toolResults.push(...parallelResults)

    // Run execute_swap sequentially (at most once per iteration)
    for (const block of swapBlocks) {
      if (swapExecuted) {
        const skipped = wrapError(block.name, 'execute_swap already called this iteration — skipped')
        console.warn('[WARN]', skipped)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: skipped })
        continue
      }
      const content = await dispatchTool(block, clients, walletAddress, maxTradeUsdc)
      console.log(`[tool:${block.name}]`, content)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content })
      swapExecuted = true
    }

    // Append assistant turn + tool results to message history
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })

    // Next Claude turn
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    })
  }

  console.log('--- Iteration end ---')
}
