# STANDING — 48-Hour Validation Log

Last updated: 2026-07-21

Project: `Standing` (Flare recurring payments / prepaid mandates)

## 48-hour validation log — Standing

### Checkpoint status

- [x] FTSO path reads XRPL/USD on Coston2 (price is non-zero and timestamped)
- [x] Contract deployed to Coston2 (`0xa1ccfe102946be49b7f2224b16402465d46a7c94`) and live tx history captured
- [x] Coston2 proof set: open, charge, top-up, cancel, insufficient-balance block, and canceled-charge rejection
- [ ] Recovered at least one real user path (subscriber + merchant) for each loop
- [x] Keeper path executed permissionlessly for both `ChargeExecuted` and `ChargeBlocked`
- [ ] External users booked (creators/merchants/community) for post-demo outreach
- [ ] Demo script aligned to final product framing (prepaid mandate + onchain replay points)

## Current notes

- Contract scaffold and tests are in place (`src/StandingMandates.sol`, `script/*.s.sol`, `test/Standing.t.sol`).
- Local gates are complete:
  - `forge fmt` ✅
  - `forge build` ✅
  - `forge test` ✅ (8/8 passing)
  - `forge coverage --report lcov` ✅
- Coston2 dependency checks done:
  - `getFeedByIdInWei(bytes21)` on FTSO v2 feed returns non-zero XRPL/USD price data and timestamp.
  - Coston2 FTestXRP verified at:
    - `0x0b6a3645c240605887a5532109323A3E12273dc7` (`FTestXRP`, 6 decimals).
- Executed forge dry-run for adapter deploy on Coston2 (simulation works with chain 114 and estimated gas logged).
- Confirmed live Coston2 Standing deployment and core state:
  - Standing contract: `0xa1ccfe102946be49b7f2224b16402465d46a7c94`
  - `planCount() = 7`, `mandateCount() = 6`
  - `contractBalance()` = `0x11a49a0` (18,500,000 micro-FXRP)
  - `FTestXRP.balanceOf(standing)` = `18,500,000`
  - Subscriber `0x3DBe06ec223c0bCD0D04B051d36CF1B077843D1a` has `1,500,000` raw FTestXRP
  - Keeper signer `0x9C7169BAAB226ABCC5C20d1CabebA8BaB9ea99dd` has `0` raw FTestXRP and sufficient C2FLR gas
  - `mandate(1)` -> canceled, deposited/remaining `4,000,000`
  - `mandate(2)` -> active, deposited `3,000,000`, remaining `2,000,000`, one successful charge
  - `mandate(3)` -> active, deposited/remaining `3,000,000`
  - `mandate(4)` -> canceled, deposited `4,000,000`, remaining `3,000,000`
  - `mandate(5)` -> canceled, deposited/remaining `4,000,000`
  - `mandate(6)` -> active, deposited/remaining `500,000`
  - `mandate(7)` -> zeroed default slot (not opened)
- Keeper execution:
  - `charge(2)` emitted `ChargeExecuted` with `990,000` to the merchant and a `10,000` protocol fee.
  - `charge(6)` emitted `ChargeBlocked` because its `500,000` remaining balance was below the `1,000,000` expected charge.
  - `charge(4)` against a canceled mandate reverts with the expected `NotActive` selector (`0x80cb55e2`).

- 2026-07-21 — live Coston2 dependency verification:
  - `cast call 0x0b6a3645c240605887a5532109323A3E12273dc7 "name()"` → `FTestXRP`
  - `cast call 0x0b6a3645c240605887a5532109323A3E12273dc7 "symbol()"` → `FTestXRP`
  - `cast call 0x0b6a3645c240605887a5532109323A3E12273dc7 "decimals()"` → `6`
  - `cast call 0x3d893C53D9e8056135C26C8c638B76C8b60Df726 "getFeedByIdInWei(bytes21)" 0x015852502f55534400000000000000000000000000`
    - value=`1133595000000000000`, timestamp=`1784628281`

## Deployment and live trace (Coston2)

### On-chain artifacts

- FTSO adapter deployed: `0x11789c23825D379b448B7B24C476bCF16941AD92`  
  - tx `0x22e1e528a527707efda8d5a7c6317d922df8edcb94240d0aefc2774ac7d032b6` (block `33091720`)
