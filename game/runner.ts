// The game loop: a fixed-timestep accumulator driving the pure simulation,
// draining its events into audio + particles, then letting the view draw an
// interpolated frame. This is the only place sim, store, audio and view meet.
import { audio } from "./audio";
import { input } from "./input";
import { DT, step } from "./sim";
import { useGame } from "./store";
import type { World } from "./types";
import { GameView } from "./render/view";

const MAX_STEPS = 6;

export function startRunner(canvas: HTMLCanvasElement): () => void {
  const view = new GameView(canvas);
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
    if (store.phase === "playing") {
      acc += frame;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) {
        step(w, input.frame());
        drain(w);
        acc -= DT;
        n++;
      }
      if (n === MAX_STEPS) acc = 0; // tab was asleep; don't spiral
    } else {
      acc = 0;
      drain(w);
    }
    store.sync();

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

    view.render(s.world, acc / DT, frame, s.phase);
  });

  const onResize = () => view.resize();
  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    view.engine.stopRenderLoop();
    view.dispose();
  };
}
