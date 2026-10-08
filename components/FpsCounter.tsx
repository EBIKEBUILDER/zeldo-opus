"use client";

import { useEffect, useRef } from "react";
import type { Runner } from "@/game/runner";

/**
 * Small FPS readout shown during gameplay. Polls the runner's render stats a
 * few times a second and writes straight to the DOM (no React re-renders).
 */
export default function FpsCounter({ runner, touch }: { runner: React.RefObject<Runner | null>; touch: boolean }) {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tick = () => {
      const s = runner.current?.stats();
      if (!s || !fpsRef.current || !detailRef.current) return;
      const fps = Math.round(s.fps);
      fpsRef.current.textContent = String(fps);
      fpsRef.current.style.color = fps >= 55 ? "#7cf0a0" : fps >= 30 ? "#ffd34a" : "#ff6a7a";
      detailRef.current.textContent = `${s.frameMs.toFixed(1)} ms · ${s.drawCalls} draws`;
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [runner]);

  // Desktop: bottom-right corner (free of the controls hint). Touch: top centre,
  // between the player plate and the minimap, clear of the thumb controls.
  const style: React.CSSProperties = touch
    ? { top: "calc(env(safe-area-inset-top) + 6px)", left: "50%", transform: "translateX(-50%)" }
    : { bottom: 10, right: 14 };

  return (
    <div className="pointer-events-none absolute z-20 select-none rounded-md bg-[#120d1a]/70 px-2 py-0.5 font-mono text-[11px] leading-[16px] text-white/70 tabular-nums"
      style={style}>
      <span ref={fpsRef} className="font-black">--</span>
      <span className="ml-1 font-bold text-white/60">FPS</span>
      <span ref={detailRef} className="ml-2 text-white/45" />
    </div>
  );
}
