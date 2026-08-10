import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { buildAtomicSubscribePreview } from "../src/preflight.js";
import { buildCancelWithdrawPreview } from "../src/control.js";
import { STANDING_V2_CAPABILITY } from "../src/standing-v2.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;

describe("V2 subscription preflight", () => {
  it("does not require Personal Account C2FLR when every 0xFE call carries zero value", async () => {
    const controller = address("1");
    const assetManager = address("2");
    const personalAccount = address("3");
    const fxrp = address("4");
    const standing = address("5");
    const merchant = address("6");
    const client = {
      readContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        if (request.functionName === "standingIdentity") return [2n, STANDING_V2_CAPABILITY] as const;
        if (request.functionName === "getContractAddressByName") {
          return request.args?.[0] === "MasterAccountController" ? controller : assetManager;
        }
        if (request.functionName === "getPersonalAccount") return personalAccount;
        if (request.functionName === "fAsset") return fxrp;
        if (request.functionName === "directMintingPaymentAddress") return "rCoreVault";
        if (request.functionName === "getDirectMintingExecutorFeeUBA") return 100_000n;
        if (request.functionName === "getDirectMintingFeeBIPS") return 100n;
        if (request.functionName === "getDirectMintingMinimumFeeUBA") return 100_000n;
        if (request.functionName === "paused") return false;
        if (request.functionName === "plans") return [merchant, 0n, 100_000n, 86_400, true] as const;
        if (request.functionName === "decimals") return 6;
        if (request.functionName === "getNonce") return 0n;
        throw new Error(`unexpected read ${request.functionName}`);
      }),
      getBalance: vi.fn(async () => 0n),
    };
    const preview = await buildAtomicSubscribePreview({
      xrplAddress: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
      planId: 4n,
      deposit: "1",
      maxInitialChargeFxrp: "0.2",
      standing,
      client: client as never,
    });
    expect(preview.operation).toBe("SUBSCRIBE_V2");
    expect(preview.readiness).toBe("READY");
    expect(preview.checks.personalAccountHasC2Flr).toBe(false);
    expect(preview.checks.personalAccountC2FlrRequired).toBe(false);
    expect(preview.instruction.calls.every((call) => call.value === "0")).toBe(true);
  });

  it("surfaces and enforces the current FTSO-derived gross initial quote", async () => {
    const controller = address("1");
    const assetManager = address("2");
    const personalAccount = address("3");
    const fxrp = address("4");
    const standing = address("5");
    const merchant = address("6");
    const adapter = address("7");
    const client = {
      readContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        if (request.functionName === "standingIdentity") return [2n, STANDING_V2_CAPABILITY] as const;
        if (request.functionName === "getContractAddressByName") {
          return request.args?.[0] === "MasterAccountController" ? controller : assetManager;
        }
        if (request.functionName === "getPersonalAccount") return personalAccount;
        if (request.functionName === "fAsset") return fxrp;
        if (request.functionName === "directMintingPaymentAddress") return "rCoreVault";
        if (request.functionName === "getDirectMintingExecutorFeeUBA") return 100_000n;
        if (request.functionName === "getDirectMintingFeeBIPS") return 100n;
        if (request.functionName === "getDirectMintingMinimumFeeUBA") return 100_000n;
        if (request.functionName === "paused") return false;
        if (request.functionName === "plans") return [merchant, 1_000_000n, 0n, 86_400, true] as const;
        if (request.functionName === "decimals") return 6;
        if (request.functionName === "getNonce") return 0n;
        if (request.functionName === "priceAdapter") return adapter;
        if (request.functionName === "maxPriceAge") return 300n;
        if (request.functionName === "getFxrpForUsdMicro") return [150_000n, 900n] as const;
        throw new Error(`unexpected read ${request.functionName}`);
      }),
      getBalance: vi.fn(async () => 0n),
      getBlock: vi.fn(async () => ({ timestamp: 1_000n })),
    };
    const base = {
      xrplAddress: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
      planId: 4n,
      deposit: "1",
      standing,
      client: client as never,
    };
    const preview = await buildAtomicSubscribePreview({ ...base, maxInitialChargeFxrp: "0.2" });
    expect(preview.quotedInitialChargeFxrp).toEqual({
      display: "0.15",
      atomic: "150000",
      decimals: 6,
      updatedAt: "900",
      source: "FTSO_ADAPTER",
    });
    await expect(buildAtomicSubscribePreview({ ...base, maxInitialChargeFxrp: "0.149999" })).rejects.toThrow("below the quoted first charge");
  });

  it("fails closed on the current V1 shape before resolving any payment dependency", async () => {
    const client = {
      readContract: vi.fn(async (request: { functionName: string }) => {
        if (request.functionName === "standingIdentity") throw new Error("function returned no data");
        throw new Error(`unexpected read ${request.functionName}`);
      }),
    };

    await expect(buildAtomicSubscribePreview({
      xrplAddress: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
      planId: 4n,
      deposit: "1",
      maxInitialChargeFxrp: "0.2",
      standing: address("5"),
      client: client as never,
    })).rejects.toThrow("does not expose the required V2 identity");
    expect(client.readContract).toHaveBeenCalledTimes(1);
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "standingIdentity" }));
  });

  it("rejects a deployment that returns the wrong V2 capability", async () => {
    const client = {
      readContract: vi.fn(async () => [2n, `0x${"00".repeat(32)}`] as const),
    };

    await expect(buildAtomicSubscribePreview({
      xrplAddress: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
      planId: 4n,
      deposit: "1",
      maxInitialChargeFxrp: "0.2",
      standing: address("5"),
      client: client as never,
    })).rejects.toThrow("has an incompatible identity");
    expect(client.readContract).toHaveBeenCalledTimes(1);
  });
});

