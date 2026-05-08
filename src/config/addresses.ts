import type { Address } from 'viem'

export type Network = 'ethereum' | 'arbitrum'

export const ADDRESSES = {
  ethereum: {
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    uniV2Router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address,
    uniV2Pair: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc' as Address,
    uniV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
    uniV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as Address,
    // WETH/USDC 0.05% pool
    uniV3Pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as Address,
  },
  arbitrum: {
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    // SushiSwap V2 — pair verified on-chain via factory.getPair(WETH, USDC)
    sushiV2Router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' as Address,
    sushiV2Pair: '0x57b85FEf094e10b5eeCDF350Af688299E9553378' as Address,
    // Uniswap V3 — same deterministic addresses as mainnet
    uniV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
    uniV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as Address,
    // WETH/USDC 0.05% pool — verified on-chain: token0=WETH, token1=USDC, fee=500
    uniV3Pool: '0xC6962004f452bE9203591991D15f6b388e09E8D0' as Address,
  },
} as const
