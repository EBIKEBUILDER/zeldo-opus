"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useGame } from "@/game/store";
import MiniMap from "./MiniMap";
import { ActionButton } from "./TouchControls";

const SAFE_T = "env(safe-area-inset-top)";
const SAFE_L = "env(safe-area-inset-left)";
const SAFE_R = "env(safe-area-inset-right)";
const SAFE_B = "env(safe-area-inset-bottom)";

function useViewport() {
  const [vp, setVp] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

function Heart({ fill, small }: { fill: 0 | 0.5 | 1; small: boolean }) {
  const path = "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.6 1.3 4.3 2.6h2c.7-1.3 2.1-2.6 4.3-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z";
  const id = useId().replace(/:/g, "");
  const clip = fill === 0.5 ? `url(#half${id})` : undefined;
  return (
    <svg viewBox="0 0 24 24" className={`${small ? "h-6 w-6" : "h-7 w-7"} drop-shadow-[0_2px_0_rgba(20,14,30,0.8)]`}>
      <defs>
        <clipPath id={`half${id}`}><rect x="0" y="0" width="12" height="24" /></clipPath>
      </defs>
      <path d={path} fill="#3a2333" stroke="#1d1220" strokeWidth="1.6" />
      {fill > 0 && <path d={path} fill="#ff4d6d" clipPath={clip} />}
      {fill > 0 && <path d="M6.5 7.2c-1.3.3-2 1.5-1.8 2.7" stroke="#ffd0da" strokeWidth="1.4" fill="none" strokeLinecap="round" clipPath={clip} />}
    </svg>
  );
}

function RupeeIcon() {
  return (
    <svg viewBox="0 0 16 24" className="h-5 w-3.5 drop-shadow-[0_2px_0_rgba(20,14,30,0.8)]">
      <path d="M8 1 15 7v10l-7 6-7-6V7z" fill="#3ddc84" stroke="#0f4a2a" strokeWidth="1.3" />
      <path d="M8 4 12 8v8l-4 3.5L4 16V8z" fill="#7cf0b0" />
      <path d="M8 4v15.5" stroke="#2bb36a" strokeWidth="1" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 drop-shadow-[0_2px_0_rgba(20,14,30,0.8)]">
      <circle cx="7" cy="8" r="4.2" fill="none" stroke="#ffcc33" strokeWidth="2.6" />
      <path d="M10 10.5 19 19.5M15.5 16l2.6-2.6M17.8 18.3l2-2" stroke="#ffcc33" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Zeldo's portrait: round face, pointy green cap, rosy cheeks. Winces when hurt. */
function Portrait({ size, hurt }: { size: number; hurt: boolean }) {
  return (
    <div className="relative shrink-0 rounded-full p-[3px] shadow-[0_3px_0_rgba(20,12,26,0.7)]"
      style={{ width: size, height: size, background: "conic-gradient(from 210deg, #ffe7a3, #c48a2c, #ffe7a3, #9a6a1e, #ffe7a3)" }}>
      <svg viewBox="0 0 64 64" className="h-full w-full rounded-full border-2 border-[#2a1a10]" style={{ background: "radial-gradient(circle at 50% 35%, #bfe8ff, #6fb7e0)" }}>
        <path d="M6 64c3-14 13-20 26-20s23 6 26 20z" fill="#3a9d5a" />
        <path d="M26 44h12l-2 6h-8z" fill="#f1c99a" />
        <circle cx="32" cy="33" r="15" fill="#ffd9b3" />
        <path d="M17 31c0-9 7-15 15-15 6 0 10 2 13 6l9-8-4 13c1 1 1 3 1 4-6-4-16-6-34 0z" fill="#3fb06a" stroke="#1f5e36" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M18 31c4-2 9-3 14-3" stroke="#2d8a52" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M18 31c-1 3 0 6 1 7M46 31c1 3 0 6-1 7" stroke="#8a5a2c" strokeWidth="3" strokeLinecap="round" />
        {hurt ? (
          <>
            <path d="M24 34l4 2-4 2M40 34l-4 2 4 2" stroke="#2a1a10" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <ellipse cx="32" cy="43" rx="3" ry="2.2" fill="#7a2a2a" />
          </>
        ) : (
          <>
            <ellipse cx="26.5" cy="36" rx="2" ry="2.6" fill="#2a1a10" />
            <ellipse cx="37.5" cy="36" rx="2" ry="2.6" fill="#2a1a10" />
            <circle cx="27.2" cy="35.2" r="0.7" fill="#fff" />
            <circle cx="38.2" cy="35.2" r="0.7" fill="#fff" />
            <path d="M29 42c2 1.6 4 1.6 6 0" stroke="#7a3a2a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </>
        )}
        <ellipse cx="22.5" cy="40" rx="2.6" ry="1.6" fill="#ff9aa8" opacity="0.7" />
        <ellipse cx="41.5" cy="40" rx="2.6" ry="1.6" fill="#ff9aa8" opacity="0.7" />
      </svg>
    </div>
  );
}

function Hearts({ small }: { small: boolean }) {
  const hp = useGame((s) => s.hp);
  const maxHp = useGame((s) => s.maxHp);
  const lowHp = useGame((s) => s.lowHp);
  const hearts = [];
  for (let i = 0; i < maxHp / 2; i++) {
    const v = hp - i * 2;
    hearts.push(<Heart key={i} small={small} fill={v >= 2 ? 1 : v === 1 ? 0.5 : 0} />);
  }
  return <div className={`flex gap-0.5 ${lowHp ? "animate-heartbeat" : ""}`}>{hearts}</div>;
}

function Rupees() {
  const rupees = useGame((s) => s.rupees);
  const [bump, setBump] = useState(0);
  const prev = useRef(rupees);
  useEffect(() => {
    if (rupees > prev.current) setBump((b) => b + 1);
    prev.current = rupees;
  }, [rupees]);
  return (
    <div className="flex items-center gap-1.5">
      <RupeeIcon />
      <span key={bump} className="animate-pop text-outline text-base font-extrabold tabular-nums">{String(rupees).padStart(3, "0")}</span>
    </div>
  );
}

/** Top-left character plate: portrait, name, hearts, purse, key. */
function PlayerPlate({ small }: { small: boolean }) {
  const hasKey = useGame((s) => s.hasKey);
  const [hurt, setHurt] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    let last = useGame.getState().hp;
    const unsub = useGame.subscribe((s) => {
      if (s.hp < last) { setHurt(true); clearTimeout(t); t = setTimeout(() => setHurt(false), 700); }
      last = s.hp;
    });
    return () => { unsub(); clearTimeout(t); };
  }, []);
  return (
    <div className="flex items-center gap-2">
      <Portrait size={small ? 54 : 66} hurt={hurt} />
      <div className="flex flex-col gap-0.5 rounded-r-2xl rounded-l-md bg-gradient-to-r from-[#1b1426]/80 to-[#1b1426]/30 py-1 pl-2 pr-4">
        <div className="text-outline text-[10px] font-black uppercase tracking-[0.3em] text-[#ffe7a3]">Zeldo</div>
        <Hearts small={small} />
        <div className="flex items-center gap-3">
          <Rupees />
          {hasKey && <div className="animate-pop flex items-center gap-1"><KeyIcon /><span className="text-outline text-[10px] font-black text-[#ffcc33]">×1</span></div>}
        </div>
      </div>
    </div>
  );
}

function AreaToast({ small }: { small: boolean }) {
  const area = useGame((s) => s.area);
  const phase = useGame((s) => s.phase);
  const [shown, setShown] = useState<{ name: string; id: number } | null>(null);
  const last = useRef<string>("");
  useEffect(() => {
    if (phase !== "playing") { last.current = ""; return; }
    if (area !== last.current) {
      last.current = area;
      setShown((s) => ({ name: area, id: (s?.id ?? 0) + 1 }));
    }
  }, [area, phase]);
  if (!shown || phase !== "playing") return null;
  return (
    <div key={shown.id} className="animate-toast pointer-events-none absolute left-0 right-0 top-[24%] text-center">
      <div className={`text-outline ${small ? "text-xl" : "text-3xl"} font-black uppercase tracking-[0.32em] text-[#fff6dc]`}>{shown.name}</div>
      <div className="mx-auto mt-2 h-[2px] w-48 bg-gradient-to-r from-transparent via-[#ffd77a] to-transparent" />
    </div>
  );
}

function MessageBox({ touch, landscape }: { touch: boolean; landscape: boolean }) {
  const id = useGame((s) => s.msgId);
  const text = useGame((s) => s.msgText);
  const big = useGame((s) => s.msgBig);
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const iv = setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 16);
    return () => clearInterval(iv);
  }, [id, text]);
  if (!text) return null;
  if (big) {
    return (
      <div className="pointer-events-none absolute left-0 right-0 top-[18%] flex justify-center px-4">
        <div className="animate-rise rounded-2xl border-2 border-[#ffd77a]/80 bg-[#1b1426]/85 px-8 py-4 text-center shadow-[0_0_40px_rgba(255,200,90,0.35)]">
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-[#ffd77a]">Treasure!</div>
          <div className="text-outline mt-1 text-2xl font-black tracking-wide text-white sm:text-3xl">{text}</div>
        </div>
      </div>
    );
  }
  const sign = text.includes("  ·  ");
  const [title, body] = sign ? text.split("  ·  ") : [null, text];
  const done = n >= text.length;
  return (
    <div className="pointer-events-none absolute left-0 right-0 flex justify-center px-3"
      style={touch && landscape
        // Landscape phones: hug the bottom edge, clear of the ⚔ button.
        ? { bottom: `calc(${SAFE_B} + 14px)`, paddingRight: `calc(${SAFE_R} + 130px)`, paddingLeft: `calc(${SAFE_L} + 12px)` }
        : { bottom: touch ? `calc(${SAFE_B} + 128px)` : "40px" }}>
      <div className="relative w-full max-w-2xl rounded-xl border-[3px] border-[#c48a2c] bg-gradient-to-b from-[#241a33]/95 to-[#150f1f]/95 px-5 pb-3 pt-3 text-[15px] leading-snug text-[#fff6e8] shadow-[0_0_0_2px_#2a1a10,0_10px_30px_rgba(0,0,0,0.5)] sm:text-lg">
        {title && (
          <div className="absolute -top-3.5 left-4 rounded-md border-2 border-[#2a1a10] bg-[#ffd77a] px-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#2a1a10]">{title}</div>
        )}
        {(() => {
          // Typewriter over the body only (the title shows on its plate).
          const off = title ? title.length + 5 : 0;
          const k = Math.max(0, n - off);
          return <>{body.slice(0, k)}<span className="opacity-0">{body.slice(k)}</span></>;
        })()}
        {done && <span className="animate-blink absolute bottom-1 right-2.5 text-xs text-[#ffd77a]">▼</span>}
      </div>
    </div>
  );
}

