# STANDING — 48-Hour Validation Log

Last updated: 2026-07-21

Project: `Standing` (Flare recurring payments / prepaid mandates)

## 48h Gate Checklist

- [x] FTSO path reads XRPL/USD on Coston2 (price is non-zero and timestamped)
- [ ] Coston2 deploy + five-tx mandate loop (open, charge, recharge, cancel, blocked charge)
- [ ] Recovered at least one real user path (subscriber + merchant) for each loop
- [ ] Keeper path tested with permissionless `charge` calls
- [ ] External users booked (creators/merchants/community) for post-demo outreach
- [ ] Draft demo script aligned to corrected product framing (prepaid mandate)

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
