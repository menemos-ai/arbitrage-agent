import { describe, it, expect } from 'vitest'
import {
  validateTokenWhitelist,
  validateAmount,
  buildDeadline,
  clampMinAmountOut,
} from '../../src/tools/swap.js'
import { ADDRESSES } from '../../src/config/addresses.js'

const ETH_WETH = ADDRESSES.ethereum.weth
const ETH_USDC = ADDRESSES.ethereum.usdc
const ARB_WETH = ADDRESSES.arbitrum.weth
const ARB_USDC = ADDRESSES.arbitrum.usdc

describe('validateTokenWhitelist', () => {
  it('passes for valid ETH mainnet WETH/USDC pair', () => {
    expect(() => validateTokenWhitelist(ETH_WETH, ETH_USDC, 'ethereum')).not.toThrow()
  })

  it('passes for valid Arbitrum WETH/USDC pair (reversed)', () => {
    expect(() => validateTokenWhitelist(ARB_USDC, ARB_WETH, 'arbitrum')).not.toThrow()
  })

  it('throws for unknown token_in', () => {
    expect(() =>
      validateTokenWhitelist('0xdeadbeef00000000000000000000000000000000', ETH_USDC, 'ethereum'),
    ).toThrow(/token_in.*not whitelisted/)
  })

  it('throws for unknown token_out', () => {
    expect(() =>
      validateTokenWhitelist(ETH_WETH, '0xdeadbeef00000000000000000000000000000000', 'ethereum'),
    ).toThrow(/token_out.*not whitelisted/)
  })

  it('rejects ETH tokens on Arbitrum network', () => {
    expect(() =>
      validateTokenWhitelist(ETH_WETH, ETH_USDC, 'arbitrum'),
    ).toThrow(/token_in.*not whitelisted/)
  })
})

describe('validateAmount', () => {
  it('passes when amount is within limit', () => {
    expect(() => validateAmount(50, 100)).not.toThrow()
  })

  it('passes when amount equals limit', () => {
    expect(() => validateAmount(100, 100)).not.toThrow()
  })

  it('throws when amount exceeds limit', () => {
    expect(() => validateAmount(101, 100)).toThrow(/exceeds MAX_TRADE_USDC/)
  })

  it('includes amounts in error message', () => {
    expect(() => validateAmount(150.5, 100)).toThrow(/\$150\.50/)
  })
})

describe('buildDeadline', () => {
  it('returns a bigint deadline in the future', () => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const deadline = buildDeadline()
    expect(typeof deadline).toBe('bigint')
    expect(deadline).toBeGreaterThan(now)
  })

  it('defaults to 5-minute offset', () => {
    const before = BigInt(Math.floor(Date.now() / 1000))
    const deadline = buildDeadline()
    expect(deadline - before).toBeGreaterThanOrEqual(299n)
    expect(deadline - before).toBeLessThanOrEqual(301n)
  })

  it('respects custom offset', () => {
    const before = BigInt(Math.floor(Date.now() / 1000))
    const deadline = buildDeadline(60)
    expect(deadline - before).toBeGreaterThanOrEqual(59n)
    expect(deadline - before).toBeLessThanOrEqual(61n)
  })
})

describe('clampMinAmountOut', () => {
  it('keeps Claude value when above 90% floor', () => {
    const claudeMin = 950n
    const quote = 1000n
    expect(clampMinAmountOut(claudeMin, quote)).toBe(950n)
  })

  it('raises to 90% floor when Claude value is too low', () => {
    const claudeMin = 800n
    const quote = 1000n
    // floor = 1000 * 9000 / 10000 = 900
    expect(clampMinAmountOut(claudeMin, quote)).toBe(900n)
  })

  it('keeps Claude value exactly at the floor', () => {
    const claudeMin = 900n
    const quote = 1000n
    expect(clampMinAmountOut(claudeMin, quote)).toBe(900n)
  })

  it('raises when Claude passes 0', () => {
    const claudeMin = 0n
    const quote = 3000_000000n  // 3000 USDC
    const result = clampMinAmountOut(claudeMin, quote)
    expect(result).toBe(2700_000000n)  // 90%
  })
})
