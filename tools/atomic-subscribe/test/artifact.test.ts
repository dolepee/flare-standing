import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertFreshPreviewMatches,
  assertPreviewIntegrity,
  executionClaimPath,
  writePrivateJsonExclusive,
} from "../src/artifact.js";
import type { AtomicSubscribePreview } from "../src/preflight.js";

function preview(overrides: Partial<AtomicSubscribePreview> = {}): AtomicSubscribePreview {
  return {
    network: "Coston2",
    chainId: 114,
    xrplSource: "rSource",
    xrplDestination: "rDestination",
    destinationTag: null,
    personalAccount: "0x1111111111111111111111111111111111111111",
    standing: "0x2222222222222222222222222222222222222222",
    fxrp: "0x3333333333333333333333333333333333333333",
    assetManager: "0x4444444444444444444444444444444444444444",
    plan: {
      id: "4",
      merchant: "0x5555555555555555555555555555555555555555",
      active: true,
      periodSeconds: 86_400,
      priceUsdMicro: "100000",
      priceFxrpAtomic: "0",
    },
    deposit: { display: "1", atomic: "1000000", decimals: 6 },
    nonce: "0",
    payment: {
      netMintUBA: "1000000",
      mintingFeeUBA: "100000",
      executorFeeUBA: "100000",
      totalPaymentUBA: "1200000",
      totalPaymentXrp: "1.2",
    },
    instruction: {
      opcode: "0xFE",
      memoBytes: 42,
      smartAccountExecutorFeeUBA: "0",
      memoData: `0x${"00".repeat(42)}`,
      packedUserOperation: "0x00",
      userOperationHash: `0x${"00".repeat(32)}`,
      calls: [
        { target: "0x3333333333333333333333333333333333333333", value: "0", data: "0x01" },
        { target: "0x2222222222222222222222222222222222222222", value: "0", data: "0x02" },
      ],
    },
    readiness: "READY",
    checks: {
      standingUnpaused: true,
      planActive: true,
      fxrpDecimals: 6,
      personalAccountHasC2Flr: true,
      personalAccountC2FlrAtomic: "1",
    },
    authorization: "NOT_SENT",
    ...overrides,
  };
}

describe("atomic artifact boundary", () => {
  it("accepts only a ready, unsent Coston2 two-call instruction", () => {
    expect(() => assertPreviewIntegrity(preview())).not.toThrow();
    expect(() => assertPreviewIntegrity(preview({ readiness: "BLOCKED" }))).toThrow("blocked");
    expect(() => assertPreviewIntegrity(preview({ destinationTag: 7 as never }))).toThrow("destination tag");
  });

  it("rejects any execution-critical artifact drift", () => {
    const committed = preview();
    expect(() => assertFreshPreviewMatches(committed, preview())).not.toThrow();
    expect(() =>
      assertFreshPreviewMatches(
        committed,
        preview({ payment: { ...committed.payment, totalPaymentUBA: "1200001" } }),
      ),
    ).toThrow("drifted");
    expect(() =>
      assertFreshPreviewMatches(
        committed,
        preview({ xrplDestination: "rChangedDestination" }),
      ),
    ).toThrow("drifted");
  });

  it("allows exactly one process to claim an executor artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standing-atomic-"));
    const claim = join(directory, "execution-claim.json");
    try {
      const results = await Promise.allSettled([
        writePrivateJsonExclusive(claim, { owner: "first" }),
        writePrivateJsonExclusive(claim, { owner: "second" }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(JSON.parse(await readFile(claim, "utf8"))).toHaveProperty("owner");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("scopes claims to a validated XRPL transaction hash", () => {
    const first = "A".repeat(64);
    const second = "B".repeat(64);
    expect(executionClaimPath("sent.json", first)).toBe(
      `sent.json.${first.toLowerCase()}.execution-claim`,
    );
    expect(executionClaimPath("sent.json", first)).not.toBe(executionClaimPath("sent.json", second));
    expect(() => executionClaimPath("sent.json", "../not-a-hash")).toThrow("invalid XRPL transaction hash");
  });
});