- Standing protocol deployed: `0xa1ccfe102946be49b7f2224b16402465d46a7c94`  
  - tx `0x6a0b12daeb78536386a6d07cdaac6db80a42fbdc5d9b9d56d9b4c07668d7c423` (block `33091761`)

### Executed lifecycle txs observed on contract

- Plan created (`PlanCreated`), plan id 1, tx `0xd6aae0a089f895f99de43c91fd603ff9ef47bf9adef8a8fd532f411b356f8f7f` (block `33091765`)
- Mandate opened (`MandateOpened`) for mandate 1, tx `0x7f256c266545a52fc6dc9aa0cbce62d14e4e78d54080ae9f5310e639c9a0d610` (block `33091768`)
- Mandate top-up (`MandateTopUp`) mandate 1, tx `0x8128c5effda7655446c92c72cc97fcb9d45ab2a63a0ce80df3c092c3fdaf51c0` (block `33091771`)
- Mandate canceled (`MandateCanceled`) mandate 1, tx `0xf638fb1ef3e6da6deeec88f083f8882b5b105cadafc4d93ca8563bb635bd688d` (block `33091772`)
- Plan created (`PlanCreated`) id 2, tx `0xe392ea25b985a37b80604366912f6dc566dd8c56fee38657983246a7bab16317` (block `33091809`)
- Mandate opened (`MandateOpened`) and top-up (`MandateTopUp`) for mandate 2, tx `0xc234b0f465983a74579c08aee75408e0380df86d36f21d0fe5664df8de92e04e` (block `33091811`)
- Successful keeper charge (`ChargeExecuted`) for mandate 2, tx `0x09a849ef744b45ce80d07d408c85fd75ec8b8d218598eb8d38986817e54ddbee` (block `33095927`)
  - merchant credit: `990,000` micro-FXRP
  - protocol fee: `10,000` micro-FXRP
- Insufficient-balance charge (`ChargeBlocked`) for mandate 6, tx `0xc59bf91eeab4cb146be7d681f66e3b0c517b6e360365074e58b8b23cde26c7a3` (block `33095929`)
  - remaining: `500,000` micro-FXRP
  - expected: `1,000,000` micro-FXRP
- Canceled mandate 4 rejects `charge(4)` with `NotActive` (`0x80cb55e2`) in a read-only execution check.

### Current on-chain state snapshot (queried 2026-07-21)

- `plan(1)` → `[priceUsdMicro: 0, priceFxrp: 1000000, periodSeconds: 45, active: true]`
- `plan(2)` → `[priceUsdMicro: 0, priceFxrp: 1000000, periodSeconds: 45, active: true]`
- `mandate(1)` → canceled = true, deposited = 4,000,000, remaining = 4,000,000, expired `nextChargeAt`
- `mandate(2)` → active, deposited = 3,000,000, remaining = 2,000,000, successful `lastChargeAt` recorded
- `mandate(3)` → active, deposited = 3,000,000, remaining = 3,000,000, elapsed `nextChargeAt`
- `mandate(4)` → canceled, deposited = 4,000,000, remaining = 3,000,000, elapsed `nextChargeAt`
- `mandate(5)` → canceled, deposited = 4,000,000, remaining = 4,000,000, expired `nextChargeAt`
- `mandate(6)` → active, deposited = 500,000, remaining = 500,000, blocked charge advanced `nextChargeAt`
- `contractBalance()` from contract view = `18,500,000` (18.5 FTestXRP)
- `merchantBalance(0x3DBe...) = 1,980,000`
- `protocolFeeBalance(0x3DBe...) = 20,000`
- `FTestXRP.balanceOf(subscriber 0x3DBe...) = 1,500,000`
- `FTestXRP.balanceOf(keeper 0x9C71...) = 0`

### Gate status

- This gives reproducible Coston2 evidence for deploy, funding, open, top-up, successful charge, insufficient-balance block, cancel, and canceled-charge rejection.
- The proof set spans controlled mandates because an insufficient-balance block and a successful charge are mutually exclusive at the same charge attempt.

### Immediate next action

- Preserve these transaction hashes in the public demo and begin merchant/subscriber user validation; no additional faucet funding is required for the technical gate.
