import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Client } from "xrpl";
import {
  acquireExecutionLock,
  assertPreviewIntegrity,
  createExecutionClaim,
  executionClaimPath,
  executionLockPath,
  operationKind,
  readJson,
  writePrivateJson,
  type AtomicOperationPreview,
  type ExecutionProgress,
  type SentAtomicSubscribe,
} from "./artifact.js";
import { assertPostPaymentExecutionFreshness } from "./execution-freshness.js";
import {
  assetManagerAbi,
  directMintingEventsAbi,
  directMintingExecuteAbi,
  masterAccountControllerAbi,
  registryAbi,
  smartAccountDirectMintingEventsAbi,
  standingAbi,
  standingEventsAbi,
  userOperationExecutedAbi,
} from "./abis.js";
import { coston2, registryAddress } from "./config.js";
import { buildCancelWithdrawPreview } from "./control.js";
import { obtainXrpPaymentProof } from "./fdc.js";
import { buildAtomicSubscribePreview } from "./preflight.js";
import { readMandateAtReceiptBlock, validateImmediateOpenPostconditions } from "./postconditions.js";
import { decideDelayedMintResume } from "./recovery.js";
import { deliveredNativePaymentDrops, requestedNativePaymentDrops } from "./xrpl.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST";
}

async function freshPreview(preview: AtomicOperationPreview): Promise<AtomicOperationPreview> {
  if (operationKind(preview) === "CANCEL_WITHDRAW") {
    if (!("control" in preview)) throw new Error("cancel-withdraw preview omitted its control binding");
    return buildCancelWithdrawPreview({
      xrplAddress: preview.xrplSource,
      mandateId: BigInt(preview.control.mandateId),
      authorizationMint: preview.deposit.display,
      standing: preview.standing,
    });
  }
  if (!("maxInitialChargeFxrp" in preview)) {
    throw new Error("legacy subscription artifact has no reviewed maximum initial charge");
  }
  return buildAtomicSubscribePreview({
    xrplAddress: preview.xrplSource,
    planId: BigInt(preview.plan.id),
    deposit: preview.deposit.display,
    maxInitialChargeFxrp: preview.maxInitialChargeFxrp.display,
    standing: preview.standing,
  });
}

async function verifyXrplPayment(sent: SentAtomicSubscribe): Promise<void> {
  const committed = sent.preview;
  const xrpl = new Client(process.env.XRPL_TESTNET_RPC_URL ?? "wss://s.altnet.rippletest.net:51233");
  await xrpl.connect();
  try {
    const transaction = await xrpl.request({ command: "tx", transaction: sent.xrplTransactionHash });
    if (!transaction.result.validated || !transaction.result.ledger_index) throw new Error("XRPL payment is not validated");
    const payment = transaction.result.tx_json;
    if (payment.TransactionType !== "Payment") throw new Error("XRPL transaction is not a Payment");
    if (payment.Account !== committed.xrplSource) throw new Error("XRPL payment source mismatch");
    if (payment.Destination !== committed.xrplDestination) throw new Error("XRPL payment destination mismatch");
    if ("DestinationTag" in payment) throw new Error("XRPL payment unexpectedly has a destination tag");
    if (requestedNativePaymentDrops(payment) !== committed.payment.totalPaymentUBA) {
      throw new Error("XRPL requested payment amount mismatch");
    }
    if (deliveredNativePaymentDrops(transaction.result.meta) !== committed.payment.totalPaymentUBA) {
      throw new Error("XRPL delivered payment amount mismatch");
    }
    const memo = payment.Memos?.[0]?.Memo?.MemoData;
    if (!memo || `0x${memo}`.toLowerCase() !== committed.instruction.memoData.toLowerCase()) {
      throw new Error("XRPL payment memo does not match committed user operation");
    }
    const latest = await xrpl.request({ command: "ledger", ledger_index: "validated" });
    const confirmations = latest.result.ledger_index - transaction.result.ledger_index + 1;
    if (confirmations < 3) throw new Error(`XRPL payment has ${confirmations}/3 confirmations`);
  } finally {
    await xrpl.disconnect();
  }
}

