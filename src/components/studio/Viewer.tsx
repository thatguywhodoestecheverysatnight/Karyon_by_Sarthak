"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Polygons } from "@/lib/pathology/features";

interface View {
  s: number;
  tx: number;
  ty: number;
}

export interface ViewerProps {
  base: ImageData | null;
  overlay: ImageData | null;
  overlayOpacity: number;
  labels: Int32Array | null;
  polygons: Polygons | null;
  mpp: number | null;
  selected: number | null;
  onSelect: (id: number | null) => void;
  focus: { id: number; nonce: number } | null;
  tooltip: (id: number) => ReactNode;
  /** changes whenever a new image is loaded, so the view refits even at identical size */
  resetKey?: number;
  children?: ReactNode;
}

function toCanvas(img: ImageData | null): HTMLCanvasElement | null {
  if (!img || typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

const NICE_UM = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

export function Viewer(props: ViewerProps) {
  const { base, overlay, overlayOpacity, labels, polygons, mpp, selected, onSelect, focus, tooltip, resetKey, children } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ s: 1, tx: 0, ty: 0 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const raf = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ moved: boolean; x: number; y: number } | null>(null);
  const pinch = useRef<{ d: number; s: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const [hover, setHover] = useState<{ id: number; x: number; y: number } | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [bar, setBar] = useState<{ px: number; label: string } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [viewportW, setViewportW] = useState(0);

  const baseCanvas = useMemo(() => toCanvas(base), [base]);
  const overlayCanvas = useMemo(() => toCanvas(overlay), [overlay]);
  const imgW = base?.width ?? 0;
  const imgH = base?.height ?? 0;

  // Everything the render loop reads lives in a ref, so draw/schedule/fit are stable
  // and changing a layer, the overlay or the selection never resets the viewport.
  const latest = useRef({ baseCanvas, overlayCanvas, overlayOpacity, polygons, selected, mpp, imgW, imgH });
  const needsFit = useRef(true);

  const updateHud = useCallback(() => {
    const s = view.current.s;
    const m = latest.current.mpp;
    setZoomPct(Math.round(s * 100));
    if (m) {
      const pxPerUm = s / m;
      const um = NICE_UM.find((u) => u * pxPerUm >= 70) ?? NICE_UM[NICE_UM.length - 1];
      setBar({ px: um * pxPerUm, label: um >= 1000 ? `${um / 1000} mm` : `${um} µm` });
    } else setBar(null);
  }, []);

  const draw = useCallback(() => {
    raf.current = 0;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const { w, h, dpr } = size.current;
    const L = latest.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!L.baseCanvas) return;
    const { s, tx, ty } = view.current;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(s, s);
    ctx.imageSmoothingEnabled = s < 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(L.baseCanvas, 0, 0);
    if (L.overlayCanvas && L.overlayOpacity > 0) {
      ctx.globalAlpha = L.overlayOpacity;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(L.overlayCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    const P = L.polygons;
    if (P && L.selected) {
      const a = P.offsets[L.selected - 1], b = P.offsets[L.selected];
      if (b > a) {
        ctx.beginPath();
        for (let k = a; k < b; k++) {
          const x = P.coords[2 * k] * s + tx;
          const y = P.coords[2 * k + 1] * s + ty;
          if (k === a) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    }
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  const fit = useCallback(() => {
    const { w, h } = size.current;
    const { imgW: iw, imgH: ih } = latest.current;
    if (!iw || !w) return false;
    const s = Math.min((w - 32) / iw, (h - 32) / ih);
    view.current = { s, tx: (w - iw * s) / 2, ty: (h - ih * s) / 2 };
    updateHud();
    schedule();
    return true;
  }, [schedule, updateHud]);

  useEffect(() => {
    latest.current = { baseCanvas, overlayCanvas, overlayOpacity, polygons, selected, mpp, imgW, imgH };
    schedule();
  }, [baseCanvas, overlayCanvas, overlayOpacity, polygons, selected, mpp, imgW, imgH, schedule]);

  useEffect(() => updateHud(), [mpp, updateHud]);

  // new image dimensions: fit to view. Layer switches keep the current viewport.
  useEffect(() => {
    needsFit.current = !fit();
  }, [imgW, imgH, resetKey, fit]);

  // resize handling
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const prev = size.current;
      size.current = { w: r.width, h: r.height, dpr };
      setViewportW(r.width);
      const c = canvas.current!;
      const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
        c.style.width = `${r.width}px`;
        c.style.height = `${r.height}px`;
      }
      // keep the image centre stable when the panel resizes
      if (!needsFit.current && prev.w) {
        view.current.tx += (r.width - prev.w) / 2;
        view.current.ty += (r.height - prev.h) / 2;
      }
      if (needsFit.current) needsFit.current = !fit();
      schedule();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, schedule]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = view.current;
      const s = Math.min(40, Math.max(0.05, v.s * factor));
      const k = s / v.s;
      view.current = { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
      updateHud();
      schedule();
    },
    [schedule, updateHud],
  );

  // focus a nucleus picked in the table (depends on the request only)
  useEffect(() => {
    const P = latest.current.polygons;
    if (!focus || !P) return;
    const a = P.offsets[focus.id - 1], b = P.offsets[focus.id];
    if (b <= a) return;
    let x = 0, y = 0;
    for (let k = a; k < b; k++) {
      x += P.coords[2 * k];
      y += P.coords[2 * k + 1];
    }
    x /= b - a;
    y /= b - a;
    const { w, h } = size.current;
    const s = Math.max(view.current.s, 4);
    view.current = { s, tx: w / 2 - x * s, ty: h / 2 - y * s };
    updateHud();
    schedule();
  }, [focus, schedule, updateHud]);

  // wheel needs a non-passive listener to prevent page scroll
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!baseCanvas) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [baseCanvas, zoomAt]);

  const imageCoords = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const { s, tx, ty } = view.current;
    return { x: Math.floor((clientX - r.left - tx) / s), y: Math.floor((clientY - r.top - ty) / s), sx: clientX - r.left, sy: clientY - r.top };
  };

  const labelAt = (clientX: number, clientY: number) => {
    if (!labels || !imgW) return { id: 0, sx: 0, sy: 0 };
    const { x, y, sx, sy } = imageCoords(clientX, clientY);
    if (x < 0 || y < 0 || x >= imgW || y >= imgH) return { id: 0, sx, sy };
    return { id: labels[y * imgW + x], sx, sy };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!baseCanvas || (e.pointerType === "mouse" && e.button !== 0)) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { moved: false, x: e.clientX, y: e.clientY };
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const r = wrap.current!.getBoundingClientRect();
      pinch.current = {
        d: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        s: view.current.s,
        cx: (p1.x + p2.x) / 2 - r.left,
        cy: (p1.y + p2.y) / 2 - r.top,
        tx: view.current.tx,
        ty: view.current.ty,
      };
      drag.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!baseCanvas) return;
    const prev = pointers.current.get(e.pointerId);
    if (prev) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const pc = pinch.current;
      const s = Math.min(40, Math.max(0.05, (pc.s * d) / pc.d));
      const k = s / pc.s;
      view.current = { s, tx: pc.cx - (pc.cx - pc.tx) * k, ty: pc.cy - (pc.cy - pc.ty) * k };
      updateHud();
      schedule();
      return;
    }
    if (drag.current && prev) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (!drag.current.moved && Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y) > 4) {
        drag.current.moved = true;
        setGrabbing(true);
      }
      view.current.tx += dx;
      view.current.ty += dy;
      schedule();
      setHover(null);
      return;
    }
    const { id, sx, sy } = labelAt(e.clientX, e.clientY);
    setHover(id ? { id, x: sx, y: sy } : null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasDrag = drag.current?.moved;
    pointers.current.delete(e.pointerId);
    if (pinch.current && pointers.current.size === 1) {
      // one finger lifted after a pinch: continue as a pan with the remaining finger
      const [p] = [...pointers.current.values()];
      drag.current = { moved: true, x: p.x, y: p.y };
    }
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      if (drag.current && !wasDrag && e.type === "pointerup") {
        const { id } = labelAt(e.clientX, e.clientY);
        onSelect(id || null);
      }
      drag.current = null;
      setGrabbing(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const { w, h } = size.current;
    const step = 60;
    const map: Record<string, () => void> = {
      "+": () => zoomAt(1.25, w / 2, h / 2),
      "=": () => zoomAt(1.25, w / 2, h / 2),
      "-": () => zoomAt(0.8, w / 2, h / 2),
      "0": fit,
      ArrowLeft: () => ((view.current.tx += step), schedule()),
      ArrowRight: () => ((view.current.tx -= step), schedule()),
      ArrowUp: () => ((view.current.ty += step), schedule()),
      ArrowDown: () => ((view.current.ty -= step), schedule()),
      Escape: () => onSelect(null),
    };
    const fn = map[e.key];
    if (fn && baseCanvas) {
      e.preventDefault();
      fn();
    }
  };

  const hoverCard = hover ? tooltip(hover.id) : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-viewer">
      <div
        ref={wrap}
        className={`absolute inset-0 touch-none select-none outline-none ${baseCanvas ? (grabbing ? "cursor-grabbing" : "cursor-crosshair") : ""}`}
        tabIndex={baseCanvas ? 0 : -1}
        role="application"
        aria-label="Slide viewer. Drag to pan, scroll or pinch to zoom, press 0 to fit, click a nucleus to inspect it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          const r = wrap.current!.getBoundingClientRect();
          zoomAt(2, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        <canvas ref={canvas} className="block" />
      </div>

      {baseCanvas && (
        <>
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-white/10 bg-black/55 p-1 text-white/90 shadow-lg backdrop-blur-md">
            <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/10" onClick={() => zoomAt(0.8, size.current.w / 2, size.current.h / 2)} aria-label="Zoom out">
              <Minus className="size-4" />
            </button>
            <span className="tabular w-12 text-center font-mono text-xs">{zoomPct}%</span>
            <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/10" onClick={() => zoomAt(1.25, size.current.w / 2, size.current.h / 2)} aria-label="Zoom in">
              <Plus className="size-4" />
            </button>
            <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/10" onClick={fit} aria-label="Fit image to view">
              <Maximize2 className="size-4" />
            </button>
          </div>
          {bar && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/55 px-2.5 py-1.5 text-white backdrop-blur-md">
              <div className="h-1.5 rounded-sm border-x-2 border-b-2 border-white" style={{ width: bar.px }} />
              <div className="mt-1 font-mono text-[11px] leading-none">{bar.label}</div>
            </div>
          )}
        </>
      )}

      {hover && hoverCard && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-xl border border-white/10 bg-black/75 p-3 text-xs text-white shadow-2xl backdrop-blur-md"
          style={{ left: Math.min(hover.x + 16, Math.max(0, viewportW - 236)), top: hover.y + 16 }}
        >
          {hoverCard}
        </div>
      )}
      {children}
    </div>
  );
}
