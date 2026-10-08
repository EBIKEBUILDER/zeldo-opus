"use client";

import { useEffect, useRef, useState } from "react";
import { QUEST_STEPS } from "@/game/objective";
import { useGame } from "@/game/store";
import type { MenuTab } from "@/game/store";
import type { MapId } from "@/game/maps";
import { drawMap, mapSize } from "./mapArt";

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Full world map with fog of war, area names, the hero and the next objective. */
function WorldMap() {
  const here = useGame((s) => s.world.player.map);
  const visited = useGame((s) => s.visited);
  const [map, setMap] = useState<MapId>(here);
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const dungeonKnown = !!(visited["dungeon:hall"] || visited["dungeon:boss"]);

  useEffect(() => {
    const c = ref.current!, b = box.current!;
    const g = c.getContext("2d")!;
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const { w: mw, h: mh } = mapSize(map);
      const bw = b.clientWidth - 8, bh = b.clientHeight - 8;
      const scale = Math.max(4, Math.min(bw / mw, bh / mh));
      const width = Math.floor(mw * scale), height = Math.floor(mh * scale);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
        c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
        c.style.width = `${width}px`; c.style.height = `${height}px`;
      }
      const s = useGame.getState();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMap(g, s.world, s.visited, { map, cx: mw / 2, cy: mh / 2, scale, width, height, radar: false, labels: true, t: now / 1000 });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [map]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {(["over", "dungeon"] as MapId[]).map((m) => {
          const ok = m === "over" || dungeonKnown;
          return (
            <button key={m} type="button" disabled={!ok} onClick={() => setMap(m)}
              className={`rounded-lg border px-3 py-1 text-xs font-black uppercase tracking-[0.18em] transition ${map === m ? "border-[#ffd77a] bg-[#ffd77a] text-[#2a1a10]" : "border-white/20 bg-white/5 text-white/70"} disabled:opacity-30`}>
              {m === "over" ? "Glimmerdell" : ok ? "Barrow" : "???"}
            </button>
          );
        })}
        <div className="ml-auto hidden items-center gap-3 text-[11px] text-white/60 sm:flex">
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rotate-45 bg-white" /> You</span>
          <span className="flex items-center gap-1 text-[#ffd34a]">★ Objective</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff4d5e]" /> Monster</span>
        </div>
      </div>
      <div ref={box} className="flex w-full items-center justify-center overflow-hidden rounded-xl border-2 border-[#5a4020] bg-[#0e0b14] p-1"
        style={{ aspectRatio: `${mapSize(map).w + 1} / ${mapSize(map).h + 1}`, maxHeight: "clamp(110px, calc(100dvh - 250px), 460px)" }}>
        <canvas ref={ref} className="block rounded-md" />
      </div>
    </div>
  );
}

function QuestLog() {
  const step = useGame((s) => s.objStep);
  const w = useGame((s) => s.world);
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2">
        {QUEST_STEPS.map((q, i) => {
          const done = i < step || (i === 4 && w.quest.chestOpen);
          const cur = i === step && !done;
          return (
            <li key={q.title} className={`flex gap-3 rounded-xl border px-3 py-2 ${cur ? "border-[#ffd77a]/70 bg-[#ffd77a]/10" : "border-white/10 bg-white/[0.03]"}`}>
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${done ? "bg-[#3ddc84] text-[#0f3a20]" : cur ? "bg-[#ffd77a] text-[#2a1a10]" : "bg-white/10 text-white/40"}`}>
                {done ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <div className={`text-sm font-extrabold ${done ? "text-white/45 line-through" : cur ? "text-[#fff3cf]" : "text-white/35"}`}>
                  {i > step ? "???" : q.title}
                </div>
                {cur && <div className="mt-0.5 text-xs leading-snug text-white/70">{q.hint}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Time", fmtTime(w.time)], ["Rupees", String(w.rupees)], ["Defeated", String(w.kills)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">{k}</div>
            <div className="text-lg font-black tabular-nums text-[#fff6dc]">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Slot({ name, desc, owned, badge, children }: { name: string; desc: string; owned: boolean; badge?: string; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-2.5 ${owned ? "border-[#ffd77a]/40 bg-[#ffd77a]/[0.07]" : "border-white/10 bg-white/[0.02]"}`}>
      <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 ${owned ? "border-[#c48a2c] bg-[#2a1d14]" : "border-white/10 bg-black/30"}`}>
        <div className={owned ? "" : "opacity-20 grayscale"}>{children}</div>
        {badge && <span className="absolute -bottom-1.5 -right-1.5 rounded-md bg-[#ffd77a] px-1 text-[9px] font-black text-[#2a1a10]">{badge}</span>}
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-extrabold ${owned ? "text-[#fff3cf]" : "text-white/35"}`}>{owned ? name : "???"}</div>
        <div className="text-xs leading-snug text-white/55">{owned ? desc : "Not yet found."}</div>
      </div>
    </div>
  );
}

function Items() {
  const q = useGame((s) => s.world.quest);
  const rupees = useGame((s) => s.rupees);
  const maxHp = useGame((s) => s.maxHp);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Slot name="Hero's Sword" desc="A little blade with a big swing. Cuts grass, smashes pots, bats back jelly." owned badge="A">
        <svg viewBox="0 0 24 24" className="h-8 w-8"><path d="M19.5 3.5 21 3l-.5 1.5L10 15l-1-1z" fill="#f4f7ff" stroke="#22303a" strokeWidth="1.2" /><path d="M6 12.5 11.5 18" stroke="#ffcc33" strokeWidth="2.2" strokeLinecap="round" /><path d="M5 18.5l2.5-2.5" stroke="#6b3a1c" strokeWidth="2.4" strokeLinecap="round" /></svg>
      </Slot>
      <Slot name="Heart Containers" desc={`${maxHp / 2} hearts of courage.`} owned badge={`×${maxHp / 2}`}>
        <svg viewBox="0 0 24 24" className="h-8 w-8"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.2 0 3.6 1.3 4.3 2.6h2c.7-1.3 2.1-2.6 4.3-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill="#ff4d6d" stroke="#1d1220" strokeWidth="1.4" /></svg>
      </Slot>
      <Slot name="Barrow Key" desc={q.gateOpen ? "Used: the iron gate stands open." : "Opens the iron gate deep in the barrow."} owned={q.keyTaken} badge={q.gateOpen ? "USED" : undefined}>
        <svg viewBox="0 0 24 24" className="h-8 w-8"><circle cx="7" cy="8" r="4.2" fill="none" stroke="#ffcc33" strokeWidth="2.6" /><path d="M10 10.5 19 19.5M15.5 16l2.6-2.6M17.8 18.3l2-2" stroke="#ffcc33" strokeWidth="2.6" strokeLinecap="round" /></svg>
      </Slot>
      <Slot name="Rupee Pouch" desc="Shiny gems from monsters, grass and pots." owned badge={String(rupees)}>
        <svg viewBox="0 0 16 24" className="h-8 w-6"><path d="M8 1 15 7v10l-7 6-7-6V7z" fill="#3ddc84" stroke="#0f4a2a" strokeWidth="1.3" /><path d="M8 4 12 8v8l-4 3.5L4 16V8z" fill="#7cf0b0" /></svg>
      </Slot>
      <Slot name="The Sunstone" desc="Glimmerdell's lost light." owned={q.chestOpen}>
        <div className="h-6 w-6 rotate-45 rounded-sm bg-gradient-to-br from-[#fff3a0] to-[#ff9a1f]" />
      </Slot>
    </div>
  );
}