const sentFile = process.env.SENT_FILE;
if (!sentFile) throw new Error("SENT_FILE is required; use the transaction-specific path printed by send");
const sentPath = resolve(sentFile);
const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
if (!privateKey) throw new Error("PRIVATE_KEY is required for the FDC request and executor transaction");
const verifierApiKey = process.env.VERIFIER_API_KEY_TESTNET;
if (!verifierApiKey) throw new Error("VERIFIER_API_KEY_TESTNET is required");

let sent = await readJson<SentAtomicSubscribe>(sentPath);
if (sent.version !== 1) throw new Error("unsupported executor artifact version");
assertPreviewIntegrity(sent.preview);
const operation = operationKind(sent.preview);
const expectedConfirmation = operation === "CANCEL_WITHDRAW"
  ? "APPROVE STANDING ATOMIC CANCEL AND WITHDRAW EXECUTION"
  : "APPROVE STANDING ATOMIC FDC EXECUTION";
const suppliedConfirmation = operation === "CANCEL_WITHDRAW"
  ? process.env.CONFIRM_CONTROL_EXECUTE
  : process.env.CONFIRM_EXECUTE;
if (suppliedConfirmation !== expectedConfirmation) {
  throw new Error(`Refusing to execute. Set ${operation === "CANCEL_WITHDRAW" ? "CONFIRM_CONTROL_EXECUTE" : "CONFIRM_EXECUTE"} exactly to: ${expectedConfirmation}`);
}

if (sent.execution === "COMPLETE") {
  console.log(`Atomic ${operation.toLowerCase()} already complete: mandate ${sent.mandateId}`);
  console.log(`Flare transaction: ${sent.executorTransactionHash}`);
  process.exit(0);
}

const account = privateKeyToAccount(privateKey);
const activeExecutionLock = acquireExecutionLock(executionLockPath(account.address), {
  xrplTransactionHash: sent.xrplTransactionHash,
  userOperationHash: sent.preview.instruction.userOperationHash,
  executorAddress: account.address,
});
function releaseExecutionLock(): void {
  try {
    activeExecutionLock.release();
  } catch (error) {
    process.stderr.write(`Failed to release atomic execution lock: ${messageOf(error)}\n`);
  }
}
process.once("exit", releaseExecutionLock);
process.once("SIGINT", () => {
  releaseExecutionLock();
  process.exit(130);
});
process.once("SIGTERM", () => {
  releaseExecutionLock();
  process.exit(143);
});
const client = createPublicClient({ chain: coston2, transport: http(process.env.COSTON2_RPC_URL) });
const walletClient = createWalletClient({ account, chain: coston2, transport: http(process.env.COSTON2_RPC_URL) });
await verifyXrplPayment(sent);

const claimPath = executionClaimPath(sent.xrplTransactionHash);
if (sent.execution === "PENDING") {
  const claimedAt = new Date().toISOString();
  try {
    await createExecutionClaim(claimPath, {
      version: 1,
      xrplTransactionHash: sent.xrplTransactionHash,
      userOperationHash: sent.preview.instruction.userOperationHash,
      claimedAt,
      executorAddress: account.address,
      status: "EXCLUSIVE_EXECUTION_CLAIM",
    });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await readJson<{ xrplTransactionHash: string; userOperationHash?: string; executorAddress: string }>(claimPath);
    if (
      existing.xrplTransactionHash.toLowerCase() !== sent.xrplTransactionHash.toLowerCase() ||
      existing.executorAddress.toLowerCase() !== account.address.toLowerCase() ||
      (existing.userOperationHash && existing.userOperationHash.toLowerCase() !== sent.preview.instruction.userOperationHash.toLowerCase())
    ) {
      throw new Error("XRPL payment is already claimed by a different executor or user operation");
    }
  }
  const progress: ExecutionProgress = {
    phase: "CLAIMED",
    attempts: [],
    claimBlockNumber: (await client.getBlockNumber()).toString(),
    updatedAt: claimedAt,
  };
  sent = {
    ...sent,
    execution: "IN_PROGRESS",
    claimedAt,
    executorAddress: account.address,
    progress,
  };
  await writePrivateJson(sentPath, sent);
}

