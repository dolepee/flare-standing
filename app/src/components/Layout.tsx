import {
  BadgeDollarSign,
  Blocks,
  LayoutDashboard,
  Menu,
  ReceiptText,
  Store,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useProtocol } from '../context/ProtocolContext'
import { Brand } from './Brand'
import { TransactionDrawer } from './TransactionDrawer'
import { WalletButton } from './WalletButton'

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/plans', label: 'Plans', icon: BadgeDollarSign },
  { to: '/mandates', label: 'Mandates', icon: ReceiptText },
  { to: '/merchant', label: 'Merchant', icon: Store },
  { to: '/evidence', label: 'Evidence', icon: Blocks },
]

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { state } = useProtocol()
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand-link" onClick={() => setMenuOpen(false)}>
          <Brand />
        </NavLink>
        <nav className={menuOpen ? 'main-nav nav-open' : 'main-nav'} aria-label="Primary navigation">
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
            {state.paused ? 'Paused' : 'Live'}
          </span>
          <WalletButton />
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
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
        <span>Standing protocol on Flare Coston2</span>
        <a href="https://github.com/dolepee/flare-standing" target="_blank" rel="noreferrer">
          Source code
        </a>
      </footer>
      <TransactionDrawer />
    </div>
  )
}

