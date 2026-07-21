# STANDING — 48-Hour Validation Log

Last updated: 2026-07-21

Project: `Standing` (Flare recurring payments / prepaid mandates)

## 48-hour validation log — Standing

### Checkpoint status

- [x] FTSO path reads XRPL/USD on Coston2 (price is non-zero and timestamped)
- [x] Contract deployed to Coston2 (`0xa1ccfe102946be49b7f2224b16402465d46a7c94`) and live tx history captured
- [ ] Coston2 live loop: open, charge, top-up, cancel, blocked charge (remaining step: charge + blocked charge are still pending)
- [ ] Recovered at least one real user path (subscriber + merchant) for each loop
- [ ] Keeper path tested with permissionless `charge` calls
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
- Next execution step: finish funded Coston2 deployment + full loop capture (open, charge, top-up, cancel, blocked).

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
- No `ChargeExecuted` or `ChargeBlocked` events yet observed in this trace window.
- `nextChargeAt` for mandate 2 is already elapsed (`1784630384`), but `charge(1)` was not executed because a funded Coston2 signer was not supplied in this environment.

### Current on-chain state snapshot (queried 2026-07-21)

- `plan(1)` → `[priceUsdMicro: 0, priceFxrp: 1000000, periodSeconds: 45, active: true]`
- `plan(2)` → same config as above, active true
- `mandate(1)` → canceled = true (expected after manual cancellation)
- `mandate(2)` → canceled = false
- `contractBalance()` from contract view = `7000000` (7 FTestXRP)
- `FTestXRP.balanceOf(standing)` = `7000000`
- `FTestXRP.balanceOf(subscriber 0x3DBe...) = 3000000`
- `mandate(2).nextChargeAt = 1784630384` (currently elapsed against `block.timestamp` at query time)

### Gate status

- This gives reproducible evidence for **deploy + partial lifecycle** under Coston2.
- Remaining on-chain requirement for the full 5-step loop is a live signer/key run for:
  - first successful `charge`
  - blocked `charge` on canceled mandate

### Immediate next action

- Supply funded Coston2 signer (`PRIVATE_KEY` + matching `ACCOUNT_ADDRESS`) and rerun:
  `RUN_LIVE=1 script/coston2-live-loop.sh` (or equivalent cast commands from README) to execute `charge` and blocked-path validation.
