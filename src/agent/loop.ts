import { createProvider } from './providers/index.js'
import type { ToolCallRequest, ToolResult } from './providers/types.js'
import { TOOL_DEFINITIONS } from './definitions.js'
import { SYSTEM_PROMPT } from './prompt.js'
import { getPrices } from '../tools/prices.js'
import { getWalletBalance } from '../tools/balance.js'
import { estimateGas } from '../tools/gas.js'
import type { PriceResult } from '../tools/prices.js'
import type { Clients } from '../config/chains.js'
import type { Network } from '../config/addresses.js'
import type { MnemosContext } from '../mnemos/client.js'
import { buildTradeBundle } from '../mnemos/bundle.js'

// Flash loan context — types will be replaced with FlashLoanParams/FlashLoanResult in U6
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlashLoanContextPlaceholder = { params: any; result: any } | null

const MAX_TURNS = 20

function wrapResult(toolName: string, data: unknown): string {
  return JSON.stringify({ tool: toolName, data })
}

function wrapError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return JSON.stringify({ tool: toolName, error: message })
}

export async function dispatchTool(
  call: ToolCallRequest,
  clients: Clients,
  walletAddress: `0x${string}`,
  maxTradeUsdc: number,
): Promise<string> {
  const { name, args: argsRaw } = call
  const args = (argsRaw ?? {}) as Record<string, string>

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
      // execute_swap removed — replaced by simulate_flash_loan_arbitrage / execute_flash_loan_arbitrage in U6
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

  const provider = createProvider(model, SYSTEM_PROMPT, TOOL_DEFINITIONS)

  let swapExecuted = false
  const reasoningLog: string[] = []
  let latestPrices: PriceResult | null = null
  let latestGasCostUsd: number | null = null
  let swapContext: FlashLoanContextPlaceholder = null

  let turnResult = await provider.sendMessage('Begin arbitrage analysis iteration.')

  let turnCount = 0
  while (true) {
    if (++turnCount > MAX_TURNS) {
      console.warn(`[WARN] Agentic loop exceeded ${MAX_TURNS} turns — aborting iteration`)
      break
    }

    for (const text of turnResult.textBlocks) {
      if (text.trim()) {
        console.log(`[${provider.name}]`, text)
        reasoningLog.push(text)
      }
    }

    if (turnResult.abortReason) {
      console.warn(`[WARN] ${provider.name} aborted: ${turnResult.abortReason}`)
      break
    }

    if (turnResult.toolCalls.length === 0) break

    // execute_swap removed — guard will be updated to execute_flash_loan_arbitrage in U6
    const nonSwapCalls = turnResult.toolCalls.filter(c => c.name !== 'execute_swap')
    const swapCalls = turnResult.toolCalls.filter(c => c.name === 'execute_swap')

    const toolResults: ToolResult[] = []

    const parallelResults = await Promise.all(
      nonSwapCalls.map(async call => {
        const content = await dispatchTool(call, clients, walletAddress, maxTradeUsdc)
        console.log(`[tool:${call.name}]`, content)

        const parsed = JSON.parse(content) as { tool: string; data?: unknown; error?: string }
        if (!parsed.error && parsed.data != null) {
          if (parsed.tool === 'get_prices') latestPrices = parsed.data as PriceResult
          else if (parsed.tool === 'estimate_gas')
            latestGasCostUsd = (parsed.data as { gasCostUsd: number }).gasCostUsd
        }

        return { id: call.id, name: call.name, content } satisfies ToolResult
      }),
    )
    toolResults.push(...parallelResults)

    for (const call of swapCalls) {
      if (swapExecuted) {
        const skipped = wrapError(call.name, 'execute_swap already called this iteration — skipped')
        console.warn('[WARN]', skipped)
        toolResults.push({ id: call.id, name: call.name, content: skipped })
        continue
      }

      const capturedParams = call.args
      const content = await dispatchTool(call, clients, walletAddress, maxTradeUsdc)
      console.log(`[tool:${call.name}]`, content)

      const parsed = JSON.parse(content) as { tool: string; data?: unknown; error?: string }
      if (!parsed.error && parsed.data != null) {
        swapContext = { params: capturedParams, result: parsed.data }
      }

      toolResults.push({ id: call.id, name: call.name, content })
      swapExecuted = true
    }

    turnResult = await provider.sendToolResults(toolResults)
  }

  console.log('--- Iteration end ---')

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
      console.log(
        `[mnemos] Snapshot minted — tokenId: ${snap.tokenId}, tx: ${snap.txHash}, storage: ${snap.storageUri}`,
      )
      console.log(`[mnemos] Listed — tokenId: ${snap.tokenId}, tx: ${listTx}`)
      mnemos.stats.totalTrades++
      mnemos.stats.totalGasCostUsd += latestGasCostUsd ?? 0
    } catch (err) {
      console.error('[mnemos] Error:', err instanceof Error ? err.message : err)
    }
  }
}
