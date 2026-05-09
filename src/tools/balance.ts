import { erc20Abi } from '../config/abis.js'
import { ADDRESSES } from '../config/addresses.js'
import type { Clients } from '../config/chains.js'

export interface NetworkBalance {
  ethNative: string
  weth: string
  usdc: string
}

export interface BalanceResult {
  ethereum: NetworkBalance | null
  arbitrum: NetworkBalance
}

export async function getWalletBalance(
  address: `0x${string}`,
  clients: Clients,
): Promise<BalanceResult> {
  const [ethNativeRes, ethWethRes, ethUsdcRes, arbNative, arbWeth, arbUsdc] = await Promise.allSettled([
    clients.ethereum.public.getBalance({ address }),
    clients.ethereum.public.readContract({ address: ADDRESSES.ethereum.weth, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
    clients.ethereum.public.readContract({ address: ADDRESSES.ethereum.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
    clients.arbitrum.public.getBalance({ address }),
    clients.arbitrum.public.readContract({ address: ADDRESSES.arbitrum.weth, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
    clients.arbitrum.public.readContract({ address: ADDRESSES.arbitrum.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ])

  const ethOk = ethNativeRes.status === 'fulfilled' && ethWethRes.status === 'fulfilled' && ethUsdcRes.status === 'fulfilled'
  if (!ethOk) console.warn('[balance] ETH mainnet unavailable — skipping ETH balance')

  return {
    ethereum: ethOk
      ? { ethNative: ethNativeRes.value.toString(), weth: (ethWethRes as PromiseFulfilledResult<bigint>).value.toString(), usdc: (ethUsdcRes as PromiseFulfilledResult<bigint>).value.toString() }
      : null,
    arbitrum: {
      ethNative: (arbNative as PromiseFulfilledResult<bigint>).value.toString(),
      weth: (arbWeth as PromiseFulfilledResult<bigint>).value.toString(),
      usdc: (arbUsdc as PromiseFulfilledResult<bigint>).value.toString(),
    },
  }
}
