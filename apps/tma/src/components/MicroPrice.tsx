const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"] as const;

function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((ch) => SUBSCRIPT_DIGITS[Number(ch)] ?? ch)
    .join("");
}

export function formatMicroPriceParts(
  value: number | null | undefined,
  prefix = "$",
): { prefix: string; leading: string; subZeros?: string; significant: string } | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value >= 1) {
    return {
      prefix,
      leading: value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: value >= 100 ? 2 : 4,
      }),
      significant: "",
    };
  }
  if (value >= 0.01) {
    return {
      prefix,
      leading: value.toFixed(4),
      significant: "",
    };
  }
  const fixed = value.toFixed(12);
  const match = fixed.match(/^0\.(0+)(\d+)/);
  if (!match?.[1] || !match[2]) {
    return { prefix, leading: value.toFixed(6), significant: "" };
  }
  const zeroCount = match[1].length;
  const sig = match[2].slice(0, 4);
  if (zeroCount <= 2) {
    return { prefix, leading: `0.${match[1]}${sig}`, significant: "" };
  }
  return {
    prefix,
    leading: "0.0",
    subZeros: toSubscript(zeroCount),
    significant: sig,
  };
}

export function MicroPrice({
  value,
  prefix = "$",
  fallback = "—",
  className = "",
}: {
  value: number | null | undefined;
  prefix?: string;
  fallback?: string;
  className?: string;
}) {
  const parts = formatMicroPriceParts(value, prefix);
  if (!parts) {
    return <span className={`tabular-nums ${className}`}>{fallback}</span>;
  }
  return (
    <span className={`tabular-nums ${className}`}>
      {parts.prefix}
      {parts.leading}
      {parts.subZeros ? (
        <sub style={{ fontSize: "0.72em", verticalAlign: "-0.16em", opacity: 0.9 }}>
          {parts.subZeros}
        </sub>
      ) : null}
      {parts.significant}
    </span>
  );
}
