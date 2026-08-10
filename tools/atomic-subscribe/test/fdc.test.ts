import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, serializeTransaction, type AbiParameter, type Address, type Hex } from "viem";
import { xrpPaymentVerificationAbi } from "../src/abis.js";
import { obtainXrpPaymentProof, type FdcProofRequestState } from "../src/fdc.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const transactionId = `0x${"ab".repeat(32)}` as Hex;
const proofOwner = address("1");
const signedFdcTransaction = (nonce: number, signatureDigit: string) => serializeTransaction({
  type: "eip1559",
  chainId: 114,
  nonce,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  gas: 21_000n,
  to: address("2"),
  value: 1n,
}, {
  r: `0x${signatureDigit.repeat(64)}` as Hex,
  s: `0x${"2".repeat(64)}` as Hex,
  yParity: 0,
});
const serializedRequestTransaction = signedFdcTransaction(7, "1");
const requestTransactionHash = keccak256(serializedRequestTransaction);
const responseAbi = (
  xrpPaymentVerificationAbi.find((item) => item.type === "function" && item.name === "verifyXRPPayment") as {
    inputs: readonly { components?: readonly AbiParameter[] }[];
  }
).inputs[0]!.components![1]!;
const responseHex = encodeAbiParameters(
  [responseAbi],
  [{
    attestationType: `0x${"01".repeat(32)}`,
    sourceId: `0x${"02".repeat(32)}`,
    votingRound: 5n,
    lowestUsedTimestamp: 100n,
    requestBody: { transactionId, proofOwner },
    responseBody: {
      blockNumber: 1n,
      blockTimestamp: 100n,
      sourceAddress: "rSource",
      sourceAddressHash: `0x${"03".repeat(32)}`,
      receivingAddressHash: `0x${"04".repeat(32)}`,
      intendedReceivingAddressHash: `0x${"04".repeat(32)}`,
      spentAmount: 1_200_000n,
      intendedSpentAmount: 1_200_000n,
      receivedAmount: 1_200_000n,
      intendedReceivedAmount: 1_200_000n,
      hasMemoData: true,
      firstMemoData: "0xfe",
      hasDestinationTag: false,
      destinationTag: 0n,
      status: 0,
    },
  }],
);

afterEach(() => vi.unstubAllGlobals());