export default function PauseMenu() {
  const paused = useGame((s) => s.paused);
  const phase = useGame((s) => s.phase);
  const tab = useGame((s) => s.menuTab);
  const muted = useGame((s) => s.muted);
  const area = useGame((s) => s.area);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [canFull, setCanFull] = useState(false);
  useEffect(() => { setCanFull(!!document.fullscreenEnabled); }, []);
  useEffect(() => { if (!paused) setConfirmQuit(false); }, [paused]);
  if (!paused || phase !== "playing") return null;

  const st = useGame.getState();
  const tabs: [MenuTab, string][] = [["map", "Map"], ["quest", "Quest"], ["items", "Items"]];
  const btn = "rounded-xl border-2 px-3 py-2 text-xs font-black uppercase tracking-[0.15em] transition active:translate-y-[1px]";

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-[#07050c]/70 p-3 backdrop-blur-[3px]"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <div className="animate-rise relative flex max-h-full w-[min(880px,100%)] flex-col overflow-hidden rounded-2xl border-[3px] border-[#c48a2c] bg-gradient-to-b from-[#241a33] to-[#150f1f] shadow-[0_0_0_3px_#2a1a10,0_20px_60px_rgba(0,0,0,0.6)]"
>
        {/* corner studs */}
        {["left-1.5 top-1.5", "right-1.5 top-1.5", "left-1.5 bottom-1.5", "right-1.5 bottom-1.5"].map((c) => (
          <i key={c} className={`absolute ${c} h-2 w-2 rotate-45 bg-[#ffd77a]`} />
        ))}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#c48a2c]/40 px-4 py-3">
          <div className="min-w-0">
            <div className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.3em] text-[#ffd77a]/80">Adventure Log</div>
            <div className="text-outline whitespace-nowrap text-lg font-black text-[#fff6dc]">{area}</div>
          </div>
          <div className="ml-auto flex gap-1 rounded-xl bg-black/30 p-1">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => st.setMenuTab(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-[0.15em] ${tab === k ? "bg-[#ffd77a] text-[#2a1a10] shadow" : "text-white/70"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "map" && <WorldMap />}
          {tab === "quest" && <QuestLog />}
          {tab === "items" && <Items />}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#c48a2c]/40 px-4 py-3">
          <button type="button" onClick={() => st.setPaused(false)} className={`${btn} border-[#2a1a10] bg-[#3ddc84] text-[#0f3a20]`}>▶ Resume</button>
          <button type="button" onClick={() => st.toggleMute()} className={`${btn} border-white/15 bg-white/5 text-white/85`}>{muted ? "🔇 Sound off" : "🔊 Sound on"}</button>
          {canFull && (
            <button type="button" className={`${btn} border-white/15 bg-white/5 text-white/85`}
              onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); }}>
              ⛶ Fullscreen
            </button>
          )}
          <button type="button" onClick={() => { if (confirmQuit) st.toTitle(); else setConfirmQuit(true); }}
            className={`${btn} ml-auto ${confirmQuit ? "border-[#ff4d6d] bg-[#ff4d6d] text-white" : "border-white/15 bg-white/5 text-white/70"}`}>
            {confirmQuit ? "Tap again to quit" : "Quit to title"}
          </button>
        </div>
      </div>
    </div>
  );
}
