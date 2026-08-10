import {
  BadgeDollarSign,
  Blocks,
  LayoutDashboard,
  Menu,
  ReceiptText,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useProtocol } from '../context/ProtocolContext'
import { Brand } from './Brand'
import { TransactionDrawer } from './TransactionDrawer'
import { WalletButton } from './WalletButton'

const navItems = [
  { to: '/', label: 'Proof replay', icon: LayoutDashboard },
  { to: '/plans', label: 'Testnet checkout', icon: BadgeDollarSign },
  { to: '/mandates', label: 'My mandates', icon: ReceiptText },
  { to: '/evidence', label: 'Receipts', icon: Blocks },
]

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { state, initialized } = useProtocol()

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand-link" onClick={() => setMenuOpen(false)}>
          <Brand />
        </NavLink>
        <nav id="primary-navigation" className={menuOpen ? 'main-nav nav-open' : 'main-nav'} aria-label="Primary navigation">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className={state.paused ? 'network-state network-paused' : 'network-state'}>
            <span aria-hidden="true" />
            {!initialized ? 'Checking Coston2' : state.paused ? 'Testnet paused' : 'Coston2 testnet'}
          </span>
          <WalletButton />
          <button
            ref={menuButtonRef}
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        <span>Standing on Flare Coston2 testnet · no mainnet funds</span>
        <a href="https://github.com/dolepee/flare-standing" target="_blank" rel="noreferrer">
          Source code
        </a>
      </footer>
      <TransactionDrawer />
    </div>
  )
}
