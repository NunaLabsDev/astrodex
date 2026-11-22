import { Account, Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  createPreSignSecurityShield,
  inspectRawXdrInWorker,
} from "./index.js";

const TESTNET_PASS = "Test SDF Network ; September 2015";
const SOURCE = "GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE";
const ATTACKER = "GB6CISIU2PAG7MVCR4HKA27VY5OBBJ4P2L5IDEOH7UL34TU66OOFCNZA";
const OFFICIAL_USDC = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("@astrodex/security-shield", () => {
  it("blocks drainer setOptions/accountMerge and spoofed protected tickers", async () => {
    const shield = createPreSignSecurityShield({
      networkPassphrase: TESTNET_PASS,
      rpcUrls: ["https://rpc.example.com"],
      verifiedAssets: [{ code: "USDC", issuer: OFFICIAL_USDC }],
    });

    const drainerTx = new TransactionBuilder(new Account(SOURCE, "1"), {
      fee: "100",
      networkPassphrase: TESTNET_PASS,
    })
      .addOperation(
        Operation.setOptions({
          masterWeight: 0,
          signer: { ed25519PublicKey: ATTACKER, weight: 1 },
        }),
      )
      .setTimeout(60)
      .build();

    const drainerReport = await shield.scanTransactionXdr(drainerTx.toXDR());
    expect(drainerReport.verdict).toBe("malicious");
    expect(drainerReport.findings.some((f) => f.blocksSigning)).toBe(true);

    const spoofOrderTx = new TransactionBuilder(new Account(SOURCE, "2"), {
      fee: "100",
      networkPassphrase: TESTNET_PASS,
    })
      .addOperation(
        Operation.manageBuyOffer({
          selling: Asset.native(),
          buying: new Asset("USDC", ATTACKER),
          buyAmount: "10",
          price: "1",
          offerId: "0",
        }),
      )
      .setTimeout(60)
      .build();

    const spoofReport = await shield.scanTransactionXdr(spoofOrderTx.toXDR());
    expect(spoofReport.verdict).toBe("malicious");
    expect(spoofReport.findings.some((f) => f.code === "SPOOFED_PROTECTED_ASSET")).toBe(true);
  });

  it("passes clean XLM limit orders and inspects raw XDR via worker helper", async () => {
    const shield = createPreSignSecurityShield({
      networkPassphrase: TESTNET_PASS,
      rpcUrls: ["https://rpc.example.com"],
      verifiedAssets: [{ code: "USDC", issuer: OFFICIAL_USDC }],
    });

    const cleanTx = new TransactionBuilder(new Account(SOURCE, "3"), {
      fee: "100",
      networkPassphrase: TESTNET_PASS,
    })
      .addOperation(
        Operation.manageBuyOffer({
          selling: Asset.native(),
          buying: new Asset("USDC", OFFICIAL_USDC),
          buyAmount: "25",
          price: "4",
          offerId: "0",
        }),
      )
      .setTimeout(60)
      .build();

    const report = await shield.scanTransactionXdr(cleanTx.toXDR());
    expect(report.verdict).toBe("safe");

    const pretty = await inspectRawXdrInWorker(cleanTx.toXDR(), TESTNET_PASS);
    expect(pretty).toContain("manageBuyOffer");
  });
});
