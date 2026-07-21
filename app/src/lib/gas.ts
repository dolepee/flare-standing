// Coston2's FTestXRP proxy has under-estimated token-path gas in live validation.
// Unused gas is not charged, so use the proven transaction ceiling for web writes.
export const COSTON2_WRITE_GAS_LIMIT = 800_000n

export function withCoston2GasLimit<T extends object>(request: T): T & { gas: bigint } {
  return { ...request, gas: COSTON2_WRITE_GAS_LIMIT }
}
