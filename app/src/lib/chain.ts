import { createPublicClient, http } from 'viem'
import { coston2 } from '../config'

export const publicClient = createPublicClient({
  chain: coston2,
  transport: http(),
  batch: { multicall: true },
})

