import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import {
  assertNoUnresolvedGlobalXrplPayment,
  assertPreparedTransactionSequence,
  type GlobalXrplPaymentGuardPreview,
  type XrplHistoryClient,
  type XrplHistoryRequest,
} from "../src/global-xrpl-payment-guard.js";

const source = "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p";
const destination = "rEAEY1WFcBurB5RdDhKmKFbpke7hzLEXce";
const currentOperationHash = `0x${"11".repeat(32)}` as Hex;
const preview: GlobalXrplPaymentGuardPreview = {
  chainId: 114,
  xrplSource: source,
  xrplDestination: destination,
  personalAccount: "0x1111111111111111111111111111111111111111",
  instruction: { userOperationHash: currentOperationHash },
};

function successfulEntry(input: {
  hash: string;
  ledgerIndex: number;
  account?: string;
  destination?: string;
  memoData?: string;
  validated?: boolean;
  result?: string;
}) {
  return {
    ledger_index: input.ledgerIndex,
    hash: input.hash,
    validated: input.validated ?? true,
    tx_json: {
      TransactionType: "Payment",
      Account: input.account ?? source,
      Destination: input.destination ?? destination,
      ...(input.memoData === undefined ? {} : { Memos: [{ Memo: { MemoData: input.memoData } }] }),
    },
    meta: { TransactionResult: input.result ?? "tesSUCCESS" },
  };
}

const creationEntry = successfulEntry({
  hash: "A".repeat(64),
  ledgerIndex: 200,
  account: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  destination: source,
});

function feMemo(operationHash: Hex): string {
  return `FE00${"00".repeat(8)}${operationHash.slice(2)}`.toUpperCase();
}

class HistoryClient implements XrplHistoryClient {
  readonly requests: XrplHistoryRequest[] = [];

  constructor(
    private readonly entries: unknown[],
    private readonly options: {
      sequence?: number;
      pageValidated?: boolean;
      completeness?: "absent" | "present" | "rpc-error";
      pageSize?: number;
      repeatMarker?: boolean;
    } = {},
  ) {}

  async request(request: XrplHistoryRequest): Promise<unknown> {
    this.requests.push(request);
    if (request.command === "account_info" && request.ledger_index === "validated") {
      return {
        result: {
          validated: true,
          ledger_index: 1_000,
          account_data: { Account: source, Sequence: this.options.sequence ?? 7 },
        },
      };
    }
    if (request.command === "account_info") {
      if (this.options.completeness === "present") {
        return {
          result: {
            validated: true,
            ledger_index: request.ledger_index,
            account_data: { Account: source, Sequence: 1 },
          },
        };
      }
      if (this.options.completeness === "rpc-error") {
        throw Object.assign(new Error("history unavailable"), { data: { error: "lgrNotFound" } });
      }
      throw Object.assign(new Error("Account not found"), { data: { error: "actNotFound" } });
    }

    const pageSize = this.options.pageSize ?? this.entries.length;
    const offset = typeof request.marker === "object" && request.marker !== null && "offset" in request.marker
      ? Number((request.marker as { offset: unknown }).offset)
      : 0;
    const nextOffset = offset + pageSize;
    const hasMore = nextOffset < this.entries.length;
    return {
      result: {
        account: source,
        ledger_index_min: 100,
        ledger_index_max: 1_000,
        validated: this.options.pageValidated ?? true,
        transactions: this.entries.slice(offset, nextOffset),
        ...(hasMore
          ? { marker: this.options.repeatMarker ? { offset: pageSize } : { offset: nextOffset } }
          : {}),
      },
    };
  }
}

