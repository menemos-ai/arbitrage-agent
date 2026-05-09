import { describe, it, expect, vi, beforeEach } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { computeMinProfitRaw, quoteFlashLoanArbitrage, executeFlashLoanArbitrage } from '../../src/tools/flash_loan.js'
import type { FlashLoanParams } from '../../src/tools/flash_loan.js'
import type { Clients } from '../../src/config/chains.js'

const ARBITRAGE_EXECUTED_TOPIC = keccak256(toBytes('ArbitrageExecuted(uint256)'))

// --- computeMinProfitRaw ---

describe('computeMinProfitRaw', () => {
  it('returns 7_500_000n for gasCostUsdc=5.0 (default boostFactor=1.5)', () => {
    expect(computeMinProfitRaw(5.0)).toBe(7_500_000n)
  })

  it('returns 1_000_000n for gasCostUsdc=0.5 boostFactor=2.0', () => {
    expect(computeMinProfitRaw(0.5, 2.0)).toBe(1_000_000n)
  })

  it('returns 0n for gasCostUsdc=0', () => {
    expect(computeMinProfitRaw(0)).toBe(0n)
  })

  it('returns 0n for negative gasCostUsdc', () => {
    expect(computeMinProfitRaw(-10)).toBe(0n)
  })

  it('rounds up fractional raw values', () => {
    // 0.333... * 1.5 * 1e6 = 499999.5 → ceil → 500000
    const result = computeMinProfitRaw(1 / 3)
    expect(result).toBe(500000n)
  })
})

// --- quoteFlashLoanArbitrage ---

function makePublicClient(simulateResult: bigint | Error) {
  return {
    simulateContract: vi.fn(async () => {
      if (simulateResult instanceof Error) throw simulateResult
      return { result: simulateResult }
    }),
  }
}

function makeClients(simulateResult: bigint | Error) {
  return {
    ethereum: { public: makePublicClient(simulateResult) },
    arbitrum: { public: makePublicClient(simulateResult) },
  } as unknown as Clients
}

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH_ETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const EXECUTOR = '0x1234567890123456789012345678901234567890' as `0x${string}`

describe('quoteFlashLoanArbitrage', () => {
  const params: FlashLoanParams = {
    network: 'ethereum',
    buyOnV2: true,
    borrowAmount: '1000000000', // 1000 USDC (1e9 * 1e-6 = 1000 USD)
  }

  it('returns willSucceed: true with correct profit when simulateContract succeeds with positive result', async () => {
    const clients = makeClients(50_000_000n) // 50 USDC profit
    const result = await quoteFlashLoanArbitrage(params, 10_000, clients, EXECUTOR)
    expect(result.willSucceed).toBe(true)
    expect(result.expectedProfitRaw).toBe(50_000_000n)
    expect(result.expectedProfitUsd).toBeCloseTo(50)
  })

  it('returns willSucceed: false when profit is 0n', async () => {
    const clients = makeClients(0n)
    const result = await quoteFlashLoanArbitrage(params, 10_000, clients, EXECUTOR)
    expect(result.willSucceed).toBe(false)
    expect(result.expectedProfitRaw).toBe(0n)
  })

  it('returns willSucceed: false when simulateContract throws', async () => {
    const clients = makeClients(new Error('execution reverted'))
    const result = await quoteFlashLoanArbitrage(params, 10_000, clients, EXECUTOR)
    expect(result.willSucceed).toBe(false)
    expect(result.expectedProfitRaw).toBe(0n)
    expect(result.revertReason).toContain('execution reverted')
  })

  it('throws for unknown network', async () => {
    const badParams = { ...params, network: 'polygon' as never }
    const clients = makeClients(100n)
    await expect(quoteFlashLoanArbitrage(badParams, 10_000, clients, EXECUTOR)).rejects.toThrow()
  })

  it('throws when borrowAmount exceeds maxTradeUsdc', async () => {
    const bigParams = { ...params, borrowAmount: '20000000000' } // 20000 USDC
    const clients = makeClients(100n)
    await expect(quoteFlashLoanArbitrage(bigParams, 5000, clients, EXECUTOR)).rejects.toThrow()
  })

  it('handles int256 overflow safely (does not return Infinity)', async () => {
    // Simulate an absurdly large result that might overflow
    const hugeProfit = BigInt('99999999999999999999999999999999999999999')
    const clients = makeClients(hugeProfit)
    const result = await quoteFlashLoanArbitrage(params, 10_000, clients, EXECUTOR)
    expect(isFinite(result.expectedProfitUsd)).toBe(true)
    expect(result.expectedProfitUsd).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER / 1e6)
  })
})

// --- executeFlashLoanArbitrage ---

