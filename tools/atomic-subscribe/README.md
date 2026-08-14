# Standing XRPL-authorized Smart Account tool

This Coston2 tool builds review-first `0xFE` instructions authorized by an XRPL Payment. It has two separate operations:

- **V2 subscribe:** direct-mint XRP into FXRP, approve the reviewed Standing V2 contract, open a mandate, and collect the first bounded charge atomically.
- **Cancel and withdraw:** authorize the XRPL-derived Personal Account to cancel an existing mandate and return its unused FXRP to that same Personal Account.

No command silently upgrades a V1 artifact. Before either preview can report
`READY`, it calls `standingIdentity()` on the supplied contract and requires the
exact V2 version and capability hash. The historical V1 deployment has no such
getter and therefore fails closed before any XRPL authorization can be built or
sent. V2 subscription artifacts must contain `operation: SUBSCRIBE_V2`,
`contractVersion: 2`, the reviewed contract address, and an explicit
`maxInitialChargeFxrp`.

## Review a V2 subscription

There is intentionally no default V2 contract address before a reviewed deployment. Preview requires it explicitly:

```bash
npm install
XRPL_ADDRESS=r... \
PLAN_ID=4 \
DEPOSIT_FXRP=1 \
MAX_INITIAL_CHARGE_FXRP=0.2 \
STANDING_ADDRESS=0x... \
OUTPUT=atomic-subscribe-preview.json \
npm run preview
```

The preview is read-only and sends nothing. It returns `quotedInitialChargeFxrp`: the exact fixed-plan charge or the current fresh FTSO-adapter quote, with source and timestamp. `MAX_INITIAL_CHARGE_FXRP` is the gross first-period FXRP charge (merchant amount plus protocol fee), not merely the merchant's net proceeds. It must cover the displayed quote and must not exceed the deposit. The contract obtains a fresh quote and rechecks this hard bound before pulling any FXRP.

All calls inside the current V2 `0xFE` instruction carry `value=0`. Under Flare's official Smart Account design, the outer executor pays C-chain gas, so an empty Personal Account C2FLR balance is reported for information but does not block this operation.

## Authorize on XRPL, then execute on Coston2

Sending and execution remain separate confirmations:

```bash
PREVIEW_FILE=atomic-subscribe-preview.json \
SENT_FILE=atomic-subscribe-sent.json \
XRPL_SEED=s... \
CONFIRM_SEND='APPROVE STANDING ATOMIC XRPL SUBSCRIPTION' \
npm run send

SENT_FILE=/exact/path/printed/by/send.json \
PRIVATE_KEY=0x... \
VERIFIER_API_KEY_TESTNET=... \
CONFIRM_EXECUTE='APPROVE STANDING ATOMIC FDC EXECUTION' \
npm run execute
```

The XRPL Payment has no destination tag. Its memo is exactly 42 bytes: `0xFE`, wallet id, Smart Account instruction executor fee, and `keccak256(PackedUserOperation)`. The memo instruction fee is zero; AssetManager's separate direct-mint executor fee is included in the reviewed XRP payment amount.

Completion requires all of the following to agree with the preview: `UserOperationExecuted`, `MandateOpened`, `ChargeExecuted`, gross initial charge, stored deposit, stored remaining balance, first-charge time, last-charge time, and next-charge time.

## Durable resume and delayed direct minting

Execution creates a private durable claim keyed by the validated XRPL transaction hash and a separate same-host live-process lock keyed by the executor address, then persists every state transition in the transaction-specific `SENT_FILE`. A second process on that host cannot race the account nonce or overwrite executor state while the first is live. A crash-stale lock is never stolen automatically: confirm the recorded process is dead before removing it. Cross-host processes are coordinated by Coston2's account nonce: each signature is anchored to a finalized block where the executor nonce must exactly equal the prepared nonce. If another host wins that nonce, recovery verifies the anchor, uses a bounded binary search over canonical finalized account state to locate the one consuming transaction, and only then re-signs the same FDC request or persisted proof at a fresh nonce. Missing, malformed, non-finalized, or contradictory RPC history fails closed. Historical signed artifacts created before nonce anchoring remain recoverable only through their exact persisted transaction hash; they are never assigned a synthetic anchor or re-signed when that receipt is absent. FDC request bytes, the signed FDC request transaction, voting round, decoded proof, signed AssetManager transaction, attempts, and delay timestamp survive a restart.