function BossBar({ narrow }: { narrow: boolean }) {
  const visible = useGame((s) => s.bossVisible);
  const hp = useGame((s) => s.bossHp);
  const max = useGame((s) => s.bossMax);
  const enraged = useGame((s) => s.bossEnraged);
  if (!visible) return null;
  // Outer box positions; the inner one animates (its transform would clobber a centring translate).
  const style = narrow
    ? { left: `calc(${SAFE_L} + 12px)`, top: `calc(${SAFE_T} + 84px)`, width: "calc(100% - 160px)" }
    : { left: "50%", top: `calc(${SAFE_T} + 18px)`, width: "min(440px, 40vw)", transform: "translateX(-50%)" };
  return (
    <div className="pointer-events-none absolute" style={style}><div className="animate-rise">
      <div className="mb-1 flex items-center justify-center gap-2">
        <span className="text-outline text-xs font-black uppercase tracking-[0.35em] text-[#ffd0ec]">👑 King Gloob</span>
        {enraged && <span className="rounded bg-[#ff3b5c] px-1.5 text-[9px] font-black uppercase tracking-widest text-white animate-pulse">Enraged</span>}
      </div>
      <div className="relative h-4 overflow-hidden rounded-md border-2 border-[#c48a2c] bg-[#2a1525] shadow-[0_0_0_2px_#2a1a10,0_4px_10px_rgba(0,0,0,0.4)]">
        <div className={`h-full transition-[width] duration-300 ${enraged ? "bg-gradient-to-r from-[#ff3b5c] to-[#ff8a3d]" : "bg-gradient-to-r from-[#c03a8a] to-[#e070b0]"}`}
          style={{ width: `${(hp / max) * 100}%` }} />
        {/* segment ticks, one per hit point */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: max }, (_, i) => <div key={i} className="flex-1 border-r border-black/30 last:border-r-0" />)}
        </div>
      </div>
    </div></div>
  );
}

