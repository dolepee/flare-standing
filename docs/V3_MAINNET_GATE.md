# Standing V3 mainnet gate

Standing V2 is the immutable Coston2 hackathon deployment. Its receipts remain
the evidence for the submitted product and must not be rewritten as V3 evidence.
V3 is a separate, audited deployment and does not launch until every gate below
is complete.

## Contract gates

- Store a subscriber-approved maximum for every recurring FTSO-priced charge;
  reject price spikes above it without consuming prepaid capacity.
- Commit each plan's terms and paid artifact to a versioned hash and immutable or
  merchant-signed URI.
- Replace one-step ownership with two-step acceptance. Put owner and treasury
  roles behind reviewed multisig/timelock controls with documented recovery.
- Encode plan-deactivation, pause, missed-cycle, and no-catch-up semantics in the
  interface and transition tests.
- Track aggregate mandate, merchant, and protocol liabilities, then permit only
  timelocked recovery of proven token surplus above those liabilities.
- Validate token code and decimals, adapter code and identity, treasury, fee,
  price age, and chain assumptions inside the constructor or deployment factory.
- Decide whether plan creation remains available during a pause. V3 must enforce
  the chosen policy rather than relying only on documentation.

## Operations gates

- Discover every due mandate from indexed events or a replayable subscriber and
  due-time index, then verify current state directly onchain before charging.
- Use durable idempotent scheduling, bounded retries, balance and failure alerts,
  restart recovery, and independently operated keeper instances.
- Use independently operated RPC providers with health checks and fail-closed
  disagreement detection for sensitive reads.
- Define keeper incentives and failure policy instead of relying on a hosted
  demonstration key.

## Verification gates

- Add multi-actor, multi-plan stateful campaigns with variable oracle prices,
  pause/deactivation transitions, ownership changes, long missed periods,
  non-standard tokens, and long execution sequences.
- Preserve exact custody and per-mandate exposure invariants under every handler.
- Run deterministic deployment reproduction and explorer verification for the
  final V3 bytecode.
- Complete an independent smart-contract audit and resolve all Critical and High
  findings before mainnet.
- Run a staged testnet beta with unrelated users, operational monitoring, and a
  documented rollback/migration plan.

No V2 limitation is considered fixed until the corresponding V3 implementation,
tests, deployed bytecode, and operational evidence all pass this gate.
