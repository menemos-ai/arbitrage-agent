import { describe, it, expect } from 'vitest'
import { validateTokenWhitelist, validateAmount } from '../../src/tools/utils.js'
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
