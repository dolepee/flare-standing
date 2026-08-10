import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeFunctionData } from "viem";
import {
  acquireExecutionLock,
  assertFreshPreviewMatches,
  assertPreviewIntegrity,
  executionClaimPath,
  executionLockPath,
  readJson,
  transactionArtifactPath,
  writePrivateJson,
  writePrivateJsonExclusive,
} from "../src/artifact.js";
import { standingAbi } from "../src/abis.js";
import type { AtomicCancelWithdrawPreview } from "../src/control.js";
import type { AtomicSubscribePreview } from "../src/preflight.js";

function preview(overrides: Partial<AtomicSubscribePreview> = {}): AtomicSubscribePreview {
  return {
    operation: "SUBSCRIBE_V2",
    contractVersion: 2,
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
    maxInitialChargeFxrp: { display: "0.2", atomic: "200000", decimals: 6 },
    quotedInitialChargeFxrp: {
      display: "0.1",
      atomic: "100000",
      decimals: 6,
      updatedAt: null,
      source: "FIXED_PLAN",
    },
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
      personalAccountC2FlrRequired: false,
    },
    authorization: "NOT_SENT",
    ...overrides,
  };
}

function controlPreview(callData?: `0x${string}`): AtomicCancelWithdrawPreview {
  const base = preview();
  const mandateId = 5n;
  const remaining = 700_000n;
  return {
    ...base,
    operation: "CANCEL_WITHDRAW",
    instruction: {
      ...base.instruction,
      calls: [{
        target: base.standing,
        value: "0",
        data: callData ?? encodeFunctionData({
          abi: standingAbi,
          functionName: "cancelAndWithdrawExact",
          args: [mandateId, remaining],
        }),
      }],
    },
    control: {
      mandateId: mandateId.toString(),
      alreadyCanceled: false,
      depositedAtomic: "1000000",
      remainingAtomic: remaining.toString(),
      nextChargeAt: "200",
      lastChargeAt: "100",
      action: "CANCEL_AND_WITHDRAW",
      reviewWarning: "test fixture",
    },
    checks: {
      mandateOwnedByPersonalAccount: true,
      remainingBalancePositive: true,
      personalAccountHasC2Flr: true,
      personalAccountC2FlrAtomic: "1",
      personalAccountC2FlrRequired: false,
    },
  } as unknown as AtomicCancelWithdrawPreview;
}

