import { erc20Abi } from '../config/abis.js'
import { ADDRESSES } from '../config/addresses.js'
import type { Clients } from '../config/chains.js'

export interface BalanceResult {
  ethereum: { ethNative: string; weth: string; usdc: string }
  arbitrum: { ethNative: string; weth: string; usdc: string }
}

export async function getWalletBalance(
  address: `0x${string}`,
  clients: Clients,
): Promise<BalanceResult> {
  const [ethNativeEth, ethWeth, ethUsdc, arbNativeEth, arbWeth, arbUsdc] = await Promise.all([
    clients.ethereum.public.getBalance({ address }),
    clients.ethereum.public.readContract({
      address: ADDRESSES.ethereum.weth,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    clients.ethereum.public.readContract({
      address: ADDRESSES.ethereum.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    clients.arbitrum.public.getBalance({ address }),
    clients.arbitrum.public.readContract({
      address: ADDRESSES.arbitrum.weth,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
    clients.arbitrum.public.readContract({
      address: ADDRESSES.arbitrum.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    }),
  ])

  return {
    ethereum: { ethNative: ethNativeEth.toString(), weth: ethWeth.toString(), usdc: ethUsdc.toString() },
    arbitrum: { ethNative: arbNativeEth.toString(), weth: arbWeth.toString(), usdc: arbUsdc.toString() },
  }
}
