import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolCallRequest } from '../../src/agent/providers/types.js'

// --- Mocks ---

vi.mock('../../src/agent/providers/index.js', () => {
  const sendMessage = vi.fn()
  const sendToolResults = vi.fn()
  return {
    createProvider: vi.fn(() => ({ name: 'TestProvider', sendMessage, sendToolResults })),
  }
})

vi.mock('../../src/tools/prices.js', () => ({
  getPrices: vi.fn().mockResolvedValue({
    ethereum: { v2: 3000, v3: 3010 },
    arbitrum: { v2: 2990, v3: 3005 },
  }),
}))

vi.mock('../../src/tools/balance.js', () => ({
  getWalletBalance: vi.fn().mockResolvedValue({
    ethereum: { ethNative: '100000000000000000', weth: '1000000000000000000', usdc: '5000000000' },
    arbitrum: { ethNative: '50000000000000000', weth: '500000000000000000', usdc: '2000000000' },
  }),
}))

vi.mock('../../src/tools/gas.js', () => ({
  estimateGas: vi.fn().mockResolvedValue({
    gasCostUsd: 5,
    gasLimit: 150000n,
    gasPriceWei: 20000000000n,
  }),
}))

vi.mock('../../src/tools/flash_loan.js', () => ({
  quoteFlashLoanArbitrage: vi.fn(),
  executeFlashLoanArbitrage: vi.fn(),
  computeMinProfitRaw: vi.fn().mockReturnValue(7_500_000n),
}))

// --- Helpers ---

type TurnResult = { textBlocks: string[]; toolCalls: ToolCallRequest[]; abortReason?: string }

function makeEndTurn(text = ''): TurnResult {
  return { textBlocks: text ? [text] : [], toolCalls: [] }
}

function makeToolCall(
  tools: Array<{ name: string; args: Record<string, unknown> }>,
  text = '',
): TurnResult {
  return {
    textBlocks: text ? [text] : [],
    toolCalls: tools.map((t, i) => ({ id: `call_${i}`, name: t.name, args: t.args })),
  }
}

function makeAbort(reason: string): TurnResult {
  return { textBlocks: [], toolCalls: [], abortReason: reason }
}

async function getMocks() {
  const mod = await import('../../src/agent/providers/index.js')
  // Call createProvider to get the shared mock fns from the vi.mock closure
  const provider = (mod.createProvider as ReturnType<typeof vi.fn>)('mock', '', []) as {
    sendMessage: ReturnType<typeof vi.fn>
    sendToolResults: ReturnType<typeof vi.fn>
  }
  return { sendMessage: provider.sendMessage, sendToolResults: provider.sendToolResults }
}

const EXECUTOR_ARB = '0xExecutorArbitrum000000000000000000000000' as `0x${string}`
const EXECUTOR_ETH = '0xExecutorEthereum000000000000000000000000' as `0x${string}`
const EXECUTOR_ADDRESSES = { arbitrum: EXECUTOR_ARB, ethereum: EXECUTOR_ETH }

// --- Tests ---

describe('dispatchTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dispatches get_prices and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: ToolCallRequest = { id: 'call_0', name: 'get_prices', args: {} }
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('get_prices')
    expect(parsed.data.ethereum.v2).toBe(3000)
  })

  it('dispatches get_wallet_balance and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: ToolCallRequest = { id: 'call_0', name: 'get_wallet_balance', args: {} }
    const result = await dispatchTool(call, {} as never, '0xwallet' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('get_wallet_balance')
    expect(parsed.data.ethereum.weth).toBe('1000000000000000000')
  })

  it('dispatches estimate_gas with correct args', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: ToolCallRequest = { id: 'call_0', name: 'estimate_gas', args: { network: 'ethereum', dex: 'v2' } }
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('estimate_gas')
    expect(parsed.data.gasCostUsd).toBe(5)
  })

  it('dispatches simulate_flash_loan_arbitrage and returns wrapped result', async () => {
    const { quoteFlashLoanArbitrage } = await import('../../src/tools/flash_loan.js')
    ;(quoteFlashLoanArbitrage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      expectedProfitRaw: 10_000_000n,
      expectedProfitUsd: 10,
      willSucceed: true,
    })

    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: ToolCallRequest = {
      id: 'call_0',
      name: 'simulate_flash_loan_arbitrage',
      args: { network: 'arbitrum', buyOnV2: true, borrowAmount: '1000000000' },
    }
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 10_000, EXECUTOR_ADDRESSES)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('simulate_flash_loan_arbitrage')
    expect(parsed.data.willSucceed).toBe(true)
    expect(parsed.data.expectedProfitUsd).toBe(10)
    expect(quoteFlashLoanArbitrage).toHaveBeenCalledOnce()
  })

  it('returns error when simulate_flash_loan_arbitrage has no executor address', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: ToolCallRequest = {
      id: 'call_0',
      name: 'simulate_flash_loan_arbitrage',
      args: { network: 'arbitrum', buyOnV2: true, borrowAmount: '1000000000' },
    }
    // no executorAddresses passed
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 10_000)
    const parsed = JSON.parse(result)
    expect(parsed.error).toMatch(/No executor address/)
  })

  it('wraps errors in JSON error envelope', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: ToolCallRequest = { id: 'call_0', name: 'unknown_tool', args: {} }
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.error).toMatch(/Unknown tool/)
  })
})

