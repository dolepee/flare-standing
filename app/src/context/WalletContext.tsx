/* oxlint-disable react/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  createWalletClient,
  custom,
  type Abi,
  type Address,
} from 'viem'
import { coston2 } from '../config'
import { publicClient } from '../lib/chain'
import { errorMessage } from '../lib/format'
import { COSTON2_WRITE_GAS_LIMIT, withCoston2GasLimit } from '../lib/gas'

type TransactionState = {
  label: string
  status: 'idle' | 'simulating' | 'signing' | 'confirming' | 'success' | 'error'
  hash?: `0x${string}`
  message?: string
}

type WalletContextValue = {
  account?: Address
  chainId?: number
  connected: boolean
  correctChain: boolean
  transaction: TransactionState
  connect: () => Promise<void>
  switchToCoston2: () => Promise<void>
  execute: (input: {
    label: string
    address: Address
    abi: Abi
    functionName: string
    args: readonly unknown[]
  }) => Promise<`0x${string}`>
  resetTransaction: () => void
}

const initialTransaction: TransactionState = { label: '', status: 'idle' }
const WalletContext = createContext<WalletContextValue | null>(null)

function parseChainId(value: unknown) {
  if (typeof value === 'string') return Number.parseInt(value, 16)
  if (typeof value === 'number') return value
  return undefined
}

export function WalletProvider({ children }: PropsWithChildren) {
  const [account, setAccount] = useState<Address>()
  const [chainId, setChainId] = useState<number>()
  const [transaction, setTransaction] = useState(initialTransaction)

  const syncWallet = useCallback(async () => {
    if (!window.ethereum) return
    const [accounts, chain] = await Promise.all([
      window.ethereum.request({ method: 'eth_accounts' }) as Promise<Address[]>,
      window.ethereum.request({ method: 'eth_chainId' }),
    ])
    setAccount(accounts[0])
    setChainId(parseChainId(chain))
  }, [])

  useEffect(() => {
    void syncWallet()
    if (!window.ethereum?.on) return

    const onAccounts = (accounts: unknown) =>
      setAccount(Array.isArray(accounts) ? (accounts[0] as Address | undefined) : undefined)
    const onChain = (chain: unknown) => setChainId(parseChainId(chain))
    window.ethereum.on('accountsChanged', onAccounts)
    window.ethereum.on('chainChanged', onChain)
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccounts)
      window.ethereum?.removeListener?.('chainChanged', onChain)
    }
  }, [syncWallet])

  const connect = useCallback(async () => {
    try {
      if (!window.ethereum) throw new Error('Install an EVM wallet to continue')
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as Address[]
      setAccount(accounts[0])
      const chain = await window.ethereum.request({ method: 'eth_chainId' })
      setChainId(parseChainId(chain))
    } catch (error) {
      setTransaction({ label: 'Connect wallet', status: 'error', message: errorMessage(error) })
      throw error
    }
  }, [])

  const switchToCoston2 = useCallback(async () => {
    try {
      if (!window.ethereum) throw new Error('Install an EVM wallet to continue')
      const chainIdHex = `0x${coston2.id.toString(16)}`
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        })
      } catch (error) {
        const code = (error as { code?: number }).code
        if (code !== 4902) throw error
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainIdHex,
              chainName: coston2.name,
              nativeCurrency: coston2.nativeCurrency,
              rpcUrls: coston2.rpcUrls.default.http,
              blockExplorerUrls: [coston2.blockExplorers.default.url],
            },
          ],
        })
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        })
      }
      const activeChain = parseChainId(await window.ethereum.request({ method: 'eth_chainId' }))
      setChainId(activeChain)
      if (activeChain !== coston2.id) throw new Error('Wallet did not switch to Coston2')
    } catch (error) {
      setTransaction({ label: 'Switch network', status: 'error', message: errorMessage(error) })
      throw error
    }
  }, [])

  const execute: WalletContextValue['execute'] = useCallback(
    async ({ label, address, abi, functionName, args }) => {
      try {
        if (!window.ethereum || !account) throw new Error('Connect wallet first')
        if (chainId !== coston2.id) throw new Error('Switch to Coston2 first')
        setTransaction({ label, status: 'simulating' })
        const simulation = await publicClient.simulateContract({
          account,
          address,
          abi,
          functionName,
          args,
          gas: COSTON2_WRITE_GAS_LIMIT,
        } as Parameters<typeof publicClient.simulateContract>[0])
        setTransaction({ label, status: 'signing' })
        const walletClient = createWalletClient({
          account,
          chain: coston2,
          transport: custom(window.ethereum),
        })
        const hash = await walletClient.writeContract(
          withCoston2GasLimit(simulation.request) as Parameters<typeof walletClient.writeContract>[0],
        )
        setTransaction({ label, status: 'confirming', hash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Transaction reverted')
        setTransaction({ label, status: 'success', hash })
        return hash
      } catch (error) {
        setTransaction({ label, status: 'error', message: errorMessage(error) })
        throw error
      }
    },
    [account, chainId],
  )

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      chainId,
      connected: Boolean(account),
      correctChain: chainId === coston2.id,
      transaction,
      connect,
      switchToCoston2,
      execute,
      resetTransaction: () => setTransaction(initialTransaction),
    }),
    [account, chainId, connect, execute, switchToCoston2, transaction],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const value = useContext(WalletContext)
  if (!value) throw new Error('useWallet must be used inside WalletProvider')
  return value
}
