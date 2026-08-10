# STANDING — 48-Hour Validation Log

Last updated: 2026-08-10

Project: `Standing` (Flare recurring payments / prepaid mandates)

## 48-hour validation log — Standing

### Checkpoint status

- [x] Live USD-priced charge resolves through the Coston2 XRP/USD FTSO feed
- [x] Historical Coston2 spike deployment captured (`0xa1ccfe102946be49b7f2224b16402465d46a7c94`)
- [x] Coston2 proof set captured: open, charge, top-up, cancel, insufficient-balance block, and canceled-charge rejection
- [x] Deployed hardened V1 lifecycle validation completed (`0x8a29c741280554028d76666dc75558d98caab855`)
- [x] Completed one external merchant-and-subscriber lifecycle
- [x] Keeper path executed permissionlessly for both `ChargeExecuted` and `ChargeBlocked`
- [x] One XRPL testnet direct-mint path completed and timed
- [x] Smart Accounts/direct-mint path executed on Coston2
- [x] External merchant and subscriber booked for the controlled Coston2 pilot

## Current notes

- Contract scaffold and tests are in place (`src/StandingMandates.sol`, `script/*.s.sol`, `test/Standing.t.sol`).
- Candidate V2 local gates are complete as of 2026-08-10:
  - `forge fmt` ✅
  - `forge build` ✅
  - `forge test` ✅ (38/38 passing, including 2 stateful invariants with 256 runs and 128,000 calls each)
  - `forge coverage --report lcov` ✅
  - `cd app && npm test` ✅ (22/22 passing)
  - `cd app && npm run test:browser` ✅ (38/38 desktop/mobile on a verified free port)
  - `cd tools/atomic-subscribe && npm test` ✅ (52/52 passing)
  - `cd tools/keeper && npm test` ✅ (17/17 passing, including hard work budgets, queued 1,001-mandate coverage, post-broadcast reconciliation, and pathological-receipt tail rotation)
- Coston2 dependency checks done:
  - `getFeedByIdInWei(bytes21)` on FTSO v2 feed returns non-zero XRPL/USD price data and timestamp.
  - Coston2 FTestXRP verified at:
    - `0x0b6A3645c240605887a5532109323A3E12273dc7` (`FTestXRP`, 6 decimals).
- Executed forge dry-run for adapter deploy on Coston2 (simulation works with chain 114 and estimated gas logged).
- 2026-07-21 dependency checks:
  - `cast call 0x0b6A3645c240605887a5532109323A3E12273dc7 "name()"` → `FTestXRP`
  - `cast call 0x0b6A3645c240605887a5532109323A3E12273dc7 "symbol()"` → `FTestXRP`
  - `cast call 0x0b6A3645c240605887a5532109323A3E12273dc7 "decimals()"` → `6`
  - `cast call 0x3d893C53D9e8056135C26C8c638B76C8b60Df726 "getFeedByIdInWei(bytes21)" 0x015852502f55534400000000000000000000000000`
    - value=`1133595000000000000`, timestamp=`1784628281`

## Deployment and live trace (Coston2)

### Source-to-deployment reproducibility check

On 2026-08-02, repository commit `b5ab700` was compiled with the pinned Solidity
`0.8.28` configuration. For both V1 live deployments, the compiled creation
bytecode plus ABI-encoded constructor arguments matched the original deployment
transaction input byte-for-byte:

- `StandingMandates`: `DEPLOYMENT_SOURCE_MATCH=true` (`15,228` creation bytes)
- `FtsoUsdToFxrpAdapter`: `ADAPTER_SOURCE_MATCH=true` (`2,649` creation bytes)

This proves V1 commit `b5ab700`/deployment source equivalence. Candidate V2
changes made after that commit are not deployed by this evidence. It is not a claim that
the explorer has published or independently verified the source; Blockscout
source publication remains a release operation.

### Historical spike deployment (historical proof path)

- FTSO adapter deployed: `0x11789c23825D379b448B7B24C476bCF16941AD92`  
  - tx `0x22e1e528a527707efda8d5a7c6317d922df8edcb94240d0aefc2774ac7d032b6` (block `33091720`)
- Standing protocol deployed: `0xa1ccfe102946be49b7f2224b16402465d46a7c94`  
  - tx `0x6a0b12daeb78536386a6d07cdaac6db80a42fbdc5d9b9d56d9b4c07668d7c423` (block `33091761`)
- This path is valid demonstration history for source version before hardening fixes.

### Deployed hardened V1 proof contract