describe('runIteration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('completes a full iteration with end_turn', async () => {
    const { sendMessage } = await getMocks()
    sendMessage.mockResolvedValue(makeEndTurn('No arbitrage opportunity this iteration.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await expect(runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')).resolves.toBeUndefined()
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  it('aborts and warns on provider abort reason', async () => {
    const { sendMessage } = await getMocks()
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    sendMessage.mockResolvedValue(makeAbort('MAX_TOKENS'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MAX_TOKENS'))
    consoleSpy.mockRestore()
  })

  it('dispatches non-exec tools sequentially', async () => {
    const { sendMessage, sendToolResults } = await getMocks()
    const { getPrices } = await import('../../src/tools/prices.js')

    sendMessage.mockResolvedValueOnce(
      makeToolCall([{ name: 'get_prices', args: {} }]),
    )
    sendToolResults.mockResolvedValueOnce(makeEndTurn('No opportunity.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')

    expect(getPrices).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(sendToolResults).toHaveBeenCalledOnce()
  })
})

describe('runIteration — mnemos', () => {
  let sendMessage: ReturnType<typeof vi.fn>
  let sendToolResults: ReturnType<typeof vi.fn>
  let mockSnapshot: ReturnType<typeof vi.fn>
  let mockList: ReturnType<typeof vi.fn>
  let mnemos: {
    client: { snapshot: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> }
    terms: object
    stats: { totalTrades: number; totalGasCostUsd: number }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ sendMessage, sendToolResults } = await getMocks())
    mockSnapshot = vi.fn().mockResolvedValue({ tokenId: '42', txHash: '0xsnaptx', storageUri: 'mock://uri' })
    mockList = vi.fn().mockResolvedValue('0xlisttx')
    mnemos = {
      client: { snapshot: mockSnapshot, list: mockList },
      terms: { buyPrice: 1000n, rentPricePerDay: 100n, forkPrice: 500n, royaltyBps: 500 },
      stats: { totalTrades: 0, totalGasCostUsd: 0 },
    }
  })

  it('no mnemos provided → snapshot never called', async () => {
    sendMessage.mockResolvedValue(makeEndTurn('No opportunity'))
    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')
    expect(mockSnapshot).not.toHaveBeenCalled()
  })

  it('mnemos provided but no trade → snapshot not called', async () => {
    sendMessage.mockResolvedValueOnce(makeToolCall([{ name: 'get_prices', args: {} }]))
    sendToolResults.mockResolvedValueOnce(makeEndTurn('No opportunity'))
    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as never)
    expect(mockSnapshot).not.toHaveBeenCalled()
  })

  it('flash loan succeeds → snapshot called with correct pricesAtTrade and txHash', async () => {
    const { executeFlashLoanArbitrage } = await import('../../src/tools/flash_loan.js')
    ;(executeFlashLoanArbitrage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      txHash: '0xtradetx',
      profitRaw: '5000000',
      profitUsd: 5,
    })

    sendMessage.mockResolvedValueOnce(
      makeToolCall([{ name: 'execute_flash_loan_arbitrage', args: { network: 'arbitrum', buyOnV2: true, borrowAmount: '1000000000', minProfit: '4000000' } }]),
    )
    sendToolResults.mockResolvedValueOnce(makeEndTurn('Trade done.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 10_000, 'gemini-2.0-flash', mnemos as never, EXECUTOR_ADDRESSES)

    expect(mockSnapshot).toHaveBeenCalledOnce()
    const bundle = mockSnapshot.mock.calls[0][0]
    const tradeData = bundle.data as { trade: { txHash: string }; context: { pricesAtTrade: null } }
    expect(tradeData.trade.txHash).toBe('0xtradetx')
  })

  it('snapshot error → no crash, error logged, stats unchanged', async () => {
    const { executeFlashLoanArbitrage } = await import('../../src/tools/flash_loan.js')
    ;(executeFlashLoanArbitrage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      txHash: '0xtradetx2',
      profitRaw: '3000000',
      profitUsd: 3,
    })
    mockSnapshot.mockRejectedValueOnce(new Error('snapshot failed'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    sendMessage.mockResolvedValueOnce(
      makeToolCall([{ name: 'execute_flash_loan_arbitrage', args: { network: 'arbitrum', buyOnV2: false, borrowAmount: '500000000', minProfit: '2000000' } }]),
    )
    sendToolResults.mockResolvedValueOnce(makeEndTurn('Done.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await expect(
      runIteration({} as never, '0xwallet' as `0x${string}`, 10_000, 'gemini-2.0-flash', mnemos as never, EXECUTOR_ADDRESSES),
    ).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[mnemos]'), expect.stringContaining('snapshot failed'))
    expect(mnemos.stats.totalTrades).toBe(0)
    consoleSpy.mockRestore()
  })

  it('list error → no crash, stats unchanged', async () => {
    const { executeFlashLoanArbitrage } = await import('../../src/tools/flash_loan.js')
    ;(executeFlashLoanArbitrage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      txHash: '0xtradetx3',
      profitRaw: '2000000',
      profitUsd: 2,
    })
    mockList.mockRejectedValueOnce(new Error('list failed'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    sendMessage.mockResolvedValueOnce(
      makeToolCall([{ name: 'execute_flash_loan_arbitrage', args: { network: 'ethereum', buyOnV2: true, borrowAmount: '500000000', minProfit: '1500000' } }]),
    )
    sendToolResults.mockResolvedValueOnce(makeEndTurn('Done.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await expect(
      runIteration({} as never, '0xwallet' as `0x${string}`, 10_000, 'gemini-2.0-flash', mnemos as never, EXECUTOR_ADDRESSES),
    ).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[mnemos]'), expect.stringContaining('list failed'))
    expect(mnemos.stats.totalTrades).toBe(0)
    consoleSpy.mockRestore()
  })

  it('stats incremented after full flash loan success', async () => {
    const { executeFlashLoanArbitrage } = await import('../../src/tools/flash_loan.js')
    ;(executeFlashLoanArbitrage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      txHash: '0xtradetx4',
      profitRaw: '8000000',
      profitUsd: 8,
    })

    // First, estimate_gas to set latestGasCostUsd
    sendMessage.mockResolvedValueOnce(
      makeToolCall([{ name: 'estimate_gas', args: { network: 'arbitrum', dex: 'flash_loan' } }]),
    )
    sendToolResults.mockResolvedValueOnce(
      makeToolCall([{ name: 'execute_flash_loan_arbitrage', args: { network: 'arbitrum', buyOnV2: true, borrowAmount: '1000000000', minProfit: '6000000' } }]),
    )
    sendToolResults.mockResolvedValueOnce(makeEndTurn('Done.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 10_000, 'gemini-2.0-flash', mnemos as never, EXECUTOR_ADDRESSES)

    expect(mnemos.stats.totalTrades).toBe(1)
    expect(mnemos.stats.totalGasCostUsd).toBe(5) // from mocked estimateGas
  })

  it('reasoning joined from multiple turns', async () => {
    const { executeFlashLoanArbitrage } = await import('../../src/tools/flash_loan.js')
    ;(executeFlashLoanArbitrage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      txHash: '0xtradetx5',
      profitRaw: '4000000',
      profitUsd: 4,
    })

    sendMessage.mockResolvedValueOnce(makeToolCall([{ name: 'get_prices', args: {} }], 'Checking prices now.'))
    sendToolResults.mockResolvedValueOnce(
      makeToolCall([{ name: 'execute_flash_loan_arbitrage', args: { network: 'arbitrum', buyOnV2: true, borrowAmount: '500000000', minProfit: '3000000' } }], 'Spread looks profitable.'),
    )
    sendToolResults.mockResolvedValueOnce(makeEndTurn('Trade executed.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 10_000, 'gemini-2.0-flash', mnemos as never, EXECUTOR_ADDRESSES)

    expect(mockSnapshot).toHaveBeenCalledOnce()
    const bundle = mockSnapshot.mock.calls[0][0]
    const ctx = bundle.data as { context: { agentReasoning: string } }
    expect(ctx.context.agentReasoning).toContain('Checking prices now.')
    expect(ctx.context.agentReasoning).toContain('Spread looks profitable.')
  })

  it('gasCostUsd is null in bundle when estimate_gas not called', async () => {
    const { executeFlashLoanArbitrage } = await import('../../src/tools/flash_loan.js')
    ;(executeFlashLoanArbitrage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      txHash: '0xtradetx6',
      profitRaw: '1000000',
      profitUsd: 1,
    })

    // Directly call execute without prior estimate_gas
    sendMessage.mockResolvedValueOnce(
      makeToolCall([{ name: 'execute_flash_loan_arbitrage', args: { network: 'arbitrum', buyOnV2: false, borrowAmount: '200000000', minProfit: '800000' } }]),
    )
    sendToolResults.mockResolvedValueOnce(makeEndTurn('Done.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 10_000, 'gemini-2.0-flash', mnemos as never, EXECUTOR_ADDRESSES)

    expect(mockSnapshot).toHaveBeenCalledOnce()
    const bundle = mockSnapshot.mock.calls[0][0]
    const tradeData = bundle.data as { trade: { gasCostUsd: number | null } }
    expect(tradeData.trade.gasCostUsd).toBeNull()
  })
})
