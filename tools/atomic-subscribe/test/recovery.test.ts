import { describe, expect, it } from "vitest";
import { decideDelayedMintResume } from "../src/recovery.js";
import type { ExecutionProgress } from "../src/artifact.js";
import type { XrpPaymentProof } from "../src/fdc.js";

const proof = { merkleProof: [], data: {} } as unknown as XrpPaymentProof;
const progress = (kind: "DirectMintingDelayed" | "LargeDirectMintingDelayed"): ExecutionProgress => ({
  phase: "DELAYED",
  proof,
  delay: { kind, executionAllowedAt: "200", observedAt: "2026-08-10T00:00:00.000Z" },
  updatedAt: "2026-08-10T00:00:00.000Z",
});

describe("delayed direct-mint recovery", () => {
  it.each(["DirectMintingDelayed", "LargeDirectMintingDelayed"] as const)(
    "waits without another transaction for %s before allowedAt",
    (kind) => {
      expect(decideDelayedMintResume({
        progress: progress(kind),
        delayState: 1,
        executionAllowedAt: 200n,
        now: 199n,
      })).toEqual({ action: "WAIT", executionAllowedAt: 200n });
    },
  );

  it.each([0, 1, 2])("reuses the persisted proof once delay state %i permits execution", (delayState) => {
    expect(decideDelayedMintResume({
      progress: progress("DirectMintingDelayed"),
      delayState,
      executionAllowedAt: 200n,
      now: 200n,
    })).toEqual({ action: "REUSE_PERSISTED_PROOF" });
  });

  it("refuses to reconstruct or reacquire a missing proof", () => {
    const { proof: _proof, ...missingProof } = progress("DirectMintingDelayed");
    expect(() => decideDelayedMintResume({
      progress: missingProof,
      delayState: 2,
      executionAllowedAt: 200n,
      now: 201n,
    })).toThrow("persisted FDC proof");
  });
});