/** Quest tracker under the minimap. Tap it for the full quest log. */
function QuestTracker({ narrow }: { narrow: boolean }) {
  const title = useGame((s) => s.objTitle);
  const hint = useGame((s) => s.objHint);
  const step = useGame((s) => s.objStep);
  const [flash, setFlash] = useState(0);
  const prev = useRef(step);
  useEffect(() => {
    if (step !== prev.current) setFlash((f) => f + 1);
    prev.current = step;
  }, [step]);
  return (
    <button type="button" key={flash}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); useGame.getState().setPaused(true, "quest"); }}
      className={`pointer-events-auto ${flash ? "animate-questflash" : ""} rounded-xl border border-[#ffd77a]/40 bg-[#1b1426]/75 px-3 py-1.5 text-right shadow-lg backdrop-blur-[2px]`}
      style={{ maxWidth: narrow ? 150 : 250 }}>
      <div className="text-[9px] font-black uppercase tracking-[0.3em] text-[#ffd77a]/90">★ Quest</div>
      <div className="text-outline text-[12px] font-extrabold leading-tight text-[#fff6dc] sm:text-[13px]">{title}</div>
      {!narrow && <div className="mt-0.5 text-[11px] leading-snug text-white/60">{hint}</div>}
    </button>
  );
}

