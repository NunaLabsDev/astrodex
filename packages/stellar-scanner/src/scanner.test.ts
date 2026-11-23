import { describe, expect, it } from "vitest";
import {
  auditClassicIssuerLockForAccount,
  computeAstroShieldScore,
  computeHolderDistribution,
  createStellarForensicScanner,
  parseStellarTomlForAsset,
} from "./index.js";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const FAKE_ISSUER = "GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE";
const ASTRO_TOKEN = "CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE";

describe("@astrodex/stellar-scanner", () => {
  it("flags hidden secondary co-signers even when master_weight is 0", () => {
    const unlocked = auditClassicIssuerLockForAccount(ISSUER, {
      thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
      signers: [
        { key: ISSUER, weight: 0 },
        { key: FAKE_ISSUER, weight: 2 },
      ],
      flags: { auth_immutable: true },
    });
    expect(unlocked.locked).toBe(false);
    expect(unlocked.combinedSecondaryWeight).toBe(2);

    const locked = auditClassicIssuerLockForAccount(ISSUER, {
      thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
      signers: [
        { key: ISSUER, weight: 0 },
        { key: FAKE_ISSUER, weight: 1 },
      ],
      flags: { auth_immutable: true },
    });
    expect(locked.locked).toBe(true);
  });

  it("hard-blocks spoofed protected tickers and builds valid Protocol 23 ExtendTTL XDR", async () => {
    const scanner = createStellarForensicScanner({
      network: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrls: ["https://rpc.example.com"],
      horizonUrls: ["https://horizon.example.com"],
      sep42AssetListUrls: ["https://sep42.example.com/list.json"],
      fetchFn: async (url) => {
        if (url.includes("sep42.example.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              assets: [{ code: "USDC", issuer: ISSUER, name: "USD Coin" }],
            }),
            text: async () => "",
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
            signers: [{ key: FAKE_ISSUER, weight: 1 }],
            flags: { auth_revocable: true },
          }),
          text: async () => "",
        };
      },
    });

    const spoofReport = await scanner.auditToken(`USDC:${FAKE_ISSUER}`);
    expect(spoofReport.verdict).toBe("malicious");
    expect(spoofReport.astroShieldScore).toBe(0);
    expect(spoofReport.trustTier).toBe("spoof_blocked");

    const xdr = await scanner.buildExtendTtlXdr!(ASTRO_TOKEN, FAKE_ISSUER);
    expect(xdr.length).toBeGreaterThan(40);
  });

  it("computes AstroGate v4.5 score, SEP-1 stellar.toml currency metadata, and whale concentration", () => {
    const meta = parseStellarTomlForAsset(
      `[DOCUMENTATION]\nORG_NAME="Circle"\n[[CURRENCIES]]\ncode="USDC"\nissuer="${ISSUER}"\nname="USD Coin"\nimage="https://example.com/usdc.png"`,
      "USDC",
      ISSUER,
    );
    expect(meta?.orgName).toBe("Circle");
    expect(meta?.image).toBe("https://example.com/usdc.png");

    const holders = computeHolderDistribution({
      totalSupplyBase: 10_000_000n * 10_000_000n,
      pairId: ASTRO_TOKEN,
      snapshots: [
        { address: ASTRO_TOKEN, balanceBase: 3_300_000n * 10_000_000n, isPoolOrContract: true },
        { address: FAKE_ISSUER, balanceBase: 500_000n * 10_000_000n },
      ],
    });
    expect(holders.largestNonPoolHolderPct).toBe(5);

    const score = computeAstroShieldScore({
      kind: "soroban",
      code: "ASTRO",
      isSpoofedProtectedTicker: false,
      isSep42Verified: false,
      directoryTags: [],
      sorobanAudit: {
        owner: null,
        ownerRenounced: true,
        dangerousMethods: [],
        sep55Verified: true,
        registryVerified: true,
        astroGate: {
          isLaunchpadToken: true,
          version: "v4.5",
          graduated: true,
          curveClosed: false,
          curveXlmNetStroops: "10000000000",
          graduationProgressPct: 100,
          lpProtection: "locked_7y",
          lpLockedPercent: 100,
          has48hTimelock: true,
        },
      },
      holders,
    });
    expect(score.verdict).toBe("safe");
    expect(score.astroShieldScore).toBe(100);
  });

  it("recognizes canonical LayerZero V2 OFT assets (USDE/SUSDE/USDT0) and blocks spoofed tickers", async () => {
    const { findKnownLayerZeroOftAsset } = await import("./classic/index.js");

    const usde = findKnownLayerZeroOftAsset({
      code: "USDE",
      issuer: "GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47",
    });
    expect(usde?.sacId).toBe("CCNOV6XVI2O5BSTA3232GIRUQULDEBV7IWGKM6QKI6II5OIIQTU24JJN");

    const usdt0 = findKnownLayerZeroOftAsset({
      contractId: "CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF",
    });
    expect(usdt0?.code).toBe("USDT0");

    const oftScore = computeAstroShieldScore({
      kind: "classic",
      code: "USDE",
      isSpoofedProtectedTicker: false,
      isSep42Verified: false,
      isLayerZeroOftVerified: true,
      directoryTags: [],
      classicAudit: {
        locked: false,
        masterWeight: 0,
        lowThreshold: 1,
        medThreshold: 1,
        highThreshold: 1,
        combinedSecondaryWeight: 1,
        flags: {
          authRequired: false,
          authRevocable: false,
          authImmutable: false,
          authClawbackEnabled: false,
        },
      },
    });
    expect(oftScore.verdict).toBe("safe");
    expect(oftScore.trustTier).toBe("official");
    expect(oftScore.astroShieldScore).toBe(100);

    const spoofScore = computeAstroShieldScore({
      kind: "classic",
      code: "USDE",
      isSpoofedProtectedTicker: true,
      isSep42Verified: false,
      isLayerZeroOftVerified: false,
      directoryTags: [],
    });
    expect(spoofScore.verdict).toBe("malicious");
    expect(spoofScore.trustTier).toBe("spoof_blocked");
    expect(spoofScore.astroShieldScore).toBe(0);
  });
});
