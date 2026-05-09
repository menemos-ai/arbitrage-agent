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
    ethereum: { weth: '1000000000000000000', usdc: '5000000000' },
    arbitrum: { weth: '500000000000000000', usdc: '2000000000' },
  }),
}))

vi.mock('../../src/tools/gas.js', () => ({
  estimateGas: vi.fn().mockResolvedValue({
    gasCostUsd: 5,
    gasLimit: 150000n,
    gasPriceWei: 20000000000n,
  }),
}))

// swap.ts removed — execute_swap replaced by flash loan tools in U6

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

  it('dispatches non-swap tools sequentially', async () => {
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
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)
    expect(mockSnapshot).not.toHaveBeenCalled()
  })

  // The following tests require execute_flash_loan_arbitrage dispatch — rewritten in U6
  it.todo('flash loan succeeds → snapshot called with correct pricesAtTrade and txHash')
  it.todo('snapshot error → no crash, error logged, stats unchanged')
  it.todo('list error → no crash, stats unchanged')
  it.todo('stats incremented after full flash loan success')
  it.todo('reasoning joined from multiple turns')
  it.todo('gasCostUsd is null in bundle when estimate_gas not called')
})
