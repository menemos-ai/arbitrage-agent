import { createProvider } from './providers/index.js'
import type { ToolCallRequest, ToolResult } from './providers/types.js'
import { TOOL_DEFINITIONS } from './definitions.js'
import { SYSTEM_PROMPT } from './prompt.js'
import { getPrices } from '../tools/prices.js'
import { getWalletBalance } from '../tools/balance.js'
import { estimateGas } from '../tools/gas.js'
import { quoteFlashLoanArbitrage, executeFlashLoanArbitrage } from '../tools/flash_loan.js'
import type { FlashLoanParams, FlashLoanResult } from '../tools/flash_loan.js'
import type { PriceResult } from '../tools/prices.js'
import type { Clients } from '../config/chains.js'
import type { Network } from '../config/addresses.js'
import type { Address } from 'viem'
import type { MnemosContext } from '../mnemos/client.js'
import { buildTradeBundle } from '../mnemos/bundle.js'

type FlashLoanContext = { params: FlashLoanParams & { minProfit: string }; result: FlashLoanResult } | null

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
  executorAddresses?: Partial<Record<Network, Address>>,
): Promise<string> {
  const { name, args: argsRaw } = call
  const args = (argsRaw ?? {}) as Record<string, unknown>

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
          args.dex as 'v2' | 'v3' | 'flash_loan',
          clients,
        )
        return wrapResult(name, {
          gasCostUsd: result.gasCostUsd,
          gasLimit: result.gasLimit.toString(),
          gasPriceWei: result.gasPriceWei.toString(),
        })
      }
      case 'simulate_flash_loan_arbitrage': {
        const network = args.network as Network
        const executorAddress = executorAddresses?.[network]
        if (!executorAddress) return wrapError(name, `No executor address configured for network: ${network}`)
        const result = await quoteFlashLoanArbitrage(
          {
            network,
            buyOnV2: Boolean(args.buyOnV2),
            borrowAmount: String(args.borrowAmount),
          },
          maxTradeUsdc,
          clients,
          executorAddress,
        )
        return wrapResult(name, {
          expectedProfitRaw: result.expectedProfitRaw.toString(),
          expectedProfitUsd: result.expectedProfitUsd,
          willSucceed: result.willSucceed,
          revertReason: result.revertReason,
        })
      }
      // execute_flash_loan_arbitrage is handled serially in runIteration (needs latestGasCostUsd)
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
  executorAddresses?: Partial<Record<Network, Address>>,
): Promise<void> {
  console.log('\n--- Iteration start', new Date().toISOString(), '---')

  const provider = createProvider(model, SYSTEM_PROMPT, TOOL_DEFINITIONS)

  let flashLoanExecuted = false
  const reasoningLog: string[] = []
  let latestPrices: PriceResult | null = null
  let latestGasCostUsd: number | null = null
  let flashLoanContext: FlashLoanContext = null

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

    const nonExecCalls = turnResult.toolCalls.filter(c => c.name !== 'execute_flash_loan_arbitrage')
    const execCalls = turnResult.toolCalls.filter(c => c.name === 'execute_flash_loan_arbitrage')

    const toolResults: ToolResult[] = []

    const parallelResults = await Promise.all(
      nonExecCalls.map(async call => {
        const content = await dispatchTool(call, clients, walletAddress, maxTradeUsdc, executorAddresses)
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

    for (const call of execCalls) {
      if (flashLoanExecuted) {
        const skipped = wrapError(call.name, 'execute_flash_loan_arbitrage already called this iteration — skipped')
        console.warn('[WARN]', skipped)
        toolResults.push({ id: call.id, name: call.name, content: skipped })
        continue
      }

      const callArgs = (call.args ?? {}) as Record<string, unknown>
      const execParams: FlashLoanParams & { minProfit: string } = {
        network: callArgs.network as Network,
        buyOnV2: Boolean(callArgs.buyOnV2),
        borrowAmount: String(callArgs.borrowAmount),
        minProfit: String(callArgs.minProfit),
      }

      const executorAddress = executorAddresses?.[execParams.network]
      let content: string
      if (!executorAddress) {
        content = wrapError(call.name, `No executor address configured for network: ${execParams.network}`)
      } else {
        try {
          const result = await executeFlashLoanArbitrage(
            execParams,
            maxTradeUsdc,
            latestGasCostUsd ?? 5.0,
            clients,
            walletAddress,
            executorAddress,
          )
          content = wrapResult(call.name, result)
          flashLoanContext = { params: execParams, result }
        } catch (err) {
          content = wrapError(call.name, err)
        }
      }

      console.log(`[tool:${call.name}]`, content)
      toolResults.push({ id: call.id, name: call.name, content })
      flashLoanExecuted = true
    }

    turnResult = await provider.sendToolResults(toolResults)
  }

  console.log('--- Iteration end ---')

  if (mnemos && flashLoanContext) {
    try {
      const bundle = buildTradeBundle(
        flashLoanContext.params,
        flashLoanContext.result,
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
