"use client";

import { useMemo } from "react";

interface Props {
  values: number[];
  bins?: number;
  domain?: [number, number];
  threshold?: number;
  label: string;
  unit?: string;
  format?: (v: number) => string;
  /** bars above the threshold use the "positive" colour */
  colorAbove?: string;
  colorBelow?: string;
}

export function Histogram({ values, bins = 28, domain, threshold, label, unit, format = (v) => v.toFixed(1), colorAbove = "var(--pos)", colorBelow = "var(--accent)" }: Props) {
  const { counts, lo, hi, max } = useMemo(() => {
    if (!values.length) return { counts: [] as number[], lo: 0, hi: 1, max: 1 };
    const sorted = [...values].sort((a, b) => a - b);
    const lo = domain?.[0] ?? sorted[0];
    // clip long tails at the 99th percentile so the bulk of the distribution stays readable
    const hi = domain?.[1] ?? Math.max(lo + 1e-6, sorted[Math.floor(0.99 * (sorted.length - 1))]);
    const counts = new Array(bins).fill(0);
    for (const v of values) {
      const b = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
      counts[b]++;
    }
    return { counts, lo, hi, max: Math.max(...counts, 1) };
  }, [values, bins, domain]);

  const W = 300, H = 72;
  const bw = W / Math.max(1, counts.length);
  const tx = threshold !== undefined ? ((threshold - lo) / (hi - lo)) * W : null;
  return (
    <figure className="space-y-1.5">
      <figcaption className="flex items-baseline justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular font-mono text-faint">
          {format(lo)} to {format(hi)} {unit}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full" role="img" aria-label={`${label} histogram, ${values.length} nuclei`} preserveAspectRatio="none">
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--border-strong)" />
        {counts.map((c, i) => {
          const h = (c / max) * (H - 6);
          const mid = lo + ((i + 0.5) / counts.length) * (hi - lo);
          const above = threshold !== undefined && mid > threshold;
          return <rect key={i} x={i * bw + 0.75} y={H - h - 1} width={Math.max(0.5, bw - 1.5)} height={h} rx="1" fill={above ? colorAbove : colorBelow} opacity={0.85} />;
        })}
        {tx !== null && tx >= 0 && tx <= W && <line x1={tx} y1="0" x2={tx} y2={H} stroke="var(--text)" strokeWidth="1.5" strokeDasharray="3 3" />}
      </svg>
    </figure>
  );
}
