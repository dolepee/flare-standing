import { COSTON2_EXPLORER, STANDING_ADDRESS } from '../config'

export const XRPL_TESTNET_EXPLORER = 'https://testnet.xrpl.org/transactions'

export const ATOMIC_PROOF = Object.freeze({
  mandateId: 1n,
  planId: 1n,
  subscriber: '0x230068eE8262BE1A7DF36f55Ebb17F64Cc8F7890',
  xrplTransaction: '54E9F5D3CFEAF5236DD6BE5B8624D8AAE69307D02D027E594B6AA023D756C0FD',
  coston2Transaction: '0x119d29cf92a5a41ae504b151bd6ab5e6bc1d86855f58673fe5f3b4e5d158b2c9',
  chargeTransaction: '0x8c3333505617ef62e2b2823cb0c95ce4ee81a6e601e80978b285865f94d5a2a9',
  deployTransaction: '0xa0f4d5f5456a2661ad1cb239edb14a7117f7961d6ca2b6392460b27c9a6b53a5',
  planTransaction: '0x06c0bfc5ecd8cb12327ad15b658d15bc328c0087644c5b2a57a97fbe6c28b2c0',
  xrplLedger: '19,802,686',
  xrplAmount: '1.2 XRP',
  mintedAmount: '1.1 FTestXRP delivered · 1 FTestXRP prepaid',
  xrplHref: `${XRPL_TESTNET_EXPLORER}/54E9F5D3CFEAF5236DD6BE5B8624D8AAE69307D02D027E594B6AA023D756C0FD`,
  coston2Href: `${COSTON2_EXPLORER}/tx/0x119d29cf92a5a41ae504b151bd6ab5e6bc1d86855f58673fe5f3b4e5d158b2c9`,
  chargeHref: `${COSTON2_EXPLORER}/tx/0x8c3333505617ef62e2b2823cb0c95ce4ee81a6e601e80978b285865f94d5a2a9`,
  deployHref: `${COSTON2_EXPLORER}/tx/0xa0f4d5f5456a2661ad1cb239edb14a7117f7961d6ca2b6392460b27c9a6b53a5`,
  planHref: `${COSTON2_EXPLORER}/tx/0x06c0bfc5ecd8cb12327ad15b658d15bc328c0087644c5b2a57a97fbe6c28b2c0`,
  standingHref: `${COSTON2_EXPLORER}/address/${STANDING_ADDRESS}`,
})

export type AtomicReplayStep = {
  id: 'authorize' | 'mint' | 'activate' | 'recur'
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
    id: 'activate',
    index: '03',
    network: 'Flare Coston2 testnet',
    title: 'The subscription opens and pays immediately.',
    summary:
      'Inside that same Coston2 transaction, the Smart Account approved Standing, opened mandate 1 for plan 1, and charged the first 0.1 FTestXRP cycle. The merchant received 0.099, the protocol fee was 0.001, and 0.9 remains under the subscriber-controlled mandate.',
    result: 'Mandate 1 active · first cycle paid · 0.9 left',
    transaction: ATOMIC_PROOF.coston2Transaction,
    href: ATOMIC_PROOF.coston2Href,
    linkLabel: 'Inspect open + first-charge receipt',
  },
  {
    id: 'recur',
    index: '04',
    network: 'Flare Coston2 testnet',
    title: 'A different keeper advances the next cycle.',
    summary:
      'The permissionless keeper address later charged mandate 1 without the subscriber key. A second 0.1 FTestXRP cycle settled with the same 0.099 merchant and 0.001 fee split, leaving 0.8 under the mandate.',
    result: 'Second cycle paid · 0.8 FTestXRP left',
    transaction: ATOMIC_PROOF.chargeTransaction,
    href: ATOMIC_PROOF.chargeHref,
    linkLabel: 'Inspect recurring keeper receipt',
  },
])
