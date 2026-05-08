import { erc20Abi, uniV2RouterAbi, swapRouterV3Abi, quoterV2Abi } from '../config/abis.js'
import { ADDRESSES, getV2Router } from '../config/addresses.js'
import type { Clients } from '../config/chains.js'
import type { Network } from '../config/addresses.js'

type Dex = 'v2' | 'v3'

const ONE_WETH = 10n ** 18n
const V3_FEE = 500

const KNOWN_TOKENS: Record<Network, Set<string>> = {
  ethereum: new Set([
    ADDRESSES.ethereum.weth.toLowerCase(),
    ADDRESSES.ethereum.usdc.toLowerCase(),
  ]),
  arbitrum: new Set([
    ADDRESSES.arbitrum.weth.toLowerCase(),
    ADDRESSES.arbitrum.usdc.toLowerCase(),
  ]),
}

export interface SwapParams {
  network: Network
  dex: Dex
  token_in: string
  token_out: string
  amount_in: string
  min_amount_out: string
}

export interface SwapResult {
  txHash: string
  amountOut: string
}

// --- Pure helpers ---

export function validateTokenWhitelist(
  tokenIn: string,
  tokenOut: string,
  network: Network,
): void {
  const allowed = KNOWN_TOKENS[network]
  if (!allowed.has(tokenIn.toLowerCase())) {
    throw new Error(`token_in ${tokenIn} is not whitelisted on ${network}`)
  }
  if (!allowed.has(tokenOut.toLowerCase())) {
    throw new Error(`token_out ${tokenOut} is not whitelisted on ${network}`)
  }
}

export function validateAmount(amountUsd: number, maxTradeUsdc: number): void {
  if (amountUsd > maxTradeUsdc) {
    throw new Error(
      `amount_in ($${amountUsd.toFixed(2)}) exceeds MAX_TRADE_USDC ($${maxTradeUsdc})`,
    )
  }
}

export function buildDeadline(offsetSeconds = 300): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds)
}

export function clampMinAmountOut(
  claudeMinAmountOut: bigint,
  independentQuote: bigint,
  floorBps = 9000n,  // 90%
): bigint {
  const floor = (independentQuote * floorBps) / 10_000n
  return claudeMinAmountOut < floor ? floor : claudeMinAmountOut
}

// --- Internal helpers ---

async function fetchWethPrice(
  network: Network,
  clients: Clients,
): Promise<number> {
  const addrs = ADDRESSES[network]
  const { result } = await clients[network].public.simulateContract({
    address: addrs.uniV3QuoterV2,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn: addrs.weth,
        tokenOut: addrs.usdc,
        amountIn: ONE_WETH,
        fee: V3_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
    account: '0x0000000000000000000000000000000000000001',
  })
  return Number(result[0]) / 1e6
}

async function quoteV3(
  amountIn: bigint,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  quoterAddress: `0x${string}`,
  publicClient: Clients['ethereum']['public'],
): Promise<bigint> {
  const { result } = await publicClient.simulateContract({
    address: quoterAddress,
    abi: quoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn,
        fee: V3_FEE,
        sqrtPriceLimitX96: 0n,
      },
    ],
    account: '0x0000000000000000000000000000000000000001',
  })
  return result[0]
}

async function ensureApproval(
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  walletAddress: `0x${string}`,
  clients: Clients[Network],
): Promise<void> {
  const allowance = await clients.public.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [walletAddress, spender],
  })
  if (allowance < amount) {
    const { request } = await clients.public.simulateContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
      account: walletAddress,
    })
    const hash = await clients.wallet.writeContract(request)
    await clients.public.waitForTransactionReceipt({ hash })
  }
}

async function swapV2(
  params: SwapParams,
  amountIn: bigint,
  minAmountOut: bigint,
  walletAddress: `0x${string}`,
  clients: Clients,
): Promise<SwapResult> {
  const addrs = ADDRESSES[params.network]
  const networkClients = clients[params.network]
  const router = getV2Router(params.network)

  await ensureApproval(
    params.token_in as `0x${string}`,
    router,
    amountIn,
    walletAddress,
    networkClients,
  )

  const deadline = buildDeadline()
  const { request } = await networkClients.public.simulateContract({
    address: router,
    abi: uniV2RouterAbi,
    functionName: 'swapExactTokensForTokens',
    args: [
      amountIn,
      minAmountOut,
      [params.token_in as `0x${string}`, params.token_out as `0x${string}`],
      walletAddress,
      deadline,
    ],
    account: walletAddress,
  })

  const hash = await networkClients.wallet.writeContract(request)
  const receipt = await networkClients.public.waitForTransactionReceipt({ hash })

  // Last Transfer event's value is amountOut
  const amountOut = receipt.logs.at(-1)?.data ?? '0x0'
  return { txHash: hash, amountOut: BigInt(amountOut).toString() }
}

async function swapV3(
  params: SwapParams,
  amountIn: bigint,
  minAmountOut: bigint,
  walletAddress: `0x${string}`,
  clients: Clients,
): Promise<SwapResult> {
  const addrs = ADDRESSES[params.network]
  const networkClients = clients[params.network]

  await ensureApproval(
    params.token_in as `0x${string}`,
    addrs.uniV3Router,
    amountIn,
    walletAddress,
    networkClients,
  )

  const deadline = buildDeadline()
  const { request } = await networkClients.public.simulateContract({
    address: addrs.uniV3Router,
    abi: swapRouterV3Abi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: params.token_in as `0x${string}`,
        tokenOut: params.token_out as `0x${string}`,
        fee: V3_FEE,
        recipient: walletAddress,
        deadline,
        amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
    account: walletAddress,
  })

  const hash = await networkClients.wallet.writeContract(request)
  const receipt = await networkClients.public.waitForTransactionReceipt({ hash })

  const amountOut = receipt.logs.at(-1)?.data ?? '0x0'
  return { txHash: hash, amountOut: BigInt(amountOut).toString() }
}

export async function executeSwap(
  params: SwapParams,
  maxTradeUsdc: number,
  clients: Clients,
  walletAddress: `0x${string}`,
): Promise<SwapResult> {
  // Step 0: token whitelist
  validateTokenWhitelist(params.token_in, params.token_out, params.network)

  const addrs = ADDRESSES[params.network]
  const amountIn = BigInt(params.amount_in)
  const tokenInIsWeth = params.token_in.toLowerCase() === addrs.weth.toLowerCase()

  // Step 1: amount validation against MAX_TRADE_USDC
  let amountUsd: number
  if (tokenInIsWeth) {
    const wethPrice = await fetchWethPrice(params.network, clients)
    // amountIn is in WETH (18 dec)
    amountUsd = (Number(amountIn) / 1e18) * wethPrice
  } else {
    // amountIn is in USDC (6 dec)
    amountUsd = Number(amountIn) / 1e6
  }
  validateAmount(amountUsd, maxTradeUsdc)

  // Step 1b: clamp min_amount_out to 90% floor from independent quote
  const claudeMinAmountOut = BigInt(params.min_amount_out)
  const independentQuote = await quoteV3(
    amountIn,
    params.token_in as `0x${string}`,
    params.token_out as `0x${string}`,
    addrs.uniV3QuoterV2,
    clients[params.network].public,
  )
  const minAmountOut = clampMinAmountOut(claudeMinAmountOut, independentQuote)

  // Step 2: simulate-then-write swap
  if (params.dex === 'v2') {
    return swapV2(params, amountIn, minAmountOut, walletAddress, clients)
  } else {
    return swapV3(params, amountIn, minAmountOut, walletAddress, clients)
  }
}
