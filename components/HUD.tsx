"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useGame } from "@/game/store";

function Heart({ fill }: { fill: 0 | 0.5 | 1 }) {
  const path = "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.6 1.3 4.3 2.6h2c.7-1.3 2.1-2.6 4.3-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z";
  const id = useId().replace(/:/g, "");
  const clip = fill === 0.5 ? `url(#half${id})` : undefined;
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 drop-shadow-[0_2px_0_rgba(20,14,30,0.8)]">
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
    <svg viewBox="0 0 16 24" className="h-6 w-4 drop-shadow-[0_2px_0_rgba(20,14,30,0.8)]">
      <path d="M8 1 15 7v10l-7 6-7-6V7z" fill="#3ddc84" stroke="#0f4a2a" strokeWidth="1.3" />
      <path d="M8 4 12 8v8l-4 3.5L4 16V8z" fill="#7cf0b0" />
      <path d="M8 4v15.5" stroke="#2bb36a" strokeWidth="1" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 drop-shadow-[0_2px_0_rgba(20,14,30,0.8)]">
      <circle cx="7" cy="8" r="4.2" fill="none" stroke="#ffcc33" strokeWidth="2.6" />
      <path d="M10 10.5 19 19.5M15.5 16l2.6-2.6M17.8 18.3l2-2" stroke="#ffcc33" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function Hearts() {
  const hp = useGame((s) => s.hp);
  const maxHp = useGame((s) => s.maxHp);
  const lowHp = useGame((s) => s.lowHp);
  const hearts = [];
  for (let i = 0; i < maxHp / 2; i++) {
    const v = hp - i * 2;
    hearts.push(<Heart key={i} fill={v >= 2 ? 1 : v === 1 ? 0.5 : 0} />);
  }
  return <div className={`flex gap-1 ${lowHp ? "animate-heartbeat" : ""}`}>{hearts}</div>;
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
    <div className="flex items-center gap-2">
      <RupeeIcon />
      <span key={bump} className="animate-pop text-outline text-xl font-extrabold tabular-nums">{String(rupees).padStart(3, "0")}</span>
    </div>
  );
}

function AreaToast() {
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
    <div key={shown.id} className="animate-toast pointer-events-none absolute left-0 right-0 top-[22%] text-center">
      <div className="text-outline text-3xl font-black uppercase tracking-[0.32em] text-[#fff6dc]">{shown.name}</div>
      <div className="mx-auto mt-2 h-[2px] w-48 bg-gradient-to-r from-transparent via-[#ffd77a] to-transparent" />
    </div>
  );
}

function MessageBox() {
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
      <div className="pointer-events-none absolute left-0 right-0 top-[16%] flex justify-center">
        <div className="animate-rise rounded-2xl border-2 border-[#ffd77a]/80 bg-[#1b1426]/85 px-8 py-4 text-center shadow-[0_0_40px_rgba(255,200,90,0.35)]">
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-[#ffd77a]">Treasure!</div>
          <div className="text-outline mt-1 text-3xl font-black tracking-wide text-white">{text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute bottom-8 left-0 right-0 flex justify-center px-4">
      <div className="max-w-2xl rounded-xl border-2 border-white/25 bg-[#1b1426]/85 px-6 py-3 text-lg leading-snug text-[#fff6e8] shadow-xl backdrop-blur-sm">
        {text.slice(0, n)}
        <span className="opacity-0">{text.slice(n)}</span>
      </div>
    </div>
  );
}

function BossBar() {
  const visible = useGame((s) => s.bossVisible);
  const hp = useGame((s) => s.bossHp);
  const max = useGame((s) => s.bossMax);
  const enraged = useGame((s) => s.bossEnraged);
  if (!visible) return null;
  return (
    <div className="animate-rise pointer-events-none absolute left-1/2 top-5 w-[min(460px,70vw)] -translate-x-1/2">
      <div className="text-outline mb-1 text-center text-sm font-black uppercase tracking-[0.4em] text-[#ffd0ec]">
        👑 King Gloob
      </div>
      <div className="h-4 overflow-hidden rounded-full border-2 border-[#1d1220] bg-[#3a2333] shadow-lg">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${enraged ? "bg-gradient-to-r from-[#ff3b5c] to-[#ff8a3d] animate-pulse" : "bg-gradient-to-r from-[#c03a8a] to-[#e070b0]"}`}
          style={{ width: `${(hp / max) * 100}%` }}
        />
      </div>
    </div>
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
  const hasKey = useGame((s) => s.hasKey);
  const muted = useGame((s) => s.muted);
  const prompt = useGame((s) => s.prompt);
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <Overlays />
      {phase === "playing" && (
        <>
          <div className="absolute left-5 top-4 flex flex-col gap-2">
            <Hearts />
            <div className="flex items-center gap-4">
              <Rupees />
              {hasKey && <div className="animate-pop"><KeyIcon /></div>}
            </div>
          </div>
          <div className="absolute right-5 top-4 flex flex-col items-end gap-1">
            <div className="text-outline rounded-full bg-[#1b1426]/55 px-4 py-1 text-sm font-bold uppercase tracking-[0.25em] text-[#fff6dc]">
              {area}
            </div>
            <div className="text-outline text-xs font-semibold text-white/70">{muted ? "🔇 muted (M)" : "♪ M to mute"}</div>
          </div>
          <BossBar />
          <AreaToast />
          <MessageBox />
          {prompt && (
            <div className="absolute bottom-28 left-0 right-0 flex justify-center">
              <div className="text-outline animate-rise rounded-lg border border-white/30 bg-[#1b1426]/70 px-3 py-1 text-sm font-bold">
                <span className="mr-2 rounded bg-white/90 px-1.5 py-0.5 text-xs font-black text-[#1b1426]">SPACE</span>{prompt}
              </div>
            </div>
          )}
          <div className="text-outline absolute bottom-3 left-4 text-[11px] font-semibold tracking-wide text-white/55">
            WASD / Arrows move · Space / Click sword · M mute
          </div>
        </>
      )}
    </div>
  );
}
