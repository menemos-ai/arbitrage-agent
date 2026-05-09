import { keccak256, toBytes, decodeAbiParameters } from 'viem'
import { arbitrageExecutorAbi } from '../config/abis.js'
import { ADDRESSES } from '../config/addresses.js'
import { validateTokenWhitelist, validateAmount } from './utils.js'
import type { Clients } from '../config/chains.js'
import type { Network } from '../config/addresses.js'
import type { Address } from 'viem'

export const FLASH_LOAN_GAS_LIMIT = 500_000n

export interface FlashLoanParams {
  network: Network
  buyOnV2: boolean
  borrowAmount: string
}

export interface FlashLoanResult {
  txHash: string
  profitRaw: string
  profitUsd: number
}

export function computeMinProfitRaw(gasCostUsdc: number, boostFactor = 1.5): bigint {
  const raw = gasCostUsdc * boostFactor * 1e6
  if (raw <= 0) return 0n
  return BigInt(Math.ceil(raw))
}

export async function quoteFlashLoanArbitrage(
  params: FlashLoanParams,
  maxTradeUsdc: number,
  clients: Clients,
  executorAddress: Address,
): Promise<{ expectedProfitRaw: bigint; expectedProfitUsd: number; willSucceed: boolean; revertReason?: string }> {
  const addrs = ADDRESSES[params.network]
  validateTokenWhitelist(addrs.usdc, addrs.weth, params.network)
  validateAmount(Number(BigInt(params.borrowAmount)) / 1e6, maxTradeUsdc)

  try {
    const { result } = await clients[params.network].public.simulateContract({
      address: executorAddress,
      abi: arbitrageExecutorAbi,
      functionName: 'quoteArbitrage',
      args: [params.buyOnV2, BigInt(params.borrowAmount)],
      account: '0x0000000000000000000000000000000000000001',
    })

    const expectedProfit = result as bigint
    // Guard against int256 overflow converting to Infinity
    const maxSafeUsd = Number.MAX_SAFE_INTEGER / 1e6
    const rawAsNumber = Number(expectedProfit)
    const expectedProfitUsd = isFinite(rawAsNumber) ? Math.min(rawAsNumber / 1e6, maxSafeUsd) : maxSafeUsd

    return {
      expectedProfitRaw: expectedProfit,
      expectedProfitUsd,
      willSucceed: expectedProfit > 0n,
    }
  } catch (err) {
    return {
      expectedProfitRaw: 0n,
      expectedProfitUsd: 0,
      willSucceed: false,
      revertReason: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function executeFlashLoanArbitrage(
  params: FlashLoanParams & { minProfit: string },
  maxTradeUsdc: number,
  gasCostUsdc: number,
  clients: Clients,
  walletAddress: Address,
  executorAddress: Address,
): Promise<FlashLoanResult> {
  const addrs = ADDRESSES[params.network]
  validateTokenWhitelist(addrs.usdc, addrs.weth, params.network)
  validateAmount(Number(BigInt(params.borrowAmount)) / 1e6, maxTradeUsdc)

  // Raise minProfit to floor if agent provided a value below 1.5x gas cost
  const minProfitFloor = computeMinProfitRaw(gasCostUsdc)
  const minProfit = BigInt(params.minProfit) < minProfitFloor ? minProfitFloor : BigInt(params.minProfit)

  const networkClients = clients[params.network]

  // Final simulation gate before sending
  const { request } = await networkClients.public.simulateContract({
    address: executorAddress,
    abi: arbitrageExecutorAbi,
    functionName: 'executeArbitrage',
    args: [params.buyOnV2, BigInt(params.borrowAmount), minProfit],
    account: walletAddress,
    gas: FLASH_LOAN_GAS_LIMIT,
  })

  const hash = await networkClients.wallet.writeContract(request)
  const receipt = await networkClients.public.waitForTransactionReceipt({ hash })

  // Parse ArbitrageExecuted(uint256 profit) from receipt logs
  const eventTopic = keccak256(toBytes('ArbitrageExecuted(uint256)'))
  const log = receipt.logs.find(l => l.topics[0] === eventTopic)

  let profitRaw = 0n
  if (log) {
    const [decoded] = decodeAbiParameters([{ name: 'profit', type: 'uint256' }], log.data)
    profitRaw = decoded as bigint
  }

  return {
    txHash: hash,
    profitRaw: profitRaw.toString(),
    profitUsd: Number(profitRaw) / 1e6,
  }
}
