import { describe, expect, it } from "vitest";
import { transactionNotFoundResult } from "../src/xrpl-history.js";

const range = { minLedger: 100, maxLedger: 120 };

function notFound(searchedAll: unknown, includeFlag = true) {
  return {
    data: {
      error: "txnNotFound",
      ...(includeFlag ? { searched_all: searchedAll } : {}),
    },
  };
}

describe("bounded XRPL history lookup", () => {
  it("accepts txnNotFound only when the complete bounded range was searched", () => {
    expect(transactionNotFoundResult(notFound(true), range)).toEqual({
      kind: "NOT_FOUND",
      minLedger: 100,
      maxLedger: 120,
      searchedAll: true,
    });
  });

  it("fails closed when the history server reports a pruned range", () => {
    expect(() => transactionNotFoundResult(notFound(false), range)).toThrow(
      "did not search every ledger",
    );
  });

  it("fails closed when txnNotFound omits searched_all", () => {
    expect(() => transactionNotFoundResult(notFound(undefined, false), range)).toThrow(
      "did not search every ledger",
    );
  });

  it("treats unbounded txnNotFound as unknown rather than a proof", () => {
    expect(transactionNotFoundResult(notFound(true))).toBeNull();
  });
});
