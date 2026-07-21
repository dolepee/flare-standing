import { formatUnits, parseUnits } from 'viem'

export function shortAddress(value?: string) {
  if (!value) return 'Not connected'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function formatFxrp(value: bigint, maximumFractionDigits = 4) {
  return Number(formatUnits(value, 6)).toLocaleString(undefined, {
    maximumFractionDigits,
  })
}

export function parseFxrp(value: string) {
  return parseUnits(value || '0', 6)
}

export function formatUsdMicro(value: bigint) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value) / 1_000_000)
}

export function formatPeriod(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

export function formatTime(timestamp: bigint) {
  if (timestamp === 0n) return 'Not charged'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Number(timestamp) * 1_000))
}

export function isSameAddress(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

export function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'Transaction failed'
  const candidate = error.message.split('\n')[0]
  return candidate.length > 150 ? `${candidate.slice(0, 147)}...` : candidate
}

export function runUiAction(action: Promise<unknown>) {
  void action.catch(() => undefined)
}