describe("atomic artifact boundary", () => {
  it("accepts only a ready, unsent Coston2 two-call instruction", () => {
    expect(() => assertPreviewIntegrity(preview())).not.toThrow();
    const legacy = { ...preview() } as Record<string, unknown>;
    delete legacy.operation;
    delete legacy.contractVersion;
    delete legacy.maxInitialChargeFxrp;
    expect(() => assertPreviewIntegrity(legacy as unknown as AtomicSubscribePreview)).toThrow("legacy subscription artifact rejected");
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

  it("rejects legacy or amount-drifted cancel calls at the executor boundary", () => {
    expect(() => assertPreviewIntegrity(controlPreview())).not.toThrow();
    expect(() => assertPreviewIntegrity(controlPreview(encodeFunctionData({
      abi: standingAbi,
      functionName: "withdrawMandate",
      args: [5n],
    })))).toThrow("cancelAndWithdrawExact");
    expect(() => assertPreviewIntegrity(controlPreview(encodeFunctionData({
      abi: standingAbi,
      functionName: "cancelAndWithdrawExact",
      args: [5n, 699_999n],
    })))).toThrow("exact remaining balance");
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

  it("holds a fail-closed execution lock so a second live process cannot mutate state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standing-live-lock-"));
    const hash = "A".repeat(64);
    const executorAddress = "0x1111111111111111111111111111111111111111";
    const lockPath = executionLockPath(executorAddress, directory);
    const identity = {
      xrplTransactionHash: hash,
      userOperationHash: `0x${"11".repeat(32)}`,
      executorAddress,
    };
    let holder: ChildProcess | undefined;
    try {
      holder = spawn(
        process.execPath,
        ["--import", "tsx", resolve("test/fixtures/hold-execution-lock.ts"), lockPath, hash, executorAddress],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      await new Promise<void>((resolveReady, rejectReady) => {
        let ready = false;
        holder!.stdout!.once("data", (chunk) => {
          if (String(chunk).includes("LOCKED")) {
            ready = true;
            resolveReady();
          }
        });
        holder!.once("error", rejectReady);
        holder!.once("exit", (code) => {
          if (!ready) rejectReady(new Error(`lock-holder process exited before ready: ${String(code)}`));
        });
      });

      expect(() => acquireExecutionLock(lockPath, {
        ...identity,
        xrplTransactionHash: "B".repeat(64),
        userOperationHash: `0x${"22".repeat(32)}`,
      })).toThrow("already locked");
      const record = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
      expect(record.pid).toBe(holder.pid);

      const exited = once(holder, "exit");
      holder.kill("SIGTERM");
      await exited;
      holder = undefined;
      const resumed = acquireExecutionLock(lockPath, identity);
      resumed.release();
    } finally {
      holder?.kill("SIGTERM");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not change permissions on an existing caller-supplied lock directory", async () => {
    if (process.platform === "win32") return;
    const directory = await mkdtemp(join(tmpdir(), "standing-lock-mode-"));
    const executorAddress = "0x1111111111111111111111111111111111111111";
    try {
      await chmod(directory, 0o755);
      const before = (await stat(directory)).mode & 0o777;
      const lock = acquireExecutionLock(executionLockPath(executorAddress, directory), {
        xrplTransactionHash: "A".repeat(64),
        userOperationHash: `0x${"11".repeat(32)}`,
        executorAddress,
      });
      lock.release();
      expect((await stat(directory)).mode & 0o777).toBe(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("scopes claims to a validated XRPL transaction hash", () => {
    const first = "A".repeat(64);
    const second = "B".repeat(64);
    expect(executionClaimPath(first, "/claims")).toBe(`/claims/coston2-${first.toLowerCase()}.json`);
    expect(executionClaimPath(first, "/claims")).not.toBe(executionClaimPath(second, "/claims"));
    expect(() => executionClaimPath("../not-a-hash", "/claims")).toThrow("invalid XRPL transaction hash");
    const firstExecutor = "0x1111111111111111111111111111111111111111";
    const secondExecutor = "0x2222222222222222222222222222222222222222";
    expect(executionLockPath(firstExecutor, "/locks")).toBe(`/locks/coston2-executor-${firstExecutor}.lock`);
    expect(executionLockPath(firstExecutor, "/locks")).not.toBe(executionLockPath(secondExecutor, "/locks"));
    expect(() => executionLockPath("not-an-address", "/locks")).toThrow("invalid executor address");
  });

  it("writes each payment to a transaction-specific artifact path", () => {
    const first = "A".repeat(64);
    const second = "B".repeat(64);
    expect(transactionArtifactPath("/tmp/sent.json", first)).toBe(
      `/tmp/sent.${first.toLowerCase()}.json`,
    );
    expect(transactionArtifactPath("/tmp/sent.json", first)).not.toBe(
      transactionArtifactPath("/tmp/sent.json", second),
    );
  });

  it("atomically persists and restores bigint-bearing FDC proofs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standing-proof-"));
    const path = join(directory, "state.json");
    try {
      await writePrivateJson(path, {
        phase: "PROOF_READY",
        proof: { data: { responseBody: { receivedAmount: 1_200_000n } } },
      });
      const restored = await readJson<{ proof: { data: { responseBody: { receivedAmount: bigint } } } }>(path);
      expect(restored.proof.data.responseBody.receivedAmount).toBe(1_200_000n);
      expect((await readFile(path, "utf8")).includes("$standingBigInt")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
