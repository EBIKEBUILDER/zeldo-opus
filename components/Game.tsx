"use client";

import { useEffect, useRef } from "react";
import { audio } from "@/game/audio";
import { input } from "@/game/input";
import { startRunner } from "@/game/runner";
import { useGame } from "@/game/store";
import HUD from "./HUD";
import Screens from "./Screens";

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseAt = useRef(0);

  // Boot Babylon + the fixed-step loop once.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stop = startRunner(canvas);
    if (new URLSearchParams(window.location.search).has("debug")) {
      const debugApi = { store: useGame, input };
      const win = window as unknown as { __zeldo: unknown; __pip: unknown };
      win.__zeldo = debugApi;
      win.__pip = debugApi;
    }
    return () => {
      stop();
      audio.dispose();
    };
  }, []);

  // Track when the phase last changed so a stray key/click can't skip a screen.
  useEffect(() => useGame.subscribe((s, prev) => {
    if (s.phase !== prev.phase) {
      phaseAt.current = performance.now();
      input.clear();
    }
  }), []);

  // Keyboard & pointer
  useEffect(() => {
    const advance = () => {
      const s = useGame.getState();
      const settled = performance.now() - phaseAt.current > 700;
      if (s.phase === "title") s.start();
      else if (s.phase === "gameover" && settled) s.retry();
      else if (s.phase === "victory" && settled) s.toTitle();
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "KeyM") {
        if (!e.repeat) useGame.getState().toggleMute();
        return;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        audio.unlock();
        if (!e.repeat) advance();
        return;
      }
      if (input.isMoveKey(e.code)) e.preventDefault();
      if (useGame.getState().phase === "playing") input.keyDown(e.code, e.repeat);
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    audio.unlock();
    const s = useGame.getState();
    const settled = performance.now() - phaseAt.current > 700;
    if (s.phase === "playing") input.click();
    else if (s.phase === "title") s.start();
    else if (s.phase === "gameover" && settled) s.retry();
    else if (s.phase === "victory" && settled) s.toTitle();
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0a10]" onPointerDown={onPointerDown} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <HUD />
      <Screens />
    </div>
  );
}
