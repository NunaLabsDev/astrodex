import { parseAstroDexStartAppParam } from "@astrodex/tg-protocol";
import { describe, expect, it } from "vitest";
import { shouldAllowMiniAppAccess } from "./telegram/webapp.js";

describe("@astrodex/tma Telegram gate and routing", () => {
  it("enforces Telegram-exclusive access outside dev override", () => {
    expect(
      shouldAllowMiniAppAccess({
        inTelegram: false,
        allowDevOutsideTelegram: false,
        authStatus: "outside",
      }),
    ).toBe(false);

    expect(
      shouldAllowMiniAppAccess({
        inTelegram: true,
        allowDevOutsideTelegram: false,
        authStatus: "verified",
      }),
    ).toBe(true);
  });

  it("parses token_, scan_, and pair_ startapp parameters cleanly", () => {
    expect(parseAstroDexStartAppParam("token_ASTRO")?.kind).toBe("token");
    expect(parseAstroDexStartAppParam("scan_XLM")?.kind).toBe("scan");
    expect(parseAstroDexStartAppParam("pair_CA32")?.kind).toBe("pair");
  });
});
