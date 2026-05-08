import { describe, it, expect, beforeAll } from 'vitest'
import { getWalletBalance } from '../../src/tools/balance.js'
import { createClients } from '../../src/config/chains.js'
import type { Clients } from '../../src/config/chains.js'

const ETH_RPC = process.env.ETH_RPC_URL ?? ''
const ARB_RPC = process.env.ARB_RPC_URL ?? 'https://arb1.arbitrum.io/rpc'
const WALLET = process.env.WALLET_ADDRESS as `0x${string}` | undefined

const skipIfNoRpc = ETH_RPC ? it : it.skip

describe('getWalletBalance integration', () => {
  let clients: Clients

  beforeAll(() => {
    clients = createClients({
      ethRpcUrl: ETH_RPC || 'https://eth.llamarpc.com',
      arbRpcUrl: ARB_RPC,
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
    })
  })

  skipIfNoRpc('returns non-negative bigint strings for all balances', async () => {
    const address = WALLET ?? '0x0000000000000000000000000000000000000001'
    const result = await getWalletBalance(address, clients)

    for (const [network, tokens] of Object.entries(result)) {
      for (const [token, balance] of Object.entries(tokens)) {
        expect(
          typeof balance,
          `${network}.${token} should be string`,
        ).toBe('string')
        expect(
          BigInt(balance as string),
          `${network}.${token} balance should be non-negative`,
        ).toBeGreaterThanOrEqual(0n)
      }
    }
  })
})
