import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Client } from "xrpl";
import {
  assertFreshPreviewMatches,
  assertPreviewIntegrity,
  readJson,
  writePrivateJson,
  type SentAtomicSubscribe,
} from "./artifact.js";
import { directMintingExecuteAbi, standingAbi, standingEventsAbi, userOperationExecutedAbi } from "./abis.js";
import { coston2 } from "./config.js";
import { obtainXrpPaymentProof } from "./fdc.js";
import { buildAtomicSubscribePreview } from "./preflight.js";

const requiredConfirmation = "APPROVE STANDING ATOMIC FDC EXECUTION";
if (process.env.CONFIRM_EXECUTE !== requiredConfirmation) {
  throw new Error(`Refusing to execute. Set CONFIRM_EXECUTE exactly to: ${requiredConfirmation}`);
}

const sentPath = resolve(process.env.SENT_FILE ?? "atomic-subscribe-sent.json");
const outputPath = resolve(process.env.COMPLETED_FILE ?? "atomic-subscribe-completed.json");
const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
if (!privateKey) throw new Error("PRIVATE_KEY is required for the FDC request and executor transaction");
const verifierApiKey = process.env.VERIFIER_API_KEY_TESTNET;
if (!verifierApiKey) throw new Error("VERIFIER_API_KEY_TESTNET is required");

const sent = await readJson<SentAtomicSubscribe>(sentPath);
if (sent.version !== 1 || sent.execution !== "PENDING") throw new Error("invalid or already completed executor artifact");
assertPreviewIntegrity(sent.preview);

const account = privateKeyToAccount(privateKey);
const client = createPublicClient({ chain: coston2, transport: http(process.env.COSTON2_RPC_URL) });
const walletClient = createWalletClient({ account, chain: coston2, transport: http(process.env.COSTON2_RPC_URL) });

const fresh = await buildAtomicSubscribePreview({
  xrplAddress: sent.preview.xrplSource,
  planId: BigInt(sent.preview.plan.id),
  deposit: sent.preview.deposit.display,
  standing: getAddress(sent.preview.standing),
  client,
});
const committed = sent.preview;
assertFreshPreviewMatches(committed, fresh);

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
  if (payment.Amount !== committed.payment.totalPaymentUBA) throw new Error("XRPL payment amount mismatch");
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

const transactionId = `0x${sent.xrplTransactionHash}`.toLowerCase() as Hex;
const proof = await obtainXrpPaymentProof({
  transactionId,
  proofOwner: account.address,
  client,
  walletClient,
  verifierUrl: process.env.VERIFIER_URL_TESTNET ?? "https://fdc-verifiers-testnet.flare.network",
  verifierApiKey,
  ...(process.env.COSTON2_DA_LAYER_URL ? { daLayerUrl: process.env.COSTON2_DA_LAYER_URL } : {}),
});

const executorHash = await walletClient.writeContract({
  address: getAddress(committed.assetManager),
  abi: directMintingExecuteAbi,
  functionName: "executeDirectMintingWithData",
  args: [proof, committed.instruction.packedUserOperation],
  value: 0n,
});
const receipt = await client.waitForTransactionReceipt({ hash: executorHash });
if (receipt.status !== "success") throw new Error(`executeDirectMintingWithData reverted: ${executorHash}`);

const mandateEvents = parseEventLogs({ abi: standingEventsAbi, eventName: "MandateOpened", logs: receipt.logs });
const mandate = mandateEvents.find(
  (event) =>
    event.address.toLowerCase() === committed.standing.toLowerCase() &&
    event.args.planId === BigInt(committed.plan.id) &&
    event.args.subscriber.toLowerCase() === committed.personalAccount.toLowerCase() &&
    event.args.deposited === BigInt(committed.deposit.atomic),
);
if (!mandate) throw new Error("executor succeeded without the committed MandateOpened event");
const storedMandate = await client.readContract({
  address: getAddress(committed.standing),
  abi: standingAbi,
  functionName: "mandates",
  args: [mandate.args.mandateId],
});
const [storedPlanId, storedSubscriber, storedDeposited, storedRemaining, , storedLastChargeAt, storedCanceled] =
  storedMandate;
if (
  storedPlanId !== BigInt(committed.plan.id) ||
  storedSubscriber.toLowerCase() !== committed.personalAccount.toLowerCase() ||
  storedDeposited !== BigInt(committed.deposit.atomic) ||
  storedRemaining !== BigInt(committed.deposit.atomic) ||
  storedLastChargeAt !== 0n ||
  storedCanceled
) {
  throw new Error("Standing stored mandate does not match the committed atomic subscription");
}

const userOperations = parseEventLogs({
    abi: userOperationExecutedAbi,
  eventName: "UserOperationExecuted",
  logs: receipt.logs,
});
const executed = userOperations.find(
  (event) =>
    event.args.personalAccount.toLowerCase() === committed.personalAccount.toLowerCase() &&
    event.args.nonce === BigInt(committed.nonce),
);
if (!executed) throw new Error("executor succeeded without the committed UserOperationExecuted event");

await writePrivateJson(outputPath, {
  version: 1,
  preview: committed,
  xrplTransactionHash: sent.xrplTransactionHash,
  executorTransactionHash: executorHash,
  mandateId: mandate.args.mandateId.toString(),
  completedAt: new Date().toISOString(),
  execution: "COMPLETE",
});
console.log(`Atomic subscription complete: mandate ${mandate.args.mandateId}`);
console.log(`Flare transaction: ${executorHash}`);
