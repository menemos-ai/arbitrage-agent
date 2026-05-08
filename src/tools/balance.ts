import { erc20Abi } from '../config/abis.js'
import { ADDRESSES } from '../config/addresses.js'
import type { Clients } from '../config/chains.js'

export interface BalanceResult {
  ethereum: { weth: string; usdc: string }
  arbitrum: { weth: string; usdc: string }
}

export async function getWalletBalance(
  address: `0x${string}`,
  clients: Clients,
): Promise<BalanceResult> {
  const [ethWeth, ethUsdc, arbWeth, arbUsdc] = await Promise.all([
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
    ethereum: { weth: ethWeth.toString(), usdc: ethUsdc.toString() },
    arbitrum: { weth: arbWeth.toString(), usdc: arbUsdc.toString() },
  }
}
