import { describe, expect, it } from "vitest";
import { deliveredNativePaymentDrops, requestedNativePaymentDrops } from "../src/xrpl.js";

describe("XRPL payment amount compatibility", () => {
  it("accepts XRPL API v2 DeliverMax and legacy Amount", () => {
    expect(requestedNativePaymentDrops({ DeliverMax: "1200000" })).toBe("1200000");
    expect(requestedNativePaymentDrops({ Amount: "1200000" })).toBe("1200000");
  });

  it("rejects issued-currency and malformed payment amounts", () => {
    expect(() => requestedNativePaymentDrops({ DeliverMax: { currency: "XRP" } })).toThrow("native drops");
    expect(() => requestedNativePaymentDrops({ Amount: "1.2" })).toThrow("native drops");
  });

  it("requires exact native delivered_amount metadata", () => {
    expect(deliveredNativePaymentDrops({ delivered_amount: "1200000" })).toBe("1200000");
    expect(() => deliveredNativePaymentDrops({ delivered_amount: "unavailable" })).toThrow("native drops");
    expect(() => deliveredNativePaymentDrops({})).toThrow("missing delivered_amount");
  });
});
