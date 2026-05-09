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
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
  },
  arbitrum: {
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address,
    // USDC.e (bridged) — SushiSwap V2 and UniV3 liquidity on Arbitrum is concentrated in USDC.e.
    // The native USDC pool on SushiSwap has only ~$23K TVL (unusable), while USDC.e has ~$174K.
    usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' as Address,
    // SushiSwap V2 — WETH/USDC.e pair (verified: token0=WETH, token1=USDC.e, TVL ~$174K)
    sushiV2Router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' as Address,
    sushiV2Pair: '0x905dfCD5649217c42684f23958568e533C711Aa3' as Address,
    // Uniswap V3 — same deterministic addresses as mainnet
    uniV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
    uniV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as Address,
    // WETH/USDC.e 0.05% pool — verified on-chain
    uniV3Pool: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443' as Address,
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
  },
} as const

export function getV2Router(network: Network): Address {
  if (network === 'ethereum') return ADDRESSES.ethereum.uniV2Router
  return ADDRESSES.arbitrum.sushiV2Router
}
