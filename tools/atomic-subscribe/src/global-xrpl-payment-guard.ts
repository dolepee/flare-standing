import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { masterAccountControllerAbi, registryAbi } from "./abis.js";
import { coston2, registryAddress } from "./config.js";

const HASH_PATTERN = /^[A-F0-9]{64}$/;
const MEMO_PATTERN = /^FE[A-F0-9]{82}$/;
const DEFAULT_PAGE_LIMIT = 200;
const MAX_HISTORY_PAGES = 10_000;

export type GlobalXrplPaymentGuardPreview = {
  chainId: 114;
  xrplSource: string;
  xrplDestination: string;
  personalAccount: Address;
  instruction: {
    userOperationHash: Hex;
  };
};

export type XrplHistoryRequest =
  | {
      command: "account_info";
      account: string;
      ledger_index: "validated" | number;
      queue: false;
    }
  | {
      command: "account_tx";
      account: string;
      ledger_index_min: -1;
      ledger_index_max: number;
      binary: false;
      forward: true;
      limit: number;
      marker?: unknown;
    };

export type XrplHistoryClient = {
  request(request: XrplHistoryRequest): Promise<unknown>;
};

export type TransactionIdUsageReader = (transactionId: Hex) => Promise<boolean>;

export type GlobalXrplPaymentSnapshot = {
  validatedLedgerIndex: number;
  sequence: number;
  scannedTransactions: number;
  matchingPayments: number;
};

type ParsedAccountInfo = {
  ledgerIndex: number;
  sequence: number;
};

type ParsedHistoryPage = {
  account: string;
  ledgerMin: number;
  ledgerMax: number;
  marker?: unknown;
  transactions: unknown[];
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is not a non-negative safe integer`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed === 0) throw new Error(`${label} must be positive`);
  return parsed;
}

function normalizedHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value.toUpperCase())) {
    throw new Error(`${label} is not a 32-byte transaction hash`);
  }
  return value.toUpperCase();
}

function parseAccountInfo(response: unknown, expectedAccount: string): ParsedAccountInfo {
  const result = record(record(response, "account_info response").result, "account_info result");
  if (result.validated !== true) throw new Error("account_info did not return validated state");
  const ledgerIndex = positiveInteger(result.ledger_index, "account_info ledger_index");
  const accountData = record(result.account_data, "account_info account_data");
  if (accountData.Account !== expectedAccount) throw new Error("account_info returned a different account");
  const sequence = positiveInteger(accountData.Sequence, "account_info Sequence");
  return { ledgerIndex, sequence };
}

function parseHistoryPage(
  response: unknown,
  expectedAccount: string,
  expectedLedgerMax: number,
): ParsedHistoryPage {
  const result = record(record(response, "account_tx response").result, "account_tx result");
  if (result.validated !== true) throw new Error("account_tx page did not return validated history");
  if (result.account !== expectedAccount) throw new Error("account_tx page returned a different account");
  const ledgerMin = nonNegativeInteger(result.ledger_index_min, "account_tx ledger_index_min");
  const ledgerMax = positiveInteger(result.ledger_index_max, "account_tx ledger_index_max");
  if (ledgerMax !== expectedLedgerMax) {
    throw new Error(`account_tx page ended at ledger ${ledgerMax}, expected ${expectedLedgerMax}`);
  }
  if (ledgerMin > ledgerMax) throw new Error("account_tx page returned an inverted ledger range");
  if (!Array.isArray(result.transactions)) throw new Error("account_tx page omitted transactions");
  return {
    account: expectedAccount,
    ledgerMin,
    ledgerMax,
    ...(result.marker === undefined ? {} : { marker: result.marker }),
    transactions: result.transactions,
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = "error" in error ? (error as { error?: unknown }).error : undefined;
  if (typeof direct === "string") return direct;
  if (!("data" in error)) return undefined;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  const nested = (data as { error?: unknown }).error;
  return typeof nested === "string" ? nested : undefined;
}

async function proveHistoryStartsBeforeAccount(
  client: XrplHistoryClient,
  account: string,
  historyMin: number,
): Promise<void> {
  // Clio's complete Testnet database currently starts at ledger 209; ledger
  // 208 is outside its retained range. Proving the account absent at the
  // returned lower bound is sufficient: the account did not yet exist when
  // the scanned history begins, so no transaction for this account can have
  // been omitted before that range.
  try {
    await client.request({
      command: "account_info",
      account,
      ledger_index: historyMin,
      queue: false,
    });
  } catch (error) {
    if (errorCode(error) === "actNotFound") return;
    throw new Error(
      `could not prove complete XRPL account history at ledger ${historyMin}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw new Error(
    `XRPL account already existed at history lower bound ${historyMin}; complete account history was not proven`,
  );
}

