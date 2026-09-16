"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { KlineCandle } from "@/lib/types";

const WIDTH = 980;
const HEIGHT = 382;
const LEFT = 14;
const RIGHT = 76;
const TOP = 52;
const PRICE_BOTTOM = 282;
const VOLUME_TOP = 306;
const VOLUME_BOTTOM = 344;

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p = (sorted.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - p) + sorted[hi] * (p - lo);
}

function fmtPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.01) return value.toFixed(5);
  if (abs >= 0.0001) return value.toFixed(7);
  return value.toPrecision(5);
}

function fmtVolume(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function fmtTime(epoch: number, withDate = false) {
  const d = new Date(epoch * 1000);
  return d.toLocaleString("zh-CN", withDate
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "2-digit", minute: "2-digit", hour12: false });
}

function cleanCandles(input: KlineCandle[]) {
  const map = new Map<number, KlineCandle>();
  for (const row of input || []) {
    const time = Number(row.time);
    const open = Number(row.open);
    const close = Number(row.close);
    const rawHigh = Number(row.high);
    const rawLow = Number(row.low);
    const volume = Math.max(0, Number(row.volume) || 0);
    if (![time, open, close, rawHigh, rawLow].every(Number.isFinite) || time <= 0 || open <= 0 || close <= 0 || rawHigh <= 0 || rawLow <= 0) continue;
    const high = Math.max(rawHigh, open, close);
    const low = Math.min(rawLow, open, close);
    map.set(time, { time, open, high, low, close, volume });
  }
  return [...map.values()].sort((a, b) => a.time - b.time).slice(-288);
}

