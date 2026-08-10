import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet, type Payment } from "xrpl";
import { afterAll, describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import {
  readJson,
  transactionArtifactPath,
  writePrivateJson,
  type AtomicOperationPreview,
  type SentAtomicSubscribe,
} from "../src/artifact.js";
import { standingAbi } from "../src/abis.js";
import {
  runDurableXrplPayment,
  xrplPaymentLockPath,
  xrplPaymentStatePath,
  type XrplPaymentState,
  type XrplTransactionOutcome,
} from "../src/xrpl-payment-state.js";

type Operation = "SUBSCRIBE_V2" | "CANCEL_WITHDRAW";

const originalHome = process.env.HOME;
const paymentTestHome = await mkdtemp(join(tmpdir(), "standing-payment-home-"));
process.env.HOME = paymentTestHome;

afterAll(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(paymentTestHome, { recursive: true, force: true });
});

function operationPreview(operation: Operation, xrplSource: string): AtomicOperationPreview {
  const shared = {
    network: "Coston2" as const,
    chainId: 114 as const,
    xrplSource,
    xrplDestination: Wallet.generate().address,
    destinationTag: null,
    personalAccount: "0x1111111111111111111111111111111111111111" as const,
    standing: "0x2222222222222222222222222222222222222222" as const,
    fxrp: "0x3333333333333333333333333333333333333333" as const,
    assetManager: "0x4444444444444444444444444444444444444444" as const,
    plan: {
      id: "4",
      merchant: "0x5555555555555555555555555555555555555555" as const,
      active: true as const,
      periodSeconds: 86_400,
      priceUsdMicro: "0",
      priceFxrpAtomic: "100000",
    },
    deposit: { display: "1", atomic: "1000000", decimals: 6 },
    nonce: "7",
    payment: {
      netMintUBA: "1000000",
      mintingFeeUBA: "100000",
      executorFeeUBA: "100000",
      totalPaymentUBA: "1200000",
      totalPaymentXrp: "1.2",
    },
    instruction: {
      opcode: "0xFE" as const,
      memoBytes: 42 as const,
      smartAccountExecutorFeeUBA: "0" as const,
      memoData: `0x${"ab".repeat(42)}` as `0x${string}`,
      packedUserOperation: "0x1234" as const,
      userOperationHash: `0x${(operation === "SUBSCRIBE_V2" ? "11" : "22").repeat(32)}` as `0x${string}`,
      calls: [
        { target: "0x3333333333333333333333333333333333333333" as const, value: "0" as const, data: "0x01" as const },
        { target: "0x2222222222222222222222222222222222222222" as const, value: "0" as const, data: "0x02" as const },
      ],
    },
    readiness: "READY" as const,
    authorization: "NOT_SENT" as const,
  };

  if (operation === "SUBSCRIBE_V2") {
    return {
      ...shared,
      operation,
      contractVersion: 2,
      maxInitialChargeFxrp: { display: "0.1", atomic: "100000", decimals: 6 },
      quotedInitialChargeFxrp: {
        display: "0.1",
        atomic: "100000",
        decimals: 6,
        updatedAt: null,
        source: "FIXED_PLAN",
      },
      checks: {
        standingUnpaused: true,
        planActive: true,
        fxrpDecimals: 6,
        personalAccountHasC2Flr: false,
        personalAccountC2FlrAtomic: "0",
        personalAccountC2FlrRequired: false,
      },
    };
  }

  return {
    ...shared,
    operation,
    instruction: {
      ...shared.instruction,
      calls: [{
        target: shared.standing,
        value: "0" as const,
        data: encodeFunctionData({
          abi: standingAbi,
          functionName: "cancelAndWithdrawExact",
          args: [5n, 900_000n],
        }),
      }],
    },
    control: {
      mandateId: "5",
      alreadyCanceled: false,
      depositedAtomic: "1000000",
      remainingAtomic: "900000",
      nextChargeAt: "100",
      lastChargeAt: "90",
      action: "CANCEL_AND_WITHDRAW",
      reviewWarning: "test authorization",
    },
    checks: {
      mandateOwnedByPersonalAccount: true,
      remainingBalancePositive: true,
      personalAccountHasC2Flr: false,
      personalAccountC2FlrAtomic: "0",
      personalAccountC2FlrRequired: false,
    },
  };
}

