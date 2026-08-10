import type {
  XrplLedgerSearchRange,
  XrplTransactionAbsence,
} from "./xrpl-payment-state.js";

type RippledErrorData = {
  error?: unknown;
  searched_all?: unknown;
};

function rippledErrorData(error: unknown): RippledErrorData | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const data = (error as { data?: unknown }).data;
  return typeof data === "object" && data !== null ? data as RippledErrorData : null;
}

export function transactionNotFoundResult(
  error: unknown,
  range?: XrplLedgerSearchRange,
): XrplTransactionAbsence | null {
  const data = rippledErrorData(error);
  if (data?.error !== "txnNotFound") throw error;
  if (range === undefined) return null;
  if (data.searched_all !== true) {
    throw new Error(
      `XRPL history server did not search every ledger in bounded range ` +
        `${range.minLedger}-${range.maxLedger}`,
    );
  }
  return {
    kind: "NOT_FOUND",
    minLedger: range.minLedger,
    maxLedger: range.maxLedger,
    searchedAll: true,
  };
}
