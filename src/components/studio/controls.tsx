"use client";

import { useId, type ReactNode } from "react";

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[]; label: string }) {
  // WAI-ARIA radio group: one tab stop, arrow keys move and select
  const idx = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (Math.max(0, idx) + d + options.length) % options.length;
    onChange(options[next].value);
    const btns = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
    btns[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-sunken p-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (idx === -1 && i === 0) ? 0 : -1}
            title={o.hint}
            aria-label={o.hint ? `${o.label}, ${o.hint}` : undefined}
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-2 py-1.5 text-[13px] font-medium transition ${on ? "bg-surface text-text shadow-card" : "text-muted hover:text-text"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={`flex items-start justify-between gap-3 ${disabled ? "opacity-50" : ""}`}>
      <label htmlFor={id} className="text-sm">
        {label}
        {hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-xs text-faint">
            {hint}
          </span>
        )}
      </label>
      <button
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? "bg-accent-fill" : "bg-border-strong"}`}
      >
        <span className={`inline-block size-4 rounded-full bg-white shadow transition ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format = (v) => String(v), hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string }) {
  const id = useId();
  const hid = `${id}-hint`;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <label htmlFor={id}>{label}</label>
        <span className="tabular font-mono text-xs text-muted">{format(value)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" aria-valuetext={format(value)} aria-describedby={hint ? hid : undefined} />
      {hint && (
        <p id={hid} className="text-xs text-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "accent" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{label}</div>
      <div className={`tabular mt-1 text-xl font-semibold tracking-tight ${tone === "pos" ? "text-pos" : tone === "accent" ? "text-accent" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
