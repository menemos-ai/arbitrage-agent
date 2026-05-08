import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

// --- Mocks (must be defined before dynamic imports) ---

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn()
  return { default: vi.fn(() => ({ messages: { create } })) }
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

// --- Tests ---

describe('dispatchTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dispatches get_prices and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const block = { id: '1', name: 'get_prices', type: 'tool_use', input: {} } as Anthropic.ToolUseBlock
    const result = await dispatchTool(block, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('get_prices')
    expect(parsed.data.ethereum.v2).toBe(3000)
  })

  it('dispatches get_wallet_balance and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const block = { id: '2', name: 'get_wallet_balance', type: 'tool_use', input: {} } as Anthropic.ToolUseBlock
    const result = await dispatchTool(block, {} as never, '0xwallet' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('get_wallet_balance')
    expect(parsed.data.ethereum.weth).toBe('1000000000000000000')
  })

  it('dispatches estimate_gas with correct args', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const block = {
      id: '3',
      name: 'estimate_gas',
      type: 'tool_use',
      input: { network: 'ethereum', dex: 'v2' },
    } as Anthropic.ToolUseBlock
    const result = await dispatchTool(block, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('estimate_gas')
    expect(parsed.data.gasCostUsd).toBe(5)
  })

  it('dispatches execute_swap and returns wrapped result', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const block = {
      id: '4',
      name: 'execute_swap',
      type: 'tool_use',
      input: {
        network: 'ethereum',
        dex: 'v3',
        token_in: '0xtoken_in',
        token_out: '0xtoken_out',
        amount_in: '1000000000000000000',
        min_amount_out: '2900000000',
      },
    } as Anthropic.ToolUseBlock
    const result = await dispatchTool(block, {} as never, '0xwallet' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.tool).toBe('execute_swap')
    expect(parsed.data.txHash).toBe('0xabc123')
  })

  it('wraps errors in JSON error envelope', async () => {
    const { dispatchTool } = await import('../../src/agent/loop.js')
    const block = { id: '5', name: 'unknown_tool', type: 'tool_use', input: {} } as Anthropic.ToolUseBlock
    const result = await dispatchTool(block, {} as never, '0x0' as `0x${string}`, 100)
    const parsed = JSON.parse(result)
    expect(parsed.error).toMatch(/Unknown tool/)
  })
})

describe('runIteration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('completes a full iteration with end_turn', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const mockCreate = vi.mocked(new Anthropic().messages.create)

    mockCreate.mockResolvedValue({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'text', text: 'No arbitrage opportunity this iteration.' }],
    })

    const { runIteration } = await import('../../src/agent/loop.js')
    await expect(runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'claude-opus-4-7')).resolves.toBeUndefined()
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('aborts and warns on max_tokens stop reason', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const mockCreate = vi.mocked(new Anthropic().messages.create)
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockCreate.mockResolvedValue({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-4-7',
      stop_reason: 'max_tokens',
      stop_sequence: null,
      usage: { input_tokens: 4096, output_tokens: 4096 },
      content: [],
    })

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'claude-opus-4-7')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('max_tokens'))
    consoleSpy.mockRestore()
  })

  it('dispatches non-swap tools then execute_swap sequentially', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const mockCreate = vi.mocked(new Anthropic().messages.create)
    const { getPrices } = await import('../../src/tools/prices.js')
    const { executeSwap } = await import('../../src/tools/swap.js')

    // First response: tool_use with get_prices + execute_swap
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'get_prices', input: {} },
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'execute_swap',
            input: {
              network: 'ethereum', dex: 'v3',
              token_in: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              token_out: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              amount_in: '1000000000000000000', min_amount_out: '2900000000',
            },
          },
        ],
      })
      // Second response: end_turn
      .mockResolvedValueOnce({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 300, output_tokens: 50 },
        content: [{ type: 'text', text: 'Swap executed.' }],
      })

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'claude-opus-4-7')

    expect(getPrices).toHaveBeenCalledOnce()
    expect(executeSwap).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('skips second execute_swap in the same iteration', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const mockCreate = vi.mocked(new Anthropic().messages.create)
    const { executeSwap } = await import('../../src/tools/swap.js')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const swapInput = {
      network: 'ethereum', dex: 'v3',
      token_in: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      token_out: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amount_in: '1000000000000000000', min_amount_out: '2900000000',
    }

    mockCreate
      .mockResolvedValueOnce({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'execute_swap', input: swapInput },
          { type: 'tool_use', id: 'tu_2', name: 'execute_swap', input: swapInput },
        ],
      })
      .mockResolvedValueOnce({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 200, output_tokens: 30 },
        content: [],
      })

    const { runIteration } = await import('../../src/agent/loop.js')
    await runIteration({} as never, '0xwallet' as `0x${string}`, 100, 'claude-opus-4-7')

    expect(executeSwap).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith('[WARN]', expect.stringContaining('already called'))
    warnSpy.mockRestore()
  })
})
