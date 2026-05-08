import type { MemoryBundle } from '@mnemos-sdk/sdk'
import type { SwapParams, SwapResult } from '../tools/swap.js'
import type { PriceResult } from '../tools/prices.js'

export interface CumulativeStats {
  totalTrades: number
  totalGasCostUsd: number
}

export function buildTradeBundle(
  params: SwapParams,
  result: SwapResult,
  prices: PriceResult | null,
  gasCostUsd: number | null,
  reasoning: string,
  stats: CumulativeStats,
): MemoryBundle {
  return {
    data: {
      trade: {
        network: params.network,
        dex: params.dex,
        tokenIn: params.token_in,
        tokenOut: params.token_out,
        amountIn: params.amount_in,
        amountOut: result.amountOut,
        txHash: result.txHash,
        gasCostUsd,
        timestamp: Date.now(),
      },
      context: {
        pricesAtTrade: prices,
        claudeReasoning: reasoning,
      },
      cumulative: {
        totalTrades: stats.totalTrades,
        totalGasCostUsd: stats.totalGasCostUsd,
      },
    },
    metadata: {
      category: 'trading',
      agentId: 'arbitrage-agent-v1',
      version: '1.0.0',
      createdAt: Date.now(),
      tags: ['arbitrage', 'weth-usdc', params.network, params.dex],
    },
  }
}