function makeWriteClient(txHash: `0x${string}`, logData: `0x${string}`) {
  const writeContract = vi.fn(async () => txHash)
  const waitForTransactionReceipt = vi.fn(async () => ({
    logs: [
      {
        topics: [ARBITRAGE_EXECUTED_TOPIC],
        data: logData,
      },
    ],
  }))
  const simulateContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === 'executeArbitrage') return { request: { mock: true } }
    throw new Error('unexpected call')
  })

  return {
    public: { simulateContract, waitForTransactionReceipt },
    wallet: { writeContract },
  }
}

describe('executeFlashLoanArbitrage', () => {
  const params: FlashLoanParams & { minProfit: string } = {
    network: 'arbitrum',
    buyOnV2: false,
    borrowAmount: '500000000', // 500 USDC
    minProfit: '1000000',
  }

  it('returns txHash and profitUsd on success', async () => {
    const txHash = '0xdeadbeef00000000000000000000000000000000000000000000000000000000' as `0x${string}`
    // ABI-encode uint256 of 5_000_000 (5 USDC)
    const profitRaw = 5_000_000n
    const logData = ('0x' + profitRaw.toString(16).padStart(64, '0')) as `0x${string}`
    const networkClient = makeWriteClient(txHash, logData)
    const clients = { arbitrum: networkClient } as unknown as Clients

    const result = await executeFlashLoanArbitrage(params, 10_000, 5, clients, '0xwallet' as `0x${string}`, EXECUTOR)
    expect(result.txHash).toBe(txHash)
    expect(result.profitRaw).toBe('5000000')
    expect(result.profitUsd).toBeCloseTo(5)
  })

  it('raises minProfit to floor when provided value is below 1.5x gas cost', async () => {
    const txHash = '0xabcdef0000000000000000000000000000000000000000000000000000000000' as `0x${string}`
    const profitRaw = 10_000_000n
    const logData = ('0x' + profitRaw.toString(16).padStart(64, '0')) as `0x${string}`
    const networkClient = makeWriteClient(txHash, logData)
    const clients = { arbitrum: networkClient } as unknown as Clients

    // gasCostUsdc=5 → floor = 7_500_000. params.minProfit='1000000' < floor
    // The simulation should be called with 7_500_000n (the floor), not 1_000_000n
    const simulateSpy = networkClient.public.simulateContract
    await executeFlashLoanArbitrage(params, 10_000, 5, clients, '0xwallet' as `0x${string}`, EXECUTOR)

    const callArgs = simulateSpy.mock.calls[0][0] as unknown as { args: [boolean, bigint, bigint] }
    const usedMinProfit = callArgs.args[2]
    expect(usedMinProfit).toBe(7_500_000n)
  })

  it('uses provided minProfit when it exceeds the floor', async () => {
    const highMinProfit = { ...params, minProfit: '20000000' } // 20 USDC > 7.5 USDC floor
    const txHash = '0x1111110000000000000000000000000000000000000000000000000000000000' as `0x${string}`
    const profitRaw = 25_000_000n
    const logData = ('0x' + profitRaw.toString(16).padStart(64, '0')) as `0x${string}`
    const networkClient = makeWriteClient(txHash, logData)
    const clients = { arbitrum: networkClient } as unknown as Clients

    const simulateSpy = networkClient.public.simulateContract
    await executeFlashLoanArbitrage(highMinProfit, 10_000, 5, clients, '0xwallet' as `0x${string}`, EXECUTOR)

    const callArgs = simulateSpy.mock.calls[0][0] as unknown as { args: [boolean, bigint, bigint] }
    expect(callArgs.args[2]).toBe(20_000_000n)
  })

  it('returns profitRaw: 0 when no matching log found', async () => {
    const txHash = '0x2222220000000000000000000000000000000000000000000000000000000000' as `0x${string}`
    const writeContract = vi.fn(async () => txHash)
    const waitForTransactionReceipt = vi.fn(async () => ({ logs: [] }))
    const simulateContract = vi.fn(async () => ({ request: {} }))
    const clients = {
      arbitrum: { public: { simulateContract, waitForTransactionReceipt }, wallet: { writeContract } },
    } as unknown as Clients

    const result = await executeFlashLoanArbitrage(params, 10_000, 5, clients, '0xwallet' as `0x${string}`, EXECUTOR)
    expect(result.profitRaw).toBe('0')
    expect(result.profitUsd).toBe(0)
  })

  it('throws when borrowAmount exceeds maxTradeUsdc', async () => {
    const bigParams = { ...params, borrowAmount: '20000000000' } // 20000 USDC
    const clients = {} as unknown as Clients
    await expect(
      executeFlashLoanArbitrage(bigParams, 5000, 5, clients, '0xwallet' as `0x${string}`, EXECUTOR),
    ).rejects.toThrow()
  })
})
