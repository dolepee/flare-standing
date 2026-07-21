/* oxlint-disable react/only-export-components */
import { createContext, useContext, type PropsWithChildren } from 'react'
import { useStanding } from '../hooks/useStanding'
import { useWallet } from './WalletContext'

type ProtocolContextValue = ReturnType<typeof useStanding>
const ProtocolContext = createContext<ProtocolContextValue | null>(null)

export function ProtocolProvider({ children }: PropsWithChildren) {
  const { account } = useWallet()
  const protocol = useStanding(account)
  return <ProtocolContext.Provider value={protocol}>{children}</ProtocolContext.Provider>
}

export function useProtocol() {
  const value = useContext(ProtocolContext)
  if (!value) throw new Error('useProtocol must be used inside ProtocolProvider')
  return value
}
