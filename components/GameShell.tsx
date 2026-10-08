"use client";

import dynamic from "next/dynamic";

// Babylon touches `window`/WebGL at import time, so the game is client-only.
const Game = dynamic(() => import("./Game"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0b0a10] text-white/70 tracking-[0.3em] text-sm">
      LOADING…
    </div>
  ),
});

export default function GameShell() {
  return <Game />;
}
