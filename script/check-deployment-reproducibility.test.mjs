import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evaluateDeployment } from './check-deployment-reproducibility.mjs'

const manifest = JSON.parse(readFileSync(new URL('../deployments/coston2.json', import.meta.url), 'utf8'))
const artifact = JSON.parse(readFileSync(new URL('../out/StandingMandates.sol/StandingMandates.json', import.meta.url), 'utf8'))
const constructorArgs = [
  manifest.fxrpAddress,
  manifest.priceAdapterAddress,
  manifest.treasuryAddress,
  `0x${manifest.feeBps.toString(16)}`,
  `0x${manifest.maxPriceAge.toString(16)}`,
].map((value) => value.toLowerCase().replace(/^0x/, '').padStart(64, '0')).join('')
const runtimeCode = '0x6001'
const adapterRuntimeCode = '0x6002'
const fixture = {
  manifest: { ...manifest },
  artifact,
  chainId: '0x72',
  transaction: { input: `${artifact.bytecode.object}${constructorArgs}`, chainId: '0x72' },
  receipt: { status: '0x1', contractAddress: manifest.standingAddress, blockNumber: `0x${manifest.deployBlock.toString(16)}` },
  runtimeCode,
  adapterRuntimeCode,
  standingVerified: true,
  adapterVerified: true,
}

fixture.manifest.runtimeBytecodeKeccak = '0x309c67890bde4c575dc23d2cc3b5c3a3d599e312e980e9b61b5bc8f3cd87c8bb'
fixture.manifest.priceAdapterRuntimeBytecodeKeccak = '0xcde7aac41575d8b30bd84f598371d46d266fadb09c9dcfcdd047fd087ef8763e'

test('accepts exact deployment evidence', () => {
  assert.deepEqual(evaluateDeployment(fixture).failures, [])
})

for (const [name, change, expected] of [
  ['wrong chain', { chainId: '0x1' }, 'chain id'],
  ['wrong deployment input', { transaction: { ...fixture.transaction, input: '0x00' } }, 'creation input'],
  ['wrong constructor arguments', { manifest: { ...fixture.manifest, feeBps: 101 } }, 'creation input'],
  ['wrong runtime bytecode', { runtimeCode: '0x6003' }, 'runtime bytecode hash'],
  ['failed receipt', { receipt: { ...fixture.receipt, status: '0x0' } }, 'transaction failed'],
  ['unverified source', { standingVerified: false }, 'not explorer verified'],
]) {
  test(`rejects ${name}`, () => {
    const result = evaluateDeployment({ ...fixture, ...change })
    assert.ok(result.failures.some((failure) => failure.includes(expected)))
  })
}
