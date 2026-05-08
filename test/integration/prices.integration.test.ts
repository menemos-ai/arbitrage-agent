import { describe, it, expect, beforeAll } from 'vitest'
import { getPrices } from '../../src/tools/prices.js'
import { createClients } from '../../src/config/chains.js'
import type { Clients } from '../../src/config/chains.js'

const ETH_RPC = process.env.ETH_RPC_URL ?? 'https://eth.llamarpc.com'
const ARB_RPC = process.env.ARB_RPC_URL ?? 'https://arb1.arbitrum.io/rpc'

// Integration tests require real RPC access — skip if env vars not present
const skipIfNoRpc = ETH_RPC === 'https://eth.llamarpc.com' ? it.skip : it

describe('getPrices integration', () => {
  let clients: Clients

  beforeAll(() => {
    clients = createClients({
      ethRpcUrl: ETH_RPC,
      arbRpcUrl: ARB_RPC,
      // dummy key — read-only calls only
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
    })
  })

  skipIfNoRpc('returns plausible WETH prices from all 4 pools', async () => {
    const prices = await getPrices(clients)

    // All prices should be in a plausible WETH range ($100–$100,000)
    for (const [network, pools] of Object.entries(prices)) {
      for (const [dex, price] of Object.entries(pools)) {
        expect(price, `${network}.${dex} price`).toBeGreaterThan(100)
        expect(price, `${network}.${dex} price`).toBeLessThan(100_000)
      }
    }

    // V2 and V3 on the same network should be within 5% of each other
    const ethSpread = Math.abs(prices.ethereum.v2 - prices.ethereum.v3) / prices.ethereum.v2
    const arbSpread = Math.abs(prices.arbitrum.v2 - prices.arbitrum.v3) / prices.arbitrum.v2
    expect(ethSpread, 'ETH V2/V3 spread').toBeLessThan(0.05)
    expect(arbSpread, 'ARB V2/V3 spread').toBeLessThan(0.05)
  })
})
