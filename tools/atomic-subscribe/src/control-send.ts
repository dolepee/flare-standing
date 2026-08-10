import { resolve } from "node:path";
import { Client, Wallet, xrpToDrops, type Payment } from "xrpl";
import {
  assertFreshPreviewMatches,
  assertPreviewIntegrity,
  readJson,
} from "./artifact.js";
import { buildCancelWithdrawPreview, type AtomicCancelWithdrawPreview } from "./control.js";
import {
  runDurableXrplPayment,
  type XrplTransactionOutcome,
} from "./xrpl-payment-state.js";

function transactionOutcome(response: unknown): XrplTransactionOutcome {
  const result = (response as {
    result?: { hash?: unknown; validated?: unknown; meta?: unknown };
  }).result;
  if (!result || typeof result.hash !== "string") throw new Error("XRPL response omitted the transaction hash");
  const transactionResult =
    typeof result.meta === "object" && result.meta !== null && "TransactionResult" in result.meta
      ? (result.meta as { TransactionResult?: unknown }).TransactionResult
      : undefined;
  return {
    hash: result.hash,
    validated: result.validated === true,
    ...(typeof transactionResult === "string" ? { transactionResult } : {}),
  };
}

function isTransactionNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    (error as { data?: { error?: unknown } }).data?.error === "txnNotFound"
  );
}

const requiredConfirmation = "APPROVE STANDING ATOMIC CANCEL AND WITHDRAW";
if (process.env.CONFIRM_CONTROL_SEND !== requiredConfirmation) {
  throw new Error(`Refusing to send. Set CONFIRM_CONTROL_SEND exactly to: ${requiredConfirmation}`);
}
const previewPath = resolve(process.env.PREVIEW_FILE ?? "atomic-cancel-withdraw-preview.json");
const outputBasePath = resolve(process.env.SENT_FILE ?? "atomic-cancel-withdraw-sent.json");
const seed = process.env.XRPL_SEED;
if (!seed) throw new Error("XRPL_SEED is required");

const preview = await readJson<AtomicCancelWithdrawPreview>(previewPath);
assertPreviewIntegrity(preview);
if (preview.operation !== "CANCEL_WITHDRAW") throw new Error("preview is not a cancel-withdraw operation");
const wallet = Wallet.fromSeed(seed);
if (wallet.address !== preview.xrplSource) {
  throw new Error(`XRPL_SEED derives ${wallet.address}, but preview is bound to ${preview.xrplSource}`);
}

const client = new Client(process.env.XRPL_TESTNET_RPC_URL ?? "wss://s.altnet.rippletest.net:51233");
await client.connect();
try {
  const durable = await runDurableXrplPayment<Payment>({
    preview,
    outputBasePath,
    validateBeforeSigning: async () => {
      const fresh = await buildCancelWithdrawPreview({
        xrplAddress: preview.xrplSource,
        mandateId: BigInt(preview.control.mandateId),
        authorizationMint: preview.deposit.display,
        standing: preview.standing,
      });
      assertFreshPreviewMatches(preview, fresh);
      const balanceDrops = BigInt(xrpToDrops(await client.getXrpBalance(wallet.address)));
      const paymentDrops = BigInt(preview.payment.totalPaymentUBA);
      if (balanceDrops <= paymentDrops) {
        throw new Error(`XRPL balance is not sufficient for ${preview.payment.totalPaymentXrp} XRP plus network reserve and fee`);
      }
    },
    prepareTransaction: async () => {
      const transaction = await client.autofill({
        TransactionType: "Payment",
        Account: wallet.address,
        Destination: preview.xrplDestination,
        Amount: preview.payment.totalPaymentUBA,
        Memos: [{ Memo: { MemoData: preview.instruction.memoData.slice(2) } }],
      });
      if ("DestinationTag" in transaction) throw new Error("autofilled transaction unexpectedly contains DestinationTag");
      return transaction;
    },
    signTransaction: (transaction) => wallet.sign(transaction),
    getValidatedLedgerIndex: () => client.getLedgerIndex(),
    lookupTransaction: async (hash) => {
      try {
        return transactionOutcome(await client.request({ command: "tx", transaction: hash }));
      } catch (error) {
        if (isTransactionNotFound(error)) return null;
        throw error;
      }
    },
    broadcastAndWait: async (blob) => transactionOutcome(await client.submitAndWait(blob)),
  });
  console.log(`XRPL authorization payment validated: ${durable.xrplTransactionHash}`);
  console.log(`Payment recovery journal: ${durable.statePath}`);
  console.log(`Executor artifact written to ${durable.sentArtifactPath}`);
} finally {
  await client.disconnect();
}
