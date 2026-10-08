// ─────────────────────────────────────────────────────────────────────────────
//  Quest log: turns the plain quest flags into RPG-style objectives (with a
//  waypoint for the minimap). Pure functions over World: no React, no Babylon.
// ─────────────────────────────────────────────────────────────────────────────
import { CHEST_POS, GATE_ROW, KEY_PEDESTAL } from "./maps";
import type { MapId } from "./maps";
import type { World } from "./types";

export interface Waypoint { map: MapId; x: number; y: number }

export interface Objective {
  /** Index into QUEST_STEPS. */
  step: number;
  title: string;
  hint: string;
  /** Where to head next *from the hero's current map* (null once the quest is done). */
  waypoint: Waypoint | null;
}

/** The barrow door in the Cragmaw cliffs, and the stairs back up. */
export const BARROW_DOOR: Waypoint = { map: "over", x: 40.5, y: 0.7 };
export const BARROW_STAIRS: Waypoint = { map: "dungeon", x: 8, y: 22 };

export const QUEST_STEPS = [
  { title: "Find the hidden barrow", hint: "Cross Brambleford bridge and search the Cragmaw cliffs to the north-east." },
  { title: "Take the Barrow Key", hint: "It rests on a pedestal in the entry hall." },
  { title: "Unlock the iron gate", hint: "Walk into the gate with the key in hand." },
  { title: "Defeat King Gloob", hint: "Wait for his lunge, then strike while he's dazed." },
  { title: "Claim the Sunstone", hint: "The royal chest is unsealed. Open it!" },
] as const;

function stepOf(w: World): number {
  const q = w.quest;
  if (!q.enteredDungeon) return 0;
  if (!q.keyTaken) return 1;
  if (!q.gateOpen) return 2;
  if (!q.bossDead) return 3;
  return 4;
}

export function objective(w: World): Objective {
  const step = stepOf(w);
  const here = w.player.map;
  let goal: Waypoint | null;
  switch (step) {
    case 0: goal = BARROW_DOOR; break;
    case 1: goal = { map: "dungeon", x: KEY_PEDESTAL.x, y: KEY_PEDESTAL.y }; break;
    case 2: goal = { map: "dungeon", x: 8, y: GATE_ROW + 0.5 }; break;
    case 3: {
      const king = w.enemies.find((e) => e.kind === "king");
      goal = { map: "dungeon", x: king?.x ?? 8, y: king?.y ?? 5.6 };
      break;
    }
    default: goal = w.quest.chestOpen ? null : { map: "dungeon", x: CHEST_POS.x, y: CHEST_POS.y };
  }
  // Goal on the other map → point at the way there instead.
  if (goal && goal.map !== here) goal = here === "over" ? BARROW_DOOR : BARROW_STAIRS;
  return { step, title: QUEST_STEPS[step].title, hint: QUEST_STEPS[step].hint, waypoint: goal };
}

/** Overworld screen (or dungeon room) key, for fog-of-war bookkeeping. */
export function regionKey(map: MapId, x: number, y: number): string {
  if (map === "dungeon") return y < GATE_ROW ? "dungeon:boss" : "dungeon:hall";
  return `over:${Math.floor(x / 16)},${Math.floor(y / 12)}`;
}
