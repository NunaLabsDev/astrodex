import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { Address, xdr } = require(resolve(process.cwd(), "apps/server/node_modules/@stellar/stellar-sdk"));

function loadEnvDefaults() {
  const merged = { ...process.env };
  const envExamplePath = resolve(process.cwd(), "apps/tma/.env.example");
  try {
    const raw = readFileSync(envExamplePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!merged[key]) {
        merged[key] = val;
      }
    }
  } catch {
    // Rely on process.env if .env.example is unavailable
  }
  return merged;
}

function loadHandoffIds() {
  const handoffPath = resolve(process.cwd(), "docs/NEXT_SESSION_HANDOFF.md");
  try {
    const md = readFileSync(handoffPath, "utf8");
    const extract = (label) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`${escaped}[^\\n]*?(C[A-Z2-7]{55})`);
      return md.match(re)?.[1];
    };
    const issuerMatch = md.match(/Circle Testnet USDC Issuer[^G]*(G[A-Z2-7]{55})/);
    const pairMatch = md.match(/Pair `(C[A-Z2-7]{55})`/);
    return {
      astroTokenId: extract("AstroGate Flagship Token"),
      astroPairId: pairMatch?.[1],
      usdcIssuer: issuerMatch?.[1],
      usdcSacId: extract("Circle Testnet USDC Issuer"),
    };
  } catch {
    return {};
  }
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

async function checkContractInstance(rpcUrl, label, contractId) {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
  const rpcRes = await fetchJson(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLedgerEntries",
      params: { keys: [key.toXDR("base64")] },
    }),
  });
  const entries = rpcRes?.result?.entries ?? [];
  const entry = entries[0];
  if (!entry) {
    throw new Error(`${label} (${contractId}) instance entry not found on Testnet RPC`);
  }
  return {
    label,
    contractId,
    liveUntilLedgerSeq: entry.liveUntilLedgerSeq ?? null,
    lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq ?? null,
  };
}

async function main() {
  const env = loadEnvDefaults();
  const handoff = loadHandoffIds();

  const horizonUrl = (env.HORIZON_URLS || env.VITE_HORIZON_URLS || "").split(",")[0]?.trim();
  const rpcUrl = (env.STELLAR_RPC_URLS || env.VITE_STELLAR_RPC_URLS || "").split(",")[0]?.trim();
  if (!horizonUrl || !rpcUrl) {
    throw new Error("Missing HORIZON_URLS / STELLAR_RPC_URLS in env or apps/tma/.env.example");
  }

  const astroTokenId = env.TESTNET_ASTRO_TOKEN_ID || handoff.astroTokenId;
  const astroPairId = env.TESTNET_ASTRO_PAIR_ID || handoff.astroPairId;
  const launchpadId = env.VITE_ASTROGATE_LAUNCHPAD_CONTRACT_ID;
  const sorobitsId = env.VITE_ASTROWALLET_SOROBITS_CONTRACT_ID;
  const usdcSacId = env.TESTNET_USDC_SAC_ID || handoff.usdcSacId;
  const usdcIssuer = env.TESTNET_USDC_ISSUER || handoff.usdcIssuer;

  if (!astroTokenId || !astroPairId || !launchpadId || !sorobitsId || !usdcSacId || !usdcIssuer) {
    throw new Error("Missing one or more Testnet contract/asset IDs from env/docs");
  }

  const cleanHorizon = horizonUrl.replace(/\/+$/, "");

  // 1. Soroban RPC latest ledger + 5 live ecosystem contracts
  const latestLedger = await fetchJson(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
  });

  const contractChecks = await Promise.all([
    checkContractInstance(rpcUrl, "$ASTRO Token", astroTokenId),
    checkContractInstance(rpcUrl, "ASTRO/XLM Soroswap Pair", astroPairId),
    checkContractInstance(rpcUrl, "AstroGate Launchpad v4.5", launchpadId),
    checkContractInstance(rpcUrl, "Testnet USDC SAC", usdcSacId),
    checkContractInstance(rpcUrl, "Sorobits SEP-50", sorobitsId),
  ]);

  // 2. Classic Horizon /order_book (XLM / Testnet USDC) & /liquidity_pools
  const orderBook = await fetchJson(
    `${cleanHorizon}/order_book?selling_asset_type=native&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=${encodeURIComponent(usdcIssuer)}&limit=5`,
  );
  const pools = await fetchJson(`${cleanHorizon}/liquidity_pools?limit=3`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        horizonUrl: cleanHorizon,
        rpcUrl,
        latestLedger: latestLedger?.result?.sequence ?? null,
        contracts: contractChecks,
        orderBook: {
          bids: (orderBook?.bids ?? []).length,
          asks: (orderBook?.asks ?? []).length,
        },
        liquidityPoolsReturned: (pools?._embedded?.records ?? []).length,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("Testnet verification failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
