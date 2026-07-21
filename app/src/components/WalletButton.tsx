import { WalletCards } from 'lucide-react'
import { coston2 } from '../config'
import { useWallet } from '../context/WalletContext'
import { shortAddress } from '../lib/format'

export function WalletButton() {
  const { account, connected, correctChain, connect, switchToCoston2 } = useWallet()

  if (!connected) {
    return (
      <button className="wallet-button" type="button" onClick={() => void connect()}>
        <WalletCards size={16} aria-hidden="true" />
        Connect wallet
      </button>
    )
  }

  if (!correctChain) {
    return (
      <button className="wallet-button wallet-warning" type="button" onClick={() => void switchToCoston2()}>
        Switch to {coston2.name}
      </button>
    )
  }

  return (
    <button className="wallet-button wallet-connected" type="button" title={account}>
      <span className="wallet-dot" aria-hidden="true" />
      {shortAddress(account)}
    </button>
  )
}

