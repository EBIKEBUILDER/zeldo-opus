// Plain, serializable game-state shapes. Everything the simulation knows lives
// in these objects; the renderer only ever reads them.
import type { MapId } from "./maps";

export type Phase = "title" | "playing" | "gameover" | "victory";

export interface Player {
  map: MapId;
  x: number; y: number;
  /** Position at the start of the last fixed step (for render interpolation). */
  px: number; py: number;
  vx: number; vy: number;
  /** Facing angle in radians, snapped to 8 directions (0 = east, π/2 = south). */
  face: number;
  hp: number; maxHp: number;
  invuln: number;
  knockT: number;
  attackT: number;
  attackCd: number;
  /** Buffered attack press (seconds remaining). */
  attackBuf: number;
  swingId: number;
  moving: boolean;
  walkPhase: number;
  dead: boolean;
  deathT: number;
  /** Item being held aloft ("You got …!" pose). */
  holding: "key" | "sunstone" | null;
  /** > 0 while wading through the King's sticky royal jelly (slows you down). */
  goo: number;
}

export type EnemyKind = "gloob" | "king";
export type EnemyState =
  | "sleep" | "idle" | "chase" | "return" | "hurt"
  | "windup" | "lunge" | "recover" | "inflate" | "spit" | "dead";

export interface Enemy {
  id: number;
  kind: EnemyKind;
  map: MapId;
  x: number; y: number; px: number; py: number;
  vx: number; vy: number;
  hx: number; hy: number;
  r: number;
  hp: number; maxHp: number;
  state: EnemyState;
  stateT: number;
  tx: number; ty: number;
  face: number;
  contactCd: number;
  flash: number;
  lastSwing: number;
  respawnT: number;
  alive: boolean;
  /** Lunge direction for the boss. */
  ldx: number; ldy: number;
  enraged: boolean;
  /** Post-hit invulnerability (the King only). */
  iframes: number;
  /** Lunges left in the King's current combo. */
  lunges: number;
  /** Spawned mid-fight by the King; never respawns. */
  minion: boolean;

  // ── Navigation (see game/path.ts) ──
  /** Current route as flat [x0, y0, x1, y1, …] waypoints. */
  path: number[];
  /** Index (in points, not floats) of the waypoint being walked to. */
  pathI: number;
  /** Seconds until the route is recomputed. */
  repathT: number;
  /** Goal the current route was planned for. */
  pgx: number; pgy: number;
  /** False when the goal can't be reached; the route ends as close as possible. */
  pathOk: boolean;

  // ── Pursuit bookkeeping ──
  /** Seconds of chasing without making any headway. */
  stuckT: number;
  /** Progress anchor: where the enemy was at the last progress check. */
  ax: number; ay: number; anchorT: number;
  /** After giving up, a short spell where the enemy won't re-aggro by sight. */
  calmT: number;
  /** "!" pop when it spots you (render hint). */
  alertT: number;

  // ── King: ranged attack ──
  rangedCd: number;
  /** How long the hero has been somewhere the King can't walk to. */
  unreachT: number;
}

export interface Breakable {
  id: number;
  kind: "grass" | "pot";
  map: MapId;
  x: number; y: number;
  broken: boolean;
  /** Little wobble when brushed / struck (render hint). */
  wobble: number;
}

export type PickupKind = "rupee" | "rupee5" | "heart";

export interface Pickup {
  id: number;
  kind: PickupKind;
  map: MapId;
  x: number; y: number; px: number; py: number;
  z: number; vz: number;
  vx: number; vy: number;
  life: number;
  permanent: boolean;
  age: number;
}

export interface Quest {
  hasKey: boolean;
  keyTaken: boolean;
  gateOpen: boolean;
  bossShut: boolean;
  bossAwake: boolean;
  bossDead: boolean;
  chestOpen: boolean;
  enteredDungeon: boolean;
}

export type GameEvent =
  | { t: "sfx"; name: SfxName }
  | { t: "fx"; kind: FxKind; map: MapId; x: number; y: number; dx?: number; dy?: number; n?: number };

export type FxKind = "spark" | "grass" | "shards" | "poof" | "bigpoof" | "sparkle" | "dust" | "splash" | "splat";

export type SfxName =
  | "swing" | "hit" | "kill" | "rupee" | "hurt" | "key" | "gate" | "chest"
  | "cut" | "smash" | "heart" | "bossHit" | "bossDie" | "bossRoar" | "lunge"
  | "door" | "text" | "denied" | "die" | "seal" | "clink" | "split"
  | "alert" | "inflate" | "spit" | "splat" | "swat";

/**
 * A glob of royal jelly the King lobs over obstacles. It flies a ballistic arc
 * from (sx, sy) to (tx, ty); once swatted by the hero it flies flat and fast
 * back at the King instead.
 */
export interface Jelly {
  id: number;
  map: MapId;
  x: number; y: number; px: number; py: number;
  /** Height above the floor (and the previous step's height, for interpolation). */
  z: number; pz: number;
  sx: number; sy: number;
  tx: number; ty: number;
  /** Flight clock and total flight time. */
  t: number; dur: number;
  /** Apex height of the lob. */
  arc: number;
  /** Swatted back by the hero: now a straight shot at the King. */
  returned: boolean;
  vx: number; vy: number;
  dead: boolean;
}

/** Sticky jelly left where a glob lands. Slows the hero down while standing in it. */
export interface Puddle {
  id: number;
  map: MapId;
  x: number; y: number;
  r: number;
  life: number; max: number;
}

export interface Message {
  id: number;
  text: string;
  t: number;
  /** "big" messages are item fanfares, centered and bold. */
  big: boolean;
}

export interface Transition {
  t: number;
  dur: number;
  to: MapId;
  x: number; y: number;
  face: number;
  swapped: boolean;
}

export interface World {
  tick: number;
  time: number;
  rng: number;
  nextId: number;
  player: Player;
  enemies: Enemy[];
  breakables: Breakable[];
  pickups: Pickup[];
  jellies: Jelly[];
  puddles: Puddle[];
  /** The "dodge it… or swat it back!" hint has been shown. */
  jellyHint: boolean;
  quest: Quest;
  rupees: number;
  /** Screen shake amplitude, red damage flash, global hit-stop. */
  fx: { shake: number; hurt: number; hitstop: number; freeze: number };
  message: Message | null;
  transition: Transition | null;
  checkpoint: { map: MapId; x: number; y: number; face: number };
  victoryT: number;
  /** Set by the simulation; the store turns it into a phase change. */
  outcome: "victory" | "gameover" | null;
  /** Context action hint ("Read", "Open") shown by the HUD. */
  prompt: string | null;
  events: GameEvent[];
}

export interface InputFrame {
  mx: number;
  my: number;
  attack: boolean;
}
