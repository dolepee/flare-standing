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
- Executed forge dry-run for adapter deploy on Coston2 (simulation works with chain 114 and estimated gas logged).
- Next execution step: finish funded Coston2 deployment + full loop capture (open, charge, top-up, cancel, blocked).
