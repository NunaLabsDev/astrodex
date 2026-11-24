import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { DepthPoint, OhlcvCandle } from "@astrodex/domain";

function resolvePriceFormat(candles: readonly OhlcvCandle[]): {
  precision: number;
  minMove: number;
} {
  if (candles.length === 0) return { precision: 4, minMove: 0.0001 };
  const sorted = candles.map((c) => c.close).filter((v) => v > 0).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 1;
  if (med < 0.001) return { precision: 7, minMove: 0.0000001 };
  if (med < 0.05) return { precision: 6, minMove: 0.000001 };
  if (med < 2) return { precision: 4, minMove: 0.0001 };
  if (med < 100) return { precision: 3, minMove: 0.001 };
  return { precision: 2, minMove: 0.01 };
}

function formatPrice(val: number): string {
  if (!Number.isFinite(val)) return "0";
  if (val < 0.001) return val.toFixed(7);
  if (val < 0.05) return val.toFixed(6);
  if (val < 2) return val.toFixed(4);
  return val.toFixed(3);
}

function ChartSurface({
  candles,
  quoteLabel,
  timeframe,
  expanded,
  onToggleExpand,
}: {
  candles: readonly OhlcvCandle[];
  quoteLabel: string;
  timeframe?: string | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bySecLookupRef = useRef<Map<number, OhlcvCandle>>(new Map());
  const latestCandleRef = useRef<OhlcvCandle | null>(null);
  const quoteLabelRef = useRef(quoteLabel);
  const timeframeRef = useRef(timeframe);
  quoteLabelRef.current = quoteLabel;
  timeframeRef.current = timeframe;
  const hudPriceRef = useRef<HTMLElement | null>(null);
  const hudRangeRef = useRef<HTMLSpanElement | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [chartStyle, setChartStyle] = useState<"area" | "candles">("area");

  const normalized = useMemo(() => {
    const bySec = new Map<number, OhlcvCandle>();
    for (const c of candles) {
      const sec = Math.floor(c.time);
      if (sec > 0 && Number.isFinite(c.close) && c.close > 0) {
        bySec.set(sec, { ...c, time: sec });
      }
    }
    return Array.from(bySec.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sec, candle]) => ({ sec: sec as UTCTimestamp, candle }));
  }, [candles]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      rightPriceScale: {
        borderColor: "rgba(165, 139, 224, 0.18)",
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
    });
  }, [logScale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const chartHeight = expanded
      ? Math.max(300, Math.min(460, Math.floor(window.innerHeight * 0.56)))
      : 210;

    const chart = createChart(el, {
      width: Math.max(240, el.clientWidth),
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(226, 232, 240, 0.78)",
        fontFamily: "inherit",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(165, 139, 224, 0.10)" },
        horzLines: { color: "rgba(165, 139, 224, 0.12)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(245, 201, 40, 0.55)",
          labelBackgroundColor: "#172C69",
        },
        horzLine: {
          color: "rgba(245, 201, 40, 0.55)",
          labelBackgroundColor: "#172C69",
        },
      },
      timeScale: {
        borderColor: "rgba(165, 139, 224, 0.18)",
        timeVisible: timeframeRef.current !== "1d",
        secondsVisible: false,
        minBarSpacing: 0.2,
      },
      rightPriceScale: {
        borderColor: "rgba(165, 139, 224, 0.18)",
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
      handleScroll: {
        vertTouchDrag: false,
        horzTouchDrag: true,
        mouseWheel: expanded,
        pressedMouseMove: true,
      },
      handleScale: {
        pinch: true,
        mouseWheel: expanded,
        axisPressedMouseMove: true,
      },
    });
    chartRef.current = chart;

    const mainSeries =
      chartStyle === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: "#10B981",
            downColor: "#F15A24",
            borderVisible: false,
            wickUpColor: "#10B981",
            wickDownColor: "#F15A24",
          })
        : chart.addSeries(AreaSeries, {
            lineColor: "#10B981",
            topColor: "rgba(16, 185, 129, 0.34)",
            bottomColor: "rgba(11, 20, 51, 0.02)",
            lineWidth: 2,
          });
    mainSeriesRef.current = mainSeries;

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volSeriesRef.current = volSeries;

    const formatHudDate = (sec: number) =>
      timeframeRef.current === "1d"
        ? new Date(sec * 1000).toLocaleDateString([], {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : new Date(sec * 1000).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });

    chart.subscribeCrosshairMove((param) => {
      const latest = latestCandleRef.current;
      if (!latest) return;
      const key = typeof param.time === "number" ? param.time : null;
      const target =
        param.time && param.point && key !== null && param.seriesData.has(mainSeries)
          ? (bySecLookupRef.current.get(key) ?? latest)
          : latest;
      if (hudPriceRef.current) {
        hudPriceRef.current.textContent = `${formatPrice(target.close)} ${quoteLabelRef.current} · ${formatHudDate(target.time)}`;
      }
      if (hudRangeRef.current) {
        hudRangeRef.current.textContent = `H ${formatPrice(target.high)} / L ${formatPrice(target.low)}`;
      }
    });

    let hasSized = false;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) {
        chart.applyOptions({ width: Math.floor(width) });
        if (!hasSized) {
          chart.timeScale().fitContent();
          hasSized = true;
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volSeriesRef.current = null;
    };
  }, [chartStyle, expanded]);

  useEffect(() => {
    const chart = chartRef.current;
    const mainSeries = mainSeriesRef.current;
    const volSeries = volSeriesRef.current;
    if (!chart || !mainSeries || !volSeries || normalized.length === 0) return;

    const priceFormat = resolvePriceFormat(candles);
    const first = normalized[0]!.candle;
    const last = normalized[normalized.length - 1]!.candle;
    const positive = last.close >= first.open;
    const lineColor = positive ? "#10B981" : "#F15A24";

    chart.applyOptions({
      timeScale: {
        borderColor: "rgba(165, 139, 224, 0.18)",
        timeVisible: timeframe !== "1d",
        secondsVisible: false,
        minBarSpacing: 0.2,
      },
    });

    if (chartStyle === "candles") {
      (mainSeries as ISeriesApi<"Candlestick">).applyOptions({
        priceFormat: { type: "price", ...priceFormat },
      });
      (mainSeries as ISeriesApi<"Candlestick">).setData(
        normalized.map(({ sec, candle }) => ({
          time: sec,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
      );
    } else {
      (mainSeries as ISeriesApi<"Area">).applyOptions({
        lineColor,
        topColor: positive ? "rgba(16, 185, 129, 0.34)" : "rgba(241, 90, 36, 0.34)",
        bottomColor: "rgba(11, 20, 51, 0.02)",
        priceFormat: { type: "price", ...priceFormat },
      });
      (mainSeries as ISeriesApi<"Area">).setData(
        normalized.map(({ sec, candle }) => ({
          time: sec,
          value: candle.close,
        })),
      );
    }

    volSeries.setData(
      normalized.map(({ sec, candle }) => ({
        time: sec,
        value: candle.volume ?? 0,
        color:
          candle.close >= candle.open
            ? "rgba(16, 185, 129, 0.30)"
            : "rgba(241, 90, 36, 0.30)",
      })),
    );

    bySecLookupRef.current = new Map<number, OhlcvCandle>(
      normalized.map(({ sec, candle }) => [Number(sec), candle]),
    );
    latestCandleRef.current = last;
    if (hudPriceRef.current) {
      const pctStr =
        first.open > 0
          ? ` (${last.close >= first.open ? "+" : ""}${(((last.close - first.open) / first.open) * 100).toFixed(2)}%)`
          : "";
      hudPriceRef.current.textContent = `${formatPrice(last.close)} ${quoteLabel}${pctStr}`;
    }
    if (hudRangeRef.current) {
      hudRangeRef.current.textContent = `H ${formatPrice(last.high)} / L ${formatPrice(last.low)}`;
    }
    chart.timeScale().fitContent();
  }, [normalized, candles, chartStyle, timeframe, quoteLabel]);

  if (normalized.length === 0) return null;

  const active = normalized[normalized.length - 1]!.candle;
  const dateLabel =
    timeframe === "1d"
      ? new Date(active.time * 1000).toLocaleDateString([], {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : new Date(active.time * 1000).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

  return (
    <div className="ad-stack-8">
      <div className="ad-stack-6">
        <div className="ad-row ad-row-wrap ad-text-sm">
          <strong ref={hudPriceRef} className="tabular-nums">
            {formatPrice(active.close)} {quoteLabel} · {dateLabel}
          </strong>
          <span ref={hudRangeRef} className="tabular-nums ad-text-xs ad-text-muted">
            H {formatPrice(active.high)} / L {formatPrice(active.low)}
          </span>
        </div>
        <div className="ad-flex-wrap">
          <button
            type="button"
            className="glass-pill ad-clickable"
            style={{ padding: "4px 10px", fontSize: 12, minHeight: 36 }}
            onClick={() => setChartStyle((s) => (s === "candles" ? "area" : "candles"))}
          >
            {chartStyle === "candles" ? "Line" : "Candles"}
          </button>
          <button
            type="button"
            className={`glass-pill ad-clickable ${logScale ? "glass-pill--gold" : ""}`}
            style={{ padding: "4px 10px", fontSize: 12, minHeight: 36 }}
            aria-pressed={logScale}
            onClick={() => setLogScale((v) => !v)}
          >
            Log
          </button>
          <button
            type="button"
            className="glass-pill ad-clickable"
            style={{ padding: "4px 10px", fontSize: 12, minHeight: 36 }}
            onClick={() => chartRef.current?.timeScale().fitContent()}
          >
            Fit
          </button>
          <button
            type="button"
            className="glass-pill ad-clickable"
            style={{ padding: "4px 10px", fontSize: 12, minHeight: 36 }}
            onClick={onToggleExpand}
          >
            {expanded ? "Close ✕" : "⤢ Expand"}
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        role="img"
        aria-label="Interactive Price Chart"
        style={{
          width: "100%",
          height: expanded ? "min(56vh, 460px)" : 210,
          minHeight: expanded ? 300 : 210,
          position: "relative",
          touchAction: expanded ? "none" : "pan-y",
        }}
      />
    </div>
  );
}

export function ChartCanvas({
  candles,
  depth,
  quoteLabel,
  timeframe,
  loading = false,
}: {
  candles: readonly OhlcvCandle[];
  depth: readonly DepthPoint[];
  quoteLabel: string;
  timeframe?: string | undefined;
  loading?: boolean | undefined;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  if (loading && candles.length === 0) {
    return (
      <div className="ad-chart-stage ad-stack-8">
        <div className="ad-shimmer" style={{ height: 210, width: "100%" }} />
      </div>
    );
  }

  if (candles.length === 0) {
    return (
      <div className="ad-chart-stage ad-chart-empty">
        <div className="ad-text-center ad-text-sm ad-text-muted">
          No OHLCV trades indexed yet for this window ({quoteLabel}).
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ad-chart-stage ad-stack-8">
        <ChartSurface
          candles={candles}
          quoteLabel={quoteLabel}
          timeframe={timeframe}
          expanded={false}
          onToggleExpand={() => setExpanded(true)}
        />

        {depth.length > 0 && (
          <div className="tabular-nums ad-text-xs ad-text-muted">
            Combined Depth Levels: {depth.length} active bid/ask levels
          </div>
        )}
      </div>

      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Expanded Chart"
          className="ad-chart-modal-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="glass-card" style={{ width: "100%", maxWidth: 720 }}>
            <ChartSurface
              candles={candles}
              quoteLabel={quoteLabel}
              timeframe={timeframe}
              expanded
              onToggleExpand={() => setExpanded(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