function transactionResult(meta: Record<string, unknown>): string {
  const result = meta.TransactionResult;
  if (typeof result !== "string" || result.length === 0) {
    throw new Error("account_tx entry metadata omitted TransactionResult");
  }
  return result;
}

function executorEligibleFeMemo(tx: Record<string, unknown>): string | null {
  // FDC and execute.ts bind the first memo's MemoData. Extra memos and the
  // optional MemoType/MemoFormat fields do not make that first memo
  // ineligible, so the cross-host guard must conservatively scan them too.
  if (!Array.isArray(tx.Memos) || tx.Memos.length === 0) return null;
  const wrapper = record(tx.Memos[0], "XRPL memo wrapper");
  if (!("Memo" in wrapper)) return null;
  const memo = record(wrapper.Memo, "XRPL memo");
  if (typeof memo.MemoData !== "string") return null;
  const value = memo.MemoData.toUpperCase();
  return MEMO_PATTERN.test(value) ? value : null;
}

function userOperationHashFromMemo(memoData: string): Hex {
  // FE opcode (1 byte), wallet id (1 byte), executor fee (8 bytes), then the
  // exact 32-byte PackedUserOperation hash.
  return `0x${memoData.slice(20).toLowerCase()}` as Hex;
}

function markerKey(marker: unknown): string {
  try {
    return JSON.stringify(marker);
  } catch {
    throw new Error("account_tx returned an unserializable pagination marker");
  }
}

