import { describe, it, expect } from 'vitest'
import { normalizeV2Price, normalizeV3Price } from '../../src/tools/prices.js'

describe('normalizeV2Price', () => {
  it('returns correct price when token0 is USDC', () => {
    // reserve0 = 1000 USDC (6 dec), reserve1 = 0.5 WETH (18 dec) → price = 2000
    const reserve0 = 1000n * 10n ** 6n
    const reserve1 = 5n * 10n ** 17n
    expect(normalizeV2Price(reserve0, reserve1, false)).toBeCloseTo(2000, 0)
  })

  it('returns correct price when token0 is WETH', () => {
    // reserve0 = 0.5 WETH (18 dec), reserve1 = 1000 USDC (6 dec) → price = 2000
    const reserve0 = 5n * 10n ** 17n
    const reserve1 = 1000n * 10n ** 6n
    expect(normalizeV2Price(reserve0, reserve1, true)).toBeCloseTo(2000, 0)
  })

  it('handles large real-world reserves', () => {
    // ~3000 USDC per WETH pool (ETH mainnet style: token0=USDC)
    const reserveUsdc = 3_000_000n * 10n ** 6n  // 3M USDC
    const reserveWeth = 1000n * 10n ** 18n       // 1000 WETH
    expect(normalizeV2Price(reserveUsdc, reserveWeth, false)).toBeCloseTo(3000, 0)
  })
})

describe('normalizeV3Price', () => {
  it('converts USDC amount out to price', () => {
    // 3000 USDC for 1 WETH → amountOut = 3000_000000 (6 dec)
    const amountOut = 3000n * 10n ** 6n
    expect(normalizeV3Price(amountOut)).toBeCloseTo(3000, 1)
  })

  it('handles sub-cent precision', () => {
    const amountOut = 2999_500000n
    expect(normalizeV3Price(amountOut)).toBeCloseTo(2999.5, 1)
  })
})
