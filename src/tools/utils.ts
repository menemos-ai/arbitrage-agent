import { ADDRESSES } from '../config/addresses.js'
import type { Network } from '../config/addresses.js'

const KNOWN_TOKENS: Record<Network, Set<string>> = {
  ethereum: new Set([
    ADDRESSES.ethereum.weth.toLowerCase(),
    ADDRESSES.ethereum.usdc.toLowerCase(),
  ]),
  arbitrum: new Set([
    ADDRESSES.arbitrum.weth.toLowerCase(),
    ADDRESSES.arbitrum.usdc.toLowerCase(),
  ]),
}

export function validateTokenWhitelist(
  tokenIn: string,
  tokenOut: string,
  network: Network,
): void {
  const allowed = KNOWN_TOKENS[network]
  if (!allowed.has(tokenIn.toLowerCase())) {
    throw new Error(`token_in ${tokenIn} is not whitelisted on ${network}`)
  }
  if (!allowed.has(tokenOut.toLowerCase())) {
    throw new Error(`token_out ${tokenOut} is not whitelisted on ${network}`)
  }
}

export function validateAmount(amountUsd: number, maxTradeUsdc: number): void {
  if (amountUsd > maxTradeUsdc) {
    throw new Error(
      `amount_in ($${amountUsd.toFixed(2)}) exceeds MAX_TRADE_USDC ($${maxTradeUsdc})`,
    )
  }
}
