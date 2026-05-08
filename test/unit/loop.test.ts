import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FunctionCall } from '@google/generative-ai'

// --- Mocks (must be defined before dynamic imports) ---

vi.mock('@google/generative-ai', () => {
  const sendMessage = vi.fn()
  const startChat = vi.fn(() => ({ sendMessage }))
  const getGenerativeModel = vi.fn(() => ({ startChat }))
  const SchemaType = {
    STRING: 'string',
    NUMBER: 'number',
    INTEGER: 'integer',
    BOOLEAN: 'boolean',
    ARRAY: 'array',
    OBJECT: 'object',
  }
  const FinishReason = {
    STOP: 'STOP',
    MAX_TOKENS: 'MAX_TOKENS',
    SAFETY: 'SAFETY',
    RECITATION: 'RECITATION',
    OTHER: 'OTHER',
  }
  return { GoogleGenerativeAI: vi.fn(() => ({ getGenerativeModel })), SchemaType, FinishReason }
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

vi.mock('../../src/tools/swap.js', () => ({
  executeSwap: vi.fn().mockResolvedValue({
    txHash: '0xabc123',
    amountOut: '3000000000',
  }),
}))

// --- Helpers ---

function makeEndTurn(text = ''): any {
  const parts = text ? [{ text }] : []
  return {
    response: {
      candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
      functionCalls: () => undefined,
    },
  }
}

function makeToolCall(tools: Array<{ name: string; args: Record<string, unknown> }>, text = ''): any {
  const parts = [
    ...(text ? [{ text }] : []),
    ...tools.map(t => ({ functionCall: t })),
  ]
  return {
    response: {
      candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
      functionCalls: () => tools,
    },
  }
}

function makeMaxTokens(): any {
  return {
    response: {
      candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS' }],
      functionCalls: () => undefined,
    },
  }
}

async function getMockSendMessage() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const ai = new (GoogleGenerativeAI as any)('')
  const model = ai.getGenerativeModel({})
  const chat = model.startChat()
  return vi.mocked(chat.sendMessage)
}

// --- Tests ---

describe('dispatchTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dispatches get_prices and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: FunctionCall = { name: 'get_prices', args: {} }
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('get_prices')
    expect(parsed.data.ethereum.v2).toBe(3000)
  })

  it('dispatches get_wallet_balance and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: FunctionCall = { name: 'get_wallet_balance', args: {} }
    const result = await dispatchTool(call, {} as never, '0xwallet' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('get_wallet_balance')
    expect(parsed.data.ethereum.weth).toBe('1000000000000000000')
  })

  it('dispatches estimate_gas with correct args', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: FunctionCall = { name: 'estimate_gas', args: { network: 'ethereum', dex: 'v2' } }
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('estimate_gas')
    expect(parsed.data.gasCostUsd).toBe(5)
  })

  it('dispatches execute_swap and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: FunctionCall = {
      name: 'execute_swap',
      args: {
        network: 'ethereum',
        dex: 'v3',
        token_in: '0xtoken_in',
        token_out: '0xtoken_out',
        amount_in: '1000000000000000000',
        min_amount_out: '2900000000',
      },
    }
    const result = await dispatchTool(call, {} as never, '0xwallet' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('execute_swap')
    expect(parsed.data.txHash).toBe('0xabc123')
  })

  it('wraps errors in JSON error envelope', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const call: FunctionCall = { name: 'unknown_tool', args: {} }
    const result = await dispatchTool(call, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.error).toMatch(/Unknown tool/)
  })
})

describe('runIteration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('completes a full iteration with end_turn', async () => {
    const mockSendMessage = await getMockSendMessage()
    mockSendMessage.mockResolvedValue(makeEndTurn('No arbitrage opportunity this iteration.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await expect(runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')).resolves.toBeUndefined()
    expect(mockSendMessage).toHaveBeenCalledOnce()
  })

  it('aborts and warns on max_tokens stop reason', async () => {
    const mockSendMessage = await getMockSendMessage()
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSendMessage.mockResolvedValue(makeMaxTokens())

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('MAX_TOKENS'))
    consoleSpy.mockRestore()
  })

  it('dispatches non-swap tools then execute_swap sequentially', async () => {
    const mockSendMessage = await getMockSendMessage()
    const { getPrices } = await import('../../src/tools/prices.js')
    const { executeSwap } = await import('../../src/tools/swap.js')

    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([
        { name: 'get_prices', args: {} },
        {
          name: 'execute_swap',
          args: {
            network: 'ethereum', dex: 'v3',
            token_in: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            token_out: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            amount_in: '1000000000000000000', min_amount_out: '2900000000',
          },
        },
      ]))
      .mockResolvedValueOnce(makeEndTurn('Swap executed.'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')

    expect(getPrices).toHaveBeenCalledOnce()
    expect(executeSwap).toHaveBeenCalledOnce()
    expect(mockSendMessage).toHaveBeenCalledTimes(2)
  })

  it('skips second execute_swap in the same iteration', async () => {
    const mockSendMessage = await getMockSendMessage()
    const { executeSwap } = await import('../../src/tools/swap.js')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const swapArgs = {
      network: 'ethereum', dex: 'v3',
      token_in: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      token_out: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amount_in: '1000000000000000000', min_amount_out: '2900000000',
    }

    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([
        { name: 'execute_swap', args: swapArgs },
        { name: 'execute_swap', args: swapArgs },
      ]))
      .mockResolvedValueOnce(makeEndTurn())

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')

    expect(executeSwap).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith('[WARN]', expect.stringContaining('already called'))
    warnSpy.mockRestore()
  })
})

