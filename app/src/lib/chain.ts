import { createPublicClient, fallback, http } from 'viem'
import { COSTON2_RPCS, coston2 } from '../config'

export const publicClient = createPublicClient({
  chain: coston2,
  transport: fallback(
    COSTON2_RPCS.map((url) => http(url, { retryCount: 0, timeout: 8_000 })),
    { retryCount: 0 },
  ),
  batch: { multicall: true },
})
