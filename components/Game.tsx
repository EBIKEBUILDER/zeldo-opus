"use client";

import { useEffect, useRef, useState } from "react";
import { audio } from "@/game/audio";
import { autopilot } from "@/game/autopilot";
import { input } from "@/game/input";
import { startRunner } from "@/game/runner";
import type { Runner } from "@/game/runner";
import { useGame } from "@/game/store";
import HUD from "./HUD";
import PauseMenu from "./PauseMenu";
import Screens from "./Screens";
import TouchControls from "./TouchControls";

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runner = useRef<Runner | null>(null);
  const phaseAt = useRef(0);
  const phase = useGame((s) => s.phase);
  const paused = useGame((s) => s.paused);
  const touch = useGame((s) => s.touch);
  const [ready, setReady] = useState(false);

  // Boot Babylon + the fixed-step loop once.
  useEffect(() => {
    const canvas = canvasRef.current!;
    runner.current = startRunner(canvas);
    setReady(true);
    if (window.matchMedia?.("(pointer: coarse)").matches) useGame.getState().setTouch(true);
    if (new URLSearchParams(window.location.search).has("debug")) {
      const debugApi = { store: useGame, input, runner: runner.current, autopilot };
      const win = window as unknown as { __zeldo: unknown; __pip: unknown };
      win.__zeldo = debugApi;
      win.__pip = debugApi;
    }
    return () => {
      runner.current?.stop();
      runner.current = null;
      audio.dispose();
    };
  }, []);

  // Track when the phase last changed so a stray key/tap can't skip a screen.
  useEffect(() => useGame.subscribe((s, prev) => {
    if (s.phase !== prev.phase || s.paused !== prev.paused) {
      if (s.phase !== prev.phase) phaseAt.current = performance.now();
      input.clear();
    }
  }), []);

  // Keyboard
  useEffect(() => {
    const advance = () => {
      const s = useGame.getState();
      const settled = performance.now() - phaseAt.current > 700;
      if (s.phase === "title") s.start();
      else if (s.phase === "playing" && s.paused) s.setPaused(false);
      else if (s.phase === "gameover" && settled) s.retry();
      else if (s.phase === "victory" && settled) s.toTitle();
    };
    const onDown = (e: KeyboardEvent) => {
      const s = useGame.getState();
      s.setTouch(false);
      if (e.code === "KeyM") {
        if (!e.repeat) s.toggleMute();
        return;
      }
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        if (!e.repeat && s.phase === "playing") s.setPaused(!s.paused);
        return;
      }
      if (e.code === "Tab") {
        e.preventDefault();
        if (!e.repeat && s.phase === "playing") {
          if (s.paused && s.menuTab === "map") s.setPaused(false);
          else s.setPaused(true, "map");
        }
        return;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        audio.unlock();
        if (!e.repeat) advance();
        return;
      }
      if (input.isMoveKey(e.code)) e.preventDefault();
      if (s.phase === "playing" && !s.paused) input.keyDown(e.code, e.repeat);
    };
    const onUp = (e: KeyboardEvent) => input.keyUp(e.code);
    const onBlur = () => input.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Mouse clicks swing the sword; any tap advances the title / game-over / victory screens.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    audio.unlock();
    const s = useGame.getState();
    s.setTouch(e.pointerType !== "mouse");
    const settled = performance.now() - phaseAt.current > 700;
    if (s.phase === "playing") { if (e.pointerType === "mouse" && !s.paused) input.click(); }
    else if (s.phase === "title") s.start();
    else if (s.phase === "gameover" && settled) s.retry();
    else if (s.phase === "victory" && settled) s.toTitle();
  };

  const showTouch = ready && touch && phase === "playing" && !paused;

  return (
    <div className="fixed inset-0 touch-none overflow-hidden bg-[#0b0a10]" onPointerDown={onPointerDown} onPointerUp={() => audio.unlock()} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {showTouch && <TouchControls pick={(x, y) => runner.current?.pick(x, y) ?? null} />}
      <HUD />
      <Screens />
      <PauseMenu />
    </div>
  );
}