- Standing contract deployed: `0x8a29c741280554028d76666dc75558d98caab855`
  - tx `0x06a9ab44b01fa7074bf5eff8f173219b954e0685542acbac13950bc94c0862e9` (block `33098682`)
- FTSO adapter deployed: `0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8`
  - tx `0x2483d9c361434a90a6fdec01f07103ba56b7417d6bc92850540df670a37d112f` (block `33098665`)
- Historical live state (queried 2026-07-21):
  - `planCount() = 2`
  - `mandateCount() = 2`
  - `contractBalance() = 0`
  - `owner() = 0x9C7169BAAB226ABCC5C20d1CabebA8BaB9ea99dd`
  - `paused() = false`
  - signer FTestXRP balance = `7,000,000` raw units
  - signer allowance to Standing = `0`
  - merchant and protocol claim balances = `0` after withdrawal
  - mandates 1 and 2 are canceled with deposited and remaining balances zero after refund

- Current V1 live state (queried 2026-08-10):
  - `planCount() = 4`
  - `mandateCount() = 5`
  - `contractBalance() = 1,001,854` raw FTestXRP
  - `owner() = 0x9C7169BAAB226ABCC5C20d1CabebA8BaB9ea99dd`
  - `paused() = false`
  - mandate 5 remains active with `902,058` raw FTestXRP after its first charge

### Hardened lifecycle proof

- Approval: `0x2781276190c17ea4ab0ae70eff5526896f22beba747c80100b6e3ec6480bd71a`
- Plan created: `0x530666a23ba69dad74fa285dba56f0db215a8c4bccc5555e502a73334009f685`
- Mandate opened with `3,000,000` raw FTestXRP: `0xdf9f131d81ff0e02f57c84046dcfdc66339e04191c3379b47f0f3dd31996cea7`
- Charge executed after the 45-second cadence: `0xe408fea90aed783564a14f479ea551c87887323ca4f7d9c16c10cdc194a39f38`
  - merchant credit: `990,000`
  - protocol fee: `10,000`
- Mandate topped up by `1,000,000`: `0x8e9efe38c6b0586f235f1a6ddb14eff2191089e2ce02f8ee184721c5bf34e648`
- Mandate canceled: `0x804deada69db18c6c717656d2191ac64038bd7ac2b810aad338fe852378e99ad`
- A read-only post-cancel charge reverted with `NotActive` (`0x80cb55e2`).
- Unused `3,000,000` mandate balance returned to the subscriber: `0x10c2b388ede9caf608c27eb8704528f606b649152f956ffc67335c4f5f66c83b`
- Merchant withdrawal: `0x0f25f18f65e605a1ea98e83f5f818b017b40acfd0d383f24998fb990d205b09e`
- Protocol withdrawal: `0xb017b4807e510921fb193f87701d647df95c039b25b197d73d69b042376a7259`
- Residual token allowance cleared: `0xc232f67cb7a906f3b99c5ebdd2048cc3ad955acb5d376728e19402977a0248ee`

### Live FTSO USD-plan proof

Plan 2 is priced at `1,000,000` micro-USD ($1.00) with no fixed FXRP
price. Its live charge called the deployed FTSO adapter and resolved the plan
to `868,677` raw FTestXRP at execution time.

- Approval: `0x1c244e299ba398b16470750151dd6e0e055168e46ef4c3c6a9b22574d3946a46`
- USD plan created: `0x45f599fe8c6016253e0e2a09fd38d321b73e64e72a6390f08ab9156ea3726858`
- Mandate funded with `3,000,000` raw FTestXRP: `0x3e9c8b9fc0a9352a9394d03b38d087bc70bea244d1145fadd3c6774da1f90c25`
- FTSO-priced charge: `0x0791f6fd41dc4a5cf94e9a4973ecba3ed8c3b3e82b3169d1f214f2bc8fb28a43`
  - total charge: `868,677`
  - merchant credit: `859,991`
  - protocol fee: `8,686`
- Cancellation: `0x586555bf5c345d7b92edd3e5678f5b98431b4727e5128ea3e9229d8e3404cef2`
- A read-only post-cancel charge reverted with `NotActive` (`0x80cb55e2`).
- Subscriber refund: `0xb18ab9f67c721f442ee7d0514101a4b5c3edc167cbba2185b5f35404d1cdd7e1`
- Merchant withdrawal: `0x4fd3b6685f699e1b87786cc9d6ef73717d256f7c65b5653064f184590a96b7e0`
- Protocol withdrawal: `0x15677d80c39d15086213a952ee51d7015183f6205439a62b3a77dc6401cb305d`
- Residual allowance cleared: `0x58fcbc435a917995a982046408149201e3d84c76ae6552b9ce31c254ef9463a3`

