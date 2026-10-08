"use client";

import { useRef, useState } from "react";
import { audio } from "@/game/audio";
import { autopilot } from "@/game/autopilot";
import { input } from "@/game/input";
import { useGame } from "@/game/store";

type Pick = (px: number, py: number) => { x: number; y: number; enemyId: number | null } | null;

const STICK_R = 58;     // knob travel (CSS px)
const DRAG_START = 11;  // movement before a touch becomes a drag
const TAP_MS = 380;
const DEADZONE = 0.12;

/**
 * Touch controls:
 *  • Drag anywhere → a floating joystick appears under your thumb (analog).
 *  • Tap the world → walk there (A* routed). Tap a monster → lock on & attack.
 *    Tap a pot/grass → cut it. Tap a sign/chest → read/open it.
 *  • A second finger tap while steering → sword swing.
 *  • ⚔ button → sword (or the context action: Read / Open).
 */
export default function TouchControls({ pick }: { pick: Pick }) {
  const layer = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const ripple = useRef<HTMLDivElement>(null);
  const g = useRef<{ id: number; sx: number; sy: number; bx: number; by: number; t0: number; drag: boolean } | null>(null);

  const showStick = (x: number, y: number, on: boolean, strong: boolean) => {
    const b = base.current!;
    b.style.opacity = on ? (strong ? "1" : "0.45") : "0";
    b.style.transform = `translate(${x - 64}px, ${y - 64}px)`;
  };
  const setKnob = (dx: number, dy: number) => {
    knob.current!.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    audio.unlock();
    if (g.current) {
      // Second finger while steering: swing!
      input.click();
      return;
    }
    layer.current!.setPointerCapture(e.pointerId);
    g.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: e.clientX, by: e.clientY, t0: performance.now(), drag: false };
    showStick(e.clientX, e.clientY, true, false);
    setKnob(0, 0);
  };

  const onMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    let dx = e.clientX - s.bx, dy = e.clientY - s.by;
    let d = Math.hypot(dx, dy);
    if (!s.drag && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > DRAG_START) {
      s.drag = true;
      autopilot.cancel();
    }
    if (!s.drag) return;
    // Floating stick: the base trails the thumb if it wanders past the rim.
    if (d > STICK_R) {
      s.bx = e.clientX - (dx / d) * STICK_R;
      s.by = e.clientY - (dy / d) * STICK_R;
      dx = e.clientX - s.bx; dy = e.clientY - s.by; d = STICK_R;
    }
    showStick(s.bx, s.by, true, true);
    setKnob(dx, dy);
    const m = d / STICK_R;
    if (m < DEADZONE) { input.setStick(0, 0); return; }
    // Gentle push = a purposeful walk, full tilt = run.
    const out = 0.38 + 0.62 * Math.min(1, (m - DEADZONE) / (0.85 - DEADZONE));
    input.setStick((dx / d) * out, (dy / d) * out);
  };

  const end = (e: React.PointerEvent, cancelled: boolean) => {
    audio.unlock(); // touch: only pointerup counts as a user gesture for audio
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    g.current = null;
    input.setStick(0, 0);
    showStick(s.bx, s.by, false, false);
    if (cancelled || s.drag || performance.now() - s.t0 > TAP_MS) return;
    // Quick tap: walk / attack / interact.
    const rect = layer.current!.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    autopilot.tap(useGame.getState().world, hit.x, hit.y, hit.enemyId);
    const r = ripple.current!;
    r.style.left = `${e.clientX - rect.left}px`;
    r.style.top = `${e.clientY - rect.top}px`;
    r.style.borderColor = hit.enemyId !== null ? "rgba(255,90,106,0.95)" : "rgba(255,243,196,0.95)";
    r.classList.remove("animate-ripple");
    void r.offsetWidth; // restart the CSS animation
    r.classList.add("animate-ripple");
  };

  return (
    <div
      ref={layer}
      className="absolute inset-0 touch-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
    >
      <div ref={ripple} className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] opacity-0" />
      <div ref={base} className="pointer-events-none absolute left-0 top-0 h-32 w-32 rounded-full opacity-0 transition-opacity duration-150"
        style={{ background: "radial-gradient(circle, rgba(27,20,38,0.25) 0%, rgba(27,20,38,0.5) 62%, rgba(255,231,163,0.55) 64%, rgba(27,20,38,0.35) 70%, transparent 72%)" }}>
        <div ref={knob} className="absolute left-[34px] top-[34px] h-[60px] w-[60px] rounded-full border-2 border-[#ffe7a3] bg-gradient-to-b from-[#fff6dc] to-[#d9c08a] shadow-[0_4px_0_rgba(60,40,10,0.6),0_6px_14px_rgba(0,0,0,0.4)]" />
      </div>
    </div>
  );
}

/** Big round action button (bottom-right). Shows the context action when there is one. */
export function ActionButton() {
  const prompt = useGame((s) => s.prompt);
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      aria-label={prompt ?? "Sword"}
      className="pointer-events-auto absolute touch-none select-none"
      style={{ right: "calc(env(safe-area-inset-right) + 22px)", bottom: "calc(env(safe-area-inset-bottom) + 26px)" }}
      onPointerDown={(e) => { e.stopPropagation(); audio.unlock(); input.click(); setDown(true); }}
      onPointerUp={() => { audio.unlock(); setDown(false); }}
      onPointerCancel={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
    >
      <div className={`relative flex h-[86px] w-[86px] items-center justify-center rounded-full border-[3px] border-[#2a1a10] transition-transform duration-75 ${down ? "translate-y-[3px] scale-95" : ""}`}
        style={{
          background: prompt ? "radial-gradient(circle at 35% 30%, #fff6c8, #f1b73a 60%, #a8681a)" : "radial-gradient(circle at 35% 30%, #c9f7d6, #3fbf6a 60%, #1d6b3a)",
          boxShadow: down ? "0 1px 0 #1a100a, 0 0 18px rgba(255,230,150,0.5)" : "0 5px 0 #1a100a, 0 8px 18px rgba(0,0,0,0.45)",
        }}>
        <div className="absolute inset-[5px] rounded-full border-2 border-white/35" />
        {prompt ? (
          <span className="text-[15px] font-black uppercase tracking-wider text-[#3a2208]">{prompt}</span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-11 w-11 drop-shadow-[0_2px_0_rgba(10,40,20,0.7)]">
            <path d="M19.5 3.5 21 3l-.5 1.5L10 15l-1-1z" fill="#f4f7ff" stroke="#22303a" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M6.5 13.5 10.5 17.5M5 18.5l2-2M8 16l-2.5 2.5" stroke="#6b3a1c" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M6 12.5 11.5 18" stroke="#ffcc33" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        )}
      </div>
    </button>
  );
}
