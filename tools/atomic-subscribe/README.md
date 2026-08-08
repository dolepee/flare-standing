# Standing atomic subscribe tool

Builds the Coston2 `0xFE` Smart Account instruction for one XRPL payment to:

1. direct-mint XRP into FXRP;
2. approve the Standing contract for the exact minted capacity; and
3. open the selected recurring mandate atomically.

The default command is read-only. It checks live plan, token, fee, nonce, personal-account gas, and direct-mint destination state, then writes an unsigned review artifact. It never sends XRP.

```bash
npm install
XRPL_ADDRESS=r... PLAN_ID=4 DEPOSIT_FXRP=1 npm run preview
```

The send command is deliberately separate. It reads the reviewed artifact, rechecks its network and instruction shape, verifies that `XRPL_SEED` derives the committed source address, and requires the exact `CONFIRM_SEND` phrase before broadcasting. After XRPL validation it writes a private executor artifact named by that transaction hash and prints the exact path. Pass that path as `SENT_FILE` to execution; execution refuses an implicit reusable default.

Execution is a third command with a different authorization phrase. Before spending C2FLR it rebuilds the instruction from fresh Coston2 state and refuses any nonce, plan, destination, token, amount, memo, or calldata drift. It verifies the XRPL transaction itself, obtains an FDC `XRPPayment` proof, calls `executeDirectMintingWithData`, and only reports completion when the receipt contains the matching `UserOperationExecuted` and `MandateOpened` events.

Immediately before requesting the paid FDC proof, execution atomically creates an exclusive claim in `~/.config/flare-standing/atomic-execution-claims`, keyed only by Coston2 and the validated XRPL transaction hash, and marks the transaction-specific sent artifact `IN_PROGRESS`. Copies of the same payment therefore share one replay boundary regardless of input path, while later payments receive independent state and claims. If execution is interrupted after that transition, do not remove the claim or reset the artifact blindly: first reconcile the FDC request, AssetManager transaction, personal-account nonce, and Standing mandate on-chain. Resume or use Flare's canonical `0xE0` recovery only from that verified state.

The XRPL payment must have no destination tag. Its memo is exactly 42 bytes: `0xFE`, wallet id, Smart Account instruction executor fee, and `keccak256(PackedUserOperation)`. The instruction fee is zero in Flare's official 0xFE starter. It is distinct from AssetManager's nonzero direct-mint executor fee, which is added to the XRP payment amount.

This implementation follows Flare's official `flare-viem-starter` custom-instruction flow at commit `47d5c5341254140e63fa60c2d497bf3aa4a875c8`. The executor obtains the FDC `XRPPayment` proof and calls `AssetManagerFXRP.executeDirectMintingWithData` with the full packed operation. If downstream execution reverts, the mint is atomic: no mandate is opened and recovery uses Flare's canonical `0xE0` skip-memo flow.
