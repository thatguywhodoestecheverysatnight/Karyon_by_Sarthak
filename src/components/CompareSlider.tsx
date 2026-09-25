"use client";

import { useRef, useState } from "react";

/** Before / after comparison of a tile and its segmentation overlay. */
export function CompareSlider({ base, overlay, alt, width, height }: { base: string; overlay: string; alt: string; width: number; height: number }) {
  const [pos, setPos] = useState(55);
  const box = useRef<HTMLDivElement>(null);
  const update = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={box}
      className="relative select-none overflow-hidden rounded-2xl border border-border bg-viewer shadow-card touch-none"
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        update(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && update(e.clientX)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={base} alt={alt} width={width} height={height} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={base} alt="" width={width} height={height} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={overlay} alt="" width={width} height={height} className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]" draggable={false} />
      </div>
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -ml-px w-0.5 bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.5)]" />
        <div className="absolute top-1/2 -ml-4 -mt-4 flex size-8 items-center justify-center rounded-full bg-white text-[11px] font-bold text-black shadow-lg">⇆</div>
      </div>
      <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">Input</span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">Karyon</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(pos)}
        onChange={(e) => setPos(Number(e.target.value))}
        className="absolute inset-x-0 bottom-0 h-8 w-full cursor-ew-resize opacity-0"
        aria-label="Comparison position between input and segmentation"
      />
    </div>
  );
}
