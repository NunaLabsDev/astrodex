import { describe, expect, it } from "vitest";
import { parseServerConfig, parseTmaConfig } from "./config.js";

const VALID_TMA_TESTNET = {
  VITE_STELLAR_NETWORK: "testnet",
  VITE_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  VITE_STELLAR_RPC_URLS: "https://soroban-testnet.stellar.org",
  VITE_HORIZON_URLS: "https://horizon-testnet.stellar.org",
  VITE_API_BASE_URL: "https://astrodex-testnet.pages.dev",
  VITE_TMA_ORIGIN: "https://astrodex-testnet.pages.dev",
  VITE_TG_BOT_USERNAME: "AstroDexTestBot",
  VITE_TG_MINI_APP_SHORT_NAME: "dex",
  VITE_ASTROWALLET_BOT_USERNAME: "AstroWalletAppBot",
  VITE_ASTROWALLET_MINI_APP_SHORT_NAME: "wallet",
  VITE_FRIENDBOT_URL: "https://friendbot.stellar.org",
  VITE_ALLOW_DEV_OUTSIDE_TELEGRAM: "true",
};

const VALID_SERVER_TESTNET = {
  STELLAR_NETWORK: "testnet",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URLS: "https://soroban-testnet.stellar.org",
  HORIZON_URLS: "https://horizon-testnet.stellar.org",
  TMA_ORIGIN: "https://astrodex-testnet.pages.dev",
  ALLOWED_ORIGINS: "https://astrodex-testnet.pages.dev",
  ASTROWALLET_BOT_USERNAME: "AstroWalletAppBot",
  ASTROWALLET_MINI_APP_SHORT_NAME: "wallet",
  TG_BOT_TOKEN: "123456789:test-token-value",
  TG_WEBHOOK_SECRET: "webhook-secret-min-16-chars",
  INTENT_HMAC_SECRET: "intent-hmac-secret-at-least-32-chars-ok",
  FRIENDBOT_URL: "https://friendbot.stellar.org",
};

describe("@astrodex/domain config validation", () => {
  it("parses valid testnet TMA and Server configs with optional Mainnet adapters unset", () => {
    const tma = parseTmaConfig(VALID_TMA_TESTNET);
    expect(tma.network).toBe("testnet");
    expect(tma.reflectorDexOracleContractId).toBeUndefined();
    expect(tma.allowDevOutsideTelegram).toBe(true);

    const server = parseServerConfig(VALID_SERVER_TESTNET);
    expect(server.network).toBe("testnet");
    expect(server.xoxnoSwapApiBase).toBeUndefined();
    expect(server.reflectorDexOracleContractId).toBeUndefined();
  });

  it("hard-blocks Friendbot, dev-outside-telegram, and plaintext http on mainnet", () => {
    expect(() =>
      parseTmaConfig({
        ...VALID_TMA_TESTNET,
        VITE_STELLAR_NETWORK: "mainnet",
        VITE_STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
      }),
    ).toThrow(/VITE_FRIENDBOT_URL/);

    expect(() =>
      parseTmaConfig({
        ...VALID_TMA_TESTNET,
        VITE_STELLAR_NETWORK: "mainnet",
        VITE_STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
        VITE_FRIENDBOT_URL: "",
        VITE_ALLOW_DEV_OUTSIDE_TELEGRAM: "true",
      }),
    ).toThrow(/VITE_ALLOW_DEV_OUTSIDE_TELEGRAM/);

    expect(() =>
      parseServerConfig({
        ...VALID_SERVER_TESTNET,
        STELLAR_NETWORK: "mainnet",
        STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
      }),
    ).toThrow(/FRIENDBOT_URL/);

    expect(() =>
      parseServerConfig({
        ...VALID_SERVER_TESTNET,
        STELLAR_NETWORK: "mainnet",
        STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
        FRIENDBOT_URL: "",
        STELLAR_RPC_URLS: "http://localhost:8000",
      }),
    ).toThrow(/Plaintext http:\/\//);
  });

  it("rejects mismatched network and passphrase", () => {
    expect(() =>
      parseTmaConfig({
        ...VALID_TMA_TESTNET,
        VITE_STELLAR_NETWORK: "mainnet",
        VITE_FRIENDBOT_URL: "",
        VITE_ALLOW_DEV_OUTSIDE_TELEGRAM: "false",
      }),
    ).toThrow(/cannot reference a test network/);
  });
});
