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
  type XrplLedgerSearchRange,
  type XrplTransactionOutcome,
} from "./xrpl-payment-state.js";
import { transactionNotFoundResult } from "./xrpl-history.js";
import {
  assertNoUnresolvedGlobalXrplPayment,
  assertPreparedTransactionSequence,
  createCostonTransactionIdUsageReader,
  type GlobalXrplPaymentSnapshot,
  type XrplHistoryClient,
} from "./global-xrpl-payment-guard.js";

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
const historyClient = new Client(
  process.env.XRPL_TESTNET_HISTORY_RPC_URL ?? "wss://clio.altnet.rippletest.net:51233",
);
const guardedHistoryClient: XrplHistoryClient = {
  request: (request) => historyClient.request(request as never),
};
const isTransactionIdUsed = createCostonTransactionIdUsageReader();
let globalPaymentSnapshot: GlobalXrplPaymentSnapshot | undefined;
await client.connect();
try {
  const durable = await runDurableXrplPayment<Payment>({
    preview,
    outputBasePath,
    validateBeforeSigning: async () => {
      if (!historyClient.isConnected()) await historyClient.connect();
      globalPaymentSnapshot = await assertNoUnresolvedGlobalXrplPayment({
        historyClient: guardedHistoryClient,
        preview,
        isTransactionIdUsed,
      });
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
      if (globalPaymentSnapshot === undefined) {
        throw new Error("global XRPL payment guard did not produce a sequence snapshot");
      }
      const transaction = await client.autofill({
        TransactionType: "Payment",
        Account: wallet.address,
        Destination: preview.xrplDestination,
        Amount: preview.payment.totalPaymentUBA,
        Memos: [{ Memo: { MemoData: preview.instruction.memoData.slice(2) } }],
        Sequence: globalPaymentSnapshot.sequence,
      });
      if ("DestinationTag" in transaction) throw new Error("autofilled transaction unexpectedly contains DestinationTag");
      assertPreparedTransactionSequence(transaction, globalPaymentSnapshot);
      return transaction;
    },
    signTransaction: (transaction) => {
      assertPreparedTransactionSequence(transaction, globalPaymentSnapshot);
      return wallet.sign(transaction);
    },
    getValidatedLedgerIndex: () => client.getLedgerIndex(),
    lookupTransaction: async (hash, range?: XrplLedgerSearchRange) => {
      const lookupClient = range === undefined ? client : historyClient;
      if (!lookupClient.isConnected()) await lookupClient.connect();
      try {
        return transactionOutcome(await lookupClient.request({
          command: "tx",
          transaction: hash,
          ...(range === undefined ? {} : {
            min_ledger: range.minLedger,
            max_ledger: range.maxLedger,
          }),
        }));
      } catch (error) {
        return transactionNotFoundResult(error, range);
      }
    },
    broadcastAndWait: async (blob) => transactionOutcome(await client.submitAndWait(blob)),
  });
  console.log(`XRPL authorization payment validated: ${durable.xrplTransactionHash}`);
  console.log(`Payment recovery journal: ${durable.statePath}`);
  console.log(`Executor artifact written to ${durable.sentArtifactPath}`);
} finally {
  if (historyClient.isConnected()) await historyClient.disconnect();
  await client.disconnect();
}