### Controlled external Coston2 pilot

An external merchant operating as Virtual and a separate anonymous subscriber
completed one controlled lifecycle with their own wallets:

- Merchant: Virtual, `0xE9bcb0f59dC73Aa39F5486131c3F6614d36515e9`
- Subscriber: `0x154C9560B619fea7acb81F65c7e87E156FE2c975`
- Plan 4 created: `0xdd9362d5794493e94f7ec26c1ff4b40ba4e545bbc707465a31bb8a3c60382924`
- `1 FTestXRP` approved: `0x91879f489e2a7b9d281ce7f088e7a82b93f63bd4ef5b4171394605c3fc3de032`
- Mandate 4 opened: `0x1a350e64894b74bd0569249cefae30bffbae26b6b97bbdb111eb92c86e7aa891`
- Scheduled FTSO-priced charge: `0x0b645b0c6bc4d8e510b84303cb879f2d945c3480358405bba3c9df8f7297aef7`
  - total charge: `92,905` atomic / `0.092905 FTestXRP`
  - merchant credit: `91,976` atomic / `0.091976 FTestXRP`
  - protocol fee: `929` atomic / `0.000929 FTestXRP`
- Mandate canceled: `0x09bf4c1c0291edb076b003c6a023f1f07671e627bad7a6dbd048efc5ed40732b`
- Exact unused capacity returned: `0x1766be15d3e344a63cb238de339a7b2ef259932c288aac4b0cbefabfc892052f`
  - refund: `907,095` atomic / `0.907095 FTestXRP`
  - final mandate: deposited `0`, remaining `0`, canceled `true`
- Virtual withdrew the full merchant accrual: `0xb1f66ae4984b278c3d01dc58c389339fb80c2e3d22d6caf32acd346b34fe5e0c`
  - amount: `91,976` atomic / `0.091976 FTestXRP`
  - final merchant claimable balance: `0`
- A read-only post-cancel charge reverted with `NotActive()` (`0x80cb55e2`).

The subscriber used disclosed direct calls to `approve`, `openMandate`,
`cancel`, and `withdrawMandate`, not the browser wallet-connect transaction
flow. The transaction evidence proves protocol use by the disclosed subscriber
address, but not the participant's independence or an end-to-end UI transaction
test. Virtual reported that wallet and Coston2 setup caused the most friction;
this release preserves wallet-provider errors and adds explicit chain 114
recovery guidance.

Approved Virtual quote:

> “Standing made the recurring Coston2 payment lifecycle easy to verify from
> plan creation through merchant withdrawal.”

The transaction receipts prove the addresses and lifecycle. Participant
independence, Virtual attribution, and the quote are participant attestations;
chain state does not establish controller identity. This is a controlled
external Coston2 pilot, not production adoption, recurring revenue, a mainnet
customer, or a partnership.

### XRPL Testnet to Coston2 direct-mint proof

The official Flare Viem starter's `direct-mint-tag.ts` flow was run unchanged
against XRPL Testnet and Coston2. A reusable destination tag was reserved and
bound to the XRPL wallet's derived Flare smart account before the XRPL payment
was sent.

- XRPL sender: `rEAEY1WFcBurB5RdDhKmKFbpke7hzLEXce`
- Derived Flare smart account: `0xe8F14E95A2011B3b9E4B607002016e22D8bFbDf4`
- MintingTagManager: `0x094511737909b626391106bBc21B25feb2D67B96`
- AssetManagerFXRP: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- Core Vault XRPL address: `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`
- Tag `182` reserved: `0x2eb94bb413467706007d17419f67d122aadca8f29a871feb43f01360c722260b`
  (block `33103959`)
- Tag `182` bound to the derived smart account:
  `0x5f396691c61b907e1ee75ddf907339e2f0aad510d87f5816efa4f6cc1c31acf1`
  (block `33103961`)
- XRPL payment: `E5B02DF79E4B1891EA26A02384CEEF52AAC771B3B2F4A88524E0962B40CDEB3E`
  - validated with `tesSUCCESS` in ledger `19256400`
  - destination tag: `182`
  - payment: `10.2 XRP` (`10 XRP` net mint plus `0.1 XRP` minting fee and
    `0.1 XRP` executor fee)
  - validated at `2026-07-21T19:06:20Z`
