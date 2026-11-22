import { describe, expect, it } from "vitest";
import {
  calculateAccountReserveSummary,
  defaultCapabilitiesForKind,
} from "./accounts.js";
import {
  calculateMinReceivedStroops7,
  formatStroops7,
  normalizeAssetIdentifier,
  parseDecimalToStroops7,
} from "./assets.js";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const CONTRACT = "CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE";

describe("@astrodex/domain assets and accounts", () => {
  it("normalizes XLM, classic CODE:G..., and Soroban C... identifiers", () => {
    expect(normalizeAssetIdentifier("native")).toEqual({
      kind: "native",
      canonicalKey: "XLM",
      code: "XLM",
    });
    expect(normalizeAssetIdentifier(`USDC:${ISSUER}`)).toEqual({
      kind: "classic",
      canonicalKey: `USDC:${ISSUER}`,
      code: "USDC",
      issuer: ISSUER,
    });
    expect(normalizeAssetIdentifier(CONTRACT, "ASTRO")).toEqual({
      kind: "soroban",
      canonicalKey: CONTRACT,
      code: "ASTRO",
      contractId: CONTRACT,
    });
  });

  it("computes exact 7-decimal stroops integer math without float drift", () => {
    expect(parseDecimalToStroops7("1.2345678")).toBe(12_345_678n);
    expect(formatStroops7(12_345_678n)).toBe("1.2345678");
    expect(formatStroops7(10_500_000n, true)).toBe("1.05");
    expect(calculateMinReceivedStroops7("100.0000000", 100)).toBe(990_000_000n);
  });

  it("enforces honest Classic G... vs Smart Account C... capabilities and reserves", () => {
    expect(defaultCapabilitiesForKind("classic").canPlaceClassicSdexOffers).toBe(true);
    expect(defaultCapabilitiesForKind("smart").canPlaceClassicSdexOffers).toBe(false);

    const summary = calculateAccountReserveSummary({
      nativeBalanceXlm: "10.0000000",
      subentryCount: 3,
      balances: [
        { assetCode: "XLM", balance: "10.0000000" },
        { assetCode: "USDC", assetIssuer: ISSUER, balance: "0.0000000" },
      ],
    });
    expect(summary.minReserveXlm).toBe("2.5");
    expect(summary.spendableXlm).toBe("7.5000000");
    expect(summary.reclaimableTrustlines).toHaveLength(1);
    expect(summary.reclaimableXlm).toBe("0.5");
  });
});
