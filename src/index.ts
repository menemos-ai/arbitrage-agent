import 'dotenv/config'
import { createClients } from './config/chains.js'
import { runIteration } from './agent/loop.js'

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

console.log('Arbitrage agent starting')
console.log('  Wallet:', walletAddress)
console.log('  MAX_TRADE_USDC:', MAX_TRADE_USDC)
console.log('  POLL_INTERVAL_SECONDS:', POLL_INTERVAL_SECONDS)
console.log('  MODEL:', MODEL)

async function tick(): Promise<void> {
  try {
    await runIteration(clients, walletAddress, MAX_TRADE_USDC, MODEL)
  } catch (err) {
    console.error('[ERROR] Iteration failed:', err instanceof Error ? err.message : err)
  }
}

// Run first iteration immediately, then on interval
tick()
setInterval(tick, POLL_INTERVAL_SECONDS * 1000)