describe('runIteration — mnemos', () => {
  const SWAP_ARGS = {
    network: 'ethereum', dex: 'v3',
    token_in: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    token_out: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amount_in: '1000000000000000000', min_amount_out: '2900000000',
  }

  let mockSendMessage: ReturnType<typeof vi.fn>
  let mockSnapshot: ReturnType<typeof vi.fn>
  let mockList: ReturnType<typeof vi.fn>
  let mnemos: { client: { snapshot: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> }; terms: object; stats: { totalTrades: number; totalGasCostUsd: number } }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockSendMessage = await getMockSendMessage()
    mockSnapshot = vi.fn().mockResolvedValue({ tokenId: '42', txHash: '0xsnaptx', storageUri: 'mock://uri' })
    mockList = vi.fn().mockResolvedValue('0xlisttx')
    mnemos = {
      client: { snapshot: mockSnapshot, list: mockList },
      terms: { buyPrice: 1000n, rentPricePerDay: 100n, forkPrice: 500n, royaltyBps: 500 },
      stats: { totalTrades: 0, totalGasCostUsd: 0 },
    }
  })

  it('no mnemos provided → snapshot never called', async () => {
    mockSendMessage.mockResolvedValue(makeEndTurn('No opportunity'))
    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash')
    expect(mockSnapshot).not.toHaveBeenCalled()
  })

  it('mnemos provided but no swap → snapshot not called', async () => {
    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([{ name: 'get_prices', args: {} }]))
      .mockResolvedValueOnce(makeEndTurn('No opportunity'))
    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)
    expect(mockSnapshot).not.toHaveBeenCalled()
  })

  it('swap succeeds → snapshot called once with correct pricesAtTrade', async () => {
    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([
        { name: 'get_prices', args: {} },
        { name: 'execute_swap', args: SWAP_ARGS },
      ]))
      .mockResolvedValueOnce(makeEndTurn('Swap done'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)

    expect(mockSnapshot).toHaveBeenCalledOnce()
    const bundle = mockSnapshot.mock.calls[0][0] as any
    expect(bundle.data.context.pricesAtTrade).toEqual({
      ethereum: { v2: 3000, v3: 3010 },
      arbitrum: { v2: 2990, v3: 3005 },
    })
    expect(bundle.data.trade.txHash).toBe('0xabc123')
  })

  it('snapshot error → no crash, error logged, stats unchanged', async () => {
    mockSnapshot.mockRejectedValue(new Error('snapshot failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([{ name: 'execute_swap', args: SWAP_ARGS }]))
      .mockResolvedValueOnce(makeEndTurn())

    const { runIteration } = await import('../../src/agent/loop.js')
    await expect(runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('[mnemos] Error:', 'snapshot failed')
    expect(mnemos.stats.totalTrades).toBe(0)
    expect(mnemos.stats.totalGasCostUsd).toBe(0)
    errorSpy.mockRestore()
  })

  it('list error → no crash, stats unchanged', async () => {
    mockList.mockRejectedValue(new Error('list failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([{ name: 'execute_swap', args: SWAP_ARGS }]))
      .mockResolvedValueOnce(makeEndTurn())

    const { runIteration } = await import('../../src/agent/loop.js')
    await expect(runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('[mnemos] Error:', 'list failed')
    expect(mnemos.stats.totalTrades).toBe(0)
    errorSpy.mockRestore()
  })

  it('stats incremented after full success', async () => {
    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([
        { name: 'estimate_gas', args: { network: 'ethereum', dex: 'v3' } },
        { name: 'execute_swap', args: SWAP_ARGS },
      ]))
      .mockResolvedValueOnce(makeEndTurn())

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)

    expect(mnemos.stats.totalTrades).toBe(1)
    expect(mnemos.stats.totalGasCostUsd).toBe(5)
  })

  it('reasoning joined from multiple turns', async () => {
    mockSendMessage
      .mockResolvedValueOnce(makeToolCall(
        [{ name: 'execute_swap', args: SWAP_ARGS }],
        'Analyzing spread...',
      ))
      .mockResolvedValueOnce(makeEndTurn('Swap executed successfully'))

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)

    const bundle = mockSnapshot.mock.calls[0][0] as any
    expect(bundle.data.context.agentReasoning).toBe('Analyzing spread...\n\nSwap executed successfully')
  })

  it('gasCostUsd is null in bundle when estimate_gas not called', async () => {
    mockSendMessage
      .mockResolvedValueOnce(makeToolCall([{ name: 'execute_swap', args: SWAP_ARGS }]))
      .mockResolvedValueOnce(makeEndTurn())

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'gemini-2.0-flash', mnemos as any)

    const bundle = mockSnapshot.mock.calls[0][0] as any
    expect(bundle.data.trade.gasCostUsd).toBeNull()
  })
})
