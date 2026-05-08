import Anthropic from '@anthropic-ai/sdk'
import { TOOLS } from './definitions.js'
import { SYSTEM_PROMPT } from './prompt.js'
import { getPrices } from '../tools/prices.js'
import { getWalletBalance } from '../tools/balance.js'
import { estimateGas } from '../tools/gas.js'
import { executeSwap } from '../tools/swap.js'
import type { SwapParams, SwapResult } from '../tools/swap.js'
import type { PriceResult } from '../tools/prices.js'
import type { Clients } from '../config/chains.js'
import type { Network } from '../config/addresses.js'
import type { MnemosContext } from '../mnemos/client.js'
import { buildTradeBundle } from '../mnemos/bundle.js'

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
  mnemos?: MnemosContext,
): Promise<void> {
  console.log('\n--- Iteration start', new Date().toISOString(), '---')

  const messages: Anthropic.MessageParam[] = []
  let swapExecuted = false

  // Mnemos collection state
  const reasoningLog: string[] = []
  let latestPrices: PriceResult | null = null
  let latestGasCostUsd: number | null = null
  let swapContext: { params: SwapParams; result: SwapResult } | null = null

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
    // Collect text blocks FIRST — before any stop_reason checks — so reasoning
    // is captured even from max_tokens responses before the early break.
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        console.log('[Claude]', block.text)
        reasoningLog.push(block.text)
      }
    }

    if (response.stop_reason === 'max_tokens') {
      console.warn('[WARN] Claude hit max_tokens — aborting iteration')
      break
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

        // Capture prices and gas cost for Mnemos bundle
        const parsed = JSON.parse(content) as { tool: string; data?: unknown; error?: string }
        if (!parsed.error && parsed.data != null) {
          if (parsed.tool === 'get_prices') {
            latestPrices = parsed.data as PriceResult
          } else if (parsed.tool === 'estimate_gas') {
            latestGasCostUsd = (parsed.data as { gasCostUsd: number }).gasCostUsd
          }
        }

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

      // Capture Claude's requested swap params before dispatch (intentional — audit trail)
      const capturedParams = block.input as SwapParams

      const content = await dispatchTool(block, clients, walletAddress, maxTradeUsdc)
      console.log(`[tool:${block.name}]`, content)

      // Capture swap result for Mnemos bundle (only on success — guard against wrapError envelopes)
      const parsed = JSON.parse(content) as { tool: string; data?: unknown; error?: string }
      if (!parsed.error && parsed.data != null) {
        swapContext = { params: capturedParams, result: parsed.data as SwapResult }
      }

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

  // Post-loop Mnemos snapshot — fires after all reasoning is collected
  if (mnemos && swapContext) {
    try {
      const bundle = buildTradeBundle(
        swapContext.params,
        swapContext.result,
        latestPrices,
        latestGasCostUsd,
        reasoningLog.join('\n\n'),
        mnemos.stats,
      )
      const snap = await mnemos.client.snapshot(bundle)
      const listTx = await mnemos.client.list(snap.tokenId, mnemos.terms)
      console.log(`[mnemos] Snapshot minted — tokenId: ${snap.tokenId}, tx: ${snap.txHash}, storage: ${snap.storageUri}`)
      console.log(`[mnemos] Listed — tokenId: ${snap.tokenId}, tx: ${listTx}`)
      mnemos.stats.totalTrades++
      mnemos.stats.totalGasCostUsd += latestGasCostUsd ?? 0
    } catch (err) {
      console.error('[mnemos] Error:', err instanceof Error ? err.message : err)
    }
  }
}
