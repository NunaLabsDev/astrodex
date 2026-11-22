import type { DepthPoint, OhlcvCandle } from "@astrodex/domain";

export function ChartCanvas({
  mode,
  candles,
  depth,
  quoteLabel,
}: {
  mode: "basic" | "pro";
  candles: readonly OhlcvCandle[];
  depth: readonly DepthPoint[];
  quoteLabel: string;
}) {
  const width = 340;
  const height = mode === "pro" ? 210 : 170;
  const pad = 12;

  if (candles.length === 0) {
    return (
      <div className="ad-chart-stage" style={{ display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--ad-ink-secondary)" }}>
          No OHLCV trades indexed yet for this window ({quoteLabel}).
        </div>
      </div>
    );
  }

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const range = maxPrice - minPrice || 1;
  const latest = candles[candles.length - 1]!;

  const toY = (price: number) =>
    height - pad - ((price - minPrice) / range) * (height - pad * 2);

  const linePath = candles
    .map((c, idx) => {
      const x =
        candles.length === 1
          ? width / 2
          : pad + (idx / (candles.length - 1)) * (width - pad * 2);
      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${toY(c.close).toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="ad-chart-stage" style={{ display: "grid", gap: 8 }}>
      <div className="ad-row" style={{ fontSize: 12 }}>
        <strong className="tabular-nums">
          Latest: {latest.close.toFixed(6)} {quoteLabel}
        </strong>
        <span style={{ color: "var(--ad-ink-secondary)" }} className="tabular-nums">
          H {maxPrice.toFixed(4)} / L {minPrice.toFixed(4)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Price Chart"
      >
        {mode === "basic" ? (
          <path
            d={linePath}
            fill="none"
            stroke="#10B981"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        ) : (
          candles.map((c, idx) => {
            const x =
              candles.length === 1
                ? width / 2
                : pad + (idx / (candles.length - 1)) * (width - pad * 2);
            const yOpen = toY(c.open);
            const yClose = toY(c.close);
            const yHigh = toY(c.high);
            const yLow = toY(c.low);
            const bullish = c.close >= c.open;
            const color = bullish ? "#10B981" : "#F15A24";
            const bodyY = Math.min(yOpen, yClose);
            const bodyH = Math.max(2, Math.abs(yClose - yOpen));
            return (
              <g key={c.time}>
                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.2" />
                <rect x={x - 3} y={bodyY} width="6" height={bodyH} fill={color} rx="1" />
              </g>
            );
          })
        )}
      </svg>

      {mode === "pro" && depth.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }} className="tabular-nums">
          Combined Depth Levels: {depth.length} active bid/ask levels
        </div>
      )}
    </div>
  );
}