- `DirectMintingExecuted`:
  `0x740995f3602e9f6548ccb11d70c789c53490faee67d1455f2a6faa7e3bec4c28`
  (block `33104019`)
  - minted amount: `10,000,000` UBA (`10 FXRP`)
  - target balance changed from `0` to `10,000,000` UBA
  - executed at `2026-07-21T19:08:53Z`
- Observed validated-payment-to-execution time: `153 seconds`

This is controlled-builder testnet evidence, not an external-user mint or a
mainnet availability claim.

### Atomic XRPL payment to Standing mandate proof

A separate controlled-builder Coston2 run proved the complete custom-instruction
path: one XRPL Testnet payment carried a canonical 42-byte `0xFE` Smart Account
memo, direct-minted FXRP, approved Standing, and opened plan 4 as mandate 5 in
one Flare transaction.

- XRPL sender: `rfm394DQHDXeLD1KYnFjKuavcGBr4911FY`
- Core Vault destination: `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`
- Derived Flare smart account: `0x230068eE8262BE1A7DF36f55Ebb17F64Cc8F7890`
- XRPL payment:
  `09BFC17FE831A80069362F34F56EC98B348787A143EA46C313811DC3E178729A`
  - validated with `tesSUCCESS`
  - amount requested and delivered: `1,200,000` drops (`1.2 XRP`)
  - destination tag: none
  - memo: canonical 42-byte `0xFE` hash instruction
- Coston2 execution:
  `0x712d68f0a2672123fdc2b18bef1df6eb85d0539b00dc3011c5321aa8342b9064`
  - receipt status: success
  - total FTestXRP delivered to the Smart Account: `1,100,000` UBA
  - Standing deposit: `1,000,000` atomic FXRP (`1 FXRP`)
  - mandate: `5`, plan: `4`
  - stored subscriber: `0x230068eE8262BE1A7DF36f55Ebb17F64Cc8F7890`
  - stored remaining capacity: `1,000,000` atomic FXRP
  - scheduled charge: nonzero; prior charge: zero; canceled: false

The payment amount also included the live `100,000` UBA minting fee and the
extra `100,000` UBA delivered to the Smart Account for the direct-mint executor
component. Standing deposited exactly `1,000,000` UBA. The Smart Account
instruction executor fee remained zero, matching Flare's official `0xFE`
starter. This is
controlled-builder testnet evidence, not a mainnet or external-user claim.

The historical contract scheduled rather than immediately charging that
mandate. On 2026-08-10, the existing Coston2 operator invoked the permissionless
charge path for the first due charge. The call required no subscriber key or
custody:

- Coston2 charge:
  `0xb258435a89008c683ada18df9f549a44b4eb391066cb90db8d6f6ba201860b7c`
- receipt status: success
- merchant credit: `96,963` atomic FTestXRP
- protocol fee: `979` atomic FTestXRP
- gross capacity consumed: `97,942` atomic FTestXRP
- remaining mandate capacity: `902,058` atomic FTestXRP
- stored `lastChargeAt`: `1786379892`
- stored `nextChargeAt`: `1786466292`

That receipt proves activation after the historical pending open. It does not
prove the new same-transaction initial-charge path; the V2 source and its fresh
proof are tracked separately until reviewed deployment.

Funding for this validation was recovered from the same signer's canceled
historical mandates. One recovery attempt
(`0x2ef83eac03663ed4f4100e90663a93d2f5b81eafec059bc650f48ca065f4b5c1`)
failed without state changes because the Coston2 token proxy exhausted an
under-estimated gas limit. The successful retry used an explicit `500,000`
gas limit (`0x78527541f9e008333398f522dc86ccf78b782514ee8785825964f04ba961453f`).

### Gate status

- Historical proof remains useful for the insufficient-balance keeper path.
- The deployed V1 proof contract proves the successful lifecycle, post-cancel rejection, subscriber refund, merchant withdrawal, protocol withdrawal, and zero residual allowance.
- The Coston2 contract, live FTSO, and XRPL-to-Coston2 direct-mint portions of
  the 48-hour gate are complete.
- The one-payment atomic subscription gate is complete: XRPL payment, FDC
  proof, direct mint, token approval, and stored Standing mandate all match.
- The controlled external Coston2 pilot is complete: separate merchant and
  subscriber wallets created and funded the relationship, the keeper charged
  it, both balances were withdrawn, and a later charge was rejected.
- Full GREEN here means the bounded testnet validation gate is complete. It does
  not imply production adoption, mainnet usage, recurring revenue, or an
  independent security audit.

### Pilot follow-up

- Publish the bounded transaction set and Virtual's approved quote.
- Keep wallet-provider errors visible and provide explicit Coston2 recovery
  guidance when a network switch fails.