if (sent.execution !== "IN_PROGRESS") throw new Error("invalid executor artifact state");
if (sent.executorAddress.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error("executor private key does not match the durable execution claim");
}

let working = sent;
async function saveProgress(progress: ExecutionProgress): Promise<void> {
  working = { ...working, progress: { ...progress, updatedAt: new Date().toISOString() } };
  await writePrivateJson(sentPath, working);
}

async function controllerAddress(): Promise<Address> {
  return client.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "getContractAddressByName",
    args: ["MasterAccountController"],
  });
}

async function recoverUnrecordedSuccessfulTransaction(): Promise<TransactionReceipt | undefined> {
  const controller = await controllerAddress();
  const transactionId = `0x${working.xrplTransactionHash}`.toLowerCase() as Hex;
  const used = await client.readContract({
    address: controller,
    abi: masterAccountControllerAbi,
    functionName: "isTransactionIdUsed",
    args: [transactionId],
  });
  if (!used) return undefined;
  const fromBlock = BigInt(working.progress.claimBlockNumber ?? process.env.ATOMIC_RECOVERY_FROM_BLOCK ?? "0");
  const events = await client.getLogs({
    address: controller,
    event: smartAccountDirectMintingEventsAbi[0],
    args: { personalAccount: working.preview.personalAccount, transactionId },
    fromBlock,
    toBlock: "latest",
  });
  const event = events.at(-1);
  if (!event?.transactionHash) {
    throw new Error("payment is consumed on-chain but its DirectMintingExecuted receipt could not be reconciled");
  }
  return client.getTransactionReceipt({ hash: event.transactionHash });
}

async function broadcastExecutionAttempt(attempt: NonNullable<ExecutionProgress["attempts"]>[number]): Promise<void> {
  if (attempt.outcome !== "SIGNED" && attempt.outcome !== "PENDING") return;
  try {
    const broadcastHash = await client.sendRawTransaction({ serializedTransaction: attempt.serializedTransaction });
    if (broadcastHash.toLowerCase() !== attempt.transactionHash.toLowerCase()) {
      throw new Error("executor broadcast hash did not match the persisted signed transaction");
    }
  } catch (error) {
    const visible = await client.getTransaction({ hash: attempt.transactionHash }).then(() => true).catch(async () =>
      client.getTransactionReceipt({ hash: attempt.transactionHash }).then(() => true).catch(() => false));
    if (!visible) throw error;
  }
  const attempts = (working.progress.attempts ?? []).map((candidate) =>
    candidate.transactionHash.toLowerCase() === attempt.transactionHash.toLowerCase()
      ? { ...candidate, outcome: "PENDING" as const }
      : candidate,
  );
  if (attempt.outcome !== "PENDING" || working.progress.phase !== "EXECUTION_SUBMITTED") {
    await saveProgress({ ...working.progress, phase: "EXECUTION_SUBMITTED", attempts });
  }
}

