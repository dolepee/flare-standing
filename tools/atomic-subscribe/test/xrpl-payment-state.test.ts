import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet, type Payment } from "xrpl";
import { afterAll, afterEach, describe, expect, it } from "vitest";
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
  reserveUserOperationNonce,
  userOperationNonceReservationPath,
  xrplPaymentLockPath,
  xrplPaymentStatePath,
  type UserOperationNonceReservation,
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

afterEach(async () => {
  await rm(join(paymentTestHome, ".config", "flare-standing", "atomic-userop-nonce-reservations"), {
    recursive: true,
    force: true,
  });
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

function terminalFailure(hash: string, transactionResult = "tecUNFUNDED_PAYMENT"): XrplTransactionOutcome {
  return { hash, validated: true, transactionResult };
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

function withDistinctUserOperation(
  preview: AtomicOperationPreview,
  hashByte: string,
): AtomicOperationPreview {
  return {
    ...preview,
    instruction: {
      ...preview.instruction,
      memoData: `0x${hashByte.repeat(42)}` as `0x${string}`,
      packedUserOperation: `0x${hashByte.repeat(4)}` as `0x${string}`,
      userOperationHash: `0x${hashByte.repeat(32)}` as `0x${string}`,
    },
  };
}

async function expectConcurrentNonceReservation(
  secondOperation: Operation,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), `standing-subscribe-${secondOperation.toLowerCase()}-race-`));
  const wallet = Wallet.generate();
  const firstPreview = operationPreview("SUBSCRIBE_V2", wallet.address);
  const secondBase = operationPreview(secondOperation, wallet.address);
  const secondPreview = secondOperation === "SUBSCRIBE_V2"
    ? withDistinctUserOperation(secondBase, "33")
    : secondBase;
  const firstTransaction = preparedPayment(wallet, firstPreview);
  const secondTransaction = preparedPayment(wallet, secondPreview);
  const firstSigned = wallet.sign(firstTransaction);
  let announceFirstSigned!: () => void;
  const firstSignedAndReserved = new Promise<void>((resolve) => {
    announceFirstSigned = resolve;
  });
  let releaseFirst!: () => void;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let secondValidations = 0;
  let secondPrepares = 0;
  let secondSigns = 0;
  let secondLookups = 0;
  let secondBroadcasts = 0;
  let first: Promise<Awaited<ReturnType<typeof runDurableXrplPayment<Payment>>>> | undefined;

  try {
    first = runDurableXrplPayment<Payment>({
      preview: firstPreview,
      outputBasePath: join(directory, "first-sent.json"),
      validateBeforeSigning: async () => undefined,
      prepareTransaction: async () => firstTransaction,
      signTransaction: (transaction) => wallet.sign(transaction),
      getValidatedLedgerIndex: async () => 99,
      lookupTransaction: async () => {
        announceFirstSigned();
        await firstMayFinish;
        return null;
      },
      broadcastAndWait: async (blob) => {
        expect(blob).toBe(firstSigned.tx_blob);
        return success(firstSigned.hash);
      },
    });

    await firstSignedAndReserved;
    await expect(runDurableXrplPayment<Payment>({
      preview: secondPreview,
      outputBasePath: join(directory, "second-sent.json"),
      validateBeforeSigning: async () => {
        secondValidations += 1;
      },
      prepareTransaction: async () => {
        secondPrepares += 1;
        return secondTransaction;
      },
      signTransaction: (transaction) => {
        secondSigns += 1;
        return wallet.sign(transaction);
      },
      getValidatedLedgerIndex: async () => 99,
      lookupTransaction: async () => {
        secondLookups += 1;
        return null;
      },
      broadcastAndWait: async () => {
        secondBroadcasts += 1;
        return success(wallet.sign(secondTransaction).hash);
      },
    })).rejects.toThrow("already reserved");

    expect(secondValidations).toBe(1);
    expect(secondPrepares).toBe(1);
    expect(secondSigns).toBe(0);
    expect(secondLookups).toBe(0);
    expect(secondBroadcasts).toBe(0);
    const reservation = await readJson<{ userOperationHash: string }>(userOperationNonceReservationPath(
      firstPreview.chainId,
      firstPreview.personalAccount,
      firstPreview.nonce,
    ));
    expect(reservation.userOperationHash).toBe(firstPreview.instruction.userOperationHash);

    releaseFirst();
    await first;
  } finally {
    releaseFirst();
    await first?.catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
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

  it("atomically reserves the canonical chain, Personal Account, and nonce key", async () => {
    const wallet = Wallet.generate();
    const preview = operationPreview("SUBSCRIBE_V2", wallet.address);
    const path = userOperationNonceReservationPath(preview.chainId, preview.personalAccount, "007");
    expect(path).toBe(join(
      paymentTestHome,
      ".config",
      "flare-standing",
      "atomic-userop-nonce-reservations",
      `chain-114-personal-${preview.personalAccount}-nonce-7.json`,
    ));
    expect((await reserveUserOperationNonce(preview)).resumed).toBe(false);
    expect((await reserveUserOperationNonce(preview)).resumed).toBe(true);
    await expect(reserveUserOperationNonce(withDistinctUserOperation(preview, "33"))).rejects.toThrow("already reserved");
    await expect(access(path)).resolves.toBeUndefined();
  });

  it("rejects concurrent SUBSCRIBE/SUBSCRIBE operations at one nonce before the second XRPL signature", async () => {
    await expectConcurrentNonceReservation("SUBSCRIBE_V2");
  });

  it("rejects concurrent SUBSCRIBE/CANCEL operations at one nonce before the cancel XRPL signature", async () => {
    await expectConcurrentNonceReservation("CANCEL_WITHDRAW");
  });

  it("keeps the winning nonce tombstone after completion so a prepared stale operation still cannot sign", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standing-completion-reservation-race-"));
    const wallet = Wallet.generate();
    const winningPreview = operationPreview("SUBSCRIBE_V2", wallet.address);
    const stalePreview = withDistinctUserOperation(operationPreview("SUBSCRIBE_V2", wallet.address), "33");
    const winningTransaction = preparedPayment(wallet, winningPreview);
    const staleTransaction = preparedPayment(wallet, stalePreview);
    const winningSigned = wallet.sign(winningTransaction);
    let announceWinnerReserved!: () => void;
    const winnerReserved = new Promise<void>((resolve) => {
      announceWinnerReserved = resolve;
    });
    let finishWinner!: () => void;
    const winnerMayFinish = new Promise<void>((resolve) => {
      finishWinner = resolve;
    });
    let announceStalePrepared!: () => void;
    const stalePrepared = new Promise<void>((resolve) => {
      announceStalePrepared = resolve;
    });
    let continueStale!: () => void;
    const staleMayContinue = new Promise<void>((resolve) => {
      continueStale = resolve;
    });
    let staleSigns = 0;
    let staleLookups = 0;
    let staleBroadcasts = 0;
    let winner: Promise<Awaited<ReturnType<typeof runDurableXrplPayment<Payment>>>> | undefined;
    let stale: Promise<Awaited<ReturnType<typeof runDurableXrplPayment<Payment>>>> | undefined;

    try {
      winner = runDurableXrplPayment<Payment>({
        preview: winningPreview,
        outputBasePath: join(directory, "winner-sent.json"),
        validateBeforeSigning: async () => undefined,
        prepareTransaction: async () => winningTransaction,
        signTransaction: (transaction) => wallet.sign(transaction),
        getValidatedLedgerIndex: async () => 99,
        lookupTransaction: async () => {
          announceWinnerReserved();
          await winnerMayFinish;
          return null;
        },
        broadcastAndWait: async () => success(winningSigned.hash),
      });
      await winnerReserved;

      stale = runDurableXrplPayment<Payment>({
        preview: stalePreview,
        outputBasePath: join(directory, "stale-sent.json"),
        validateBeforeSigning: async () => undefined,
        prepareTransaction: async () => staleTransaction,
        signTransaction: (transaction) => {
          staleSigns += 1;
          return wallet.sign(transaction);
        },
        getValidatedLedgerIndex: async () => {
          announceStalePrepared();
          await staleMayContinue;
          return 99;
        },
        lookupTransaction: async () => {
          staleLookups += 1;
          return null;
        },
        broadcastAndWait: async () => {
          staleBroadcasts += 1;
          return success(wallet.sign(staleTransaction).hash);
        },
      });
      const staleRejection = expect(stale).rejects.toThrow("already reserved");
      await stalePrepared;

      finishWinner();
      const completedPayment = await winner;
      const pending = await readJson<SentAtomicSubscribe>(completedPayment.sentArtifactPath);
      const complete = {
        version: 1,
        preview: pending.preview,
        xrplTransactionHash: pending.xrplTransactionHash,
        sentAt: pending.sentAt,
        execution: "COMPLETE",
        executorTransactionHash: `0x${"44".repeat(32)}`,
        mandateId: "9",
        completedAt: "2026-08-10T18:01:00.000Z",
      } satisfies SentAtomicSubscribe;
      await writePrivateJson(completedPayment.sentArtifactPath, complete);

      continueStale();
      await staleRejection;
      expect(staleSigns).toBe(0);
      expect(staleLookups).toBe(0);
      expect(staleBroadcasts).toBe(0);
      const reservationPath = userOperationNonceReservationPath(
        winningPreview.chainId,
        winningPreview.personalAccount,
        winningPreview.nonce,
      );
      await expect(access(reservationPath)).resolves.toBeUndefined();
      expect((await readJson<UserOperationNonceReservation>(reservationPath)).userOperationHash)
        .toBe(winningPreview.instruction.userOperationHash);
    } finally {
      finishWinner();
      continueStale();
      await winner?.catch(() => undefined);
      await stale?.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes explicit recovery from terminal no-delivery expiry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "standing-expired-payment-recovery-race-"));
    const wallet = Wallet.generate();
    const preview = operationPreview("SUBSCRIBE_V2", wallet.address);
    const transaction = preparedPayment(wallet, preview);
    const signed = wallet.sign(transaction);
    const replacementTransaction: Payment = {
      ...transaction,
      Fee: "13",
      LastLedgerSequence: 200,
    };
    const replacementSigned = wallet.sign(replacementTransaction);
    const outputBasePath = join(directory, "sent.json");
    let announcePreparation!: () => void;
    const preparationStarted = new Promise<void>((resolve) => {
      announcePreparation = resolve;
    });
    let releasePreparation!: () => void;
    const preparationMayFinish = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    let winnerValidations = 0;
    let winnerPrepares = 0;
    let winnerSigns = 0;
    let winnerLookups = 0;
    let winnerBroadcasts = 0;
    let loserValidations = 0;
    let loserPrepares = 0;
    let loserSigns = 0;
    let loserLedgerReads = 0;
    let loserLookups = 0;
    let loserBroadcasts = 0;
    let winner: Promise<Awaited<ReturnType<typeof runDurableXrplPayment<Payment>>>> | undefined;

    try {
      await expect(runDurableXrplPayment<Payment>({
        preview,
        outputBasePath,
        validateBeforeSigning: async () => undefined,
        prepareTransaction: async () => transaction,
        signTransaction: (prepared) => wallet.sign(prepared),
        getValidatedLedgerIndex: async () => 99,
        lookupTransaction: async () => {
          throw new Error("simulated crash before broadcast");
        },
        broadcastAndWait: async () => {
          throw new Error("setup must not broadcast");
        },
      })).rejects.toThrow("simulated crash before broadcast");

      await expect(runDurableXrplPayment<Payment>({
        preview,
        outputBasePath,
        validateBeforeSigning: async () => {
          throw new Error("expiry discovery must not revalidate");
        },
        prepareTransaction: async () => {
          throw new Error("expiry discovery must not prepare");
        },
        signTransaction: () => {
          throw new Error("expiry discovery must not sign");
        },
        getValidatedLedgerIndex: async () => 101,
        lookupTransaction: async () => null,
        broadcastAndWait: async () => {
          throw new Error("expiry discovery must not broadcast");
        },
      })).rejects.toThrow("terminal no-delivery expiry recorded");

      winner = runDurableXrplPayment<Payment>({
        preview,
        outputBasePath,
        validateBeforeSigning: async () => {
          winnerValidations += 1;
        },
        prepareTransaction: async () => {
          winnerPrepares += 1;
          announcePreparation();
          await preparationMayFinish;
          return replacementTransaction;
        },
        signTransaction: (prepared) => {
          winnerSigns += 1;
          return wallet.sign(prepared);
        },
        getValidatedLedgerIndex: async () => 101,
        lookupTransaction: async () => {
          winnerLookups += 1;
          return null;
        },
        broadcastAndWait: async (blob) => {
          winnerBroadcasts += 1;
          expect(blob).toBe(replacementSigned.tx_blob);
          return success(replacementSigned.hash);
        },
      });
      await preparationStarted;

      await expect(runDurableXrplPayment<Payment>({
        preview,
        outputBasePath: join(directory, "loser-sent.json"),
        validateBeforeSigning: async () => {
          loserValidations += 1;
        },
        prepareTransaction: async () => {
          loserPrepares += 1;
          return replacementTransaction;
        },
        signTransaction: (prepared) => {
          loserSigns += 1;
          return wallet.sign(prepared);
        },
        getValidatedLedgerIndex: async () => {
          loserLedgerReads += 1;
          return 101;
        },
        lookupTransaction: async () => {
          loserLookups += 1;
          return null;
        },
        broadcastAndWait: async () => {
          loserBroadcasts += 1;
          return success(replacementSigned.hash);
        },
      })).rejects.toThrow("XRPL payment state is already locked");
      expect([
        loserValidations,
        loserPrepares,
        loserSigns,
        loserLedgerReads,
        loserLookups,
        loserBroadcasts,
      ]).toEqual([0, 0, 0, 0, 0, 0]);

      releasePreparation();
      const recovered = await winner;
      expect(recovered.xrplTransactionHash).toBe(replacementSigned.hash);
      expect([winnerValidations, winnerPrepares, winnerSigns, winnerLookups, winnerBroadcasts])
        .toEqual([1, 1, 1, 2, 1]);
      const state = await readJson<XrplPaymentState<Payment>>(recovered.statePath);
      expect(state.phase).toBe("VALIDATED");
      expect(state.terminalExpiries).toHaveLength(1);
      await expect(access(userOperationNonceReservationPath(
        preview.chainId,
        preview.personalAccount,
        preview.nonce,
      ))).resolves.toBeUndefined();
    } finally {
      releasePreparation();
      await winner?.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
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

    it("journals exact-hash no-delivery expiry before explicitly preparing a fresh same-operation payment", async () => {
      const value = await fixture(operation);
      const replacementTransaction: Payment = {
        ...value.transaction,
        Fee: "13",
        LastLedgerSequence: 200,
      };
      const replacementSigned = value.wallet.sign(replacementTransaction);
      let validations = 0;
      let prepares = 0;
      let signs = 0;
      let currentLedger = 99;
      let broadcasts = 0;
      try {
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => {
            validations += 1;
          },
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
            throw new Error("simulated crash before broadcast");
          },
          broadcastAndWait: async () => {
            throw new Error("must not broadcast during setup");
          },
        })).rejects.toThrow("simulated crash before broadcast");
        const statePath = xrplPaymentStatePath(value.preview.xrplSource, value.preview.instruction.userOperationHash);
        expect((await readJson<XrplPaymentState<Payment>>(statePath)).phase).toBe("SIGNED");

        // LastLedgerSequence itself is not enough: only a validated ledger
        // strictly beyond it proves the exact absent hash can no longer land.
        currentLedger = 100;
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => {
            throw new Error("live signed retry must not revalidate");
          },
          prepareTransaction: async () => {
            throw new Error("live signed retry must not prepare");
          },
          signTransaction: () => {
            throw new Error("live signed retry must not sign");
          },
          getValidatedLedgerIndex: async () => currentLedger,
          lookupTransaction: async () => null,
          broadcastAndWait: async (blob) => {
            broadcasts += 1;
            expect(blob).toBe(value.signed.tx_blob);
            throw new Error("simulated disconnect at LastLedgerSequence");
          },
        })).rejects.toThrow("simulated disconnect at LastLedgerSequence");
        expect((await readJson<XrplPaymentState<Payment>>(statePath)).phase).toBe("SIGNED");

        currentLedger = 101;
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => {
            throw new Error("expiry discovery must not revalidate or replace in the same invocation");
          },
          prepareTransaction: async () => {
            throw new Error("expiry discovery must not prepare a replacement");
          },
          signTransaction: () => {
            throw new Error("expiry discovery must not sign a replacement");
          },
          getValidatedLedgerIndex: async () => currentLedger,
          lookupTransaction: async () => null,
          broadcastAndWait: async () => {
            throw new Error("expired signed bytes must not be rebroadcast");
          },
        })).rejects.toThrow("terminal no-delivery expiry recorded");

        const expired = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(expired.phase).toBe("TERMINAL_EXPIRY");
        if (expired.phase === "TERMINAL_EXPIRY") {
          expect(expired.xrplTransactionHash).toBe(value.signed.hash);
          expect(expired.signedTransactionBlob).toBe(value.signed.tx_blob);
          expect(expired.expiryValidatedLedger).toBe(101);
        }

        const recovered = await runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: join(value.directory, "alternate-sent.json"),
          validateBeforeSigning: async () => {
            validations += 1;
          },
          prepareTransaction: async () => {
            prepares += 1;
            return replacementTransaction;
          },
          signTransaction: (transaction) => {
            signs += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => currentLedger,
          lookupTransaction: async () => null,
          broadcastAndWait: async (blob) => {
            broadcasts += 1;
            expect(blob).toBe(replacementSigned.tx_blob);
            return success(replacementSigned.hash);
          },
        });

        expect(recovered.xrplTransactionHash).toBe(replacementSigned.hash);
        expect(recovered.sentArtifactPath).toBe(transactionArtifactPath(value.outputBasePath, replacementSigned.hash));
        expect(validations).toBe(2);
        expect(prepares).toBe(2);
        expect(signs).toBe(2);
        expect(broadcasts).toBe(2);
        const completed = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(completed.phase).toBe("VALIDATED");
        expect(completed.terminalExpiries).toHaveLength(1);
        expect(completed.terminalExpiries?.[0]).toMatchObject({
          xrplTransactionHash: value.signed.hash,
          expiryValidatedLedger: 101,
          preparedTransaction: { Sequence: 1, LastLedgerSequence: 100 },
        });
        await expect(access(userOperationNonceReservationPath(
          value.preview.chainId,
          value.preview.personalAccount,
          value.preview.nonce,
        ))).resolves.toBeUndefined();
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

    it("records a terminal failed payment, then revalidates and uses a fresh sequence on a later invocation", async () => {
      const value = await fixture(operation);
      const secondOutputBasePath = join(value.directory, "retry-sent.json");
      const replacementTransaction: Payment = {
        ...value.transaction,
        Sequence: 2,
        LastLedgerSequence: 200,
      };
      const replacementSigned = value.wallet.sign(replacementTransaction);
      const ledger = new Map<string, XrplTransactionOutcome>();
      const broadcasts: string[] = [];
      let validations = 0;
      let prepares = 0;
      let signs = 0;
      try {
        const first = () => runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => {
            validations += 1;
          },
          prepareTransaction: async () => {
            prepares += 1;
            return value.transaction;
          },
          signTransaction: (transaction) => {
            signs += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 99,
          lookupTransaction: async (hash) => ledger.get(hash) ?? null,
          broadcastAndWait: async (blob) => {
            broadcasts.push(blob);
            const failed = terminalFailure(value.signed.hash);
            ledger.set(value.signed.hash, failed);
            return failed;
          },
        });

        await expect(first()).rejects.toThrow(
          "terminal failure recorded and no XRP was delivered",
        );
        const statePath = xrplPaymentStatePath(value.preview.xrplSource, value.preview.instruction.userOperationHash);
        const failedState = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(failedState.phase).toBe("TERMINAL_FAILURE");
        if (failedState.phase === "TERMINAL_FAILURE") {
          expect(failedState.xrplTransactionHash).toBe(value.signed.hash);
          expect(failedState.transactionResult).toBe("tecUNFUNDED_PAYMENT");
          expect(failedState.preparedTransaction.Sequence).toBe(1);
        }
        await expect(access(transactionArtifactPath(value.outputBasePath, value.signed.hash))).rejects.toMatchObject({
          code: "ENOENT",
        });

        const recovered = await runDurableXrplPayment<Payment>({
          preview: value.preview,
          // A retry cannot redirect the executor artifact selected by the first
          // invocation, even though the successful hash belongs to sequence 2.
          outputBasePath: secondOutputBasePath,
          validateBeforeSigning: async () => {
            validations += 1;
          },
          prepareTransaction: async () => {
            prepares += 1;
            return replacementTransaction;
          },
          signTransaction: (transaction) => {
            signs += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 101,
          lookupTransaction: async (hash) => ledger.get(hash) ?? null,
          broadcastAndWait: async (blob) => {
            broadcasts.push(blob);
            expect(blob).toBe(replacementSigned.tx_blob);
            const succeeded = success(replacementSigned.hash);
            ledger.set(replacementSigned.hash, succeeded);
            return succeeded;
          },
        });

        expect(recovered.xrplTransactionHash).toBe(replacementSigned.hash);
        expect(recovered.sentArtifactPath).toBe(transactionArtifactPath(value.outputBasePath, replacementSigned.hash));
        expect(recovered.sentArtifactPath).not.toBe(transactionArtifactPath(secondOutputBasePath, replacementSigned.hash));
        expect(validations).toBe(2);
        expect(prepares).toBe(2);
        expect(signs).toBe(2);
        expect(broadcasts).toEqual([value.signed.tx_blob, replacementSigned.tx_blob]);

        const completedState = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(completedState.phase).toBe("VALIDATED");
        expect(completedState.terminalFailures).toHaveLength(1);
        expect(completedState.terminalFailures?.[0]).toMatchObject({
          xrplTransactionHash: value.signed.hash,
          transactionResult: "tecUNFUNDED_PAYMENT",
          preparedTransaction: { Sequence: 1 },
        });

        const replayed = await runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: join(value.directory, "third-sent.json"),
          validateBeforeSigning: async () => {
            throw new Error("validated replay must not revalidate");
          },
          prepareTransaction: async () => {
            throw new Error("validated replay must not prepare a third payment");
          },
          signTransaction: () => {
            throw new Error("validated replay must not sign a third payment");
          },
          getValidatedLedgerIndex: async () => {
            throw new Error("validated replay must not inspect ledger state");
          },
          lookupTransaction: async () => {
            throw new Error("validated replay must not look up another payment");
          },
          broadcastAndWait: async () => {
            throw new Error("validated replay must not broadcast another payment");
          },
        });
        expect(replayed.xrplTransactionHash).toBe(replacementSigned.hash);
        expect(replayed.sentArtifactPath).toBe(recovered.sentArtifactPath);
        expect(broadcasts).toHaveLength(2);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("journals a terminal failure discovered after a lost broadcast response before allowing retry", async () => {
      const value = await fixture(operation);
      const replacementTransaction: Payment = {
        ...value.transaction,
        Sequence: 2,
        LastLedgerSequence: 200,
      };
      const replacementSigned = value.wallet.sign(replacementTransaction);
      const failed = terminalFailure(value.signed.hash);
      const ledger = new Map<string, XrplTransactionOutcome>();
      let prepares = 0;
      let signs = 0;
      let broadcasts = 0;
      let validations = 0;
      try {
        const common = {
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => {
            validations += 1;
          },
          getValidatedLedgerIndex: async () => 101,
          lookupTransaction: async (hash: string) => ledger.get(hash) ?? null,
        };

        await expect(runDurableXrplPayment<Payment>({
          ...common,
          prepareTransaction: async () => {
            prepares += 1;
            return value.transaction;
          },
          signTransaction: (transaction) => {
            signs += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 99,
          broadcastAndWait: async () => {
            broadcasts += 1;
            ledger.set(value.signed.hash, failed);
            throw new Error("simulated lost response after terminal XRPL validation");
          },
        })).rejects.toThrow("simulated lost response");

        const statePath = xrplPaymentStatePath(value.preview.xrplSource, value.preview.instruction.userOperationHash);
        expect((await readJson<XrplPaymentState>(statePath)).phase).toBe("SIGNED");

        await expect(runDurableXrplPayment<Payment>({
          ...common,
          prepareTransaction: async () => {
            throw new Error("failure-discovery invocation must not prepare a replacement");
          },
          signTransaction: () => {
            throw new Error("failure-discovery invocation must not sign a replacement");
          },
          broadcastAndWait: async () => {
            throw new Error("failure-discovery invocation must not rebroadcast");
          },
        })).rejects.toThrow("terminal failure recorded and no XRP was delivered");

        const terminalState = await readJson<XrplPaymentState<Payment>>(statePath);
        expect(terminalState.phase).toBe("TERMINAL_FAILURE");
        expect(prepares).toBe(1);
        expect(signs).toBe(1);
        expect(broadcasts).toBe(1);
        expect(validations).toBe(1);

        const recovered = await runDurableXrplPayment<Payment>({
          ...common,
          prepareTransaction: async () => {
            prepares += 1;
            return replacementTransaction;
          },
          signTransaction: (transaction) => {
            signs += 1;
            return value.wallet.sign(transaction);
          },
          broadcastAndWait: async () => {
            broadcasts += 1;
            return success(replacementSigned.hash);
          },
        });
        expect(recovered.xrplTransactionHash).toBe(replacementSigned.hash);
        expect(prepares).toBe(2);
        expect(signs).toBe(2);
        expect(broadcasts).toBe(2);
        expect(validations).toBe(2);
      } finally {
        await rm(value.directory, { recursive: true, force: true });
      }
    });

    it("requires revalidation and serializes concurrent recovery from a terminal payment failure", async () => {
      const value = await fixture(operation);
      const replacementTransaction: Payment = {
        ...value.transaction,
        Sequence: 2,
        LastLedgerSequence: 200,
      };
      const replacementSigned = value.wallet.sign(replacementTransaction);
      const failed = terminalFailure(value.signed.hash);
      let releasePreparation!: () => void;
      const preparationMayFinish = new Promise<void>((resolve) => {
        releasePreparation = resolve;
      });
      let announcePreparation!: () => void;
      const preparationStarted = new Promise<void>((resolve) => {
        announcePreparation = resolve;
      });
      let winningValidations = 0;
      let winningPrepares = 0;
      let winningSigns = 0;
      let winningBroadcasts = 0;
      let losingValidations = 0;
      let losingPrepares = 0;
      let losingSigns = 0;
      let losingBroadcasts = 0;
      let winner: Promise<Awaited<ReturnType<typeof runDurableXrplPayment<Payment>>>> | undefined;
      try {
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => undefined,
          prepareTransaction: async () => value.transaction,
          signTransaction: (transaction) => value.wallet.sign(transaction),
          getValidatedLedgerIndex: async () => 99,
          lookupTransaction: async () => null,
          broadcastAndWait: async () => failed,
        })).rejects.toThrow("terminal failure recorded");

        // A terminal state is not retryable until the exact failed hash can be
        // re-proven from a validated ledger.
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => {
            losingValidations += 1;
          },
          prepareTransaction: async () => {
            losingPrepares += 1;
            return replacementTransaction;
          },
          signTransaction: (transaction) => {
            losingSigns += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 101,
          lookupTransaction: async () => null,
          broadcastAndWait: async () => {
            losingBroadcasts += 1;
            return success(replacementSigned.hash);
          },
        })).rejects.toThrow("could not be revalidated");
        expect([losingValidations, losingPrepares, losingSigns, losingBroadcasts]).toEqual([0, 0, 0, 0]);

        winner = runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: value.outputBasePath,
          validateBeforeSigning: async () => {
            winningValidations += 1;
          },
          prepareTransaction: async () => {
            winningPrepares += 1;
            announcePreparation();
            await preparationMayFinish;
            return replacementTransaction;
          },
          signTransaction: (transaction) => {
            winningSigns += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 101,
          lookupTransaction: async (hash) => hash === value.signed.hash ? failed : null,
          broadcastAndWait: async () => {
            winningBroadcasts += 1;
            return success(replacementSigned.hash);
          },
        });

        await preparationStarted;
        await expect(runDurableXrplPayment<Payment>({
          preview: value.preview,
          outputBasePath: join(value.directory, "concurrent-sent.json"),
          validateBeforeSigning: async () => {
            losingValidations += 1;
          },
          prepareTransaction: async () => {
            losingPrepares += 1;
            return replacementTransaction;
          },
          signTransaction: (transaction) => {
            losingSigns += 1;
            return value.wallet.sign(transaction);
          },
          getValidatedLedgerIndex: async () => 101,
          lookupTransaction: async () => failed,
          broadcastAndWait: async () => {
            losingBroadcasts += 1;
            return success(replacementSigned.hash);
          },
        })).rejects.toThrow("XRPL payment state is already locked");
        expect([losingValidations, losingPrepares, losingSigns, losingBroadcasts]).toEqual([0, 0, 0, 0]);

        releasePreparation();
        const completed = await winner;
        expect(completed.xrplTransactionHash).toBe(replacementSigned.hash);
        expect([winningValidations, winningPrepares, winningSigns, winningBroadcasts]).toEqual([1, 1, 1, 1]);
      } finally {
        releasePreparation();
        await winner?.catch(() => undefined);
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