describe("global cross-host XRPL payment guard", () => {
  it("pins two hosts scanning the same validated snapshot to the same XRPL sequence", async () => {
    const first = new HistoryClient([creationEntry], { sequence: 19 });
    const second = new HistoryClient([creationEntry], { sequence: 19 });
    const used = vi.fn(async () => true);

    const [firstSnapshot, secondSnapshot] = await Promise.all([
      assertNoUnresolvedGlobalXrplPayment({ historyClient: first, preview, isTransactionIdUsed: used }),
      assertNoUnresolvedGlobalXrplPayment({ historyClient: second, preview, isTransactionIdUsed: used }),
    ]);

    expect(firstSnapshot.sequence).toBe(19);
    expect(secondSnapshot.sequence).toBe(19);
    expect(firstSnapshot.validatedLedgerIndex).toBe(1_000);
    assertPreparedTransactionSequence({ Sequence: 19 }, firstSnapshot);
    assertPreparedTransactionSequence({ Sequence: 19 }, secondSnapshot);
    expect(() => assertPreparedTransactionSequence({ Sequence: 20 }, firstSnapshot)).toThrow(
      "does not match guarded account sequence 19",
    );
    expect(() => assertPreparedTransactionSequence({ Sequence: 0 }, firstSnapshot)).toThrow(
      "Sequence must be positive",
    );
  });

  it("rejects Ticket-style Sequence zero from the authoritative account snapshot", async () => {
    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient([creationEntry], { sequence: 0 }),
      preview,
      isTransactionIdUsed: async () => true,
    })).rejects.toThrow("account_info Sequence must be positive");
  });

  it("blocks a later host that sees a different unresolved user operation", async () => {
    const conflict = successfulEntry({
      hash: "B".repeat(64),
      ledgerIndex: 300,
      memoData: feMemo(`0x${"22".repeat(32)}` as Hex),
    });
    const used = vi.fn(async () => false);

    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient([creationEntry, conflict]),
      preview,
      isTransactionIdUsed: used,
    })).rejects.toThrow("different unresolved user operation");
    expect(used).toHaveBeenCalledWith(`0x${"b".repeat(64)}`);
  });

  it("routes an unresolved payment for the same operation to recovery instead of paying again", async () => {
    const prior = successfulEntry({
      hash: "C".repeat(64),
      ledgerIndex: 300,
      memoData: feMemo(currentOperationHash),
    });

    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient([creationEntry, prior]),
      preview,
      isTransactionIdUsed: async () => false,
    })).rejects.toThrow("recover/import that payment instead of signing another");
  });

  it("fails closed when the account existed at the history lower bound", async () => {
    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient([creationEntry], { completeness: "present" }),
      preview,
      isTransactionIdUsed: async () => true,
    })).rejects.toThrow("complete account history was not proven");
  });

  it("fails closed on malformed or non-validated paginated history", async () => {
    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient([creationEntry], { pageValidated: false }),
      preview,
      isTransactionIdUsed: async () => true,
    })).rejects.toThrow("did not return validated history");

    const malformed = { ...creationEntry, hash: "not-a-hash" };
    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient([malformed]),
      preview,
      isTransactionIdUsed: async () => true,
    })).rejects.toThrow("is not a 32-byte transaction hash");

    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient([creationEntry], { completeness: "rpc-error" }),
      preview,
      isTransactionIdUsed: async () => true,
    })).rejects.toThrow("could not prove complete XRPL account history");
  });

  it("accepts paginated complete history when every prior matching payment is consumed", async () => {
    const consumed = successfulEntry({
      hash: "D".repeat(64),
      ledgerIndex: 300,
      memoData: feMemo(`0x${"22".repeat(32)}` as Hex),
    });
    const irrelevant = successfulEntry({
      hash: "E".repeat(64),
      ledgerIndex: 301,
      destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
      memoData: feMemo(`0x${"33".repeat(32)}` as Hex),
    });
    const history = new HistoryClient([creationEntry, consumed, irrelevant], { pageSize: 1 });
    const used = vi.fn(async () => true);

    const snapshot = await assertNoUnresolvedGlobalXrplPayment({
      historyClient: history,
      preview,
      isTransactionIdUsed: used,
      pageLimit: 1,
    });

    expect(snapshot).toMatchObject({
      sequence: 7,
      validatedLedgerIndex: 1_000,
      scannedTransactions: 3,
      matchingPayments: 1,
    });
    expect(used).toHaveBeenCalledTimes(1);
    expect(history.requests.filter((request) => request.command === "account_tx")).toHaveLength(3);
  });

  it("fails closed when pagination repeats a marker", async () => {
    await expect(assertNoUnresolvedGlobalXrplPayment({
      historyClient: new HistoryClient(
        [creationEntry, { ...creationEntry, hash: "F".repeat(64), ledger_index: 201 }, { ...creationEntry, hash: "9".repeat(64), ledger_index: 202 }],
        { pageSize: 1, repeatMarker: true },
      ),
      preview,
      isTransactionIdUsed: async () => true,
      pageLimit: 1,
    })).rejects.toThrow("pagination marker repeated");
  });
});