async function finishFromReceipt(receipt: TransactionReceipt): Promise<"COMPLETE" | "DELAYED"> {
  const transactionId = `0x${working.xrplTransactionHash}`.toLowerCase() as Hex;
  const attempts = [...(working.progress.attempts ?? [])];
  const attemptIndex = attempts.findIndex((attempt) => attempt.transactionHash.toLowerCase() === receipt.transactionHash.toLowerCase());

  if (receipt.status !== "success") {
    if (attemptIndex >= 0) attempts[attemptIndex] = { ...attempts[attemptIndex]!, outcome: "REVERTED", receiptBlock: receipt.blockNumber.toString() };
    const [delayState, allowedAt] = await client.readContract({
      address: getAddress(working.preview.assetManager),
      abi: assetManagerAbi,
      functionName: "directMintingDelayState",
      args: [transactionId],
    });
    const remainsDelayed = delayState === 1;
    await saveProgress({
      ...working.progress,
      phase: remainsDelayed ? "DELAYED" : "RECOVERY_REQUIRED",
      attempts,
      ...(remainsDelayed ? {
        delay: {
          kind: working.progress.delay?.kind ?? "DirectMintingDelayed",
          executionAllowedAt: allowedAt.toString(),
          observedAt: new Date().toISOString(),
        },
      } : {}),
      lastError: { at: new Date().toISOString(), message: `executor transaction reverted: ${receipt.transactionHash}` },
    });
    throw new Error(
      remainsDelayed
        ? `executeDirectMintingWithData remains delayed: ${receipt.transactionHash}; rerun reuses the persisted proof`
        : `executeDirectMintingWithData reverted outside a live delay: ${receipt.transactionHash}; manual review or 0xE0 recovery is required, never another XRPL payment`,
    );
  }

  const delayedEvents = parseEventLogs({ abi: directMintingEventsAbi, logs: receipt.logs, strict: false }).filter(
    (event) => "transactionId" in event.args && event.args.transactionId?.toLowerCase() === transactionId,
  );
  const delayed = delayedEvents.find(
    (event) => event.eventName === "DirectMintingDelayed" || event.eventName === "LargeDirectMintingDelayed",
  );
  if (delayed && "executionAllowedAt" in delayed.args && delayed.args.executionAllowedAt !== undefined) {
    if (attemptIndex >= 0) attempts[attemptIndex] = { ...attempts[attemptIndex]!, outcome: "DELAYED", receiptBlock: receipt.blockNumber.toString() };
    await saveProgress({
      ...working.progress,
      phase: "DELAYED",
      attempts,
      delay: {
        kind: delayed.eventName,
        executionAllowedAt: delayed.args.executionAllowedAt.toString(),
        observedAt: new Date().toISOString(),
      },
    });
    console.log(`${delayed.eventName}; resume after Unix ${delayed.args.executionAllowedAt} with the same SENT_FILE and proof.`);
    return "DELAYED";
  }

  const userOperations = parseEventLogs({ abi: userOperationExecutedAbi, eventName: "UserOperationExecuted", logs: receipt.logs });
  const executed = userOperations.find(
    (event) =>
      event.args.personalAccount.toLowerCase() === working.preview.personalAccount.toLowerCase() &&
      event.args.nonce === BigInt(working.preview.nonce),
  );
  if (!executed) {
    await saveProgress({
      ...working.progress,
      phase: "RECOVERY_REQUIRED",
      attempts,
      lastError: {
        at: new Date().toISOString(),
        message: "successful executor receipt omitted the committed UserOperationExecuted event",
      },
    });
    throw new Error("executor receipt did not execute the committed UserOp; preserve the artifact and use the 0xE0 recovery path, never another payment");
  }

  let mandateId: bigint;
  if (operation === "SUBSCRIBE_V2") {
    const mandateEvents = parseEventLogs({ abi: standingEventsAbi, eventName: "MandateOpened", logs: receipt.logs });
    const mandate = mandateEvents.find(
      (event) =>
        event.address.toLowerCase() === working.preview.standing.toLowerCase() &&
        event.args.planId === BigInt(working.preview.plan.id) &&
        event.args.subscriber.toLowerCase() === working.preview.personalAccount.toLowerCase() &&
        event.args.deposited === BigInt(working.preview.deposit.atomic),
    );
    if (!mandate) throw new Error("executor succeeded without the committed MandateOpened event");
    mandateId = mandate.args.mandateId;
    const chargeEvents = parseEventLogs({ abi: standingEventsAbi, eventName: "ChargeExecuted", logs: receipt.logs });
    const charge = chargeEvents.find(
      (event) =>
        event.address.toLowerCase() === working.preview.standing.toLowerCase() &&
        event.args.mandateId === mandateId &&
        event.args.merchant.toLowerCase() === working.preview.plan.merchant.toLowerCase(),
    );
    if (!charge) throw new Error("executor succeeded without the immediate ChargeExecuted event");
    if (!("maxInitialChargeFxrp" in working.preview)) {
      throw new Error("V2 completion artifact omitted maxInitialChargeFxrp");
    }
    // A keeper can legitimately advance the mandate after this transaction lands.
    // Bind the postcondition to the receipt's state instead of treating that later
    // charge as a failed atomic subscription during recovery.
    const stored = await readMandateAtReceiptBlock({
      readContract: (request) => client.readContract(request),
      standing: getAddress(working.preview.standing),
      mandateId,
      receiptBlockNumber: receipt.blockNumber,
    });
    validateImmediateOpenPostconditions({
      committed: {
        planId: BigInt(working.preview.plan.id),
        subscriber: working.preview.personalAccount,
        merchant: working.preview.plan.merchant,
        deposit: BigInt(working.preview.deposit.atomic),
        maxInitialCharge: BigInt(working.preview.maxInitialChargeFxrp.atomic),
      },
      opened: {
        mandateId,
        planId: mandate.args.planId,
        subscriber: mandate.args.subscriber,
        deposited: mandate.args.deposited,
        firstChargeAt: mandate.args.firstChargeAt,
      },
      charged: {
        mandateId: charge.args.mandateId,
        merchant: charge.args.merchant,
        merchantAmount: charge.args.merchantAmount,
        feeAmount: charge.args.feeAmount,
        nextChargeAt: charge.args.nextChargeAt,
      },
      stored,
    });
  } else {
    if (!("control" in working.preview)) throw new Error("control preview omitted mandate binding");
    mandateId = BigInt(working.preview.control.mandateId);
    const stored = await client.readContract({
      address: getAddress(working.preview.standing),
      abi: standingAbi,
      functionName: "mandates",
      args: [mandateId],
    });
    if (stored[1].toLowerCase() !== working.preview.personalAccount.toLowerCase() || !stored[6] || stored[3] !== 0n) {
      throw new Error("cancel-withdraw UserOp executed but the bound mandate was not canceled and fully recovered");
    }
    const withdrawals = parseEventLogs({ abi: standingEventsAbi, eventName: "MandateWithdrawn", logs: receipt.logs });
    const withdrawal = withdrawals.find(
      (event) =>
        event.address.toLowerCase() === working.preview.standing.toLowerCase() &&
        event.args.mandateId === mandateId &&
        event.args.subscriber.toLowerCase() === working.preview.personalAccount.toLowerCase(),
    );
    if (!withdrawal || withdrawal.args.amount !== BigInt(working.preview.control.remainingAtomic)) {
      throw new Error("cancel-withdraw refund did not equal the exact FXRP amount reviewed before XRPL authorization");
    }
  }

  if (attemptIndex >= 0) attempts[attemptIndex] = { ...attempts[attemptIndex]!, outcome: "COMPLETE", receiptBlock: receipt.blockNumber.toString() };
  const completed: SentAtomicSubscribe = {
    version: 1,
    preview: working.preview,
    xrplTransactionHash: working.xrplTransactionHash,
    sentAt: working.sentAt,
    executorTransactionHash: receipt.transactionHash,
    mandateId: mandateId.toString(),
    completedAt: new Date().toISOString(),
    execution: "COMPLETE",
    ...(operation === "CANCEL_WITHDRAW" && "control" in working.preview ? {
      controlResult: {
        withdrawnFxrpAtomic: working.preview.control.remainingAtomic,
        returnedToPersonalAccount: working.preview.personalAccount,
      },
    } : {}),
  };
  await writePrivateJson(sentPath, completed);
  const defaultCompleted = operation === "CANCEL_WITHDRAW"
    ? "atomic-cancel-withdraw-completed.json"
    : "atomic-subscribe-completed.json";
  await writePrivateJson(resolve(process.env.COMPLETED_FILE ?? defaultCompleted), completed);
  console.log(`Atomic ${operation.toLowerCase()} complete: mandate ${mandateId}`);
  console.log(`Flare transaction: ${receipt.transactionHash}`);
  return "COMPLETE";
}

