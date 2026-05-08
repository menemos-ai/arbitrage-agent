import { describe, it, expect } from 'vitest'
import { MnemosClient } from '@mnemos/sdk'
import { createMnemosClient, buildListingTerms, type MnemosEnv } from '../../src/mnemos/client.js'

const validEnv: MnemosEnv = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ogRpcUrl: 'http://localhost:8545',
  ogStorageNode: 'http://localhost:5678',
  ogChainId: '16601',
  registryAddress: '0x1111111111111111111111111111111111111111',
  marketplaceAddress: '0x2222222222222222222222222222222222222222',
  mnemoBuyPrice: '1000000000000000000',
  mnemoRentPricePerDay: '100000000000000000',
  mnemoForkPrice: '500000000000000000',
  mnemoRoyaltyBps: '500',
}

describe('createMnemosClient', () => {
  it('returns a MnemosClient instance', () => {
    const client = createMnemosClient(validEnv)
    expect(client).toBeInstanceOf(MnemosClient)
  })

  it('defaults storageMock to false when not provided', () => {
    const { storageMock: _, ...envWithoutMock } = validEnv
    const client = createMnemosClient(envWithoutMock as MnemosEnv)
    expect(client).toBeInstanceOf(MnemosClient)
  })

  it('accepts storageMock: true', () => {
    const client = createMnemosClient({ ...validEnv, storageMock: true })
    expect(client).toBeInstanceOf(MnemosClient)
  })
})

describe('buildListingTerms', () => {
  it('parses price strings to BigInt', () => {
    const terms = buildListingTerms(validEnv)
    expect(terms.buyPrice).toBe(1000000000000000000n)
    expect(terms.rentPricePerDay).toBe(100000000000000000n)
    expect(terms.forkPrice).toBe(500000000000000000n)
  })

  it('parses royaltyBps as number', () => {
    const terms = buildListingTerms(validEnv)
    expect(terms.royaltyBps).toBe(500)
    expect(typeof terms.royaltyBps).toBe('number')
  })

  it('handles different royaltyBps values', () => {
    const terms = buildListingTerms({ ...validEnv, mnemoRoyaltyBps: '1000' })
    expect(terms.royaltyBps).toBe(1000)
  })
})
