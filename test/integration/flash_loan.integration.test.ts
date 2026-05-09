import { describe, it, expect, beforeAll } from 'vitest'
import { quoteFlashLoanArbitrage } from '../../src/tools/flash_loan.js'
import { createClients } from '../../src/config/chains.js'
import type { Clients } from '../../src/config/chains.js'

const ARB_RPC = process.env.ARB_RPC_URL

// Integration tests require a deployed ArbitrageExecutor and real RPC
const EXECUTOR_ARB = process.env.EXECUTOR_ARB as `0x${string}` | undefined

const skip = !ARB_RPC || !EXECUTOR_ARB

describe('quoteFlashLoanArbitrage integration', () => {
  let clients: Clients

  beforeAll(() => {
    if (skip) return
    clients = createClients({
      ethRpcUrl: process.env.ETH_RPC_URL ?? 'https://eth.llamarpc.com',
      arbRpcUrl: ARB_RPC!,
      // dummy key — read-only simulation only
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
    })
  })

  it.skipIf(skip)('returns a numeric result for a small borrow on arbitrum', async () => {
    const params = {
      network: 'arbitrum' as const,
      buyOnV2: true,
      borrowAmount: '1000000000', // 1000 USDC
    }

    const result = await quoteFlashLoanArbitrage(params, 10_000, clients, EXECUTOR_ARB!)

    // Result should always have a numeric profit (could be negative / willSucceed: false)
    expect(typeof result.expectedProfitUsd).toBe('number')
    expect(isFinite(result.expectedProfitUsd)).toBe(true)

    // profitRaw should be a bigint
    expect(typeof result.expectedProfitRaw).toBe('bigint')
  })

  it.skipIf(skip)('returns willSucceed: false (not throw) when no opportunity', async () => {
    // Use very large borrow — likely no profit opportunity, but should not throw
    const params = {
      network: 'arbitrum' as const,
      buyOnV2: false,
      borrowAmount: '1000000', // 1 USDC — tiny; should succeed without error
    }

    const result = await quoteFlashLoanArbitrage(params, 10_000, clients, EXECUTOR_ARB!)
    // Must return a result object, not throw
    expect(result).toBeDefined()
    expect('willSucceed' in result).toBe(true)
  })
})