let pendingAttempt = [...(working.progress.attempts ?? [])].reverse().find(
  (attempt) => attempt.outcome === "SIGNED" || attempt.outcome === "PENDING",
);
if (pendingAttempt) {
  await broadcastExecutionAttempt(pendingAttempt);
  pendingAttempt = [...(working.progress.attempts ?? [])].reverse().find(
    (attempt) => attempt.transactionHash.toLowerCase() === pendingAttempt!.transactionHash.toLowerCase(),
  );
  if (!pendingAttempt) throw new Error("persisted executor attempt disappeared during broadcast");
  const receipt = await client.waitForTransactionReceipt({ hash: pendingAttempt.transactionHash, timeout: 90_000 });
  await finishFromReceipt(receipt);
  process.exit(0);
}

const recoveredReceipt = await recoverUnrecordedSuccessfulTransaction();
if (recoveredReceipt) {
  await finishFromReceipt(recoveredReceipt);
  process.exit(0);
}

if (working.progress.phase === "RECOVERY_REQUIRED") {
  throw new Error("execution is marked RECOVERY_REQUIRED; do not send another XRPL payment or delete the claim");
}

const fresh = await freshPreview(working.preview);
assertPostPaymentExecutionFreshness(working.preview, fresh);
const transactionId = `0x${working.xrplTransactionHash}`.toLowerCase() as Hex;

