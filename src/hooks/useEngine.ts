"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RGBAImage } from "@/lib/pathology/image";
import type { AnalysisOptions, AnalysisResult, Backend, WorkerRequest, WorkerResponse } from "@/lib/pathology/types";
import { SITE } from "@/lib/site";

export type EngineStatus =
  | { state: "loading" }
  | { state: "ready"; backend: Backend; loadMs: number; threads: number }
  | { state: "error"; message: string };

interface Pending {
  resolve: (r: AnalysisResult) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: string, fraction: number) => void;
}

/** Owns the analysis worker: model loading, request multiplexing and progress. */
export function useEngine() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const current = useRef<number | null>(null);
  const [status, setStatus] = useState<EngineStatus>({ state: "loading" });

  useEffect(() => {
    let w: Worker;
    try {
      w = new Worker(SITE.workerUrl, { type: "module", name: "karyon-engine" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Web Workers are unavailable in this browser.";
      queueMicrotask(() => setStatus({ state: "error", message }));
      return;
    }
    worker.current = w;
    const inflight = pending.current;
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === "ready") setStatus({ state: "ready", backend: m.backend, loadMs: m.loadMs, threads: m.threads });
      else if (m.type === "init-error") setStatus({ state: "error", message: m.message });
      else if (m.type === "progress") inflight.get(m.id)?.onProgress?.(m.stage, m.fraction);
      else if (m.type === "result") {
        inflight.get(m.id)?.resolve(m.result);
        inflight.delete(m.id);
      } else if (m.type === "error") {
        inflight.get(m.id)?.reject(new Error(m.message));
        inflight.delete(m.id);
      }
    };
    w.onmessageerror = () => {
      for (const p of inflight.values()) p.reject(new Error("The analysis result could not be transferred from the worker."));
      inflight.clear();
    };
    w.onerror = (ev) => {
      setStatus({ state: "error", message: ev.message || "The analysis engine failed to start." });
      for (const p of inflight.values()) p.reject(new Error("engine crashed"));
      inflight.clear();
    };
    const init: WorkerRequest = { type: "init", modelUrl: SITE.modelUrl, ortBase: SITE.ortBase, prefer: "auto" };
    w.postMessage(init);
    return () => {
      w.terminate();
      worker.current = null;
      for (const p of inflight.values()) p.reject(new Error("engine stopped"));
      inflight.clear();
    };
  }, []);

  const analyze = useCallback((img: RGBAImage, options: AnalysisOptions, onProgress?: Pending["onProgress"]) => {
    return new Promise<AnalysisResult>((resolve, reject) => {
      const w = worker.current;
      if (!w) return reject(new Error("The analysis engine is not running."));
      const id = nextId.current++;
      // only the newest request matters to the UI: cancel whatever is still running
      if (current.current !== null) w.postMessage({ type: "cancel", id: current.current } satisfies WorkerRequest);
      current.current = id;
      pending.current.set(id, {
        resolve: (r) => {
          if (current.current === id) current.current = null;
          resolve(r);
        },
        reject: (e) => {
          if (current.current === id) current.current = null;
          reject(e);
        },
        onProgress,
      });
      // copy so the caller keeps its pixels; the copy is transferred without another clone
      const buf = img.data.slice().buffer;
      const req: WorkerRequest = { type: "analyze", id, width: img.width, height: img.height, data: buf, options };
      w.postMessage(req, [buf]);
    });
  }, []);

  const cancel = useCallback(() => {
    const id = current.current;
    if (id !== null) worker.current?.postMessage({ type: "cancel", id } satisfies WorkerRequest);
  }, []);

  return { status, analyze, cancel };
}