export default function CandleChart({ candles }: { candles: KlineCandle[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const data = useMemo(() => cleanCandles(candles), [candles]);

  const model = useMemo(() => {
    if (!data.length) return null;
    const bodyPrices = data.flatMap(c => [c.open, c.close]);
    const median = quantile(bodyPrices, .5);
    const q05 = quantile(bodyPrices, .05);
    const q95 = quantile(bodyPrices, .95);
    const rawLow = Math.min(...data.map(c => c.low));
    const rawHigh = Math.max(...data.map(c => c.high));
    const bodySpan = Math.max(q95 - q05, median * .003, 1e-12);

    let axisLow = Math.max(1e-12, q05 - bodySpan * .6);
    let axisHigh = q95 + bodySpan * .6;
    const robustSpan = Math.max(axisHigh - axisLow, 1e-12);
    const rawSpan = rawHigh - rawLow;

    // When the full wick range is close to the body range, show everything. When one or two
    // extreme prints stretch the chart, keep them as marked clipped wicks instead of crushing the body.
    if (data.length < 20 || rawSpan <= robustSpan * 1.65) {
      const pad = Math.max(rawSpan * .06, median * .0015, 1e-12);
      axisLow = Math.max(1e-12, rawLow - pad);
      axisHigh = rawHigh + pad;
    } else {
      const latest = data[data.length - 1].close;
      axisLow = Math.min(axisLow, latest - bodySpan * .2);
      axisHigh = Math.max(axisHigh, latest + bodySpan * .2);
    }

    const span = Math.max(axisHigh - axisLow, axisHigh * 1e-9, 1e-12);
    const extremeCount = data.filter(c => c.high > axisHigh || c.low < axisLow).length;
    const volume95 = Math.max(quantile(data.map(c => c.volume), .95), 1);
    return { axisLow, axisHigh, span, rawLow, rawHigh, extremeCount, volume95 };
  }, [data]);

  if (!data.length || !model) return <div className="chart-empty">暂无可用K线数据</div>;

  const plotWidth = WIDTH - LEFT - RIGHT;
  const priceHeight = PRICE_BOTTOM - TOP;
  const x = (i: number) => LEFT + i * (plotWidth / Math.max(1, data.length - 1));
  const y = (p: number) => TOP + ((model.axisHigh - Math.min(model.axisHigh, Math.max(model.axisLow, p))) / model.span) * priceHeight;
  const candleWidth = Math.max(1.2, Math.min(5.2, plotWidth / Math.max(data.length, 1) * .66));
  const currentIndex = hoverIndex == null ? data.length - 1 : Math.max(0, Math.min(data.length - 1, hoverIndex));
  const current = data[currentIndex];
  const currentChange = current.open ? (current.close / current.open - 1) * 100 : 0;
  const periodChange = data[0].open ? (data[data.length - 1].close / data[0].open - 1) * 100 : 0;
  const lastPrice = data[data.length - 1].close;
  const lastY = y(lastPrice);
  const ticks = [0, .25, .5, .75, 1];
  const timeTickIndexes = [...new Set([0, Math.round((data.length - 1) * .25), Math.round((data.length - 1) * .5), Math.round((data.length - 1) * .75), data.length - 1])];

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * WIDTH;
    const ratio = (px - LEFT) / Math.max(plotWidth, 1);
    const idx = Math.round(ratio * (data.length - 1));
    setHoverIndex(Math.max(0, Math.min(data.length - 1, idx)));
  };

  return <div className="kline-card">
    <div className="kline-toolbar">
      <div className="kline-ohlc">
        <b>{fmtTime(current.time, true)}</b>
        <span>O <strong>{fmtPrice(current.open)}</strong></span>
        <span>H <strong>{fmtPrice(current.high)}</strong></span>
        <span>L <strong>{fmtPrice(current.low)}</strong></span>
        <span>C <strong>{fmtPrice(current.close)}</strong></span>
        <span className={currentChange >= 0 ? "positive" : "negative"}>{currentChange >= 0 ? "+" : ""}{currentChange.toFixed(2)}%</span>
        <span>Vol <strong>{fmtVolume(current.volume)}</strong></span>
      </div>
      <div className="kline-meta">
        <span>24H · 5m</span>
        <span className={periodChange >= 0 ? "positive" : "negative"}>24H {periodChange >= 0 ? "+" : ""}{periodChange.toFixed(2)}%</span>
        {model.extremeCount > 0 && <span className="kline-extreme">极端针 {model.extremeCount} 根 · 已隔离缩放</span>}
      </div>
    </div>

    <div className="kline-svg-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="24小时5分钟K线" onMouseMove={onMove} onMouseLeave={() => setHoverIndex(null)}>
        {ticks.map(t => {
          const yy = TOP + t * priceHeight;
          const price = model.axisHigh - t * model.span;
          return <g key={t}>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={yy} y2={yy} className="grid-line" />
            <text x={WIDTH - RIGHT + 8} y={yy + 4} className="axis-label">{fmtPrice(price)}</text>
          </g>;
        })}

        {timeTickIndexes.map((i, idx) => {
          const xx = x(i);
          return <g key={`${i}-${idx}`}>
            <line x1={xx} x2={xx} y1={TOP} y2={VOLUME_BOTTOM} className="grid-line vertical" />
            <text x={xx} y={HEIGHT - 11} textAnchor={idx === 0 ? "start" : idx === timeTickIndexes.length - 1 ? "end" : "middle"} className="axis-label">{fmtTime(data[i].time)}</text>
          </g>;
        })}

        <line x1={LEFT} x2={WIDTH - RIGHT} y1={lastY} y2={lastY} className="last-price-line" />
        <rect x={WIDTH - RIGHT + 4} y={lastY - 9} width={RIGHT - 8} height={18} rx={4} className="last-price-box" />
        <text x={WIDTH - RIGHT + 10} y={lastY + 4} className="last-price-text">{fmtPrice(lastPrice)}</text>

        {data.map((c, i) => {
          const up = c.close >= c.open;
          const cx = x(i);
          const yo = y(c.open);
          const yc = y(c.close);
          const yh = y(c.high);
          const yl = y(c.low);
          const highClipped = c.high > model.axisHigh;
          const lowClipped = c.low < model.axisLow;
          return <g key={`${c.time}-${i}`} className={up ? "candle-up" : "candle-down"}>
            <line x1={cx} x2={cx} y1={yh} y2={yl} />
            <rect x={cx - candleWidth / 2} y={Math.min(yo, yc)} width={candleWidth} height={Math.max(1, Math.abs(yc - yo))} />
            {highClipped && <path d={`M ${cx - 3} ${TOP + 7} L ${cx} ${TOP + 2} L ${cx + 3} ${TOP + 7}`} className="wick-clip" />}
            {lowClipped && <path d={`M ${cx - 3} ${PRICE_BOTTOM - 7} L ${cx} ${PRICE_BOTTOM - 2} L ${cx + 3} ${PRICE_BOTTOM - 7}`} className="wick-clip" />}
          </g>;
        })}

        <line x1={LEFT} x2={WIDTH - RIGHT} y1={VOLUME_TOP - 7} y2={VOLUME_TOP - 7} className="volume-separator" />
        {data.map((c, i) => {
          const h = Math.min(1, c.volume / model.volume95) * (VOLUME_BOTTOM - VOLUME_TOP);
          const cx = x(i);
          return <rect key={`v-${c.time}`} x={cx - candleWidth / 2} y={VOLUME_BOTTOM - h} width={candleWidth} height={Math.max(.7, h)} className={c.close >= c.open ? "volume-up" : "volume-down"} />;
        })}

        {hoverIndex != null && <>
          <line x1={x(currentIndex)} x2={x(currentIndex)} y1={TOP} y2={VOLUME_BOTTOM} className="crosshair" />
          <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(current.close)} y2={y(current.close)} className="crosshair horizontal" />
          <circle cx={x(currentIndex)} cy={y(current.close)} r={3.2} className="crosshair-dot" />
        </>}
      </svg>
    </div>

    <div className="kline-foot">
      <span>主视图价格带 {fmtPrice(model.axisLow)} – {fmtPrice(model.axisHigh)}</span>
      {model.extremeCount > 0
        ? <span>原始成交极值 {fmtPrice(model.rawLow)} – {fmtPrice(model.rawHigh)} · 极端针保留标记但不压缩主体走势</span>
        : <span>原始高低点已完整纳入缩放</span>}
    </div>
  </div>;
}
