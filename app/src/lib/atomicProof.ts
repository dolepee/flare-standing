import { COSTON2_EXPLORER, STANDING_ADDRESS } from '../config'

export const XRPL_TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions'

export const ATOMIC_PROOF = Object.freeze({
  mandateId: 5n,
  planId: 4n,
  subscriber: '0x230068eE8262BE1A7DF36f55Ebb17F64Cc8F7890',
  xrplTransaction: '09BFC17FE831A80069362F34F56EC98B348787A143EA46C313811DC3E178729A',
  coston2Transaction: '0x712d68f0a2672123fdc2b18bef1df6eb85d0539b00dc3011c5321aa8342b9064',
  chargeTransaction: '0xb258435a89008c683ada18df9f549a44b4eb391066cb90db8d6f6ba201860b7c',
  xrplLedger: '19,738,200',
  xrplAmount: '1.2 XRP',
  mintedAmount: '1.1 FTestXRP delivered · 1 FTestXRP prepaid',
  xrplHref: `${XRPL_TESTNET_EXPLORER}/09BFC17FE831A80069362F34F56EC98B348787A143EA46C313811DC3E178729A`,
  coston2Href: `${COSTON2_EXPLORER}/tx/0x712d68f0a2672123fdc2b18bef1df6eb85d0539b00dc3011c5321aa8342b9064`,
  chargeHref: `${COSTON2_EXPLORER}/tx/0xb258435a89008c683ada18df9f549a44b4eb391066cb90db8d6f6ba201860b7c`,
  standingHref: `${COSTON2_EXPLORER}/address/${STANDING_ADDRESS}`,
})

export type AtomicReplayStep = {
  id: 'authorize' | 'mint' | 'subscribe' | 'charge'
  index: string
  network: string
  title: string
  summary: string
  result: string
  transaction: string
  href: string
  linkLabel: string
}

export const ATOMIC_REPLAY_STEPS: readonly AtomicReplayStep[] = Object.freeze([
  {
    id: 'authorize',
    index: '01',
    network: 'XRPL Testnet',
    title: 'The XRP payment is user-authorized.',
    summary:
      'An XRPL Testnet account signed one 1.2 XRP payment to the Core Vault with the canonical 0xFE Smart Account instruction.',
    result: 'Validated · tesSUCCESS',
    transaction: ATOMIC_PROOF.xrplTransaction,
    href: ATOMIC_PROOF.xrplHref,
    linkLabel: 'Open exact XRPL transaction',
  },
  {
    id: 'mint',
    index: '02',
    network: 'Flare Coston2 testnet',
    title: 'FDC-backed proof releases the mint.',
    summary:
      'The verified XRPL payment entered the FAssets direct-mint path and delivered 1.1 FTestXRP to the derived Flare Smart Account. Standing received 1 FTestXRP; the additional 0.1 was the direct-mint executor component.',
    result: 'Receipt success · 1.1 FTestXRP delivered',
    transaction: ATOMIC_PROOF.coston2Transaction,
    href: ATOMIC_PROOF.coston2Href,
    linkLabel: 'Open exact Coston2 transaction',
  },
  {
    id: 'subscribe',
    index: '03',
    network: 'Flare Coston2 testnet',
    title: 'Mint and pending subscribe settle atomically.',
    summary:
      'Inside that same Coston2 transaction, the Smart Account approved Standing and opened pending mandate 5 for plan 4 with 1 FTestXRP prepaid. No recurring charge happened yet.',
    result: 'Pending mandate 5 · 1 FTestXRP',
    transaction: ATOMIC_PROOF.coston2Transaction,
    href: ATOMIC_PROOF.coston2Href,
    linkLabel: 'Inspect the shared Coston2 receipt',
  },
  {
    id: 'charge',
    index: '04',
    network: 'Flare Coston2 testnet',
    title: 'A later keeper proves the recurring charge.',
    summary:
      'The existing Coston2 operator invoked the permissionless charge path for mandate 5: 0.097942 FTestXRP left the mandate, including a 0.000979 FTestXRP protocol fee. No subscriber key or custody was required.',
    result: 'Paid · active · 0.902058 FTestXRP left',
    transaction: ATOMIC_PROOF.chargeTransaction,
    href: ATOMIC_PROOF.chargeHref,
    linkLabel: 'Open exact keeper charge transaction',
  },
])
