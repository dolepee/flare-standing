import { Check, ExternalLink, LoaderCircle, X } from 'lucide-react'
import { COSTON2_EXPLORER } from '../config'
import { useWallet } from '../context/WalletContext'

export function TransactionDrawer() {
  const { transaction, resetTransaction } = useWallet()
  if (transaction.status === 'idle') return null

  const active = ['simulating', 'signing', 'confirming'].includes(transaction.status)
  const label =
    transaction.status === 'simulating'
      ? 'Checking transaction'
      : transaction.status === 'signing'
        ? 'Confirm in wallet'
        : transaction.status === 'confirming'
          ? 'Waiting for Coston2'
          : transaction.status === 'success'
            ? 'Transaction confirmed'
            : 'Transaction stopped'

  return (
    <aside className={`transaction-drawer transaction-${transaction.status}`} aria-live="polite">
      <div className="transaction-icon" aria-hidden="true">
        {active ? <LoaderCircle className="spin" /> : transaction.status === 'success' ? <Check /> : <X />}
      </div>
      <div>
        <strong>{label}</strong>
        <span>{transaction.label}</span>
        {transaction.message ? <small>{transaction.message}</small> : null}
      </div>
      {transaction.hash ? (
        <a
          className="icon-link"
          href={`${COSTON2_EXPLORER}/tx/${transaction.hash}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Open transaction in Coston2 Explorer"
        >
          <ExternalLink size={17} aria-hidden="true" />
        </a>
      ) : null}
      {!active ? (
        <button className="icon-button" type="button" onClick={resetTransaction} aria-label="Dismiss transaction status">
          <X size={17} aria-hidden="true" />
        </button>
      ) : null}
    </aside>
  )
}

