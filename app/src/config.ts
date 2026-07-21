import { defineChain } from 'viem'

export const COSTON2_RPC = 'https://coston2-api.flare.network/ext/C/rpc'
export const COSTON2_EXPLORER = 'https://coston2-explorer.flare.network'

export const coston2 = defineChain({
  id: 114,
  name: 'Coston2',
  nativeCurrency: { name: 'Coston2 Flare', symbol: 'C2FLR', decimals: 18 },
  rpcUrls: { default: { http: [COSTON2_RPC] } },
  blockExplorers: {
    default: { name: 'Coston2 Explorer', url: COSTON2_EXPLORER },
  },
  testnet: true,
})

export const STANDING_ADDRESS = '0x8a29c741280554028d76666dc75558d98caab855' as const
export const FXRP_ADDRESS = '0x0b6a3645c240605887a5532109323A3E12273dc7' as const
export const FTSO_ADAPTER_ADDRESS = '0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8' as const

export const DEPLOY_BLOCK = 33_098_682n

