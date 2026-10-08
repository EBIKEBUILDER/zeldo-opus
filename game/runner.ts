// The game loop: a fixed-timestep accumulator driving the pure simulation,
// draining its events into audio + particles, then letting the view draw an
// interpolated frame. This is the only place sim, store, audio and view meet.
import { audio } from "./audio";
import { autopilot } from "./autopilot";
import { input } from "./input";
import { DT, step } from "./sim";
import { useGame } from "./store";
import type { World } from "./types";
import { GameView } from "./render/view";

const MAX_STEPS = 6;

export interface Runner {
  stop(): void;
  /** Screen (CSS px, relative to the canvas) → tapped ground point + monster under the finger. */
  pick(px: number, py: number): { x: number; y: number; enemyId: number | null } | null;
  /** Live render stats (FPS, frame time, draw calls) for the on-screen counter. */
  stats(): GameView["stats"];
}

export function startRunner(canvas: HTMLCanvasElement): Runner {
  const view = new GameView(canvas);
  let lastHp = -1;
  let acc = 0;
  let last = performance.now();

  const drain = (w: World) => {
    if (w.events.length === 0) return;
    for (const e of w.events) {
      if (e.t === "sfx") audio.play(e.name);
      else view.handleEvent(e);
    }
    w.events.length = 0;
  };

  view.engine.runRenderLoop(() => {
    const now = performance.now();
    const frame = Math.min(0.1, (now - last) / 1000);
    last = now;

    const store = useGame.getState();
    const w = store.world;
    if (store.phase === "playing" && !store.paused) {
      acc += frame;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) {
        // Hand steering always wins over tap-to-move.
        let f = input.frame();
        if (input.steering()) autopilot.cancel();
        else if (autopilot.active) {
          const a = autopilot.frame(w, DT);
          if (a) f = { mx: a.mx, my: a.my, attack: a.attack || f.attack };
        }
        step(w, f);
        drain(w);
        acc -= DT;
        n++;
      }
      if (n === MAX_STEPS) acc = 0; // tab was asleep; don't spiral
    } else {
      acc = 0;
      drain(w);
      if (store.phase !== "playing") autopilot.cancel();
    }
    store.sync();

    // A little rumble when the hero gets hurt (phones that support it).
    const hp = w.player.hp;
    if (lastHp >= 0 && hp < lastHp && store.touch && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(hp <= 0 ? [60, 40, 90] : 45); } catch { /* not allowed */ }
    }
    lastHp = hp;

    // Music follows the mood.
    const s = useGame.getState();
    audio.setMuted(s.muted);
    let track: "none" | "over" | "dungeon" | "boss" = "none";
    if (s.phase === "playing" && s.world.victoryT <= 0 && !s.world.player.dead) {
      const q = s.world.quest;
      if (s.world.player.map === "over") track = "over";
      else track = q.bossAwake && !q.bossDead ? "boss" : "dungeon";
    } else if (s.phase === "title") track = "over";
    audio.setTrack(track);

    view.render(s.world, acc / DT, s.paused ? 0 : frame, s.phase, autopilot.marker(s.world));
  });

  const onResize = () => view.resize();
  window.addEventListener("resize", onResize);
  // Phones: switching apps or locking the screen pauses the adventure.
  const onVis = () => {
    if (document.hidden) { input.clear(); useGame.getState().setPaused(true); }
  };
  document.addEventListener("visibilitychange", onVis);

  return {
    stop() {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      view.engine.stopRenderLoop();
      view.dispose();
    },
    pick(px, py) {
      return view.pick(px, py, useGame.getState().world);
    },
    stats() {
      return view.stats;
    },
  };
}
