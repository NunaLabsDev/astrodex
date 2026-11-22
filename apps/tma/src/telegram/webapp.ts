import { useEffect } from "react";

export interface TelegramWebAppInstance {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { id?: number; username?: string };
  };
  viewportStableHeight?: number;
  safeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
  contentSafeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  openTelegramLink?(url: string): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
}

export type TelegramAuthStatus = "checking" | "verified" | "outside" | "error";

export function getTelegramWebApp(): TelegramWebAppInstance | null {
  if (typeof window === "undefined") return null;
  const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebAppInstance } }).Telegram;
  return tg?.WebApp ?? null;
}

export function isInsideTelegramMiniApp(): boolean {
  const wa = getTelegramWebApp();
  return Boolean(wa && typeof wa.initData === "string" && wa.initData.trim().length > 0);
}

export function shouldAllowMiniAppAccess(input: {
  inTelegram: boolean;
  allowDevOutsideTelegram: boolean;
  authStatus: TelegramAuthStatus;
}): boolean {
  if (!input.inTelegram) {
    return input.allowDevOutsideTelegram;
  }
  return input.authStatus === "verified";
}

export function initTelegramMiniApp(): TelegramWebAppInstance | null {
  const wa = getTelegramWebApp();
  if (!wa) return null;
  try {
    wa.ready();
    wa.expand();
    wa.setHeaderColor?.("#0B1433");
    wa.setBackgroundColor?.("#0B1433");

    if (typeof document !== "undefined") {
      const top = (wa.safeAreaInset?.top ?? 0) + (wa.contentSafeAreaInset?.top ?? 0);
      const bottom = (wa.safeAreaInset?.bottom ?? 0) + (wa.contentSafeAreaInset?.bottom ?? 0);
      const left = (wa.safeAreaInset?.left ?? 0) + (wa.contentSafeAreaInset?.left ?? 0);
      const right = (wa.safeAreaInset?.right ?? 0) + (wa.contentSafeAreaInset?.right ?? 0);
      if (top > 0) document.documentElement.style.setProperty("--tg-safe-area-inset-top", `${top}px`);
      if (bottom > 0) document.documentElement.style.setProperty("--tg-safe-area-inset-bottom", `${bottom}px`);
      if (left > 0) document.documentElement.style.setProperty("--tg-safe-area-inset-left", `${left}px`);
      if (right > 0) document.documentElement.style.setProperty("--tg-safe-area-inset-right", `${right}px`);
      if (typeof wa.viewportStableHeight === "number" && wa.viewportStableHeight > 0) {
        document.documentElement.style.setProperty(
          "--tg-viewport-stable-height",
          `${Math.round(wa.viewportStableHeight)}px`,
        );
      }
    }
  } catch {
    // Non-fatal in partially mocked WebViews
  }
  return wa;
}

export function triggerTelegramHaptic(
  kind: "success" | "warning" | "error" | "impact" | "selection",
): void {
  const hf = getTelegramWebApp()?.HapticFeedback;
  if (!hf) return;
  try {
    if (kind === "selection") hf.selectionChanged();
    else if (kind === "impact") hf.impactOccurred("medium");
    else hf.notificationOccurred(kind);
  } catch {
    // Ignore
  }
}

export function openTelegramDeepLink(url: string): void {
  const wa = getTelegramWebApp();
  if (wa?.openTelegramLink) {
    wa.openTelegramLink(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function useTelegramBackButton(visible: boolean, onBack: () => void): void {
  useEffect(() => {
    const bb = getTelegramWebApp()?.BackButton;
    if (!bb) return undefined;
    if (!visible) {
      bb.hide();
      return undefined;
    }
    bb.onClick(onBack);
    bb.show();
    return () => {
      bb.offClick(onBack);
      bb.hide();
    };
  }, [visible, onBack]);
}

export function setTelegramClosingConfirmation(enabled: boolean): void {
  const wa = getTelegramWebApp();
  if (!wa) return;
  try {
    if (enabled) wa.enableClosingConfirmation?.();
    else wa.disableClosingConfirmation?.();
  } catch {
    // Ignore
  }
}
