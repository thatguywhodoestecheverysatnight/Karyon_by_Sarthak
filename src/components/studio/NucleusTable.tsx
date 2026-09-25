"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Nucleus } from "@/lib/pathology/features";

type Key = "id" | "areaUm2" | "circularity" | "eccentricity" | "meanS2" | "contrastS2";
const LIMIT = 200;

export function NucleusTable({ nuclei, ihc, s2Name, threshold, selected, onPick }: { nuclei: Nucleus[]; ihc: boolean; s2Name: string; threshold: number; selected: number | null; onPick: (id: number) => void }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "areaUm2", desc: true });
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (!selected) return;
    body.current?.querySelector<HTMLElement>(`[data-id="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const rows = useMemo(() => {
    const r = [...nuclei];
    r.sort((a, b) => (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]));
    const top = r.slice(0, LIMIT);
    // keep a nucleus picked in the viewer visible even when it is outside the top rows
    if (selected && !top.some((n) => n.id === selected) && nuclei[selected - 1]) top.unshift(nuclei[selected - 1]);
    return top;
  }, [nuclei, sort, selected]);

  const cols: { key: Key; label: string; fmt: (n: Nucleus) => string }[] = [
    { key: "id", label: "#", fmt: (n) => String(n.id) },
    { key: "areaUm2", label: "Area µm²", fmt: (n) => n.areaUm2.toFixed(1) },
    { key: "circularity", label: "Circ.", fmt: (n) => n.circularity.toFixed(2) },
    { key: "eccentricity", label: "Ecc.", fmt: (n) => n.eccentricity.toFixed(2) },
    ihc ? { key: "contrastS2", label: "DAB score", fmt: (n) => n.contrastS2.toFixed(3) } : { key: "meanS2", label: s2Name, fmt: (n) => n.meanS2.toFixed(3) },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="max-h-72 overflow-auto">
        <table className="tabular w-full text-left font-mono text-xs">
          <thead className="sticky top-0 bg-sunken text-[11px] text-muted">
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"} className="px-2.5 py-2 font-medium">
                  <button type="button" className="inline-flex items-center gap-0.5 hover:text-text" onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : true })}>
                    {c.label}
                    {sort.key === c.key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={body}>
            {rows.map((n) => {
              const pos = ihc && n.contrastS2 > threshold;
              return (
                <tr
                  key={n.id}
                  data-id={n.id}
                  onClick={() => onPick(n.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(n.id))}
                  tabIndex={0}
                  aria-current={selected === n.id ? "true" : undefined}
                  className={`cursor-pointer border-t border-border transition ${selected === n.id ? "bg-accent-soft" : "hover:bg-sunken"}`}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={`px-2.5 py-1.5 ${c.key === "contrastS2" ? (pos ? "text-pos" : "text-neg") : ""}`}>
                      {c.fmt(n)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {nuclei.length > LIMIT && <p className="border-t border-border bg-sunken px-2.5 py-1.5 text-[11px] text-faint">Showing {LIMIT} of {nuclei.length.toLocaleString()}. Export CSV for every nucleus.</p>}
    </div>
  );
}