describe("cancel-withdraw preflight", () => {
  it("discloses the new direct mint and FXRP-only return destination", async () => {
    const controller = address("1");
    const assetManager = address("2");
    const personalAccount = address("3");
    const fxrp = address("4");
    const standing = address("5");
    const merchant = address("6");
    const client = {
      readContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        if (request.functionName === "standingIdentity") return [2n, STANDING_V2_CAPABILITY] as const;
        if (request.functionName === "getContractAddressByName") {
          return request.args?.[0] === "MasterAccountController" ? controller : assetManager;
        }
        if (request.functionName === "getPersonalAccount") return personalAccount;
        if (request.functionName === "fAsset") return fxrp;
        if (request.functionName === "directMintingPaymentAddress") return "rCoreVault";
        if (request.functionName === "getDirectMintingExecutorFeeUBA") return 100_000n;
        if (request.functionName === "getDirectMintingFeeBIPS") return 100n;
        if (request.functionName === "getDirectMintingMinimumFeeUBA") return 100_000n;
        if (request.functionName === "mandates") return [4n, personalAccount, 1_000_000n, 700_000n, 200n, 100n, false] as const;
        if (request.functionName === "decimals") return 6;
        if (request.functionName === "getNonce") return 1n;
        if (request.functionName === "plans") return [merchant, 0n, 100_000n, 86_400, true] as const;
        throw new Error(`unexpected read ${request.functionName}`);
      }),
      getBalance: vi.fn(async () => 0n),
    };
    const preview = await buildCancelWithdrawPreview({
      xrplAddress: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
      mandateId: 5n,
      authorizationMint: "0.1",
      standing,
      client: client as never,
    });
    expect(preview.operation).toBe("CANCEL_WITHDRAW");
    expect(preview.control.action).toBe("CANCEL_AND_WITHDRAW");
    expect(preview.control.reviewWarning).toContain("same Personal Account");
    expect(preview.control.reviewWarning).toContain("entire operation reverts");
    expect(preview.control.reviewWarning).toContain("does not return native XRP to the XRPL address");
    expect(preview.instruction.calls).toHaveLength(1);
    expect(preview.readiness).toBe("READY");
  });

  it("fails closed on a V1 mandate before constructing a cancellation payment", async () => {
    const client = {
      readContract: vi.fn(async (request: { functionName: string }) => {
        if (request.functionName === "standingIdentity") throw new Error("function returned no data");
        throw new Error(`unexpected read ${request.functionName}`);
      }),
    };

    await expect(buildCancelWithdrawPreview({
      xrplAddress: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59",
      mandateId: 5n,
      authorizationMint: "0.1",
      standing: address("5"),
      client: client as never,
    })).rejects.toThrow("does not expose the required V2 identity");
    expect(client.readContract).toHaveBeenCalledTimes(1);
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "standingIdentity" }));
  });
});
