import { createPublicClient, createWalletClient, http } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import type { PublicClient, WalletClient } from 'viem'
import type { Network } from './addresses.js'

export interface EnvConfig {
  ethRpcUrl: string
  arbRpcUrl: string
  privateKey: `0x${string}`
}

export interface Clients {
  ethereum: { public: PublicClient; wallet: WalletClient }
  arbitrum: { public: PublicClient; wallet: WalletClient }
}

export function createClients(config: EnvConfig): Clients {
  const account = privateKeyToAccount(config.privateKey)

  return {
    ethereum: {
      public: createPublicClient({ chain: mainnet, transport: http(config.ethRpcUrl) }),
      wallet: createWalletClient({ chain: mainnet, account, transport: http(config.ethRpcUrl) }),
    },
    arbitrum: {
      public: createPublicClient({ chain: arbitrum, transport: http(config.arbRpcUrl) }),
      wallet: createWalletClient({ chain: arbitrum, account, transport: http(config.arbRpcUrl) }),
    },
  }
}

export function getClients(network: Network, clients: Clients) {
  return clients[network]
}
