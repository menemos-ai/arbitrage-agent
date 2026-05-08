import { GoogleGenerativeAI, FinishReason } from '@google/generative-ai'
import type { FunctionCall, Part } from '@google/generative-ai'
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const MAX_TURNS = 20

function wrapResult(toolName: string, data: unknown): string {
  return JSON.stringify({ tool: toolName, data })
}

function wrapError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return JSON.stringify({ tool: toolName, error: message })
}

export async function dispatchTool(
  call: FunctionCall,
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

  const geminiModel = genAI.getGenerativeModel({
    model,
    tools: TOOLS,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { maxOutputTokens: 4096 },
  })

  const chat = geminiModel.startChat()
  let swapExecuted = false

  // Mnemos collection state
  const reasoningLog: string[] = []
  let latestPrices: PriceResult | null = null
  let latestGasCostUsd: number | null = null
  let swapContext: { params: SwapParams; result: SwapResult } | null = null

  // Initial trigger — system instruction sets the context, this starts the turn
  let result = await chat.sendMessage('Begin arbitrage analysis iteration.')

  // Agentic loop
  let turnCount = 0
  while (true) {
    if (++turnCount > MAX_TURNS) {
      console.warn(`[WARN] Agentic loop exceeded ${MAX_TURNS} turns — aborting iteration`)
      break
    }

    const response = result.response
    const candidate = response.candidates?.[0]

    if (!candidate) break

    // Collect text blocks — capture reasoning before stop-reason checks
    for (const part of candidate.content?.parts ?? []) {
      if ('text' in part && part.text?.trim()) {
        console.log('[Gemini]', part.text)
        reasoningLog.push(part.text)
      }
    }

    // Any finish reason other than STOP (normal) means the model can't continue
    if (candidate.finishReason && candidate.finishReason !== FinishReason.STOP) {
      console.warn(`[WARN] Gemini finished with reason: ${candidate.finishReason} — aborting iteration`)
      break
    }

    // Get all function calls from this turn
    const functionCalls = response.functionCalls() ?? []

    if (functionCalls.length === 0) break

    // Separate execute_swap from other tools — run non-swap in parallel, swap sequentially
    const nonSwapCalls = functionCalls.filter(fc => fc.name !== 'execute_swap')
    const swapCalls = functionCalls.filter(fc => fc.name === 'execute_swap')

    const responseParts: Part[] = []

    // Run non-swap tools in parallel
    const parallelResults = await Promise.all(
      nonSwapCalls.map(async call => {
        const content = await dispatchTool(call, clients, walletAddress, maxTradeUsdc)
        console.log(`[tool:${call.name}]`, content)

        // Capture prices and gas cost for Mnemos bundle
        const parsed = JSON.parse(content) as { tool: string; data?: unknown; error?: string }
        if (!parsed.error && parsed.data != null) {
          if (parsed.tool === 'get_prices') {
            latestPrices = parsed.data as PriceResult
          } else if (parsed.tool === 'estimate_gas') {
            latestGasCostUsd = (parsed.data as { gasCostUsd: number }).gasCostUsd
          }
        }

        return {
          functionResponse: { name: call.name, response: { result: content } },
        } as Part
      }),
    )
    responseParts.push(...parallelResults)

    // Run execute_swap sequentially (at most once per iteration)
    for (const call of swapCalls) {
      if (swapExecuted) {
        const skipped = wrapError(call.name, 'execute_swap already called this iteration — skipped')
        console.warn('[WARN]', skipped)
        responseParts.push({ functionResponse: { name: call.name, response: { result: skipped } } } as Part)
        continue
      }

      // Capture requested swap params before dispatch (intentional — audit trail)
      const capturedParams = call.args as unknown as SwapParams

      const content = await dispatchTool(call, clients, walletAddress, maxTradeUsdc)
      console.log(`[tool:${call.name}]`, content)

      // Capture swap result for Mnemos bundle (only on success — guard against wrapError envelopes)
      const parsed = JSON.parse(content) as { tool: string; data?: unknown; error?: string }
      if (!parsed.error && parsed.data != null) {
        swapContext = { params: capturedParams, result: parsed.data as SwapResult }
      }

      responseParts.push({ functionResponse: { name: call.name, response: { result: content } } } as Part)
      swapExecuted = true
    }

    result = await chat.sendMessage(responseParts)
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
