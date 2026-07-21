# STANDING — 48-Hour Validation Log

Last updated: 2026-07-21

Project: `Standing` (Flare recurring payments / prepaid mandates)

## 48h Gate Checklist

- [ ] Coston2 deploy + five-tx mandate loop (open, charge, recharge, cancel, blocked charge)
- [ ] FTSO path reads XRPL/USD (feed age check)
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
- Next execution step: run Coston2 deploy + keeper dry run and capture txids in this file.
