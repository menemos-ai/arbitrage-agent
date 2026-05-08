import { quoterV2Abi } from '../config/abis.js'
import { ADDRESSES } from '../config/addresses.js'
import type { Clients } from '../config/chains.js'
import type { Network } from '../config/addresses.js'

type Dex = 'v2' | 'v3'

// Conservative gas limits per swap type
const GAS_LIMIT: Record<Dex, bigint> = {
  v2: 150_000n,
  v3: 180_000n,
}

const ONE_WETH = 10n ** 18n
const V3_FEE = 500

export interface GasEstimateResult {
  gasCostUsd: number
  gasLimit: bigint
  gasPriceWei: bigint
}

export function calculateGasCostUsd(
  gasLimit: bigint,
  gasPriceWei: bigint,
  ethPriceUsdc: number,
): number {
  // Divide to pico-ETH units (10^12) before Number conversion to keep sub-gwei precision
  // while avoiding floating-point overflow on large gas*price products
  const gasCostPicoEth = gasLimit * gasPriceWei / 10n ** 12n
  const gasCostEth = Number(gasCostPicoEth) / 1e6
  return gasCostEth * ethPriceUsdc
}

async function fetchEthPrice(
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
  return Number(result[0]) / 1e6
}

export async function estimateGas(
  network: Network,
  dex: Dex,
  clients: Clients,
): Promise<GasEstimateResult> {
  const networkClients = clients[network]
  const addrs = ADDRESSES[network]

  const [gasPriceWei, ethPriceUsdc] = await Promise.all([
    networkClients.public.getGasPrice(),
    fetchEthPrice(
      addrs.uniV3QuoterV2,
      addrs.weth,
      addrs.usdc,
      networkClients.public,
    ),
  ])

  const gasLimit = GAS_LIMIT[dex]

  return {
    gasCostUsd: calculateGasCostUsd(gasLimit, gasPriceWei, ethPriceUsdc),
    gasLimit,
    gasPriceWei,
  }
}
