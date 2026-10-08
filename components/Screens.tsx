"use client";

import { useGame } from "@/game/store";

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block min-w-7 rounded-md border-b-4 border-[#c9b98f] bg-[#fff6dc] px-2 py-0.5 text-center text-xs font-black text-[#2a1f33]">
      {children}
    </kbd>
  );
}

function Title() {
  const touch = useGame((s) => s.touch);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ background: "radial-gradient(ellipse at center, rgba(15,10,25,0.05) 0%, rgba(15,10,25,0.55) 75%, rgba(15,10,25,0.8) 100%)" }}>
      <div className="animate-floaty text-center">
        <div className="text-outline text-xs font-bold uppercase tracking-[0.35em] text-[#ffe9a8] sm:text-sm sm:tracking-[0.6em]">A tiny tale of Glimmerdell</div>
        <h1 className="mt-3 text-[clamp(56px,11vw,128px)] font-black leading-none tracking-tight text-[#fff6dc]"
          style={{ textShadow: "0 6px 0 #2f9e5a, 0 12px 0 #1b4a30, 0 18px 30px rgba(0,0,0,0.5)" }}>
          ZELDO
        </h1>
        <div className="text-outline -mt-1 text-[clamp(22px,3.6vw,40px)] font-extrabold italic tracking-wide text-[#ffcc33]">
          &amp; the Sunstone
        </div>
      </div>
      <p className="text-outline mt-6 max-w-md px-6 text-center text-sm leading-relaxed text-white/85 sm:mt-8 sm:text-base">
        The Sunstone was swallowed by <span className="font-bold text-[#ff9bd2]">King Gloob</span>, who naps in the barrow under
        Cragmaw Rocks. Grab your little sword and fetch it home.
      </p>
      <div className="animate-blink text-outline mt-8 text-xl font-black uppercase tracking-[0.3em] text-white sm:mt-10">
        {touch ? "Tap to start" : "Press Enter or Click"}
      </div>
      {touch ? (
        <div className="mt-6 grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-2 rounded-2xl bg-[#1b1426]/60 px-5 py-3 text-[13px] text-white/85 sm:mt-10">
          <div className="flex gap-1"><Key>Drag</Key></div><div>Walk (stick appears under your thumb)</div>
          <div className="flex gap-1"><Key>Tap</Key></div><div>Go there · tap a monster to attack it</div>
          <div className="flex gap-1"><Key>⚔</Key></div><div>Swing sword · read · open</div>
          <div className="flex gap-1"><Key>Map</Key></div><div>Tap the minimap for the world map</div>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-2 rounded-2xl bg-[#1b1426]/60 px-6 py-4 text-sm text-white/85">
          <div className="flex gap-1"><Key>W</Key><Key>A</Key><Key>S</Key><Key>D</Key></div><div>Move (or arrow keys)</div>
          <div className="flex gap-1"><Key>Space</Key><Key>Click</Key></div><div>Swing sword · read signs · open chests</div>
          <div className="flex gap-1"><Key>Esc</Key><Key>Tab</Key></div><div>Adventure log · world map</div>
          <div className="flex gap-1"><Key>M</Key></div><div>Toggle sound</div>
        </div>
      )}
    </div>
  );
}

function GameOver() {
  const entered = useGame((s) => s.world.quest.enteredDungeon);
  const touch = useGame((s) => s.touch);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(60,0,20,0.45),rgba(10,0,8,0.88))]">
      <div className="animate-rise text-center">
        <div className="text-outline text-sm font-bold uppercase tracking-[0.5em] text-[#ff9bb0]">Oh no</div>
        <h2 className="text-outline mt-2 text-5xl font-black text-[#fff0f2] sm:text-6xl">Zeldo fainted…</h2>
        <p className="text-outline mt-4 px-6 text-white/75">
          You&apos;ll wake up at {entered ? "the barrow entrance" : "Hearthside"} with your treasures intact.
        </p>
        <div className="animate-blink text-outline mt-10 text-xl font-black uppercase tracking-[0.3em]">
          {touch ? "Tap to try again" : "Press Enter to try again"}
        </div>
      </div>
    </div>
  );
}

function Victory() {
  const touch = useGame((s) => s.touch);
  const time = useGame((s) => s.finalTime);
  const rupees = useGame((s) => s.finalRupees);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(255,190,60,0.35),rgba(30,15,5,0.9))]">
      <div className="animate-rise text-center">
        <div className="mx-auto mb-4 h-16 w-16 rotate-45 rounded-md bg-gradient-to-br from-[#fff3a0] to-[#ff9a1f] shadow-[0_0_60px_rgba(255,190,60,0.9)]" />
        <div className="text-outline text-sm font-bold uppercase tracking-[0.5em] text-[#ffe9a8]">Quest complete</div>
        <h2 className="mt-2 text-[clamp(40px,7vw,72px)] font-black leading-tight text-[#fff6dc]"
          style={{ textShadow: "0 5px 0 #b8741a, 0 10px 24px rgba(0,0,0,0.5)" }}>
          The Sunstone shines again!
        </h2>
        <p className="text-outline mt-3 px-6 text-white/80">Glimmerdell is warm and golden. Grandma is making pie.</p>
        <div className="mt-8 flex justify-center gap-6">
          <div className="rounded-2xl bg-[#1b1426]/70 px-6 py-4">
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-white/60">Time</div>
            <div className="text-outline text-3xl font-black tabular-nums text-[#fff6dc]">{fmtTime(time)}</div>
          </div>
          <div className="rounded-2xl bg-[#1b1426]/70 px-6 py-4">
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-white/60">Rupees</div>
            <div className="text-outline text-3xl font-black tabular-nums text-[#3ddc84]">{rupees}</div>
          </div>
        </div>
        <div className="animate-blink text-outline mt-10 text-lg font-black uppercase tracking-[0.3em]">
          {touch ? "Tap for the title screen" : "Press Enter for the title screen"}
        </div>
      </div>
    </div>
  );
}

export default function Screens() {
  const phase = useGame((s) => s.phase);
  return (
    <div className="pointer-events-none absolute inset-0">
      {phase === "title" && <Title />}
      {phase === "gameover" && <GameOver />}
      {phase === "victory" && <Victory />}
    </div>
  );
}
