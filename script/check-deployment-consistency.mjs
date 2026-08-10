import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../deployments/coston2.json', import.meta.url), 'utf8'))
const config = readFileSync(new URL('../app/src/config.ts', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../app/src/pages/DashboardPage.tsx', import.meta.url), 'utf8')

function requireMatch(source, pattern, label) {
  const match = source.match(pattern)
  if (!match) throw new Error(`Could not read ${label}`)
  return match[1]
}

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase()
}

const configuredAddress = requireMatch(config, /STANDING_ADDRESS = '(0x[0-9a-fA-F]{40})'/, 'STANDING_ADDRESS')
const configuredFxrp = requireMatch(config, /FXRP_ADDRESS = '(0x[0-9a-fA-F]{40})'/, 'FXRP_ADDRESS')
const configuredAdapter = requireMatch(config, /FTSO_ADAPTER_ADDRESS = '(0x[0-9a-fA-F]{40})'/, 'FTSO_ADAPTER_ADDRESS')
const configuredBlock = Number(requireMatch(config, /DEPLOY_BLOCK = ([0-9_]+)n/, 'DEPLOY_BLOCK').replaceAll('_', ''))
const configuredV2 = requireMatch(config, /V2_CHECKOUT_DEPLOYED = (true|false)/, 'V2_CHECKOUT_DEPLOYED') === 'true'
const checkoutPlanId = Number(requireMatch(dashboard, /to="\/checkout\/(\d+)"/, 'primary checkout plan id'))

const mismatches = []
if (manifest.chainId !== 114) mismatches.push(`chainId ${manifest.chainId} != 114`)
if (!sameAddress(configuredAddress, manifest.standingAddress)) mismatches.push('app Standing address')
if (!sameAddress(configuredFxrp, manifest.fxrpAddress)) mismatches.push('app FXRP address')
if (!sameAddress(configuredAdapter, manifest.priceAdapterAddress)) mismatches.push('app price adapter address')
if (configuredBlock !== manifest.deployBlock) mismatches.push('app deploy block')
if (configuredV2 !== manifest.v2CheckoutDeployed) mismatches.push('app V2 checkout flag')
if (checkoutPlanId !== manifest.primaryCheckoutPlanId) mismatches.push('homepage checkout plan')

const keeperAddress = process.env.KEEPER_STANDING_ADDRESS
if (keeperAddress && !sameAddress(keeperAddress, manifest.standingAddress)) {
  mismatches.push('GitHub Actions STANDING_ADDRESS variable')
}

if (mismatches.length > 0) {
  throw new Error(`Coston2 deployment mismatch: ${mismatches.join(', ')}`)
}

console.log(`Coston2 deployment surfaces agree on ${manifest.standingAddress} (V${manifest.contractVersion})`)
