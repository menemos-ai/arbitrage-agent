import { describe, it, expect } from 'vitest'
import { buildTradeBundle, type CumulativeStats } from '../../src/mnemos/bundle.js'
import type { SwapParams, SwapResult } from '../../src/tools/swap.js'
import type { PriceResult } from '../../src/tools/prices.js'

const params: SwapParams = {
  network: 'ethereum',
  dex: 'v2',
  token_in: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  token_out: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  amount_in: '1000000000000000000',
  min_amount_out: '2950000000',
}

const result: SwapResult = {
  txHash: '0xdeadbeef',
  amountOut: '2995000000',
}

const prices: PriceResult = {
  ethereum: { v2: 2995, v3: 3010 },
  arbitrum: { v2: 2990, v3: 3005 },
}

const stats: CumulativeStats = { totalTrades: 0, totalGasCostUsd: 0 }

describe('buildTradeBundle', () => {
  it('produces correct trade fields', () => {
    const bundle = buildTradeBundle(params, result, prices, 0.5, 'reasoning text', stats)
    const trade = bundle.data as any
    expect(trade.trade.network).toBe('ethereum')
    expect(trade.trade.dex).toBe('v2')
    expect(trade.trade.tokenIn).toBe(params.token_in)
    expect(trade.trade.tokenOut).toBe(params.token_out)
    expect(trade.trade.amountIn).toBe(params.amount_in)
    expect(trade.trade.amountOut).toBe(result.amountOut)
    expect(trade.trade.txHash).toBe(result.txHash)
    expect(trade.trade.gasCostUsd).toBe(0.5)
    expect(typeof trade.trade.timestamp).toBe('number')
  })

  it('sets pricesAtTrade from prices arg', () => {
    const bundle = buildTradeBundle(params, result, prices, null, '', stats)
    const data = bundle.data as any
    expect(data.context.pricesAtTrade).toEqual(prices)
  })

  it('sets null pricesAtTrade when prices is null', () => {
    const bundle = buildTradeBundle(params, result, null, null, '', stats)
    const data = bundle.data as any
    expect(data.context.pricesAtTrade).toBeNull()
  })

  it('sets null gasCostUsd when gasCostUsd is null', () => {
    const bundle = buildTradeBundle(params, result, prices, null, 'reason', stats)
    const data = bundle.data as any
    expect(data.trade.gasCostUsd).toBeNull()
  })

  it('snapshots stats at call time (pre-increment)', () => {
    const mutableStats: CumulativeStats = { totalTrades: 0, totalGasCostUsd: 0 }
    const bundle = buildTradeBundle(params, result, prices, 0.3, '', mutableStats)
    mutableStats.totalTrades++
    mutableStats.totalGasCostUsd += 0.3
    const data = bundle.data as any
    expect(data.cumulative.totalTrades).toBe(0)
    expect(data.cumulative.totalGasCostUsd).toBe(0)
  })

  it('is JSON-serializable (no BigInt)', () => {
    const bundle = buildTradeBundle(params, result, prices, 0.5, 'reason', stats)
    expect(() => JSON.stringify(bundle)).not.toThrow()
  })

  it('includes network and dex in tags', () => {
    const arbParams = { ...params, network: 'arbitrum' as const, dex: 'v3' as const }
    const bundle = buildTradeBundle(arbParams, result, prices, null, '', stats)
    expect(bundle.metadata.tags).toContain('arbitrage')
    expect(bundle.metadata.tags).toContain('weth-usdc')
    expect(bundle.metadata.tags).toContain('arbitrum')
    expect(bundle.metadata.tags).toContain('v3')
  })

  it('sets agentReasoning from reasoning arg', () => {
    const bundle = buildTradeBundle(params, result, prices, null, 'deep analysis', stats)
    const data = bundle.data as any
    expect(data.context.agentReasoning).toBe('deep analysis')
  })

  it('sets correct metadata fields', () => {
    const bundle = buildTradeBundle(params, result, prices, null, '', stats)
    expect(bundle.metadata.category).toBe('trading')
    expect(bundle.metadata.agentId).toBe('arbitrage-agent-v1')
    expect(bundle.metadata.version).toBe('1.0.0')
    expect(typeof bundle.metadata.createdAt).toBe('number')
  })
})