describe("durable FDC proof acquisition", () => {
  it("resumes a persisted request without paying for a second attestation", async () => {
    const registryAddresses: Record<string, Address> = {
      FdcHub: address("2"),
      FlareSystemsManager: address("3"),
      Relay: address("4"),
      FdcVerification: address("5"),
    };
    const client = {
      readContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        if (request.functionName === "getContractAddressByName") return registryAddresses[String(request.args?.[0])];
        if (request.functionName === "fdcRequestFeeConfigurations") return address("6");
        if (request.functionName === "getRequestFee") return 1n;
        if (request.functionName === "firstVotingRoundStartTs") return 100n;
        if (request.functionName === "votingEpochDurationSeconds") return 10n;
        if (request.functionName === "fdcProtocolId") return 7;
        if (request.functionName === "isFinalized") return true;
        throw new Error(`unexpected read ${request.functionName}`);
      }),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 10n })),
      getBlock: vi.fn(async () => ({ timestamp: 150n })),
      sendRawTransaction: vi.fn(async () => requestTransactionHash),
      getTransaction: vi.fn(async () => ({ hash: requestTransactionHash })),
    };
    const walletClient = {
      chain: { id: 114 },
      account: { address: proofOwner },
      prepareTransactionRequest: vi.fn(async (request: unknown) => ({ ...(request as object), nonce: 7 })),
      signTransaction: vi.fn(async () => serializedRequestTransaction),
    };
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.includes("prepareRequest")
        ? { status: "VALID", abiEncodedRequest: "0x1234" }
        : { response_hex: responseHex, proof: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const states: FdcProofRequestState[] = [];

    const first = await obtainXrpPaymentProof({
      transactionId,
      proofOwner,
      client: client as never,
      walletClient: walletClient as never,
      verifierUrl: "https://verifier.invalid",
      verifierApiKey: "secret",
      daLayerUrl: "https://da.invalid",
      onState: async (state) => {
        states.push(structuredClone(state));
      },
    });
    expect(states.map((state) => state.phase)).toEqual(["PREPARED", "SIGNED", "REQUESTED", "ROUND_IDENTIFIED"]);
    expect(walletClient.signTransaction).toHaveBeenCalledTimes(1);
    expect(client.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(first.proof.data.requestBody.transactionId).toBe(transactionId);

    for (const persisted of states) {
      walletClient.signTransaction.mockClear();
      client.sendRawTransaction.mockClear();
      fetchMock.mockClear();
      const resumed = await obtainXrpPaymentProof({
        transactionId,
        proofOwner,
        client: client as never,
        walletClient: walletClient as never,
        verifierUrl: "https://verifier.invalid",
        verifierApiKey: "secret",
        daLayerUrl: "https://da.invalid",
        resume: persisted,
      });
      expect(walletClient.signTransaction).toHaveBeenCalledTimes(persisted.phase === "PREPARED" ? 1 : 0);
      expect(client.sendRawTransaction).toHaveBeenCalledTimes(
        persisted.phase === "PREPARED" || persisted.phase === "SIGNED" || persisted.phase === "REQUESTED" ? 1 : 0,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("proof-by-request-round-raw");
      expect(resumed.proof.data.responseBody.receivedAmount).toBe(1_200_000n);
    }
  });

  it("checkpoints a reverted request and advances its nonce exactly once on a later invocation", async () => {
    const registryAddresses: Record<string, Address> = {
      FdcHub: address("2"),
      FlareSystemsManager: address("3"),
      Relay: address("4"),
      FdcVerification: address("5"),
    };
    const revertedSerializedTransaction = signedFdcTransaction(7, "3");
    const revertedTransactionHash = keccak256(revertedSerializedTransaction);
    const freshSerializedTransaction = signedFdcTransaction(8, "4");
    const freshTransactionHash = keccak256(freshSerializedTransaction);
    const client = {
      readContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[] }) => {
        if (request.functionName === "getContractAddressByName") return registryAddresses[String(request.args?.[0])];
        if (request.functionName === "fdcRequestFeeConfigurations") return address("6");
        if (request.functionName === "getRequestFee") return 1n;
        if (request.functionName === "firstVotingRoundStartTs") return 100n;
        if (request.functionName === "votingEpochDurationSeconds") return 10n;
        if (request.functionName === "fdcProtocolId") return 7;
        if (request.functionName === "isFinalized") return true;
        throw new Error(`unexpected read ${request.functionName}`);
      }),
      getTransactionCount: vi.fn(async () => 7),
      waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => hash === revertedTransactionHash
        ? { status: "reverted", blockNumber: 20n }
        : { status: "success", blockNumber: 21n }),
      getBlock: vi.fn(async () => ({ timestamp: 160n })),
      sendRawTransaction: vi.fn(async ({ serializedTransaction }: { serializedTransaction: Hex }) =>
        keccak256(serializedTransaction)),
    };
    const walletClient = {
      chain: { id: 114 },
      account: { address: proofOwner },
      prepareTransactionRequest: vi.fn(async (request: unknown) => request),
      signTransaction: vi.fn(async () => freshSerializedTransaction),
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("prepareRequest")) throw new Error("settled XRPL payment must not be prepared again");
      return new Response(JSON.stringify({ response_hex: responseHex, proof: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const requested: FdcProofRequestState = {
      version: 1,
      transactionId,
      proofOwner,
      requestBytes: "0x1234",
      phase: "REQUESTED",
      requestTransactionHash: revertedTransactionHash,
      serializedRequestTransaction: revertedSerializedTransaction,
      requestTransactionNonce: 7,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:01:00.000Z",
    };

    let retryable: FdcProofRequestState | undefined;
    await expect(obtainXrpPaymentProof({
      transactionId,
      proofOwner,
      client: client as never,
      walletClient: walletClient as never,
      verifierUrl: "https://verifier.invalid",
      verifierApiKey: "secret",
      daLayerUrl: "https://da.invalid",
      resume: requested,
      onState: async (state) => {
        retryable = structuredClone(state);
      },
    })).rejects.toThrow("retry state persisted, rerun once after revalidation");

    expect(retryable).toMatchObject({
      phase: "RETRYABLE",
      transactionId,
      proofOwner,
      requestBytes: "0x1234",
      minimumRequestNonce: 8,
      revertedRequestTransactions: [{
        transactionHash: revertedTransactionHash,
        nonce: 7,
        blockNumber: "20",
      }],
    });
    expect(retryable?.requestTransactionHash).toBeUndefined();
    expect(retryable?.serializedRequestTransaction).toBeUndefined();
    expect(retryable?.requestTransactionNonce).toBeUndefined();
    expect(walletClient.prepareTransactionRequest).not.toHaveBeenCalled();
    expect(walletClient.signTransaction).not.toHaveBeenCalled();
    expect(client.getTransactionCount).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    let signedRetry: FdcProofRequestState | undefined;
    await expect(obtainXrpPaymentProof({
      transactionId,
      proofOwner,
      client: client as never,
      walletClient: walletClient as never,
      verifierUrl: "https://verifier.invalid",
      verifierApiKey: "secret",
      daLayerUrl: "https://da.invalid",
      resume: retryable!,
      onState: async (state) => {
        if (state.phase === "SIGNED") {
          signedRetry = structuredClone(state);
          throw new Error("simulated crash after durable retry signing");
        }
      },
    })).rejects.toThrow("simulated crash after durable retry signing");

    expect(client.getTransactionCount).toHaveBeenCalledWith({ address: proofOwner, blockTag: "pending" });
    expect(walletClient.prepareTransactionRequest).toHaveBeenCalledWith(expect.objectContaining({ nonce: 8 }));
    expect(walletClient.signTransaction).toHaveBeenCalledTimes(1);
    expect(signedRetry).toMatchObject({
      phase: "SIGNED",
      requestTransactionHash: freshTransactionHash,
      serializedRequestTransaction: freshSerializedTransaction,
      requestTransactionNonce: 8,
      minimumRequestNonce: 8,
    });
    expect(client.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(client.sendRawTransaction).toHaveBeenLastCalledWith({
      serializedTransaction: revertedSerializedTransaction,
    });

    const result = await obtainXrpPaymentProof({
      transactionId,
      proofOwner,
      client: client as never,
      walletClient: walletClient as never,
      verifierUrl: "https://verifier.invalid",
      verifierApiKey: "secret",
      daLayerUrl: "https://da.invalid",
      resume: signedRetry!,
    });

    expect(walletClient.prepareTransactionRequest).toHaveBeenCalledTimes(1);
    expect(walletClient.signTransaction).toHaveBeenCalledTimes(1);
    expect(client.sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(client.sendRawTransaction).toHaveBeenLastCalledWith({
      serializedTransaction: freshSerializedTransaction,
    });
    expect(result.state.requestTransactionHash).toBe(freshTransactionHash);
    expect(result.state.revertedRequestTransactions).toHaveLength(1);
    expect(result.proof.data.requestBody.transactionId).toBe(transactionId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("proof-by-request-round-raw");
  });
});
