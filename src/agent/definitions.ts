import type { ToolDefinition } from './providers/types.js'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_prices',
    description:
      'Fetches the current WETH/USDC price (USDC per WETH) from four pools: ' +
      'Uniswap V2 on ETH mainnet, Uniswap V3 on ETH mainnet, ' +
      'SushiSwap V2 on Arbitrum, and Uniswap V3 on Arbitrum. ' +
      'All prices are in the same unit (USDC per 1 WETH) for direct comparison.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_wallet_balance',
    description:
      'Returns the current WETH and USDC balances of the trading wallet ' +
      'on both ETH mainnet and Arbitrum. Balances are returned as decimal strings ' +
      "in the token's native units (WETH in wei, USDC in 6-decimal units).",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'estimate_gas',
    description:
      'Estimates the USD cost of executing one operation on the specified network and DEX. ' +
      'Use this before deciding to execute to ensure the opportunity is profitable after fees.',
    parameters: {
      type: 'object',
      properties: {
        network: {
          type: 'string',
          enum: ['ethereum', 'arbitrum'],
          description: 'The network to estimate gas for.',
        },
        dex: {
          type: 'string',
          enum: ['v2', 'v3', 'flash_loan'],
          description: 'v2 = Uniswap V2 (ETH) or SushiSwap (Arbitrum); v3 = Uniswap V3; flash_loan = Balancer flash loan arbitrage.',
        },
      },
      required: ['network', 'dex'],
    },
  },
  {
    name: 'simulate_flash_loan_arbitrage',
    description:
      'Quotes the expected profit of a flash loan arbitrage via the on-chain ArbitrageExecutor contract. ' +
      'Uses a Balancer V2 flash loan to borrow USDC, execute two swaps atomically, and repay. ' +
      'Returns { expectedProfitRaw, expectedProfitUsd, willSucceed }. ' +
      'Call this before execute_flash_loan_arbitrage to confirm the opportunity is profitable on-chain.',
    parameters: {
      type: 'object',
      properties: {
        network: {
          type: 'string',
          enum: ['ethereum', 'arbitrum'],
          description: 'Network where the arbitrage will execute.',
        },
        buyOnV2: {
          type: 'boolean',
          description:
            'true = buy WETH on Uniswap V2 / SushiSwap then sell on Uniswap V3; ' +
            'false = buy WETH on Uniswap V3 then sell on V2 / SushiSwap.',
        },
        borrowAmount: {
          type: 'string',
          description:
            'Amount of USDC to borrow as a decimal string in 6-decimal units (e.g. "1000000000" = 1000 USDC). ' +
            'Must not exceed MAX_TRADE_USDC.',
        },
      },
      required: ['network', 'buyOnV2', 'borrowAmount'],
    },
  },
  {
    name: 'execute_flash_loan_arbitrage',
    description:
      'Executes the flash loan arbitrage via the on-chain ArbitrageExecutor contract. ' +
      'The transaction reverts atomically if profit < minProfit — no USDC is lost from the caller wallet. ' +
      'Only call after simulate_flash_loan_arbitrage confirms willSucceed: true. ' +
      'Call at most once per iteration.',
    parameters: {
      type: 'object',
      properties: {
        network: {
          type: 'string',
          enum: ['ethereum', 'arbitrum'],
          description: 'Network where the arbitrage will execute.',
        },
        buyOnV2: {
          type: 'boolean',
          description:
            'true = buy WETH on Uniswap V2 / SushiSwap then sell on Uniswap V3; ' +
            'false = buy WETH on Uniswap V3 then sell on V2 / SushiSwap.',
        },
        borrowAmount: {
          type: 'string',
          description:
            'Amount of USDC to borrow as a decimal string in 6-decimal units (e.g. "1000000000" = 1000 USDC). ' +
            'Must match the value used in simulate_flash_loan_arbitrage.',
        },
        minProfit: {
          type: 'string',
          description:
            'Minimum acceptable profit in 6-decimal USDC units as a decimal string. ' +
            'Recommended: simulate expectedProfitRaw × 0.8 for a 20% slippage buffer. ' +
            'The runtime raises this to at least 1.5× gas cost regardless of your value.',
        },
      },
      required: ['network', 'buyOnV2', 'borrowAmount', 'minProfit'],
    },
  },
]