Both `DirectMintingDelayed` and `LargeDirectMintingDelayed` are normal resumable states. Before `executionAllowedAt`, rerunning `npm run execute` sends nothing. After release, the same command reuses the persisted FDC proof and the original packed operation. It never asks for or sends a second XRPL Payment.

Transactions are signed and their deterministic hashes are written durably before broadcast. If the process loses the response after broadcast, a retry rebroadcasts the identical signed bytes and nonce, or reconciles the receipt by the XRPL transaction id. If the exact signed hash remains absent after the authoritative validated ledger advances strictly beyond its `LastLedgerSequence`, that invocation durably records terminal no-delivery expiry and stops. A later explicit rerun must prove the same hash absent beyond expiry again, repeat every live pre-sign check, and only then may autofill and sign a fresh XRPL transaction for the same reviewed operation. Do not delete the claim or edit the artifact to recover execution.

Before XRPL signing, the tool also creates a durable canonical reservation keyed by Coston2 chain id, derived Personal Account, and Smart Account nonce. The reservation binds exactly one `userOperationHash`, so a concurrent subscribe or cancel built at the same nonce fails before signing or paying XRP. Same-operation crash recovery reuses the binding. Reservations are immutable tombstones and are never removed: successful execution advances the on-chain nonce, so later valid operations use a new key, while a stale operation can never become signable after completion cleanup.

The local reservation is backed by a cross-host guard. Before signing, the tool scans the XRPL account's complete validated history through an archival Clio endpoint, checks every canonical Standing payment against Coston2, pins the current XRPL account `Sequence`, then rebuilds the Coston2 preview. The prepared transaction must still carry that exact sequence at signing, so two machines cannot both validate conflicting payments. `XRPL_TESTNET_HISTORY_RPC_URL` may override the history service; it defaults to the official Testnet Clio endpoint. Missing, pruned, incomplete, or unavailable history fails closed and sends no payment.

If a receipt reverts outside a live minting delay, the artifact moves to `RECOVERY_REQUIRED`. Preserve it. Flare's separately XRP-authorized `0xE0` ignore-memo path can release FXRP from a genuinely broken memo, but this executor never manufactures that user authorization automatically. An external `0xE0` recovery does not remove or bypass the immutable local nonce reservation.

## Review-first cancel and unused-FXRP withdrawal

An XRPL classic-address holder cannot directly connect as the derived EVM Personal Account. The control flow therefore builds a new, separately reviewed `0xFE` authorization for one V2 `cancelAndWithdrawExact(mandateId, expectedRemaining)` call. The contract cancels if needed and atomically reverts if a keeper changed the reviewed remaining balance before execution:

```bash
XRPL_ADDRESS=r... \
MANDATE_ID=5 \
AUTHORIZATION_MINT_FXRP=0.1 \
STANDING_ADDRESS=0x... \
PREVIEW_FILE=atomic-cancel-withdraw-preview.json \
npm run control:preview

PREVIEW_FILE=atomic-cancel-withdraw-preview.json \
SENT_FILE=atomic-cancel-withdraw-sent.json \
XRPL_SEED=s... \
CONFIRM_CONTROL_SEND='APPROVE STANDING ATOMIC CANCEL AND WITHDRAW' \
npm run control:send

SENT_FILE=/exact/path/printed/by/control-send.json \
PRIVATE_KEY=0x... \
VERIFIER_API_KEY_TESTNET=... \
CONFIRM_CONTROL_EXECUTE='APPROVE STANDING ATOMIC CANCEL AND WITHDRAW EXECUTION' \
npm run control:execute
```

`AUTHORIZATION_MINT_FXRP` is the requested net FXRP output of a small **new direct mint**, not a fee-free signature and not the total XRP debit. The preview displays its exact XRP payment (including protocol fees), FXRP output, mandate schedule, and observed unused balance before authorization. The observed refund is execution-bound twice: fresh-state validation refuses known drift before signing, and `cancelAndWithdrawExact` atomically reverts if a keeper changes the balance afterward. On success, the receipt must contain an exact matching `MandateWithdrawn` event. The newly minted FXRP and the mandate's unused FXRP end in the same derived Personal Account. This flow does **not** redeem FXRP or return native XRP to the XRPL address, and the executor never receives custody.

This implementation follows Flare's official custom-instruction and FAssets direct-minting semantics. A downstream UserOp revert unwinds the Flare mint-and-call transaction; the original XRPL Payment remains irreversible and must be resumed or recovered from its persisted state.
