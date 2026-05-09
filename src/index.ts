import 'dotenv/config'
import { createClients } from './config/chains.js'
import { runIteration } from './agent/loop.js'
import type { MnemosContext, MnemosEnv } from './mnemos/client.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function resolveModel(): string {
  const explicit = process.env.MODEL
  if (explicit) {
    // Explicit model — validate the matching key is present
    if (explicit.startsWith('gemini-')) {
      if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for Gemini models')
    } else if (explicit.startsWith('claude-')) {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for Claude models')
    } else if (explicit.startsWith('gpt-') || /^o[0-9]/.test(explicit)) {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for OpenAI models')
    } else if (explicit.startsWith('llama') || explicit.startsWith('mixtral') || explicit.startsWith('gemma')) {
      if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is required for Groq models')
    } else {
      throw new Error(
        `Unrecognized model: "${explicit}". Supported prefixes: gemini- (Google), claude- (Anthropic), gpt-/o1/o3/o4 (OpenAI), llama/mixtral/gemma (Groq — free)`,
      )
    }
    return explicit
  }

  // Auto-detect from whichever API key is present
  if (process.env.GROQ_API_KEY) return 'llama-3.3-70b-versatile'
  if (process.env.GEMINI_API_KEY) return 'gemini-2.0-flash'
  if (process.env.ANTHROPIC_API_KEY) return 'claude-sonnet-4-6'
  if (process.env.OPENAI_API_KEY) return 'gpt-4o'

  throw new Error(
    'No AI provider API key found. Set one of: GROQ_API_KEY (free), GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY',
  )
}

const ETH_RPC_URL = requireEnv('ETH_RPC_URL')
const ARB_RPC_URL = requireEnv('ARB_RPC_URL')
const PRIVATE_KEY = requireEnv('PRIVATE_KEY') as `0x${string}`
const EXECUTOR_ETH = requireEnv('EXECUTOR_ETH') as `0x${string}`
const EXECUTOR_ARB = requireEnv('EXECUTOR_ARB') as `0x${string}`
const MAX_TRADE_USDC = Number(requireEnv('MAX_TRADE_USDC'))
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS ?? '30')
const MODEL = resolveModel()

if (isNaN(MAX_TRADE_USDC) || MAX_TRADE_USDC <= 0) {
  throw new Error('MAX_TRADE_USDC must be a positive number')
}
if (isNaN(POLL_INTERVAL_SECONDS) || POLL_INTERVAL_SECONDS < 10) {
  throw new Error('POLL_INTERVAL_SECONDS must be >= 10')
}

const clients = createClients({ ethRpcUrl: ETH_RPC_URL, arbRpcUrl: ARB_RPC_URL, privateKey: PRIVATE_KEY })
const walletAddress = clients.ethereum.wallet.account!.address
const executorAddresses = { ethereum: EXECUTOR_ETH, arbitrum: EXECUTOR_ARB }

// Build optional Mnemos context — all 9 vars must be present to enable
const MNEMOS_REQUIRED = [
  'OG_RPC_URL', 'OG_STORAGE_NODE', 'OG_CHAIN_ID',
  'MNEMO_REGISTRY_ADDRESS', 'MNEMO_MARKETPLACE_ADDRESS',
  'MNEMO_BUY_PRICE', 'MNEMO_RENT_PRICE_PER_DAY', 'MNEMO_FORK_PRICE', 'MNEMO_ROYALTY_BPS',
] as const

let mnemos: MnemosContext | undefined
if (MNEMOS_REQUIRED.every(k => process.env[k])) {
  const { createMnemosClient, buildListingTerms } = await import('./mnemos/client.js')
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
console.log('  EXECUTOR_ETH:', EXECUTOR_ETH)
console.log('  EXECUTOR_ARB:', EXECUTOR_ARB)
console.log('  Mnemos:', mnemos ? 'enabled' : 'disabled (env vars missing)')

let isRunning = false

async function tick(): Promise<void> {
  if (isRunning) {
    console.warn('[WARN] Previous iteration still in flight — skipping tick')
    return
  }
  isRunning = true
  try {
    await runIteration(clients, walletAddress, MAX_TRADE_USDC, MODEL, mnemos)
  } catch (err) {
    console.error('[ERROR] Iteration failed:', err instanceof Error ? err.message : err)
  } finally {
    isRunning = false
  }
}

// Run first iteration immediately, then on interval
tick()
setInterval(tick, POLL_INTERVAL_SECONDS * 1000)
