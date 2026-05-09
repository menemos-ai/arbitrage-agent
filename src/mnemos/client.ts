import { createRequire } from 'module'
import type { MnemosClient, ListingTerms } from '@mnemos-sdk/sdk'
import type { CumulativeStats } from './bundle.js'

// Force CJS build of @mnemos-sdk/sdk to avoid "Dynamic require of crypto" error
// caused by tweetnacl bundled inside the ESM build.
const _require = createRequire(import.meta.url)
const { MnemosClient: MnemosClientImpl } = _require('@mnemos-sdk/sdk') as typeof import('@mnemos-sdk/sdk')

export interface MnemosEnv {
  privateKey: `0x${string}`
  ogRpcUrl: string
  ogStorageNode: string
  ogChainId: string
  registryAddress: string
  marketplaceAddress: string
  mnemoBuyPrice: string
  mnemoRentPricePerDay: string
  mnemoForkPrice: string
  mnemoRoyaltyBps: string
  storageMock?: boolean
}

export interface MnemosContext {
  client: MnemosClient
  terms: ListingTerms
  stats: CumulativeStats
}

export function createMnemosClient(env: MnemosEnv): MnemosClient {
  return new MnemosClientImpl({
    privateKey: env.privateKey,
    chainId: Number(env.ogChainId),
    rpcUrl: env.ogRpcUrl,
    storageNodeUrl: env.ogStorageNode,
    registryAddress: env.registryAddress as `0x${string}`,
    marketplaceAddress: env.marketplaceAddress as `0x${string}`,
    storageMock: env.storageMock ?? false,
  })
}

export function buildListingTerms(env: MnemosEnv): ListingTerms {
  return {
    buyPrice: BigInt(env.mnemoBuyPrice),
    rentPricePerDay: BigInt(env.mnemoRentPricePerDay),
    forkPrice: BigInt(env.mnemoForkPrice),
    royaltyBps: Number(env.mnemoRoyaltyBps),
  }
}
