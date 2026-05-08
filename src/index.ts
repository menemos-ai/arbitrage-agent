import 'dotenv/config'
import { createClients } from './config/chains.js'
import { runIteration } from './agent/loop.js'
import { createMnemosClient, buildListingTerms, type MnemosContext } from './mnemos/client.js'
import type { MnemosEnv } from './mnemos/client.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

const ETH_RPC_URL = requireEnv('ETH_RPC_URL')
const ARB_RPC_URL = requireEnv('ARB_RPC_URL')
const PRIVATE_KEY = requireEnv('PRIVATE_KEY') as `0x${string}`
const MAX_TRADE_USDC = Number(requireEnv('MAX_TRADE_USDC'))
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS ?? '30')
const MODEL = process.env.MODEL ?? 'claude-opus-4-7'

if (isNaN(MAX_TRADE_USDC) || MAX_TRADE_USDC <= 0) {
  throw new Error('MAX_TRADE_USDC must be a positive number')
}
if (isNaN(POLL_INTERVAL_SECONDS) || POLL_INTERVAL_SECONDS < 10) {
  throw new Error('POLL_INTERVAL_SECONDS must be >= 10')
}

const clients = createClients({ ethRpcUrl: ETH_RPC_URL, arbRpcUrl: ARB_RPC_URL, privateKey: PRIVATE_KEY })
const walletAddress = clients.ethereum.wallet.account!.address

// Build optional Mnemos context — all 9 vars must be present to enable
const MNEMOS_ENV_KEYS: (keyof MnemosEnv)[] = [
  'privateKey', 'ogRpcUrl', 'ogStorageNode', 'ogChainId',
  'registryAddress', 'marketplaceAddress',
  'mnemoBuyPrice', 'mnemoRentPricePerDay', 'mnemoForkPrice', 'mnemoRoyaltyBps',
]
const ENV_KEY_MAP: Record<keyof MnemosEnv, string> = {
  privateKey: 'PRIVATE_KEY',
  ogRpcUrl: 'OG_RPC_URL',
  ogStorageNode: 'OG_STORAGE_NODE',
  ogChainId: 'OG_CHAIN_ID',
  registryAddress: 'MNEMO_REGISTRY_ADDRESS',
  marketplaceAddress: 'MNEMO_MARKETPLACE_ADDRESS',
  mnemoBuyPrice: 'MNEMO_BUY_PRICE',
  mnemoRentPricePerDay: 'MNEMO_RENT_PRICE_PER_DAY',
  mnemoForkPrice: 'MNEMO_FORK_PRICE',
  mnemoRoyaltyBps: 'MNEMO_ROYALTY_BPS',
  storageMock: 'MNEMO_STORAGE_MOCK',
}

let mnemos: MnemosContext | undefined
const mnemosValues = MNEMOS_ENV_KEYS.map(k => process.env[ENV_KEY_MAP[k]])
if (mnemosValues.every(Boolean)) {
  const mnemosEnv: MnemosEnv = {
    privateKey: PRIVATE_KEY,
    ogRpcUrl: process.env.OG_RPC_URL!,
    ogStorageNode: process.env.OG_STORAGE_NODE!,
    ogChainId: process.env.OG_CHAIN_ID!,
    registryAddress: process.env.MNEMO_REGISTRY_ADDRESS!,
    marketplaceAddress: process.env.MNEMO_MARKETPLACE_ADDRESS!,
    mnemoBuyPrice: process.env.MNEMO_BUY_PRICE!,
    mnemoRentPricePerDay: process.env.MNEMO_RENT_PRICE_PER_DAY!,
    mnemoForkPrice: process.env.MNEMO_FORK_PRICE!,
    mnemoRoyaltyBps: process.env.MNEMO_ROYALTY_BPS!,
    storageMock: process.env.MNEMO_STORAGE_MOCK === 'true',
  }
  mnemos = {
    client: createMnemosClient(mnemosEnv),
    terms: buildListingTerms(mnemosEnv),
    stats: { totalTrades: 0, totalGasCostUsd: 0 },
  }
}

console.log('Arbitrage agent starting')
console.log('  Wallet:', walletAddress)
console.log('  MAX_TRADE_USDC:', MAX_TRADE_USDC)
console.log('  POLL_INTERVAL_SECONDS:', POLL_INTERVAL_SECONDS)
console.log('  MODEL:', MODEL)
console.log('  Mnemos:', mnemos ? 'enabled' : 'disabled (env vars missing)')

async function tick(): Promise<void> {
  try {
    await runIteration(clients, walletAddress, MAX_TRADE_USDC, MODEL, mnemos)
  } catch (err) {
    console.error('[ERROR] Iteration failed:', err instanceof Error ? err.message : err)
  }
}

// Run first iteration immediately, then on interval
tick()
setInterval(tick, POLL_INTERVAL_SECONDS * 1000)
