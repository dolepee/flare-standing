import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'

export function Status({
  tone,
  children,
}: {
  tone: 'good' | 'warning' | 'muted'
  children: React.ReactNode
}) {
  const Icon = tone === 'good' ? CircleCheck : tone === 'warning' ? CircleAlert : LoaderCircle
  return (
    <span className={`status status-${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  )
}

