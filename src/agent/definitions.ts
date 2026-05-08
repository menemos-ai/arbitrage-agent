import { SchemaType, type Tool } from '@google/generative-ai'

export const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'get_prices',
        description:
          'Fetches the current WETH/USDC price (USDC per WETH) from four pools: ' +
          'Uniswap V2 on ETH mainnet, Uniswap V3 on ETH mainnet, ' +
          'SushiSwap V2 on Arbitrum, and Uniswap V3 on Arbitrum. ' +
          'All prices are in the same unit (USDC per 1 WETH) for direct comparison.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_wallet_balance',
        description:
          'Returns the current WETH and USDC balances of the trading wallet ' +
          'on both ETH mainnet and Arbitrum. Balances are returned as decimal strings ' +
          'in the token\'s native units (WETH in wei, USDC in 6-decimal units).',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
          required: [],
        },
      },
      {
        name: 'estimate_gas',
        description:
          'Estimates the USD cost of executing one swap on the specified network and DEX. ' +
          'Use this before deciding to execute to ensure the opportunity is profitable after fees.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            network: {
              type: SchemaType.STRING,
              format: 'enum' as const,
              enum: ['ethereum', 'arbitrum'],
              description: 'The network to estimate gas for.',
            },
            dex: {
              type: SchemaType.STRING,
              format: 'enum' as const,
              enum: ['v2', 'v3'],
              description: 'v2 = Uniswap V2 (ETH) or SushiSwap (Arbitrum); v3 = Uniswap V3.',
            },
          },
          required: ['network', 'dex'],
        },
      },
      {
        name: 'execute_swap',
        description:
          'Executes a token swap on the specified network and DEX. ' +
          'The runtime enforces MAX_TRADE_USDC regardless of the amount you provide. ' +
          'Set min_amount_out conservatively — the runtime will raise it to at least ' +
          '90% of the current market quote if your value is lower. ' +
          'Only call this after confirming the spread exceeds gas costs. ' +
          'Call at most once per iteration (buy leg or sell leg, not both simultaneously).',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            network: {
              type: SchemaType.STRING,
              format: 'enum' as const,
              enum: ['ethereum', 'arbitrum'],
              description: 'Network where the swap will execute.',
            },
            dex: {
              type: SchemaType.STRING,
              format: 'enum' as const,
              enum: ['v2', 'v3'],
              description: 'DEX to use: v2 = Uniswap V2 / SushiSwap, v3 = Uniswap V3.',
            },
            token_in: {
              type: SchemaType.STRING,
              description: 'Address of the token to sell (must be WETH or USDC).',
            },
            token_out: {
              type: SchemaType.STRING,
              description: 'Address of the token to buy (must be WETH or USDC).',
            },
            amount_in: {
              type: SchemaType.STRING,
              description:
                'Amount to sell in the token\'s native units as a decimal string ' +
                '(WETH in wei / 10^18, USDC in 10^6 units).',
            },
            min_amount_out: {
              type: SchemaType.STRING,
              description:
                'Minimum acceptable output in the token\'s native units as a decimal string. ' +
                'The runtime raises this to 90% of market quote if your value is lower.',
            },
          },
          required: ['network', 'dex', 'token_in', 'token_out', 'amount_in', 'min_amount_out'],
        },
      },
    ],
  },
]
