"use client";

import { useEffect, useRef, useState } from "react";
import type { Runner } from "@/game/runner";

/**
 * Performance readout shown during gameplay.
 * Displays FPS, frame & CPU render time, draw calls, meshes, triangles,
 * particles, resolution, and memory.
 * Polls the runner's render stats ~4×/s and writes straight to the DOM (no React re-renders).
 * Tapping or clicking toggles between a compact bar and an expanded inspector panel.
 */
export default function FpsCounter({ runner, touch }: { runner: React.RefObject<Runner | null>; touch: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // Standard compact readout refs
  const fpsRef = useRef<HTMLSpanElement>(null);
  const frameMsRef = useRef<HTMLSpanElement>(null);
  const cpuMsRef = useRef<HTMLSpanElement>(null);
  const drawsRef = useRef<HTMLSpanElement>(null);
  const meshesRef = useRef<HTMLSpanElement>(null);
  const trisRef = useRef<HTMLSpanElement>(null);
  const extraRef = useRef<HTMLSpanElement>(null);

  // Expanded inspector refs
  const expFpsRef = useRef<HTMLSpanElement>(null);
  const expFrameMsRef = useRef<HTMLSpanElement>(null);
  const expCpuMsRef = useRef<HTMLSpanElement>(null);
  const expDrawsRef = useRef<HTMLSpanElement>(null);
  const expMeshesRef = useRef<HTMLSpanElement>(null);
  const expTrisRef = useRef<HTMLSpanElement>(null);
  const expPtclRef = useRef<HTMLSpanElement>(null);
  const expScaleRef = useRef<HTMLSpanElement>(null);
  const expResRef = useRef<HTMLSpanElement>(null);
  const expHitchRef = useRef<HTMLSpanElement>(null);
  const expMemRef = useRef<HTMLSpanElement>(null);

  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const tick = () => {
      const s = runner.current?.stats();
      if (!s) return;
      const fps = Math.round(s.fps);
      const fpsColor = fps >= 55 ? "#7cf0a0" : fps >= 30 ? "#ffd34a" : "#ff6a7a";
      const trisFmt = s.triangles >= 1000 ? `${(s.triangles / 1000).toFixed(1)}k` : String(s.triangles);

      // Compact bar refs
      if (fpsRef.current) {
        fpsRef.current.textContent = String(fps);
        fpsRef.current.style.color = fpsColor;
      }
      if (frameMsRef.current) frameMsRef.current.textContent = s.frameMs.toFixed(1);
      if (cpuMsRef.current) cpuMsRef.current.textContent = s.cpuMs.toFixed(1);
      if (drawsRef.current) drawsRef.current.textContent = String(s.drawCalls);
      if (meshesRef.current) meshesRef.current.textContent = String(s.activeMeshes);
      if (trisRef.current) trisRef.current.textContent = trisFmt;
      if (extraRef.current) {
        const parts: string[] = [];
        if (s.memMb > 0) parts.push(`${s.memMb} MB`);
        if (s.particles > 0) parts.push(`${s.particles} ptcl`);
        if (s.renderScale !== 1) parts.push(`${s.renderScale.toFixed(2)}×`);
        extraRef.current.textContent = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
      }

      // Expanded inspector refs
      if (expFpsRef.current) {
        expFpsRef.current.textContent = `${fps} FPS`;
        expFpsRef.current.style.color = fpsColor;
      }
      if (expFrameMsRef.current) expFrameMsRef.current.textContent = `${s.frameMs.toFixed(1)} ms`;
      if (expCpuMsRef.current) expCpuMsRef.current.textContent = `${s.cpuMs.toFixed(1)} ms`;
      if (expDrawsRef.current) expDrawsRef.current.textContent = String(s.drawCalls);
      if (expMeshesRef.current) expMeshesRef.current.textContent = `${s.activeMeshes} / ${s.totalMeshes}`;
      if (expTrisRef.current) expTrisRef.current.textContent = `${s.triangles.toLocaleString()} (${trisFmt})`;
      if (expPtclRef.current) expPtclRef.current.textContent = String(s.particles);
      if (expScaleRef.current) expScaleRef.current.textContent = `${s.renderScale.toFixed(2)}×`;
      if (expResRef.current) expResRef.current.textContent = s.resolution || "--";
      if (expHitchRef.current) expHitchRef.current.textContent = `${s.maxGapMs.toFixed(1)} ms`;
      if (expMemRef.current) expMemRef.current.textContent = s.memMb > 0 ? `${s.memMb} MB` : "N/A";
    };

    tickRef.current = tick;
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [runner]);

  useEffect(() => {
    tickRef.current();
  }, [expanded]);

  // Desktop: bottom-right corner (free of the controls hint). Touch: top centre,
  // between the player plate and the minimap, clear of the thumb controls.
  const style: React.CSSProperties = touch
    ? { top: "calc(env(safe-area-inset-top) + 6px)", left: "50%", transform: "translateX(-50%)" }
    : { bottom: 10, right: 14 };

  return (
    <div
      role="button"
      tabIndex={0}
      title="Click to toggle detailed performance stats"
      onClick={(e) => {
        e.stopPropagation();
        setExpanded((v) => !v);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute z-20 cursor-pointer select-none rounded-md border border-white/10 bg-[#120d1a]/80 px-2.5 py-1 font-mono text-[11px] leading-[16px] text-white/70 shadow-lg backdrop-blur-[2px] transition-colors hover:border-white/20 hover:bg-[#120d1a]/95 tabular-nums"
      style={style}
    >
      {expanded ? (
        <div className="flex min-w-[270px] max-w-[320px] flex-col gap-2 p-1 font-mono text-[11px] leading-[15px]">
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
            <div className="flex items-center gap-2">
              <span ref={expFpsRef} className="text-sm font-black text-[#7cf0a0]">-- FPS</span>
              <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/60">Perf</span>
            </div>
            <span className="text-[10px] text-white/40 hover:text-white/80">▲ Compact</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Frame:</span>
              <span ref={expFrameMsRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">CPU Render:</span>
              <span ref={expCpuMsRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Draw Calls:</span>
              <span ref={expDrawsRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Meshes:</span>
              <span ref={expMeshesRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Triangles:</span>
              <span ref={expTrisRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Particles:</span>
              <span ref={expPtclRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Render Scale:</span>
              <span ref={expScaleRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Resolution:</span>
              <span ref={expResRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">Max Hitch:</span>
              <span ref={expHitchRef} className="font-semibold text-white/90">--</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-0.5">
              <span className="text-white/45">JS Heap:</span>
              <span ref={expMemRef} className="font-semibold text-white/90">--</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 whitespace-nowrap">
          <span ref={fpsRef} className="font-black text-[#7cf0a0]">--</span>
          <span className="font-bold text-white/60">FPS</span>
          <span className="text-white/25">·</span>
          <span className="hidden sm:inline">
            <span ref={frameMsRef} className="font-medium text-white/90">--</span>
            <span className="text-white/45"> ms </span>
            <span className="text-white/40">(<span ref={cpuMsRef}>--</span> ms cpu)</span>
            <span className="mx-1 text-white/25">·</span>
          </span>
          <span>
            <span ref={drawsRef} className="font-medium text-white/90">--</span>
            <span className="ml-1 text-white/45">draws</span>
          </span>
          <span className="hidden md:inline">
            <span className="mx-1 text-white/25">·</span>
            <span ref={meshesRef} className="font-medium text-white/90">--</span>
            <span className="ml-1 text-white/45">meshes</span>
          </span>
          <span className="hidden sm:inline">
            <span className="mx-1 text-white/25">·</span>
            <span ref={trisRef} className="font-medium text-white/90">--</span>
            <span className="ml-1 text-white/45">tris</span>
          </span>
          <span ref={extraRef} className="hidden lg:inline text-white/45" />
          <span className="ml-1 text-[9px] text-white/30">▾</span>
        </div>
      )}
    </div>
  );
}
