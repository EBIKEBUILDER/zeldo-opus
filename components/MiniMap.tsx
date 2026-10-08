"use client";

import { useEffect, useRef } from "react";
import { useGame } from "@/game/store";
import { drawMap } from "./mapArt";

/** Circular radar in the HUD corner. Tap/click it to open the world map. */
export default function MiniMap({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const g = c.getContext("2d")!;
    let raf = 0, last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30 fps is plenty for a radar
      last = now;
      const s = useGame.getState();
      const p = s.world.player;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMap(g, s.world, s.visited, {
        map: p.map, cx: p.x, cy: p.y, scale: size / 21, width: size, height: size,
        radar: true, labels: false, t: now / 1000,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <button
      type="button"
      aria-label="Open map"
      onPointerDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); useGame.getState().setPaused(true, "map"); }}
      className="pointer-events-auto relative block rounded-full p-[3px] shadow-[0_4px_0_rgba(20,12,26,0.7),0_0_24px_rgba(0,0,0,0.35)]"
      style={{ width: size + 10, height: size + 10, background: "conic-gradient(from 200deg, #ffe7a3, #c48a2c, #ffe7a3, #9a6a1e, #ffe7a3)" }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-full border-2 border-[#2a1a10] bg-[#120d1a]">
        <canvas ref={ref} style={{ width: size, height: size }} className="block" />
        {/* soft vignette for a lens-like radar */}
        <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_14px_rgba(0,0,0,0.55)]" />
      </div>
      <span className="text-outline absolute -top-1 left-1/2 -translate-x-1/2 rounded-full border border-[#6b4a1c] bg-[#2a1d14] px-1.5 text-[9px] font-black leading-[14px] text-[#ffe7a3]">N</span>
    </button>
  );
}
