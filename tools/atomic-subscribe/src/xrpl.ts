type XrplPaymentJson = {
  Amount?: unknown;
  DeliverMax?: unknown;
};

export function requestedNativePaymentDrops(payment: XrplPaymentJson): string {
  const amount = payment.DeliverMax ?? payment.Amount;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new Error("XRPL payment does not contain a native drops amount");
  }
  return amount;
}

export function deliveredNativePaymentDrops(meta: unknown): string {
  if (meta === null || typeof meta !== "object" || !("delivered_amount" in meta)) {
    throw new Error("validated XRPL payment is missing delivered_amount");
  }
  const delivered = (meta as { delivered_amount?: unknown }).delivered_amount;
  if (typeof delivered !== "string" || !/^\d+$/.test(delivered)) {
    throw new Error("XRPL payment did not deliver a native drops amount");
  }
  return delivered;
}
