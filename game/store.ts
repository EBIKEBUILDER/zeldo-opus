// Zustand store: owns the World (plain data) plus the derived HUD snapshot.
import { create } from "zustand";
import { createWorld, retryWorld, transitionFade } from "./sim";
import { areaName } from "./maps";
import type { Phase, World } from "./types";

export interface GameStore {
  phase: Phase;
  world: World;
  muted: boolean;
  runId: number;

  // Derived HUD snapshot (primitives so selectors stay cheap).
  hp: number;
  maxHp: number;
  rupees: number;
  area: string;
  hasKey: boolean;
  bossVisible: boolean;
  bossHp: number;
  bossMax: number;
  bossEnraged: boolean;
  msgId: number;
  msgText: string;
  msgBig: boolean;
  prompt: string | null;
  /** Per-frame values (read via subscribe for direct DOM updates). */
  hurt: number;
  fade: number;
  lowHp: boolean;
  finalTime: number;
  finalRupees: number;

  start(): void;
  retry(): void;
  toTitle(): void;
  toggleMute(): void;
  sync(): void;
}

function derive(w: World, phase: Phase) {
  const p = w.player;
  const king = w.enemies.find((e) => e.kind === "king")!;
  const m = w.message;
  return {
    hp: p.hp,
    maxHp: p.maxHp,
    rupees: w.rupees,
    area: areaName(p.map, p.x, p.y),
    hasKey: w.quest.hasKey,
    bossVisible: phase === "playing" && w.quest.bossAwake && !w.quest.bossDead && p.map === "dungeon",
    bossHp: Math.max(0, king.hp),
    bossMax: king.maxHp,
    bossEnraged: king.enraged,
    msgId: m ? m.id : 0,
    msgText: m ? m.text : "",
    msgBig: m ? m.big : false,
    prompt: w.prompt,
    hurt: w.fx.hurt,
    fade: transitionFade(w),
    lowHp: p.hp > 0 && p.hp <= 2,
  };
}

export const useGame = create<GameStore>((set, get) => {
  const world = createWorld();
  return {
    phase: "title",
    world,
    muted: false,
    runId: 0,
    ...derive(world, "title"),
    finalTime: 0,
    finalRupees: 0,

    start() {
      const w = createWorld();
      set({ world: w, phase: "playing", runId: get().runId + 1, ...derive(w, "playing") });
    },
    retry() {
      const w = get().world;
      retryWorld(w);
      set({ phase: "playing", ...derive(w, "playing") });
    },
    toTitle() {
      const w = createWorld();
      set({ world: w, phase: "title", runId: get().runId + 1, ...derive(w, "title") });
    },
    toggleMute() {
      set({ muted: !get().muted });
    },
    sync() {
      const s = get();
      const w = s.world;
      if (s.phase === "playing" && w.outcome) {
        if (w.outcome === "victory") {
          set({ phase: "victory", finalTime: w.time, finalRupees: w.rupees });
        } else {
          set({ phase: "gameover" });
        }
      }
      const d = derive(w, get().phase);
      // Only push keys that actually changed — keeps React re-renders minimal.
      const patch: Partial<GameStore> = {};
      let dirty = false;
      for (const k in d) {
        const key = k as keyof typeof d;
        if (s[key] !== d[key]) {
          (patch as Record<string, unknown>)[key] = d[key];
          dirty = true;
        }
      }
      if (dirty) set(patch);
    },
  };
});