export async function assertNoUnresolvedGlobalXrplPayment(input: {
  historyClient: XrplHistoryClient;
  preview: GlobalXrplPaymentGuardPreview;
  isTransactionIdUsed: TransactionIdUsageReader;
  pageLimit?: number;
}): Promise<GlobalXrplPaymentSnapshot> {
  if (input.preview.chainId !== 114) throw new Error("global XRPL payment guard only supports Coston2 chain 114");
  const pageLimit = input.pageLimit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(pageLimit) || pageLimit <= 0 || pageLimit > 400) {
    throw new Error("account_tx page limit must be between 1 and 400");
  }

  const accountInfo = parseAccountInfo(
    await input.historyClient.request({
      command: "account_info",
      account: input.preview.xrplSource,
      ledger_index: "validated",
      queue: false,
    }),
    input.preview.xrplSource,
  );

  let marker: unknown = undefined;
  let historyMin: number | undefined;
  let previousLedger = -1;
  let scannedTransactions = 0;
  let matchingPayments = 0;
  const seenHashes = new Set<string>();
  const seenMarkers = new Set<string>();

  for (let pageNumber = 0; pageNumber < MAX_HISTORY_PAGES; pageNumber += 1) {
    const request: XrplHistoryRequest = {
      command: "account_tx",
      account: input.preview.xrplSource,
      ledger_index_min: -1,
      ledger_index_max: accountInfo.ledgerIndex,
      binary: false,
      forward: true,
      limit: pageLimit,
      ...(marker === undefined ? {} : { marker }),
    };
    const page = parseHistoryPage(
      await input.historyClient.request(request),
      input.preview.xrplSource,
      accountInfo.ledgerIndex,
    );
    if (historyMin === undefined) historyMin = page.ledgerMin;
    else if (historyMin !== page.ledgerMin) throw new Error("account_tx ledger_index_min changed during pagination");

    for (const rawEntry of page.transactions) {
      const entry = record(rawEntry, "account_tx entry");
      if (entry.validated !== true) throw new Error("account_tx returned a non-validated entry");
      const ledgerIndex = positiveInteger(entry.ledger_index, "account_tx entry ledger_index");
      if (ledgerIndex < page.ledgerMin || ledgerIndex > accountInfo.ledgerIndex) {
        throw new Error("account_tx entry lies outside the requested validated ledger range");
      }
      if (ledgerIndex < previousLedger) throw new Error("forward account_tx history is not ordered by ledger");
      previousLedger = ledgerIndex;

      const hash = normalizedHash(entry.hash, "account_tx entry hash");
      if (seenHashes.has(hash)) throw new Error(`account_tx returned duplicate transaction ${hash}`);
      seenHashes.add(hash);
      scannedTransactions += 1;

      const tx = record(entry.tx_json ?? entry.tx, "account_tx entry transaction");
      const meta = record(entry.meta, "account_tx entry metadata");
      const result = transactionResult(meta);
      if (
        result !== "tesSUCCESS" ||
        tx.TransactionType !== "Payment" ||
        tx.Account !== input.preview.xrplSource ||
        tx.Destination !== input.preview.xrplDestination
      ) {
        continue;
      }
      const memoData = executorEligibleFeMemo(tx);
      if (memoData === null) continue;
      matchingPayments += 1;

      const transactionId = `0x${hash.toLowerCase()}` as Hex;
      const used = await input.isTransactionIdUsed(transactionId);
      if (typeof used !== "boolean") throw new Error("Coston2 isTransactionIdUsed returned a non-boolean result");
      if (used) continue;

      const committedHash = userOperationHashFromMemo(memoData);
      if (committedHash.toLowerCase() === input.preview.instruction.userOperationHash.toLowerCase()) {
        throw new Error(
          `validated XRPL payment ${hash} already commits this user operation but is not consumed on Coston2; ` +
            "recover/import that payment instead of signing another",
        );
      }
      throw new Error(
        `validated XRPL payment ${hash} commits a different unresolved user operation; ` +
          "refusing a conflicting payment at the same Smart Account nonce",
      );
    }

    if (page.marker === undefined) break;
    const key = markerKey(page.marker);
    if (seenMarkers.has(key)) throw new Error("account_tx pagination marker repeated before history completed");
    seenMarkers.add(key);
    marker = page.marker;
    if (pageNumber === MAX_HISTORY_PAGES - 1) {
      throw new Error(`account_tx exceeded the ${MAX_HISTORY_PAGES}-page safety limit`);
    }
  }

  if (historyMin === undefined || scannedTransactions === 0) {
    throw new Error("account_tx returned no account-creation history; completeness was not proven");
  }
  await proveHistoryStartsBeforeAccount(input.historyClient, input.preview.xrplSource, historyMin);

  return {
    validatedLedgerIndex: accountInfo.ledgerIndex,
    sequence: accountInfo.sequence,
    scannedTransactions,
    matchingPayments,
  };
}

export function assertPreparedTransactionSequence(
  transaction: unknown,
  snapshot: GlobalXrplPaymentSnapshot | undefined,
): void {
  if (snapshot === undefined) throw new Error("global XRPL payment guard did not produce a sequence snapshot");
  const prepared = record(transaction, "prepared XRPL transaction");
  const sequence = positiveInteger(prepared.Sequence, "prepared XRPL transaction Sequence");
  if (sequence !== snapshot.sequence) {
    throw new Error(
      `prepared XRPL transaction sequence ${sequence} does not match guarded account sequence ${snapshot.sequence}`,
    );
  }
}

export function createCostonTransactionIdUsageReader(
  rpcUrl = process.env.COSTON2_RPC_URL ?? coston2.rpcUrls.default.http[0],
  client: PublicClient = createPublicClient({ chain: coston2, transport: http(rpcUrl) }),
): TransactionIdUsageReader {
  let controllerPromise: Promise<Address> | undefined;
  const controller = () => {
    controllerPromise ??= client.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "getContractAddressByName",
      args: ["MasterAccountController"],
    }).then((value) => getAddress(value));
    return controllerPromise;
  };
  return async (transactionId) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionId)) throw new Error("Coston2 transaction id must be bytes32");
    const result = await client.readContract({
      address: await controller(),
      abi: masterAccountControllerAbi,
      functionName: "isTransactionIdUsed",
      args: [transactionId],
    });
    if (typeof result !== "boolean") throw new Error("Coston2 isTransactionIdUsed returned a non-boolean result");
    return result;
  };
}