if (working.progress.phase === "DELAYED") {
  const [delayState, allowedAt] = await client.readContract({
    address: getAddress(working.preview.assetManager),
    abi: assetManagerAbi,
    functionName: "directMintingDelayState",
    args: [transactionId],
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const decision = decideDelayedMintResume({
    progress: working.progress,
    delayState,
    executionAllowedAt: allowedAt,
    now,
  });
  if (decision.action === "WAIT") {
    console.log(`Direct minting remains delayed until Unix ${decision.executionAllowedAt}; no transaction or payment was sent.`);
    process.exit(0);
  }
}

if (!working.progress.proof) {
  const result = await obtainXrpPaymentProof({
    transactionId,
    proofOwner: account.address,
    client,
    walletClient,
    verifierUrl: process.env.VERIFIER_URL_TESTNET ?? "https://fdc-verifiers-testnet.flare.network",
    verifierApiKey,
    ...(process.env.COSTON2_DA_LAYER_URL ? { daLayerUrl: process.env.COSTON2_DA_LAYER_URL } : {}),
    ...(working.progress.fdc ? { resume: working.progress.fdc } : {}),
    onState: async (fdc) => {
      await saveProgress({ ...working.progress, phase: "FDC_REQUESTED", fdc });
    },
  });
  await saveProgress({
    ...working.progress,
    phase: "PROOF_READY",
    fdc: result.state,
    proof: result.proof,
  });
}

const proof = working.progress.proof;
if (!proof) throw new Error("durable FDC proof is unavailable");
const preparedExecution = await walletClient.prepareTransactionRequest({
  account,
  chain: coston2,
  to: getAddress(working.preview.assetManager),
  data: encodeFunctionData({
    abi: directMintingExecuteAbi,
    functionName: "executeDirectMintingWithData",
    args: [proof, working.preview.instruction.packedUserOperation],
  }),
  value: 0n,
});
const serializedExecution = await walletClient.signTransaction(preparedExecution as never);
const executorHash = keccak256(serializedExecution);
const signedAttempt = {
  transactionHash: executorHash,
  serializedTransaction: serializedExecution,
  submittedAt: new Date().toISOString(),
  outcome: "SIGNED" as const,
};
await saveProgress({
  ...working.progress,
  phase: "EXECUTION_SIGNED",
  attempts: [...(working.progress.attempts ?? []), signedAttempt],
});
try {
  await broadcastExecutionAttempt(signedAttempt);
} catch (error) {
  await saveProgress({
    ...working.progress,
    phase: "EXECUTION_SIGNED",
    lastError: { at: new Date().toISOString(), message: messageOf(error) },
  });
  throw error;
}
const receipt = await client.waitForTransactionReceipt({ hash: executorHash });
await finishFromReceipt(receipt);
