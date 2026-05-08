import { describe, it, expect } from 'vitest'
import { calculateGasCostUsd } from '../../src/tools/gas.js'

describe('calculateGasCostUsd', () => {
  it('returns correct cost for V2 swap at average gas price', () => {
    const gasLimit = 150_000n
    const gasPriceWei = 20n * 10n ** 9n  // 20 gwei
    const ethPriceUsdc = 3000

    // 150000 * 20e9 = 3e15 wei = 0.003 ETH → 0.003 * 3000 = $9
    const cost = calculateGasCostUsd(gasLimit, gasPriceWei, ethPriceUsdc)
    expect(cost).toBeCloseTo(9, 1)
  })

  it('returns correct cost for V3 swap at low gas price', () => {
    const gasLimit = 180_000n
    const gasPriceWei = 5n * 10n ** 9n  // 5 gwei
    const ethPriceUsdc = 2000

    // 180000 * 5e9 = 9e14 wei = 0.0009 ETH → 0.0009 * 2000 = $1.8
    const cost = calculateGasCostUsd(gasLimit, gasPriceWei, ethPriceUsdc)
    expect(cost).toBeCloseTo(1.8, 1)
  })

  it('handles high gas prices without bigint overflow', () => {
    // 1000 gwei × 200k gas × $5000 ETH — stress test for overflow
    const gasLimit = 200_000n
    const gasPriceWei = 1000n * 10n ** 9n
    const ethPriceUsdc = 5000

    // 200000 * 1000e9 = 2e17 wei = 0.2 ETH → 0.2 * 5000 = $1000
    const cost = calculateGasCostUsd(gasLimit, gasPriceWei, ethPriceUsdc)
    expect(cost).toBeCloseTo(1000, 0)
  })

  it('returns near-zero cost at very low gas price', () => {
    const gasLimit = 150_000n
    const gasPriceWei = 1n * 10n ** 9n  // 1 gwei
    const ethPriceUsdc = 3000

    const cost = calculateGasCostUsd(gasLimit, gasPriceWei, ethPriceUsdc)
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(1)
  })
})
