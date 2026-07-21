# STANDING — 48-Hour Validation Log

Last updated: 2026-07-21

Project: `Standing` (Flare recurring payments / prepaid mandates)

## 48-hour validation log — Standing

### Checkpoint status

- [x] Live USD-priced charge resolves through the Coston2 XRP/USD FTSO feed
- [x] Historical Coston2 spike deployment captured (`0xa1ccfe102946be49b7f2224b16402465d46a7c94`)
- [x] Coston2 proof set captured: open, charge, top-up, cancel, insufficient-balance block, and canceled-charge rejection
- [x] Hardened Coston2 candidate lifecycle validation completed (`0x8a29c741280554028d76666dc75558d98caab855`)
- [ ] Recovered at least one real user path (subscriber + merchant) for each loop
- [x] Keeper path executed permissionlessly for both `ChargeExecuted` and `ChargeBlocked`
- [ ] One XRPL testnet mint/funding path completed and timed
- [ ] Smart Accounts/direct-mint availability confirmed with the Flare team
- [ ] External users booked (creators/merchants/community) for post-demo outreach
- [ ] Demo script aligned to final product framing (prepaid mandate + onchain replay points)

## Current notes

- Contract scaffold and tests are in place (`src/StandingMandates.sol`, `script/*.s.sol`, `test/Standing.t.sol`).
- Local gates are complete:
  - `forge fmt` ✅
  - `forge build` ✅
  - `forge test` ✅ (13/13 passing)
  - `forge coverage --report lcov` ✅
- Coston2 dependency checks done:
  - `getFeedByIdInWei(bytes21)` on FTSO v2 feed returns non-zero XRPL/USD price data and timestamp.
  - Coston2 FTestXRP verified at:
    - `0x0b6a3645c240605887a5532109323A3E12273dc7` (`FTestXRP`, 6 decimals).
- Executed forge dry-run for adapter deploy on Coston2 (simulation works with chain 114 and estimated gas logged).
- 2026-07-21 dependency checks:
  - `cast call 0x0b6a3645c240605887a5532109323A3E12273dc7 "name()"` → `FTestXRP`
  - `cast call 0x0b6a3645c240605887a5532109323A3E12273dc7 "symbol()"` → `FTestXRP`
  - `cast call 0x0b6a3645c240605887a5532109323A3E12273dc7 "decimals()"` → `6`
  - `cast call 0x3d893C53D9e8056135C26C8c638B76C8b60Df726 "getFeedByIdInWei(bytes21)" 0x015852502f55534400000000000000000000000000`
    - value=`1133595000000000000`, timestamp=`1784628281`

## Deployment and live trace (Coston2)

### Historical spike deployment (historical proof path)

- FTSO adapter deployed: `0x11789c23825D379b448B7B24C476bCF16941AD92`  
  - tx `0x22e1e528a527707efda8d5a7c6317d922df8edcb94240d0aefc2774ac7d032b6` (block `33091720`)
- Standing protocol deployed: `0xa1ccfe102946be49b7f2224b16402465d46a7c94`  
  - tx `0x6a0b12daeb78536386a6d07cdaac6db80a42fbdc5d9b9d56d9b4c07668d7c423` (block `33091761`)
- This path is valid demonstration history for source version before hardening fixes.

### Hardened Coston2 candidate (current release branch target)

- Standing contract deployed: `0x8a29c741280554028d76666dc75558d98caab855`
  - tx `0x06a9ab44b01fa7074bf5eff8f173219b954e0685542acbac13950bc94c0862e9` (block `33098682`)
- FTSO adapter deployed: `0xd076bb76F5A0C489163d746C9Afd0A7f91D06Ae8`
  - tx `0x2483d9c361434a90a6fdec01f07103ba56b7417d6bc92850540df670a37d112f` (block `33098665`)
- Current live state (queried 2026-07-21):
  - `planCount() = 2`
  - `mandateCount() = 2`
  - `contractBalance() = 0`
  - `owner() = 0x9C7169BAAB226ABCC5C20d1CabebA8BaB9ea99dd`
  - `paused() = false`
  - signer FTestXRP balance = `7,000,000` raw units
  - signer allowance to Standing = `0`
  - merchant and protocol claim balances = `0` after withdrawal
  - mandates 1 and 2 are canceled with deposited and remaining balances zero after refund

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

Funding for this validation was recovered from the same signer's canceled
historical mandates. One recovery attempt
(`0x2ef83eac03663ed4f4100e90663a93d2f5b81eafec059bc650f48ca065f4b5c1`)
failed without state changes because the Coston2 token proxy exhausted an
under-estimated gas limit. The successful retry used an explicit `500,000`
gas limit (`0x78527541f9e008333398f522dc86ccf78b782514ee8785825964f04ba961453f`).

### Gate status

- Historical proof remains useful for the insufficient-balance keeper path.
- The hardened candidate now proves the successful lifecycle, post-cancel rejection, subscriber refund, merchant withdrawal, protocol withdrawal, and zero residual allowance.
- The Coston2 contract and live FTSO portions of the 48-hour gate are complete.
- Full GREEN status still requires one XRPL-side test mint/funding path and two creator conversations. This controlled signer run is not external-user validation.

### Immediate next action

- Complete and time one XRPL testnet mint/funding path.
- Record the Flare team's current Smart Accounts/direct-mint availability answer.
- Book two creator or merchant conversations, then recruit the first external Coston2 subscriber.