function MenuButton() {
  return (
    <button type="button" aria-label="Menu"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); useGame.getState().setPaused(true); }}
      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#2a1a10] shadow-[0_3px_0_rgba(20,12,26,0.7)]"
      style={{ background: "radial-gradient(circle at 35% 30%, #fff1c4, #d8a54a 70%, #9a6a1e)" }}>
      <svg viewBox="0 0 20 20" className="h-4 w-4"><path d="M4 5.5h12M4 10h12M4 14.5h12" stroke="#2a1a10" strokeWidth="2.4" strokeLinecap="round" /></svg>
    </button>
  );
}

/** Per-frame overlays written straight to the DOM (no React re-render). */
function Overlays() {
  const red = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const low = useRef<HTMLDivElement>(null);
  useEffect(() => useGame.subscribe((s) => {
    if (red.current) red.current.style.opacity = String(Math.min(1, s.hurt * 1.1));
    if (fade.current) fade.current.style.opacity = String(s.fade);
    if (low.current) low.current.style.opacity = s.lowHp && s.phase === "playing" ? "1" : "0";
  }), []);
  return (
    <>
      <div ref={low} className="pointer-events-none absolute inset-0 animate-pulse opacity-0 transition-opacity duration-500"
        style={{ boxShadow: "inset 0 0 90px 10px rgba(255,40,70,0.28)" }} />
      <div ref={red} className="pointer-events-none absolute inset-0 opacity-0"
        style={{ background: "radial-gradient(ellipse at center, rgba(255,0,40,0) 45%, rgba(255,20,50,0.55) 100%)", boxShadow: "inset 0 0 70px 20px rgba(255,0,40,0.55)" }} />
      <div ref={fade} className="pointer-events-none absolute inset-0 bg-black opacity-0" />
    </>
  );
}

export default function HUD() {
  const phase = useGame((s) => s.phase);
  const area = useGame((s) => s.area);
  const muted = useGame((s) => s.muted);
  const prompt = useGame((s) => s.prompt);
  const touch = useGame((s) => s.touch);
  const paused = useGame((s) => s.paused);
  const vp = useViewport();
  const narrow = vp.w < 640;
  const small = narrow || vp.h < 500;
  const mapSize = small ? 92 : 132;
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <Overlays />
      {phase === "playing" && (
        <>
          <div className="absolute" style={{ left: `calc(${SAFE_L} + 12px)`, top: `calc(${SAFE_T} + 10px)` }}>
            <PlayerPlate small={small} />
          </div>
          <div className="absolute flex flex-col items-end gap-1.5" style={{ right: `calc(${SAFE_R} + 12px)`, top: `calc(${SAFE_T} + 10px)` }}>
            <div className="relative">
              <MiniMap size={mapSize} />
              <div className="absolute -bottom-1 -left-3"><MenuButton /></div>
            </div>
            <div className="text-outline max-w-[210px] truncate rounded-full bg-[#1b1426]/65 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-[#fff6dc]">
              {area}
            </div>
            {!small || vp.h > 560 ? <QuestTracker narrow={narrow} /> : null}
          </div>
          <BossBar narrow={narrow} />
          <AreaToast small={small} />
          <MessageBox touch={touch} landscape={vp.w > vp.h} />
          {touch && !paused && <ActionButton />}
          {!touch && prompt && (
            <div className="absolute bottom-32 left-0 right-0 flex justify-center">
              <div className="text-outline animate-rise rounded-lg border border-white/30 bg-[#1b1426]/70 px-3 py-1 text-sm font-bold">
                <span className="mr-2 rounded bg-white/90 px-1.5 py-0.5 text-xs font-black text-[#1b1426]">SPACE</span>{prompt}
              </div>
            </div>
          )}
          {!touch && (
            <div className="text-outline absolute bottom-3 left-4 text-[11px] font-semibold tracking-wide text-white/55">
              WASD / Arrows move · Space / Click sword · Esc menu · Tab map · M {muted ? "unmute" : "mute"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
