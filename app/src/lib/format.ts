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

function walletErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'number' ? code : undefined
}

function firstErrorDetail(error: unknown) {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (typeof error !== 'object' || error === null) return undefined

  const candidate = error as {
    shortMessage?: unknown
    message?: unknown
    details?: unknown
  }
  return [candidate.shortMessage, candidate.message, candidate.details]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    ?.trim()
}

function compactError(value: string) {
  const firstLine = value.split('\n')[0]?.trim() || 'Transaction failed'
  return firstLine.length > 150 ? `${firstLine.slice(0, 147)}...` : firstLine
}

export function errorMessage(error: unknown) {
  return compactError(firstErrorDetail(error) ?? 'Transaction failed')
}

export function networkSwitchErrorMessage(error: unknown) {
  if (walletErrorCode(error) === 4001) {
    return 'Coston2 network request was rejected in the wallet. Approve the switch, then retry.'
  }

  const detail = errorMessage(error)
  const separator = /[.!?]$/.test(detail) ? '' : '.'
  return `${detail}${separator} Open the wallet network settings, add or select Coston2 (chain 114), then retry.`
}

export function runUiAction(action: Promise<unknown>) {
  void action.catch(() => undefined)
}