function preparedPayment(wallet: Wallet, preview: AtomicOperationPreview): Payment {
  return {
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: preview.xrplDestination,
    Amount: preview.payment.totalPaymentUBA,
    Sequence: 1,
    Fee: "12",
    LastLedgerSequence: 100,
    Memos: [{ Memo: { MemoData: preview.instruction.memoData.slice(2) } }],
  };
}

function success(hash: string): XrplTransactionOutcome {
  return { hash, validated: true, transactionResult: "tesSUCCESS" };
}

async function fixture(operation: Operation) {
  const directory = await mkdtemp(join(tmpdir(), `standing-${operation.toLowerCase()}-`));
  const wallet = Wallet.generate();
  const preview = operationPreview(operation, wallet.address);
  const transaction = preparedPayment(wallet, preview);
  const signed = wallet.sign(transaction);
  const outputBasePath = join(directory, "sent.json");
  return { directory, wallet, preview, transaction, signed, outputBasePath };
}

describe("durable XRPL payment state", () => {
  it("keys the app-owned recovery journal by validated XRPL source and reviewed operation", () => {
    const xrplSource = Wallet.generate().address;
    expect(xrplPaymentStatePath(xrplSource, `0x${"ab".repeat(32)}`)).toBe(
      join(
        paymentTestHome,
        ".config",
        "flare-standing",
        "atomic-xrpl-payments",
        `xrpl-${xrplSource}-${"ab".repeat(32)}.state.json`,
      ),
    );
    expect(() => xrplPaymentStatePath("not-an-xrpl-address", `0x${"ab".repeat(32)}`)).toThrow(
      "preview XRPL source is not a valid classic address",
    );
  });

  describe.each<Operation>(["SUBSCRIBE_V2", "CANCEL_WITHDRAW"])("%s", (operation) => {
    it("persists PREPARED before signing and deterministically resumes a crash during signing", async () => {
      const value = await fixture(operation);
      let prepares = 0;
      let signs = 0;
      const signedBlobs: string[] = [];
      try {
        const run = (crashDuringSign: boolean) =>
          runDurableXrplPayment<Payment>({
            preview: value.preview,
            outputBasePath: value.outputBasePath,
            validateBeforeSigning: async () => undefined,
            prepareTransaction: async () => {
              prepares += 1;
              return value.transaction;
            },
            signTransaction: (transaction) => {
              signs += 1;
              const signed = value.wallet.sign(transaction);
              signedBlobs.push(signed.tx_blob);
              if (crashDuringSign) throw new Error("simulated crash after signing, before persistence");
              return signed;
            },
            getValidatedLedgerIndex: async () => 99,
            lookupTransaction: async () => null,
            broadcastAndWait: async () => success(value.signed.hash),
          });

        await expect(run(true)).rejects.toThrow("simulated crash");
        const statePath = xrplPaymentStatePath(value.preview.xrplSource, value.preview.instruction.userOperationHash);
        expect((await readJson<XrplPaymentState>(statePath)).phase).toBe("PREPARED");

        const completed = await run(false);
        expect(completed.xrplTransactionHash).toBe(value.signed.hash);
        expect(prepares).toBe(1);
        expect(signs).toBe(2);
        expect(signedBlobs[0]).toBe(signedBlobs[1]);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("rebuilds an expired PREPARED transaction after a crash without reusing stale bytes", async () => {
      const value = await fixture(operation);
      const replacementTransaction: Payment = {
        ...value.transaction,
        Sequence: 2,
        LastLedgerSequence: 200,
      };
      const replacementSigned = value.wallet.sign(replacementTransaction);
      let prepares = 0;
      let signs = 0;
      const signedBlobs: string[] = [];
      let crashDuringReplacementSign = true;
      let ledgerReads = 0;
      let broadcasts = 0;
      try {
        const run = () =>
          runDurableXrplPayment<Payment>({
            preview: value.preview,
            outputBasePath: value.outputBasePath,
            validateBeforeSigning: async () => undefined,
            prepareTransaction: async () => {
              prepares += 1;
              return prepares === 1 ? value.transaction : replacementTransaction;
            },
            signTransaction: (transaction) => {
              signs += 1;
              const signed = value.wallet.sign(transaction);
              signedBlobs.push(signed.tx_blob);
              if (crashDuringReplacementSign) throw new Error("simulated crash after replacement signing");
              return signed;
            },
            getValidatedLedgerIndex: async () => {
              ledgerReads += 1;
              if (ledgerReads === 1) throw new Error("simulated crash before signing");
              return 101;
            },
            lookupTransaction: async () => null,
            broadcastAndWait: async (blob) => {
              broadcasts += 1;
              expect(blob).toBe(replacementSigned.tx_blob);
              expect(blob).not.toBe(value.signed.tx_blob);
              return success(replacementSigned.hash);
            },
          });

        await expect(run()).rejects.toThrow("simulated crash before signing");
        const statePath = xrplPaymentStatePath(value.preview.xrplSource, value.preview.instruction.userOperationHash);
        const crashedState = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(crashedState.phase).toBe("PREPARED");
        if (crashedState.phase === "PREPARED") {
          expect(crashedState.preparedTransaction.LastLedgerSequence).toBe(100);
        }

        await expect(run()).rejects.toThrow("simulated crash after replacement signing");
        const refreshedState = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(refreshedState.phase).toBe("PREPARED");
        expect(refreshedState.preparedTransaction.LastLedgerSequence).toBe(200);

        crashDuringReplacementSign = false;
        const completed = await run();
        expect(completed.xrplTransactionHash).toBe(replacementSigned.hash);
        expect(prepares).toBe(2);
        expect(signs).toBe(2);
        expect(signedBlobs).toEqual([replacementSigned.tx_blob, replacementSigned.tx_blob]);
        expect(broadcasts).toBe(1);
        const completedState = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(completedState.phase).toBe("VALIDATED");
        expect(completedState.preparedTransaction.LastLedgerSequence).toBe(200);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("serializes concurrent replacement of the same expired PREPARED payment", async () => {
      const value = await fixture(operation);
      const secondOutputBasePath = join(value.directory, "alternate-sent.json");
      const firstReplacement: Payment = {
        ...value.transaction,
        Sequence: 2,
        LastLedgerSequence: 200,
      };
      const secondReplacement: Payment = {
        ...value.transaction,
        Sequence: 3,
        LastLedgerSequence: 200,
      };
      const firstSigned = value.wallet.sign(firstReplacement);
      let releaseFirstReplacement!: () => void;
      const firstReplacementMayFinish = new Promise<void>((resolve) => {
        releaseFirstReplacement = resolve;
      });
      let announceFirstReplacement!: () => void;
      const firstReplacementStarted = new Promise<void>((resolve) => {
        announceFirstReplacement = resolve;
      });
      let firstPrepares = 0;
      let firstSigns = 0;
      let firstBroadcasts = 0;
      let secondPrepares = 0;
      let secondSigns = 0;
      let secondBroadcasts = 0;
      let first: Promise<Awaited<ReturnType<typeof runDurableXrplPayment<Payment>>>> | undefined;

      try {
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => undefined,
          prepareTransaction: async () => value.transaction,
          signTransaction: (transaction) => value.wallet.sign(transaction),
          getValidatedLedgerIndex: async () => {
            throw new Error("simulated crash with PREPARED durable");
          },
          lookupTransaction: async () => null,
          broadcastAndWait: async () => {
            throw new Error("must not broadcast during setup");
          },
        })).rejects.toThrow("simulated crash with PREPARED durable");

        first = runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => undefined,
          prepareTransaction: async () => {
            firstPrepares += 1;
            announceFirstReplacement();
            await firstReplacementMayFinish;
            return firstReplacement;
          },
          signTransaction: (transaction) => {
            firstSigns += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 101,
          lookupTransaction: async () => null,
          broadcastAndWait: async (blob) => {
            firstBroadcasts += 1;
            expect(blob).toBe(firstSigned.tx_blob);
            return success(firstSigned.hash);
          },
        });

        await firstReplacementStarted;
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: secondOutputBasePath,
          validateBeforeSigning: async () => undefined,
          prepareTransaction: async () => {
            secondPrepares += 1;
            return secondReplacement;
          },
          signTransaction: (transaction) => {
            secondSigns += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 101,
          lookupTransaction: async () => null,
          broadcastAndWait: async () => {
            secondBroadcasts += 1;
            return success(value.wallet.sign(secondReplacement).hash);
          },
        })).rejects.toThrow("XRPL payment state is already locked");

        releaseFirstReplacement();
        const completed = await first;
        expect(completed.xrplTransactionHash).toBe(firstSigned.hash);
        expect(firstPrepares).toBe(1);
        expect(firstSigns).toBe(1);
        expect(firstBroadcasts).toBe(1);
        expect(secondPrepares).toBe(0);
        expect(secondSigns).toBe(0);
        expect(secondBroadcasts).toBe(0);
        const state = await readJson<XrplPaymentState<Payment>>(completed.statePath);
        expect(state.phase).toBe("VALIDATED");
        if (state.phase === "VALIDATED") {
          expect(state.xrplTransactionHash).toBe(firstSigned.hash);
          expect(state.preparedTransaction.Sequence).toBe(2);
        }
        await expect(access(xrplPaymentLockPath(value.preview.xrplSource, value.preview.instruction.userOperationHash))).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        releaseFirstReplacement();
        await first?.catch(() => undefined);
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("reconciles a sequential replay under a different output path without paying again", async () => {
      const value = await fixture(operation);
      const secondOutputBasePath = join(value.directory, "alternate-sent.json");
      let prepares = 0;
      let signs = 0;
      let lookups = 0;
      let broadcasts = 0;
      try {
        const first = await runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => undefined,
          prepareTransaction: async () => {
            prepares += 1;
            return value.transaction;
          },
          signTransaction: (transaction) => {
            signs += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 99,
          lookupTransaction: async () => {
            lookups += 1;
            return null;
          },
          broadcastAndWait: async () => {
            broadcasts += 1;
            return success(value.signed.hash);
          },
        });

        const replayed = await runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: secondOutputBasePath,
          validateBeforeSigning: async () => {
            throw new Error("validated replay must not revalidate before signing");
          },
          prepareTransaction: async () => {
            throw new Error("validated replay must not prepare another payment");
          },
          signTransaction: () => {
            throw new Error("validated replay must not sign another payment");
          },
          getValidatedLedgerIndex: async () => {
            throw new Error("validated replay must not query ledger expiry");
          },
          lookupTransaction: async () => {
            throw new Error("validated replay must not look up a second payment");
          },
          broadcastAndWait: async () => {
            throw new Error("validated replay must not broadcast another payment");
          },
        });

        expect(replayed.resumed).toBe(true);
        expect(replayed.xrplTransactionHash).toBe(first.xrplTransactionHash);
        expect(replayed.statePath).toBe(first.statePath);
        expect(replayed.sentArtifactPath).toBe(first.sentArtifactPath);
        expect(prepares).toBe(1);
        expect(signs).toBe(1);
        expect(lookups).toBe(1);
        expect(broadcasts).toBe(1);
        const state = await readJson<XrplPaymentState<Payment>>(replayed.statePath);
        expect(state.sentArtifactBasePath).toBe(value.outputBasePath);
        await expect(access(transactionArtifactPath(secondOutputBasePath, first.xrplTransactionHash))).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("resumes the persisted SIGNED bytes after a crash before broadcast", async () => {
      const value = await fixture(operation);
      let prepares = 0;
      let signs = 0;
      let broadcasts = 0;
      let crashBeforeBroadcast = true;
      try {
        const run = () =>
          runDurableXrplPayment<Payment>({
            preview: value.preview,
            outputBasePath: value.outputBasePath,
            validateBeforeSigning: async () => undefined,
            prepareTransaction: async () => {
              prepares += 1;
              return value.transaction;
            },
            signTransaction: (transaction) => {
              signs += 1;
              return value.wallet.sign(transaction);
            },
            getValidatedLedgerIndex: async () => 99,
            lookupTransaction: async () => {
              if (crashBeforeBroadcast) throw new Error("simulated crash before broadcast");
              return null;
            },
            broadcastAndWait: async (blob) => {
              broadcasts += 1;
              expect(blob).toBe(value.signed.tx_blob);
              return success(value.signed.hash);
            },
          });

        await expect(run()).rejects.toThrow("simulated crash before broadcast");
        const statePath = xrplPaymentStatePath(value.preview.xrplSource, value.preview.instruction.userOperationHash);
        const signedState = await readJson<XrplPaymentState>(statePath);
        expect(signedState.phase).toBe("SIGNED");
        if (signedState.phase === "SIGNED") expect(signedState.signedTransactionBlob).toBe(value.signed.tx_blob);

        crashBeforeBroadcast = false;
        await run();
        expect(prepares).toBe(1);
        expect(signs).toBe(1);
        expect(broadcasts).toBe(1);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("preserves an expired SIGNED transaction and refuses to replace or rebroadcast it", async () => {
      const value = await fixture(operation);
      let prepares = 0;
      let signs = 0;
      let currentLedger = 99;
      let crashBeforeBroadcast = true;
      let broadcasts = 0;
      try {
        const run = () =>
          runDurableXrplPayment<Payment>({
            preview: value.preview,
            outputBasePath: value.outputBasePath,
            validateBeforeSigning: async () => undefined,
            prepareTransaction: async () => {
              prepares += 1;
              return value.transaction;
            },
            signTransaction: (transaction) => {
              signs += 1;
              return value.wallet.sign(transaction);
            },
            getValidatedLedgerIndex: async () => currentLedger,
            lookupTransaction: async () => {
              if (crashBeforeBroadcast) throw new Error("simulated crash before broadcast");
              return null;
            },
            broadcastAndWait: async () => {
              broadcasts += 1;
              throw new Error("expired signed bytes must not be rebroadcast");
            },
          });

        await expect(run()).rejects.toThrow("simulated crash before broadcast");
        const statePath = xrplPaymentStatePath(value.preview.xrplSource, value.preview.instruction.userOperationHash);
        const signedBeforeExpiry = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(signedBeforeExpiry.phase).toBe("SIGNED");
        if (signedBeforeExpiry.phase === "SIGNED") {
          expect(signedBeforeExpiry.signedTransactionBlob).toBe(value.signed.tx_blob);
        }

        crashBeforeBroadcast = false;
        currentLedger = 101;
        await expect(run()).rejects.toThrow(/persisted SIGNED XRPL transaction .* expired at ledger 100/);

        const signedAfterExpiry = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(signedAfterExpiry).toEqual(signedBeforeExpiry);
        expect(prepares).toBe(1);
        expect(signs).toBe(1);
        expect(broadcasts).toBe(0);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("reconciles an accepted payment after the broadcast response is lost even after expiry", async () => {
      const value = await fixture(operation);
      const ledger = new Map<string, XrplTransactionOutcome>();
      let prepares = 0;
      let signs = 0;
      let broadcasts = 0;
      let currentLedger = 99;
      try {
        const run = () =>
          runDurableXrplPayment<Payment>({
            preview: value.preview,
            outputBasePath: value.outputBasePath,
            validateBeforeSigning: async () => undefined,
            prepareTransaction: async () => {
              prepares += 1;
              return value.transaction;
            },
            signTransaction: (transaction) => {
              signs += 1;
              return value.wallet.sign(transaction);
            },
            getValidatedLedgerIndex: async () => currentLedger,
            lookupTransaction: async (hash) => ledger.get(hash) ?? null,
            broadcastAndWait: async (blob) => {
              broadcasts += 1;
              expect(blob).toBe(value.signed.tx_blob);
              ledger.set(value.signed.hash, success(value.signed.hash));
              throw new Error("simulated lost response after XRPL accepted payment");
            },
          });

        await expect(run()).rejects.toThrow("simulated lost response");
        currentLedger = 101;
        const recovered = await run();
        expect(recovered.resumed).toBe(true);
        expect(prepares).toBe(1);
        expect(signs).toBe(1);
        expect(broadcasts).toBe(1);
        expect((await readJson<XrplPaymentState>(recovered.statePath)).phase).toBe("VALIDATED");
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("rebroadcasts the identical signed transaction when the first attempt was not accepted", async () => {
      const value = await fixture(operation);
      const blobs: string[] = [];
      let attempts = 0;
      let signs = 0;
      try {
        const run = () =>
          runDurableXrplPayment<Payment>({
            preview: value.preview,
            outputBasePath: value.outputBasePath,
            validateBeforeSigning: async () => undefined,
            prepareTransaction: async () => value.transaction,
            signTransaction: (transaction) => {
              signs += 1;
              return value.wallet.sign(transaction);
            },
            getValidatedLedgerIndex: async () => 99,
            lookupTransaction: async () => null,
            broadcastAndWait: async (blob) => {
              blobs.push(blob);
              attempts += 1;
              if (attempts === 1) throw new Error("simulated disconnect before acceptance");
              return success(value.signed.hash);
            },
          });

        await expect(run()).rejects.toThrow("simulated disconnect");
        await run();
        expect(signs).toBe(1);
        expect(blobs).toEqual([value.signed.tx_blob, value.signed.tx_blob]);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("recreates a lost executor artifact from VALIDATED state without touching XRPL", async () => {
      const value = await fixture(operation);
      let lookups = 0;
      let broadcasts = 0;
      try {
        const run = () =>
          runDurableXrplPayment<Payment>({
            preview: value.preview,
            outputBasePath: value.outputBasePath,
            validateBeforeSigning: async () => undefined,
            prepareTransaction: async () => value.transaction,
            signTransaction: (transaction) => value.wallet.sign(transaction),
            getValidatedLedgerIndex: async () => 99,
            lookupTransaction: async () => {
              lookups += 1;
              return null;
            },
            broadcastAndWait: async () => {
              broadcasts += 1;
              return success(value.signed.hash);
            },
          });

        const first = await run();
        await rm(first.sentArtifactPath);
        const resumed = await run();
        await expect(access(resumed.sentArtifactPath)).resolves.toBeUndefined();
        expect(lookups).toBe(1);
        expect(broadcasts).toBe(1);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("never rewinds an executor artifact that has progressed past PENDING", async () => {
      const value = await fixture(operation);
      try {
        const input = {
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => undefined,
          prepareTransaction: async () => value.transaction,
          signTransaction: (transaction: Payment) => value.wallet.sign(transaction),
          getValidatedLedgerIndex: async () => 99,
          lookupTransaction: async () => null,
          broadcastAndWait: async () => success(value.signed.hash),
        };
        const first = await runDurableXrplPayment<Payment>(input);
        const pending = await readJson<SentAtomicSubscribe>(first.sentArtifactPath);
        await writePrivateJson(first.sentArtifactPath, {
          version: 1,
          preview: pending.preview,
          xrplTransactionHash: pending.xrplTransactionHash,
          sentAt: pending.sentAt,
          execution: "COMPLETE",
          executorTransactionHash: `0x${"33".repeat(32)}`,
          mandateId: "9",
          completedAt: "2026-08-10T18:00:00.000Z",
        } satisfies SentAtomicSubscribe);

        await runDurableXrplPayment<Payment>(input);
        expect((await readJson<SentAtomicSubscribe>(first.sentArtifactPath)).execution).toBe("COMPLETE");
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });
  });
});
