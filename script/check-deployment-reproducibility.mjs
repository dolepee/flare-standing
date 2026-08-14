import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const RPC_URLS = [
  process.env.COSTON2_RPC_URL ?? 'https://falling-skilled-uranium.flare-coston2.quiknode.pro/ext/bc/C/rpc',
  process.env.COSTON2_FALLBACK_RPC_URL ?? 'https://coston2-api.flare.network/ext/C/rpc',
].filter((url, index, urls) => urls.indexOf(url) === index)
const EXPLORER_API = process.env.COSTON2_EXPLORER_API ?? 'https://coston2-explorer.flare.network/api'

function sameHex(left, right) {
  return left.toLowerCase() === right.toLowerCase()
}

function word(value) {
  const raw = typeof value === 'number' ? BigInt(value).toString(16) : value.toLowerCase().replace(/^0x/, '')
  if (raw.length > 64) throw new Error(`Constructor value exceeds one word: ${value}`)
  return raw.padStart(64, '0')
}

function keccak(hex) {
  return execFileSync('cast', ['keccak', hex], { encoding: 'utf8' }).trim()
}

async function rpc(method, params = []) {
  const failures = []
  for (const rpcUrl of RPC_URLS) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body.error) throw new Error(body.error.message)
      return body.result
    } catch (error) {
      failures.push(`${rpcUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Coston2 RPC ${method} failed on every configured endpoint:\n- ${failures.join('\n- ')}`)
}

async function sourceVerified(address) {
  const url = new URL(EXPLORER_API)
  url.search = new URLSearchParams({ module: 'contract', action: 'getsourcecode', address })
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Coston2 explorer returned HTTP ${response.status}`)
  const body = await response.json()
  return body.message === 'OK' && typeof body.result?.[0]?.SourceCode === 'string' && body.result[0].SourceCode.length > 0
}

export function evaluateDeployment({ manifest, artifact, chainId, transaction, receipt, runtimeCode, adapterRuntimeCode, standingVerified, adapterVerified }) {
  const failures = []
  const constructorArgs = [
    manifest.fxrpAddress,
    manifest.priceAdapterAddress,
    manifest.treasuryAddress,
    manifest.feeBps,
    manifest.maxPriceAge,
  ].map(word).join('')
  const expectedInput = `${artifact.bytecode.object}${constructorArgs}`
  const creationInputBytes = (expectedInput.length - 2) / 2
  const creationInputKeccak = keccak(expectedInput)
  const runtimeBytecodeKeccak = keccak(runtimeCode)
  const adapterRuntimeBytecodeKeccak = keccak(adapterRuntimeCode)

  if (Number.parseInt(chainId, 16) !== manifest.chainId) failures.push(`chain id ${Number.parseInt(chainId, 16)} != ${manifest.chainId}`)
  if (!transaction) failures.push('deployment transaction is missing')
  else {
    if (!sameHex(transaction.input, expectedInput)) failures.push('repository creation input differs from deployment transaction')
    if (Number.parseInt(transaction.chainId, 16) !== manifest.chainId) failures.push('deployment transaction chain id differs')
  }
  if (!receipt) failures.push('deployment receipt is missing')
  else {
    if (receipt.status !== '0x1') failures.push('deployment transaction failed')
    if (!sameHex(receipt.contractAddress, manifest.standingAddress)) failures.push('deployment receipt contract address differs')
    if (Number.parseInt(receipt.blockNumber, 16) !== manifest.deployBlock) failures.push('deployment block differs')
  }
  if (artifact.metadata?.compiler?.version !== manifest.compilerVersion) failures.push('compiler version differs')
  if (creationInputBytes !== manifest.creationInputBytes) failures.push('creation input length differs')
  if (!sameHex(creationInputKeccak, manifest.creationInputKeccak)) failures.push('creation input hash differs')
  if (!sameHex(runtimeBytecodeKeccak, manifest.runtimeBytecodeKeccak)) failures.push('Standing runtime bytecode hash differs')
  if (!sameHex(adapterRuntimeBytecodeKeccak, manifest.priceAdapterRuntimeBytecodeKeccak)) failures.push('adapter runtime bytecode hash differs')
  if (!standingVerified) failures.push('Standing source is not explorer verified')
  if (!adapterVerified) failures.push('FTSO adapter source is not explorer verified')

  return {
    failures,
    evidence: {
      chainId: Number.parseInt(chainId, 16),
      creationInputBytes,
      creationInputKeccak,
      runtimeBytecodeKeccak,
      adapterRuntimeBytecodeKeccak,
      standingVerified,
      adapterVerified,
    },
  }
}

async function main() {
  execFileSync('forge', ['build'], { cwd: new URL('.', ROOT), stdio: 'inherit' })
  const manifest = JSON.parse(readFileSync(new URL('deployments/coston2.json', ROOT), 'utf8'))
  const artifact = JSON.parse(readFileSync(new URL('out/StandingMandates.sol/StandingMandates.json', ROOT), 'utf8'))
  const [chainId, transaction, receipt, runtimeCode, adapterRuntimeCode, standingVerified, adapterVerified] = await Promise.all([
    rpc('eth_chainId'),
    rpc('eth_getTransactionByHash', [manifest.deploymentTransaction]),
    rpc('eth_getTransactionReceipt', [manifest.deploymentTransaction]),
    rpc('eth_getCode', [manifest.standingAddress, 'latest']),
    rpc('eth_getCode', [manifest.priceAdapterAddress, 'latest']),
    sourceVerified(manifest.standingAddress),
    sourceVerified(manifest.priceAdapterAddress),
  ])
  const result = evaluateDeployment({ manifest, artifact, chainId, transaction, receipt, runtimeCode, adapterRuntimeCode, standingVerified, adapterVerified })
  if (result.failures.length > 0) throw new Error(`Deployment reproduction failed:\n- ${result.failures.join('\n- ')}`)
  console.log(JSON.stringify(result.evidence, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
