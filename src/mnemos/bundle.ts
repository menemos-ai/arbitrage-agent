import type { MemoryBundle } from '@mnemos-sdk/sdk'
import type { PriceResult } from '../tools/prices.js'

export interface CumulativeStats {
  totalTrades: number
  totalGasCostUsd: number
}

// Minimal shim — accepts any trade params/result shape.
// Full FlashLoanParams/FlashLoanResult schema migration is deferred.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TradeParams = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TradeResult = any

export function buildTradeBundle(
  params: TradeParams,
  result: TradeResult,
  prices: PriceResult | null,
  gasCostUsd: number | null,
  reasoning: string,
  stats: CumulativeStats,
): MemoryBundle {
  return {
    data: {
      trade: {
        network: params.network ?? 'unknown',
        dex: params.dex ?? (params.buyOnV2 !== undefined ? (params.buyOnV2 ? 'v2_buy' : 'v3_buy') : 'unknown'),
        tokenIn: params.token_in ?? params.borrowToken ?? 'usdc',
        tokenOut: params.token_out ?? 'weth',
        amountIn: params.amount_in ?? params.borrowAmount ?? '0',
        amountOut: result.amountOut ?? result.profitRaw ?? '0',
        txHash: result.txHash,
        gasCostUsd,
        timestamp: Date.now(),
      },
      context: {
        pricesAtTrade: prices,
        agentReasoning: reasoning,
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
      tags: ['arbitrage', 'weth-usdc', params.network ?? 'unknown', params.dex ?? 'flash_loan'],
    },
  }
}
