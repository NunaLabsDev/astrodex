import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const PEER_PACKAGES = [
  "@astrodex/stellar-scanner",
  "@astrodex/dex-aggregator",
  "@astrodex/oracles-and-charts",
  "@astrodex/security-shield",
  "@astrodex/tg-protocol",
];

function peerForbiddenFor(selfPkg) {
  return PEER_PACKAGES.filter((pkg) => pkg !== selfPkg).map((pkg) => ({
    name: pkg,
    message: `Peer package import ${pkg} forbidden by hexagonal DAG.`,
  }));
}

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "coverage/**",
      ".agents/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["apps/tma/**/*.ts", "apps/tma/**/*.tsx"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "grammy", message: "apps/tma must never import server bot packages." },
            { name: "hono", message: "apps/tma must never import server framework packages." },
          ],
          patterns: [
            { group: ["cloudflare:*"], message: "apps/tma must never import Cloudflare runtime modules." },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/server/**/*.ts"],
    languageOptions: {
      globals: globals.serviceworker,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "apps/server must never import React." },
            { name: "react-dom", message: "apps/server must never import React DOM." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "@astrodex/domain must stay pure." },
            { name: "react-dom", message: "@astrodex/domain must stay pure." },
            { name: "grammy", message: "@astrodex/domain must stay pure." },
            { name: "hono", message: "@astrodex/domain must stay pure." },
          ],
          patterns: [
            { group: ["@stellar/*"], message: "@astrodex/domain must not depend on Stellar SDKs." },
            { group: ["cloudflare:*"], message: "@astrodex/domain must not depend on Cloudflare." },
            { group: ["@astrodex/*"], message: "@astrodex/domain is the root layer and cannot import peer packages." },
            { group: ["@noble/*"], message: "@astrodex/domain must not depend on crypto primitives." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/stellar-scanner/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "stellar-scanner cannot import UI frameworks." },
            { name: "react-dom", message: "stellar-scanner cannot import UI frameworks." },
            { name: "grammy", message: "stellar-scanner cannot import Telegram bot SDKs." },
            { name: "hono", message: "stellar-scanner cannot import HTTP server frameworks." },
            ...peerForbiddenFor("@astrodex/stellar-scanner"),
          ],
          patterns: [
            { group: ["cloudflare:*"], message: "stellar-scanner cannot import Cloudflare modules." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/dex-aggregator/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "dex-aggregator cannot import UI frameworks." },
            { name: "react-dom", message: "dex-aggregator cannot import UI frameworks." },
            { name: "grammy", message: "dex-aggregator cannot import Telegram bot SDKs." },
            { name: "hono", message: "dex-aggregator cannot import HTTP server frameworks." },
            ...peerForbiddenFor("@astrodex/dex-aggregator"),
          ],
          patterns: [
            { group: ["cloudflare:*"], message: "dex-aggregator cannot import Cloudflare modules." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/oracles-and-charts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "oracles-and-charts cannot import UI frameworks." },
            { name: "react-dom", message: "oracles-and-charts cannot import UI frameworks." },
            { name: "grammy", message: "oracles-and-charts cannot import Telegram bot SDKs." },
            { name: "hono", message: "oracles-and-charts cannot import HTTP server frameworks." },
            ...peerForbiddenFor("@astrodex/oracles-and-charts"),
          ],
          patterns: [
            { group: ["cloudflare:*"], message: "oracles-and-charts cannot import Cloudflare modules." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/security-shield/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "security-shield cannot import UI frameworks." },
            { name: "react-dom", message: "security-shield cannot import UI frameworks." },
            { name: "grammy", message: "security-shield cannot import Telegram bot SDKs." },
            { name: "hono", message: "security-shield cannot import HTTP server frameworks." },
            ...peerForbiddenFor("@astrodex/security-shield"),
          ],
          patterns: [
            { group: ["cloudflare:*"], message: "security-shield cannot import Cloudflare modules directly." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/tg-protocol/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "tg-protocol cannot import UI frameworks." },
            { name: "react-dom", message: "tg-protocol cannot import UI frameworks." },
            { name: "grammy", message: "tg-protocol must stay transport-agnostic." },
            { name: "hono", message: "tg-protocol must stay transport-agnostic." },
            ...peerForbiddenFor("@astrodex/tg-protocol"),
          ],
          patterns: [
            { group: ["cloudflare:*"], message: "tg-protocol cannot import Cloudflare modules." },
          ],
        },
      ],
    },
  },
);
