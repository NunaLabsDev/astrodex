import { useEffect, useMemo, useState } from "react";

export interface TokenAvatarProps {
  code: string;
  icon?: string | undefined;
  isNative?: boolean | undefined;
  size?: number | undefined;
  verified?: boolean | undefined;
  scamRisk?: boolean | undefined;
}

const FALLBACK_GRADIENTS = [
  "linear-gradient(135deg, rgba(99, 102, 241, 0.42), rgba(16, 185, 129, 0.28))",
  "linear-gradient(135deg, rgba(128, 80, 200, 0.44), rgba(245, 201, 40, 0.24))",
  "linear-gradient(135deg, rgba(14, 165, 233, 0.40), rgba(99, 102, 241, 0.30))",
  "linear-gradient(135deg, rgba(241, 90, 36, 0.38), rgba(245, 201, 40, 0.24))",
] as const;

function normalizeAvatarUrl(raw?: string): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.startsWith("ipfs://")) {
    const cid = trimmed.slice(7).replace(/^ipfs\//, "");
    return cid ? `https://ipfs.io/ipfs/${cid}` : null;
  }
  return trimmed.startsWith("https://") ? trimmed : null;
}

function pickGradient(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) | 0;
  }
  return FALLBACK_GRADIENTS[Math.abs(hash) % FALLBACK_GRADIENTS.length]!;
}

export function TokenAvatar({
  code,
  icon,
  isNative,
  size = 34,
  verified,
  scamRisk,
}: TokenAvatarProps) {
  const cleanUrl = useMemo(() => normalizeAvatarUrl(icon), [icon]);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [cleanUrl]);

  const dotColor = scamRisk ? "#ef4444" : verified ? "#10b981" : null;
  const nativeXlm =
    (isNative || (isNative === undefined && code.trim().toUpperCase() === "XLM")) &&
    !scamRisk;

  return (
    <span
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "999px",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        background: nativeXlm
          ? "radial-gradient(circle at 30% 25%, #172C69 0%, #060E24 100%)"
          : cleanUrl && !imgFailed
            ? "rgba(248, 250, 255, 0.08)"
            : pickGradient(code),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontSize: Math.max(11, Math.round(size * 0.36)),
        fontWeight: 800,
        color: "#F8FAFF",
      }}
    >
      {cleanUrl && !imgFailed ? (
        <img
          src={cleanUrl}
          alt={`${code} logo`}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            borderRadius: "999px",
            display: "block",
          }}
        />
      ) : nativeXlm ? (
        <svg
          width={Math.round(size * 0.6)}
          height={Math.round(size * 0.6)}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M19.2 4.6 5.4 11.7a7.3 7.3 0 0 1 11.5-5.6l2.3-1.5Zm-14.4 14.8 13.8-7.1a7.3 7.3 0 0 1-11.5 5.6l-2.3 1.5Z"
            fill="#F8FAFF"
          />
          <path
            d="M3.5 14.3 20.5 5.6M3.5 17.5 20.5 8.8"
            stroke="#F5C928"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <span>{code.slice(0, 2).toUpperCase() || "?"}</span>
      )}
      {dotColor && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: Math.max(8, Math.round(size * 0.27)),
            height: Math.max(8, Math.round(size * 0.27)),
            borderRadius: "999px",
            background: dotColor,
            border: "1.5px solid #060E24",
          }}
        />
      )}
    </span>
  );
}
