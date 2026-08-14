/* oxlint-disable react/only-export-components */
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { useStanding, type StandingReadScope } from '../hooks/useStanding'
import { useWallet } from './WalletContext'

type ProtocolContextValue = ReturnType<typeof useStanding>
const ProtocolContext = createContext<ProtocolContextValue | null>(null)

export function ProtocolProvider({ children }: PropsWithChildren) {
  const { account } = useWallet()
  const { pathname } = useLocation()
  const scope = useMemo<StandingReadScope>(() => {
    const id = (value: string | undefined) => value && /^\d+$/.test(value) ? BigInt(value) : undefined
    if (pathname.startsWith('/checkout/')) {
      const planId = id(pathname.split('/')[2])
      return { planIds: planId ? [planId] : [], mandateIds: [] }
    }
    if (pathname.startsWith('/access/')) {
      const mandateId = id(pathname.split('/')[2])
      return { planIds: [], mandateIds: mandateId ? [mandateId] : [] }
    }
    if (pathname === '/plans') return { mandateIds: [], catalogLimit: 50 }
    if (pathname === '/mandates') return { planIds: [], catalogLimit: 50 }
    return { catalogLimit: 50 }
  }, [pathname])
  const protocol = useStanding(account, scope)
  return <ProtocolContext.Provider value={protocol}>{children}</ProtocolContext.Provider>
}

export function useProtocol() {
  const value = useContext(ProtocolContext)
  if (!value) throw new Error('useProtocol must be used inside ProtocolProvider')
  return value
}
