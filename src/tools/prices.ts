import { uniV2PairAbi, quoterV2Abi } from '../config/abis.js'
import { ADDRESSES } from '../config/addresses.js'
import type { Clients } from '../config/chains.js'

export interface PriceResult {
  ethereum: { v2: number; v3: number } | null
  arbitrum: { v2: number; v3: number }
}

// ETH mainnet UniV2 pair: token0=USDC (6 dec), token1=WETH (18 dec)
// price = (reserve0/1e6) / (reserve1/1e18)
export function normalizeV2Price(
  reserve0: bigint,
  reserve1: bigint,
  token0IsWeth: boolean,
): number {
  if (token0IsWeth) {
    // reserve0 = WETH (18 dec), reserve1 = USDC (6 dec)
    return Number((reserve1 * 10n ** 12n) / reserve0)
  } else {
    // reserve0 = USDC (6 dec), reserve1 = WETH (18 dec)
    return Number((reserve0 * 10n ** 12n) / reserve1)
  }
}

// amountOut is USDC with 6 decimals for 1 WETH input (1e18 wei)
export function normalizeV3Price(amountOut: bigint): number {
  return Number(amountOut) / 1e6
}

const ONE_WETH = 10n ** 18n
const V3_FEE = 500 // 0.05%

async function fetchV2Price(
  pairAddress: `0x${string}`,
  token0IsWeth: boolean,
  publicClient: Clients['ethereum']['public'],
): Promise<number> {
  const reserves = await publicClient.readContract({
    address: pairAddress,
    abi: uniV2PairAbi,
    functionName: 'getReserves',
  })
  return normalizeV2Price(reserves[0], reserves[1], token0IsWeth)
}

async function fetchV3Price(
  quoterAddress: `0x${string}`,
  wethAddress: `0x${string}`,
  usdcAddress: `0x${string}`,
  publicClient: Clients['ethereum']['public'],
): Promise<number> {
  const { result } = await publicClient.simulateContract({
    address: quoterAddress,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn: wethAddress,
        tokenOut: usdcAddress,
        amountIn: ONE_WETH,
        fee: V3_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
    account: '0x0000000000000000000000000000000000000001',
  })
  return normalizeV3Price(result[0])
}

export async function getPrices(clients: Clients): Promise<PriceResult> {
  const [ethV2, ethV3, arbV2, arbV3] = await Promise.allSettled([
    fetchV2Price(ADDRESSES.ethereum.uniV2Pair, false, clients.ethereum.public),
    fetchV3Price(
      ADDRESSES.ethereum.uniV3QuoterV2,
      ADDRESSES.ethereum.weth,
      ADDRESSES.ethereum.usdc,
      clients.ethereum.public,
    ),
    fetchV2Price(ADDRESSES.arbitrum.sushiV2Pair, true, clients.arbitrum.public),
    fetchV3Price(
      ADDRESSES.arbitrum.uniV3QuoterV2,
      ADDRESSES.arbitrum.weth,
      ADDRESSES.arbitrum.usdc,
      clients.arbitrum.public,
    ),
  ])

  const ethOk = ethV2.status === 'fulfilled' && ethV3.status === 'fulfilled'
  if (!ethOk) {
    const reason = ethV2.status === 'rejected' ? ethV2.reason : (ethV3 as PromiseRejectedResult).reason
    console.warn('[prices] ETH mainnet unavailable:', (reason as Error)?.message ?? reason)
  }

  return {
    ethereum: ethOk ? { v2: ethV2.value, v3: ethV3.value } : null,
    arbitrum: {
      v2: (arbV2 as PromiseFulfilledResult<number>).value,
      v3: (arbV3 as PromiseFulfilledResult<number>).value,
    },
  }
}
