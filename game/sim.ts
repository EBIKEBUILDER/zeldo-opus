// ─────────────────────────────────────────────────────────────────────────────
//  The simulation. Deterministic, fixed-timestep, framework-free: it advances a
//  plain `World` object by exactly DT seconds per call. No Babylon, no React.
// ─────────────────────────────────────────────────────────────────────────────
import {
  MAPS, MapId, HERO_SPAWN, SAFE_ZONE, DUNGEON_ENTRY, OVERWORLD_RETURN, KEY_PEDESTAL,
  CHEST_POS, BOSS_SPAWN, BOSS_ROOM_MAX_Y, GATE_ROW, SIGN_TEXT, signKey, tileAt, isStaticSolid,
} from "./maps";
import type {
  World, Player, Enemy, Breakable, Pickup, PickupKind, InputFrame, SfxName, FxKind, Jelly,
} from "./types";
import {
  type Nav, type NavSize, findPath, lineClear, pathScheduler,
  wallSlideVector, getStandoffPoint, getPortals, chunkToUnified,
} from "./path";

export const DT = 1 / 60;

// ── Tuning ──────────────────────────────────────────────────────────────────
export const PLAYER_R = 0.3;
const MAX_HP = 6; // half-hearts → 3 hearts
const RUN_SPEED = 5.0;
const ACCEL = 40;
const FRICTION = 32;
const SWING_MOVE_MUL = 0.35;
export const SWING_DUR = 0.22;
const SWING_CD = 0.34;
export const SWING_HALF_ARC = 1.25;
const SWORD_REACH = 1.38;
const INVULN = 1.1;

const GLOOB = {
  r: 0.36, hp: 2, wander: 1.1, chase: 2.85, dmg: 1, respawn: 20,
  /** Spots the hero within this range… */
  aggro: 5.5,
  /** …and calls over idle friends this close by. */
  rally: 4.0,
  /** Keeps hunting while the hero is inside its territory (around home)… */
  territory: 13,
  /** …or (outside it) while the hero is still this close. */
  forget: 4,
  /** Seconds of zero headway before it sulks off home. */
  giveUp: 4.5,
  /** After giving up, it ignores the hero (unless struck) for this long. */
  calm: 3.0,
};
const KING = {
  r: 0.85, hp: 8, chase: 3.1, chaseRage: 3.8, lunge: 9.5, lungeRage: 11.5, dmg: 2,
  /** Hero out of reach for this long → royal jelly. */
  unreach: 0.7,
  /** Telegraph (puff up) before spitting, normal / enraged. */
  inflate: 0.9, inflateRage: 0.75,
  /** Cooldown between volleys, normal / enraged. */
  rangedCd: 2.8, rangedCdRage: 2.1,
};
/** Royal-jelly splash radius (the renderer draws its target circle at exactly this size). */
export const JELLY_SPLASH = 1.0;
const JELLY = {
  /** Splash radius on landing, and its damage. */
  splash: JELLY_SPLASH, dmg: 2,
  /** Sticky puddle size and lifetime. */
  puddleR: 1.05, puddleLife: 4.5,
  /** Speed multiplier while wading in jelly. */
  slow: 0.5,
  /** Swatted-back shot speed. */
  returnSpeed: 12,
};

const DUNGEON_GATE = { x0: 7, x1: 9, y0: GATE_ROW, y1: GATE_ROW + 1 };

// ── Small helpers ───────────────────────────────────────────────────────────
function rand(w: World): number {
  w.rng = (w.rng + 0x6d2b79f5) | 0;
  let t = w.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
function angDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function approach(vx: number, vy: number, tx: number, ty: number, step: number): [number, number] {
  const dx = tx - vx, dy = ty - vy;
  const len = Math.hypot(dx, dy);
  if (len <= step || len === 0) return [tx, ty];
  return [vx + (dx / len) * step, vy + (dy / len) * step];
}
function sfx(w: World, name: SfxName) {
  w.events.push({ t: "sfx", name });
}
function fx(w: World, kind: FxKind, map: MapId, x: number, y: number, dx = 0, dy = 0, n?: number) {
  w.events.push({ t: "fx", kind, map, x, y, dx, dy, n });
}
function say(w: World, text: string, t = 3.2, big = false) {
  w.message = { id: (w.message?.id ?? 0) + 1, text, t, big };
}

// ── World construction ──────────────────────────────────────────────────────
function makeEnemy(w: World, kind: "gloob" | "king", map: MapId, x: number, y: number): Enemy {
  const k = kind === "king";
  const e: Enemy = {
    id: w.nextId++, kind, map, x, y, px: x, py: y, vx: 0, vy: 0, hx: x, hy: y,
    r: k ? KING.r : GLOOB.r, hp: k ? KING.hp : GLOOB.hp, maxHp: k ? KING.hp : GLOOB.hp,
    state: k ? "sleep" : "idle", stateT: rand(w) * 2, tx: x, ty: y, face: Math.PI / 2,
    contactCd: 0, flash: 0, lastSwing: -1, respawnT: 0, alive: true, ldx: 0, ldy: 1, enraged: false,
    iframes: 0, lunges: 0, minion: false,
    path: [], pathI: 0, repathT: 0, pgx: x, pgy: y, pathOk: true,
    pathPending: false, wallStuckT: 0,
    stuckT: 0, ax: x, ay: y, anchorT: 0, calmT: 0, alertT: 0,
    rangedCd: 0, unreachT: 0,
  };
  return e;
}

/** Forget any route / pursuit state (used on respawn and retry). */
function resetAi(e: Enemy) {
  e.path = []; e.pathI = 0; e.repathT = 0; e.pathOk = true;
  e.pathPending = false; e.wallStuckT = 0;
  e.stuckT = 0; e.ax = e.x; e.ay = e.y; e.anchorT = 0; e.calmT = 0; e.alertT = 0;
  e.rangedCd = 0; e.unreachT = 0;
  pathScheduler.cancel(e.id);
}

function makePlayer(): Player {
  return {
    map: "over", x: HERO_SPAWN.x, y: HERO_SPAWN.y, px: HERO_SPAWN.x, py: HERO_SPAWN.y,
    vx: 0, vy: 0, face: Math.PI / 2, hp: MAX_HP, maxHp: MAX_HP, invuln: 0, knockT: 0,
    attackT: 0, attackCd: 0, attackBuf: 0, swingId: 0, moving: false, walkPhase: 0, dead: false, deathT: 0,
    holding: null, goo: 0,
  };
}

export function createWorld(seed = 0x5eed): World {
  const w: World = {
    tick: 0, time: 0, rng: seed, nextId: 1, player: makePlayer(), enemies: [], breakables: [],
    pickups: [], jellies: [], puddles: [], jellyHint: false, rupees: 0, kills: 0,
    quest: {
      hasKey: false, keyTaken: false, gateOpen: false, bossShut: false, bossAwake: false,
      bossDead: false, chestOpen: false, enteredDungeon: false,
    },
    fx: { shake: 0, hurt: 0, hitstop: 0, freeze: 0 },
    message: null, transition: null,
    checkpoint: { map: "over", x: HERO_SPAWN.x, y: HERO_SPAWN.y, face: Math.PI / 2 },
    victoryT: 0, outcome: null, prompt: null, navRevision: 1, events: [],
  };
  for (const id of ["over", "dungeon"] as MapId[]) {
    const m = MAPS[id];
    for (const p of m.enemies) w.enemies.push(makeEnemy(w, "gloob", id, p.x, p.y));
    for (const p of m.grass) w.breakables.push({ id: w.nextId++, kind: "grass", map: id, x: p.x, y: p.y, broken: false, wobble: 0 });
    for (const p of m.pots) w.breakables.push({ id: w.nextId++, kind: "pot", map: id, x: p.x, y: p.y, broken: false, wobble: 0 });
    for (const p of m.rupees) spawnPickup(w, "rupee", id, p.x, p.y, true, false);
    for (const p of m.hearts) spawnPickup(w, "heart", id, p.x, p.y, true, false);
  }
  w.enemies.push(makeEnemy(w, "king", "dungeon", BOSS_SPAWN.x, BOSS_SPAWN.y));
  return w;
}

/** Retry after a game over: back to the last checkpoint, quest progress kept. */
export function retryWorld(w: World) {
  const cp = w.checkpoint;
  const p = makePlayer();
  p.map = cp.map; p.x = p.px = cp.x; p.y = p.py = cp.y; p.face = cp.face;
  w.player = p;
  w.enemies = w.enemies.filter((e) => !e.minion);
  for (const e of w.enemies) {
    if (e.kind === "king" && w.quest.bossDead) continue;
    Object.assign(e, {
      x: e.hx, y: e.hy, px: e.hx, py: e.hy, vx: 0, vy: 0, hp: e.maxHp, alive: true,
      state: e.kind === "king" ? "sleep" : "idle", stateT: 1, flash: 0, contactCd: 0.5, enraged: false, iframes: 0, lunges: 0,
    });
    resetAi(e);
  }
  w.pickups = w.pickups.filter((k) => k.permanent);
  w.jellies = [];
  w.puddles = [];
  w.quest.bossShut = false;
  w.quest.bossAwake = false;
  w.fx = { shake: 0, hurt: 0, hitstop: 0, freeze: 0 };
  w.message = null; w.transition = null; w.outcome = null; w.victoryT = 0; w.events = [];
  invalidateNav(w);
}

function spawnPickup(w: World, kind: PickupKind, map: MapId, x: number, y: number, permanent: boolean, pop = true) {
  const a = rand(w) * Math.PI * 2;
  const s = pop ? 1 + rand(w) * 1.6 : 0;
  const k: Pickup = {
    id: w.nextId++, kind, map, x, y, px: x, py: y, z: pop ? 0.1 : 0, vz: pop ? 6 + rand(w) * 2 : 0,
    vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 14, permanent, age: pop ? 0 : 1,
  };
  w.pickups.push(k);
}

function rollDrop(w: World, map: MapId, x: number, y: number, rupee: number, blue: number, heart: number) {
  const p = w.player;
  const r = rand(w);
  if (p.hp < p.maxHp && r < heart) spawnPickup(w, "heart", map, x, y, false);
  else if (r < heart + blue) spawnPickup(w, "rupee5", map, x, y, false);
  else if (r < heart + blue + rupee) spawnPickup(w, "rupee", map, x, y, false);
}

// ── Collision ───────────────────────────────────────────────────────────────
function gateClosed(w: World) {
  return !w.quest.gateOpen || w.quest.bossShut;
}

function solidFor(w: World, map: MapId, tx: number, ty: number, enemy: boolean): boolean {
  const ch = tileAt(map, tx, ty);
  if (isStaticSolid(ch)) return true;
  if (ch === "G") return gateClosed(w);
  if (ch === "D" || ch === "X") {
    if (!enemy) return false;
    // For enemy: check if portal at this tile is traversable by AI
    const portals = getPortals();
    return !portals.some((p) => {
      const from = chunkToUnified(p.fromChunk, p.fromTile.x, p.fromTile.y);
      return from.map === map && from.x === tx && from.y === ty && p.traversableByAI;
    });
  }
  return false;
}

function resolveTiles(w: World, e: { x: number; y: number }, r: number, map: MapId, enemy: boolean): boolean {
  let hit = false;
  for (let iter = 0; iter < 2; iter++) {
    const x0 = Math.floor(e.x - r), x1 = Math.floor(e.x + r);
    const y0 = Math.floor(e.y - r), y1 = Math.floor(e.y + r);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!solidFor(w, map, tx, ty, enemy)) continue;
        const cx = clamp(e.x, tx, tx + 1), cy = clamp(e.y, ty, ty + 1);
        const dx = e.x - cx, dy = e.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = (r - d) / d;
          e.x += dx * push;
          e.y += dy * push;
        } else {
          const l = e.x - tx, rr = tx + 1 - e.x, t = e.y - ty, b = ty + 1 - e.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) e.x = tx - r; else if (m === rr) e.x = tx + 1 + r;
          else if (m === t) e.y = ty - r; else e.y = ty + 1 + r;
        }
      }
    }
  }
  return hit;
}

/** Round static props: pots, the key pedestal, the chest. */
function propCircles(w: World, map: MapId): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  for (const b of w.breakables) if (b.map === map && b.kind === "pot" && !b.broken) out.push({ x: b.x, y: b.y, r: 0.32 });
  if (map === "dungeon") {
    out.push({ x: KEY_PEDESTAL.x, y: KEY_PEDESTAL.y, r: 0.4 });
    out.push({ x: CHEST_POS.x - 0.25, y: CHEST_POS.y, r: 0.42 });
    out.push({ x: CHEST_POS.x + 0.25, y: CHEST_POS.y, r: 0.42 });
  }
  return out;
}

function resolveProps(e: { x: number; y: number }, r: number, props: { x: number; y: number; r: number }[]) {
  for (const c of props) {
    const dx = e.x - c.x, dy = e.y - c.y;
    const d = Math.hypot(dx, dy);
    const min = r + c.r;
    if (d < min) {
      if (d < 1e-6) { e.y += min; continue; }
      e.x += (dx / d) * (min - d);
      e.y += (dy / d) * (min - d);
    }
  }
}

function moveBody(
  w: World, e: { x: number; y: number }, vx: number, vy: number, r: number, map: MapId,
  enemy: boolean, props: { x: number; y: number; r: number }[],
): boolean {
  // Axis-separated moves + circle-vs-box push-out gives clean wall sliding.
  e.x += vx * DT;
  const hitX = resolveTiles(w, e, r, map, enemy);
  if (hitX && enemy && "vx" in e) (e as { vx: number }).vx = 0; // stop pushing into wall
  e.y += vy * DT;
  const hitY = resolveTiles(w, e, r, map, enemy);
  if (hitY && enemy && "vy" in e) (e as { vy: number }).vy = 0; // stop pushing into wall
  resolveProps(e, r, props);
  resolveTiles(w, e, r, map, enemy);
  return hitX || hitY;
}

function keepOutOfSafeZone(e: Enemy) {
  if (e.map !== "over") return;
  const dx = e.x - SAFE_ZONE.x, dy = e.y - SAFE_ZONE.y;
  const d = Math.hypot(dx, dy) || 1;
  const min = SAFE_ZONE.r + e.r;
  if (d < min) {
    e.x = SAFE_ZONE.x + (dx / d) * min;
    e.y = SAFE_ZONE.y + (dy / d) * min;
  }
}

export function inSafeZone(p: { map: MapId; x: number; y: number }) {
  return p.map === "over" && dist(p.x, p.y, SAFE_ZONE.x, SAFE_ZONE.y) < SAFE_ZONE.r;
}

// ── Damage ──────────────────────────────────────────────────────────────────
function hurtPlayer(w: World, dmg: number, fromX: number, fromY: number) {
  const p = w.player;
  if (p.invuln > 0 || p.dead || w.transition) return;
  p.hp = Math.max(0, p.hp - dmg);
  p.invuln = INVULN;
  p.knockT = 0.17;
  let dx = p.x - fromX, dy = p.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  p.vx = dx * 9.5; p.vy = dy * 9.5;
  p.attackT = 0;
  w.fx.shake = Math.max(w.fx.shake, 0.55);
  w.fx.hurt = 1;
  w.fx.hitstop = Math.max(w.fx.hitstop, 0.06);
  fx(w, "spark", p.map, p.x - dx * 0.3, p.y - dy * 0.3, dx, dy, 6);
  if (p.hp <= 0) {
    p.dead = true;
    p.deathT = 0;
    p.vx = p.vy = 0;
    sfx(w, "die");
    w.fx.shake = 0.8;
  } else sfx(w, "hurt");
}

function hitEnemy(w: World, e: Enemy) {
  const p = w.player;
  const king = e.kind === "king";
  e.lastSwing = p.swingId;
  let dx = e.x - p.x, dy = e.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  if (king && e.iframes > 0) {
    // Still wobbling from the last blow: the blade glances off the jelly.
    fx(w, "spark", e.map, e.x - dx * e.r, e.y - dy * e.r, dx, dy, 3);
    sfx(w, "clink");
    p.vx -= dx * 3.5; p.vy -= dy * 3.5;
    return;
  }
  e.hp -= 1;
  e.flash = 0.14;
  const dazed = king && e.state === "recover";
  if (dazed) {
    // Punish window: a dazed King barely budges and can be comboed.
    e.iframes = 0.22;
    e.vx = dx * 1.2; e.vy = dy * 1.2;
  } else {
    if (king) e.iframes = 0.95;
    const kb = king ? (e.state === "lunge" ? 2.5 : 4.6) : 8.5;
    e.vx = dx * kb; e.vy = dy * kb;
    e.state = "hurt";
    e.stateT = king ? 0.16 : 0.3;
  }
  e.contactCd = Math.max(e.contactCd, king ? 0.2 : 0.35);
  e.calmT = 0;
  fx(w, "spark", e.map, e.x - dx * e.r, e.y - dy * e.r, dx, dy, king ? 10 : 7);
  // A little recoil for the hero so hits feel solid.
  p.vx -= dx * (king ? 4 : 1.6); p.vy -= dy * (king ? 4 : 1.6);
  if (e.hp <= 0) {
    killEnemy(w, e);
  } else {
    sfx(w, king ? "bossHit" : "hit");
    w.fx.hitstop = Math.max(w.fx.hitstop, king ? 0.09 : 0.055);
    w.fx.shake = Math.max(w.fx.shake, king ? 0.35 : 0.18);
    if (king) maybeEnrage(w, e);
  }
}

function killEnemy(w: World, e: Enemy) {
  e.alive = false;
  e.state = "dead";
  e.vx = e.vy = 0;
  e.path = [];
  e.pathI = 0;
  e.pathPending = false;
  pathScheduler.cancel(e.id);
  w.kills++;
  if (e.kind === "king") {
    w.quest.bossDead = true;
    w.quest.bossShut = false;
    invalidateNav(w);
    w.fx.hitstop = 0.25;
    w.fx.shake = 1;
    fx(w, "bigpoof", e.map, e.x, e.y, 0, 0, 40);
    fx(w, "sparkle", e.map, CHEST_POS.x, CHEST_POS.y, 0, 0, 24);
    sfx(w, "bossDie");
    for (const m of w.enemies) {
      if (m.minion && m.alive) { m.alive = false; m.state = "dead"; fx(w, "poof", m.map, m.x, m.y, 0, 0, 8); }
    }
    for (const j of w.jellies) fx(w, "splat", j.map, j.x, j.y, 0, 0, 6);
    w.jellies = [];
    for (const pd of w.puddles) pd.life = Math.min(pd.life, 0.8);
    for (let i = 0; i < 3; i++) spawnPickup(w, "rupee5", e.map, e.x, e.y, false);
    spawnPickup(w, "heart", e.map, e.x, e.y, false);
    say(w, "King Gloob bursts into jelly! The chest's seal fades…", 4);
  } else {
    e.respawnT = e.minion ? Infinity : GLOOB.respawn;
    w.fx.hitstop = Math.max(w.fx.hitstop, 0.08);
    w.fx.shake = Math.max(w.fx.shake, 0.25);
    fx(w, "poof", e.map, e.x, e.y, 0, 0, 14);
    sfx(w, "kill");
    spawnPickup(w, "rupee", e.map, e.x, e.y, false);
    if (rand(w) < 0.3) rollDrop(w, e.map, e.x, e.y, 0, 0.4, 0.6);
  }
}

function breakProp(w: World, b: Breakable) {
  b.broken = true;
  if (b.kind === "grass") {
    fx(w, "grass", b.map, b.x, b.y, 0, 0, 12);
    sfx(w, "cut");
    rollDrop(w, b.map, b.x, b.y, 0.22, 0.02, 0.12);
  } else {
    fx(w, "shards", b.map, b.x, b.y, 0, 0, 14);
    sfx(w, "smash");
    w.fx.shake = Math.max(w.fx.shake, 0.12);
    invalidateNav(w);
    rollDrop(w, b.map, b.x, b.y, 0.45, 0.12, 0.25);
  }
}

// ── Player ──────────────────────────────────────────────────────────────────
function facingVec(a: number): [number, number] {
  return [Math.cos(a), Math.sin(a)];
}

function tryInteract(w: World): boolean {
  const p = w.player;
  const [fx_, fy_] = facingVec(p.face);
  // Signs
  if (p.map === "over") {
    for (const s of MAPS.over.signs) {
      const dx = s.x - p.x, dy = s.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.25 && (dx * fx_ + dy * fy_) / d > 0.35) {
        const text = SIGN_TEXT[signKey(s.x, s.y)];
        if (text) { say(w, text, 5.5); sfx(w, "text"); return true; }
      }
    }
  }
  // Chest (only intercepts the button once it can actually be opened)
  if (p.map === "dungeon" && !w.quest.chestOpen && w.quest.bossDead && dist(p.x, p.y, CHEST_POS.x, CHEST_POS.y) < 1.35) {
    openChest(w);
    return true;
  }
  return false;
}

function openChest(w: World) {
  w.quest.chestOpen = true;
  w.player.holding = "sunstone";
  w.player.vx = w.player.vy = 0;
  w.player.face = -Math.PI / 2;
  w.fx.freeze = 3.2;
  w.victoryT = 3.2;
  sfx(w, "chest");
  fx(w, "sparkle", "dungeon", CHEST_POS.x, CHEST_POS.y, 0, 0, 40);
  say(w, "You found the SUNSTONE!", 3.2, true);
}

function updatePlayer(w: World, input: InputFrame) {
  const p = w.player;
  p.px = p.x; p.py = p.y;

  if (p.dead) {
    p.deathT += DT;
    if (p.deathT > 1.7) w.outcome = "gameover";
    return;
  }

  p.invuln = Math.max(0, p.invuln - DT);
  p.attackCd = Math.max(0, p.attackCd - DT);
  p.knockT = Math.max(0, p.knockT - DT);
  if (p.attackT > 0) p.attackT = Math.max(0, p.attackT - DT);

  let mx = input.mx, my = input.my;
  const busy = !!w.transition;
  if (busy) { mx = 0; my = 0; }
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }

  // 8-way facing follows input (locked mid-swing so the arc stays readable).
  if (ml > 0.1 && p.attackT <= 0 && p.knockT <= 0) {
    p.face = Math.round(Math.atan2(my, mx) / (Math.PI / 4)) * (Math.PI / 4);
  }

  if (p.attackBuf > 0 && !busy && p.knockT <= 0) {
    if (tryInteract(w)) p.attackBuf = 0;
    else if (p.attackCd <= 0) {
      p.attackBuf = 0;
      p.attackT = SWING_DUR;
      p.attackCd = SWING_CD;
      p.swingId++;
      const [fx_, fy_] = facingVec(p.face);
      p.vx += fx_ * 2.2; p.vy += fy_ * 2.2; // small step into the swing
      sfx(w, "swing");
    }
  }

  // Royal jelly puddles are sticky: wading through one halves your speed.
  let inGoo = false;
  for (const pd of w.puddles) {
    if (pd.map === p.map && dist(p.x, p.y, pd.x, pd.y) < pd.r) { inGoo = true; break; }
  }
  p.goo = inGoo ? p.goo + DT : 0;

  if (p.knockT > 0) {
    [p.vx, p.vy] = approach(p.vx, p.vy, 0, 0, FRICTION * 0.6 * DT);
  } else {
    const speed = RUN_SPEED * (p.attackT > 0 ? SWING_MOVE_MUL : 1) * (inGoo ? JELLY.slow : 1);
    if (ml > 0.1) [p.vx, p.vy] = approach(p.vx, p.vy, mx * speed, my * speed, ACCEL * DT);
    else [p.vx, p.vy] = approach(p.vx, p.vy, 0, 0, FRICTION * DT);
  }

  moveBody(w, p, p.vx, p.vy, PLAYER_R, p.map, false, propCircles(w, p.map));
  const sp = Math.hypot(p.vx, p.vy);
  p.moving = sp > 0.4;
  p.walkPhase += sp * DT * 2.4;

  // Sword hits
  if (p.attackT > 0) swordHits(w);

  // Door triggers
  const ch = tileAt(p.map, Math.floor(p.x), Math.floor(p.y));
  if (!w.transition) {
    if (p.map === "over" && ch === "D") {
      w.transition = { t: 0, dur: 1.0, to: "dungeon", x: DUNGEON_ENTRY.x, y: DUNGEON_ENTRY.y, face: -Math.PI / 2, swapped: false };
      sfx(w, "door");
    } else if (p.map === "dungeon" && ch === "X") {
      w.transition = { t: 0, dur: 1.0, to: "over", x: OVERWORLD_RETURN.x, y: OVERWORLD_RETURN.y, face: Math.PI / 2, swapped: false };
      sfx(w, "door");
    }
  }

  // Gate: the key opens it on contact.
  if (p.map === "dungeon" && !w.quest.gateOpen) {
    const cx = clamp(p.x, DUNGEON_GATE.x0, DUNGEON_GATE.x1), cy = clamp(p.y, DUNGEON_GATE.y0, DUNGEON_GATE.y1);
    if (dist(p.x, p.y, cx, cy) < PLAYER_R + 0.06 && p.y > DUNGEON_GATE.y1) {
      if (w.quest.hasKey) {
        w.quest.gateOpen = true;
        w.quest.hasKey = false;
        invalidateNav(w);
        w.fx.shake = 0.45;
        sfx(w, "gate");
        fx(w, "dust", "dungeon", 8, GATE_ROW + 0.9, 0, 0, 18);
        say(w, "The key turns… the gate grinds open!", 3);
      } else if (!w.message || w.message.t < 0.5) {
        say(w, "A heavy iron gate. There must be a key somewhere.", 2.6);
        sfx(w, "denied");
      }
    }
  }

  // Key pedestal
  if (p.map === "dungeon" && !w.quest.keyTaken && dist(p.x, p.y, KEY_PEDESTAL.x, KEY_PEDESTAL.y) < 0.95) {
    w.quest.keyTaken = true;
    w.quest.hasKey = true;
    p.holding = "key";
    p.vx = p.vy = 0;
    p.attackT = 0;
    w.fx.freeze = 1.6;
    sfx(w, "key");
    fx(w, "sparkle", "dungeon", p.x, p.y, 0, 0, 20);
    say(w, "You got the BARROW KEY!", 3, true);
  }

  // Walking into the unlocked chest opens it too.
  if (p.map === "dungeon" && w.quest.bossDead && !w.quest.chestOpen && dist(p.x, p.y, CHEST_POS.x, CHEST_POS.y) < 0.98) {
    openChest(w);
  }

  // Grass wobbles as you wade through it.
  for (const b of w.breakables) {
    if (b.broken || b.map !== p.map) continue;
    if (b.kind === "grass" && p.moving && dist(p.x, p.y, b.x, b.y) < 0.55) b.wobble = 1;
  }

  // Context prompt
  w.prompt = null;
  if (p.map === "over") {
    const [fx_, fy_] = facingVec(p.face);
    for (const s of MAPS.over.signs) {
      const dx = s.x - p.x, dy = s.y - p.y, d = Math.hypot(dx, dy);
      if (d < 1.25 && (dx * fx_ + dy * fy_) / d > 0.35) w.prompt = "Read";
    }
  } else if (!w.quest.chestOpen && dist(p.x, p.y, CHEST_POS.x, CHEST_POS.y) < 1.35) {
    w.prompt = w.quest.bossDead ? "Open" : null;
  }
}

function swordHits(w: World) {
  const p = w.player;
  const prog = 1 - p.attackT / SWING_DUR;
  const start = p.face - SWING_HALF_ARC;
  const cur = start + SWING_HALF_ARC * 2 * Math.min(1, prog * 1.15);
  const inArc = (x: number, y: number, r: number) => {
    const d = dist(p.x, p.y, x, y);
    if (d > SWORD_REACH + r) return false;
    if (d < PLAYER_R + r + 0.12) return Math.abs(angDiff(Math.atan2(y - p.y, x - p.x), p.face)) < 1.9;
    const a = Math.atan2(y - p.y, x - p.x);
    const rel = angDiff(a, start);
    const slack = Math.asin(Math.min(1, r / d)) + 0.12;
    return rel > -slack && rel < angDiff(cur, start) + slack;
  };
  for (const e of w.enemies) {
    if (!e.alive || e.map !== p.map || e.lastSwing === p.swingId) continue;
    if (e.kind === "king" && e.state === "sleep") continue;
    if (inArc(e.x, e.y, e.r)) hitEnemy(w, e);
  }
  for (const b of w.breakables) {
    if (b.broken || b.map !== p.map) continue;
    if (inArc(b.x, b.y, 0.25)) breakProp(w, b);
  }
  // Royal jelly on its way down can be batted straight back at the King.
  const king = w.enemies.find((e) => e.kind === "king" && e.alive);
  for (const j of w.jellies) {
    if (j.returned || j.map !== p.map || j.z > 1.7 || j.t < j.dur * 0.45) continue;
    if (!inArc(j.x, j.y, 0.4)) continue;
    j.returned = true;
    j.t = 0;
    let dx = Math.cos(p.face), dy = Math.sin(p.face);
    if (king) { const d = dist(j.x, j.y, king.x, king.y) || 1; dx = (king.x - j.x) / d; dy = (king.y - j.y) / d; }
    j.vx = dx * JELLY.returnSpeed; j.vy = dy * JELLY.returnSpeed;
    fx(w, "spark", j.map, j.x, j.y, dx, dy, 9);
    sfx(w, "swat");
    w.fx.hitstop = Math.max(w.fx.hitstop, 0.08);
    w.fx.shake = Math.max(w.fx.shake, 0.2);
  }
}

// ── Navigation & Caching ───────────────────────────────────────────────────

let navCacheAI = { over: null as Nav | null, dungeon: null as Nav | null, revision: -1 };
let navCacheHero = { over: null as Nav | null, dungeon: null as Nav | null, revision: -1 };

/** Invalidate cached navigation grids whenever tiles change state. */
export function invalidateNav(w: World) {
  w.navRevision = (w.navRevision ?? 0) + 1;
  // If tiles changed state, prompt active hunters to adapt their route
  for (const e of w.enemies) {
    if (e.alive && (e.state === "chase" || e.state === "return")) {
      e.repathT = Math.min(e.repathT, 0.05);
    }
  }
}

/** Snapshot of where monsters or heroes may walk in this map right now. */
function buildNav(w: World, map: MapId, forAI = true): Nav {
  const m = MAPS[map];
  const solid = new Uint8Array(m.w * m.h);
  for (let ty = 0; ty < m.h; ty++) {
    for (let tx = 0; tx < m.w; tx++) if (solidFor(w, map, tx, ty, forAI)) solid[ty * m.w + tx] = 1;
  }
  // Pots, the key pedestal and the chest block the tiles they stand on.
  for (const c of propCircles(w, map)) {
    const s = forAI ? c.r - 0.08 : 0;
    for (let ty = Math.floor(c.y - s); ty <= Math.floor(c.y + s); ty++) {
      for (let tx = Math.floor(c.x - s); tx <= Math.floor(c.x + s); tx++) {
        if (tx >= 0 && ty >= 0 && tx < m.w && ty < m.h) solid[ty * m.w + tx] = 1;
      }
    }
  }
  // Monsters never set foot in the spawn sanctuary, so they don't plan routes through it.
  if (forAI && map === "over") {
    const R = SAFE_ZONE.r + 0.25;
    for (let ty = Math.floor(SAFE_ZONE.y - R); ty <= Math.floor(SAFE_ZONE.y + R); ty++) {
      for (let tx = Math.floor(SAFE_ZONE.x - R); tx <= Math.floor(SAFE_ZONE.x + R); tx++) {
        if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) continue;
        if (dist(tx + 0.5, ty + 0.5, SAFE_ZONE.x, SAFE_ZONE.y) < R) solid[ty * m.w + tx] = 1;
      }
    }
  }
  return { w: m.w, h: m.h, solid, map, revision: w.navRevision };
}

export function getAllNav(w: World, forAI = true): Record<MapId, Nav> {
  const cache = forAI ? navCacheAI : navCacheHero;
  if (cache.revision === w.navRevision && cache.over && cache.dungeon) {
    return { over: cache.over, dungeon: cache.dungeon };
  }
  cache.over = buildNav(w, "over", forAI);
  cache.dungeon = buildNav(w, "dungeon", forAI);
  cache.revision = w.navRevision;
  return { over: cache.over, dungeon: cache.dungeon };
}

export function getNav(w: World, map: MapId, forAI = true): Nav {
  return getAllNav(w, forAI)[map];
}

/**
 * Where the *hero* can walk right now (doors and stairs are open, the spawn
 * sanctuary is not blocked). Used by the touch controls' tap-to-move routing.
 */
export function heroNav(w: World, map: MapId): Nav {
  return getAllNav(w, false)[map];
}

interface Steer {
  /** Point to walk toward this step. */
  x: number; y: number;
  /** The goal itself is reachable (straight line or full route). */
  ok: boolean;
}

/**
 * Where to walk next on the way to (gx, gy) across chunks and portals:
 * - Straight at it when the way is clear on the same map with ample clearance.
 * - Otherwise through the per-tick pathfinding budget to prevent frame hitching.
 * - Graceful fallback to standoff positions when unreachable (never freeze or vibrate against walls).
 */
function navigate(w: World, allNav: Record<MapId, Nav>, e: Enemy, size: NavSize, gx: number, gy: number, goalMap: MapId): Steer {
  const nav = allNav[e.map];
  // 1. Direct line of sight on same map with safety margin
  if (e.map === goalMap && lineClear(nav, e.x, e.y, gx, gy, e.r + 0.06)) {
    e.path = []; e.pathI = 0; e.pathOk = true; e.pathPending = false;
    e.pgx = gx; e.pgy = gy;
    return { x: gx, y: gy, ok: true };
  }

  // 2. Repath check with per-tick pathfinding budget
  e.repathT -= DT;
  const goalDrift = Math.hypot(gx - e.pgx, gy - e.pgy);
  if ((e.repathT <= 0 || goalDrift > 1.2) && !e.pathPending) {
    const priority = 1000 - Math.hypot(gx - e.x, gy - e.y);
    const immediate = pathScheduler.requestPath(allNav, {
      id: e.id,
      size,
      startMap: e.map,
      sx: e.x,
      sy: e.y,
      goalMap,
      gx,
      gy,
      isAI: true,
      priority,
      callback: (res) => {
        e.path = res.pts;
        e.pathI = 0;
        e.pathOk = res.ok;
        e.pathPending = false;
        e.pgx = gx;
        e.pgy = gy;
        e.repathT = 0.32 + (e.id % 7) * 0.03;
      },
    });

    if (immediate) {
      e.path = immediate.pts;
      e.pathI = 0;
      e.pathOk = immediate.ok;
      e.pathPending = false;
      e.pgx = gx;
      e.pgy = gy;
      e.repathT = 0.32 + (e.id % 7) * 0.03;
    } else {
      e.pathPending = true;
    }
  }

  // 3. Waypoint progression
  const pts = e.path, n = pts.length / 2;
  while (e.pathI < n && Math.hypot(pts[e.pathI * 2] - e.x, pts[e.pathI * 2 + 1] - e.y) < 0.3) e.pathI++;
  for (let k = 0; k < 2 && e.pathI + 1 < n; k++) {
    if (!lineClear(nav, e.x, e.y, pts[(e.pathI + 1) * 2], pts[(e.pathI + 1) * 2 + 1], e.r)) break;
    e.pathI++;
  }
  if (e.pathI < n) {
    return { x: pts[e.pathI * 2], y: pts[e.pathI * 2 + 1], ok: e.pathOk };
  }

  // 4. Route exhausted:
  if (e.pathOk && e.map === goalMap) {
    return { x: gx, y: gy, ok: true };
  }

  // Graceful no-path fallback:
  // Instead of driving face-first into blocking walls, standoff smoothly.
  const standoff = getStandoffPoint(nav, e.x, e.y, gx, gy, e.r);
  return { x: standoff.x, y: standoff.y, ok: false };
}

function toward(nav: Nav, e: Enemy, x: number, y: number, speed: number): [number, number] {
  const dx = x - e.x, dy = y - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.04) return [0, 0];
  const vx = (dx / d) * speed;
  const vy = (dy / d) * speed;
  // Apply wall slide vector so monsters slide gracefully along walls instead of vibrating
  return wallSlideVector(nav, e.x, e.y, vx, vy, e.r);
}

/**
 * Headway tracker. Every half second: did we actually go anywhere? Being in
 * the thick of a fight (`engaged`) always counts as progress, so a gloob
 * jostling for space next to the hero never "gets bored".
 */
function trackStuck(e: Enemy, engaged: boolean) {
  e.anchorT += DT;
  if (e.anchorT < 0.5) return;
  const moved = Math.hypot(e.x - e.ax, e.y - e.ay) > 0.3;
  e.stuckT = moved || engaged ? 0 : e.stuckT + e.anchorT;
  e.ax = e.x; e.ay = e.y; e.anchorT = 0;
}

// ── Enemies ─────────────────────────────────────────────────────────────────
/** Is the hero somewhere a monster on this map is allowed to hunt them? */
function huntable(w: World, e: Enemy) {
  const p = w.player;
  if (p.dead || w.transition || inSafeZone(p)) return false;
  if (p.map === e.map) return true;
  // If player is on another map, AI may hunt only if an AI-traversable portal exists
  const portals = getPortals();
  return portals.some((pt) => pt.traversableByAI);
}

function startChase(e: Enemy) {
  e.state = "chase"; e.stateT = 0;
  e.stuckT = 0; e.anchorT = 0; e.ax = e.x; e.ay = e.y;
  e.repathT = 0; e.calmT = 0;
  e.path = []; e.pathI = 0; e.pathPending = false; e.pathOk = true;
  pathScheduler.cancel(e.id);
}

function spotHero(w: World, e: Enemy) {
  startChase(e);
  e.alertT = 0.75;
  sfx(w, "alert");
  // Gloobs hunt in packs: idle friends close by join in.
  for (const o of w.enemies) {
    if (o === e || !o.alive || o.kind !== "gloob" || o.map !== e.map || o.state !== "idle" || o.calmT > 0) continue;
    if (dist(o.x, o.y, e.x, e.y) < GLOOB.rally) { startChase(o); o.alertT = 0.75; }
  }
}

function giveUp(e: Enemy) {
  e.state = "return";
  e.calmT = GLOOB.calm;
  e.stuckT = 0; e.anchorT = 0; e.ax = e.x; e.ay = e.y;
  e.repathT = 0;
  e.path = [];
  e.pathI = 0;
  e.pathPending = false;
  e.pathOk = true;
  e.pgx = e.hx; e.pgy = e.hy;
  pathScheduler.cancel(e.id);
  // Turn to face home immediately so the monster doesn't moonwalk backwards
  const dx = e.hx - e.x, dy = e.hy - e.y;
  if (Math.hypot(dx, dy) > 0.05) {
    e.face = Math.atan2(dy, dx);
  }
  // Cut forward momentum so it turns cleanly toward home
  e.vx = 0;
  e.vy = 0;
}

function updateGloob(w: World, e: Enemy, allNav: Record<MapId, Nav>, props: { x: number; y: number; r: number }[]) {
  const p = w.player;
  const nav = allNav[e.map];
  let tvx = 0, tvy = 0;
  e.stateT -= DT;
  e.calmT = Math.max(0, e.calmT - DT);
  const homeD = dist(e.x, e.y, e.hx, e.hy);
  const hunt = huntable(w, e);
  const pd = dist(e.x, e.y, p.x, p.y);
  const spots = hunt && e.calmT <= 0 && pd < GLOOB.aggro;
  switch (e.state) {
    case "idle": {
      if (e.stateT <= 0) {
        // Amble to a random nearby spot it can reach in a straight line.
        e.stateT = 1.4 + rand(w) * 2;
        for (let i = 0; i < 4; i++) {
          const a = rand(w) * Math.PI * 2, r = 0.6 + rand(w) * 1.9;
          const tx = e.hx + Math.cos(a) * r, ty = e.hy + Math.sin(a) * r;
          if (lineClear(nav, e.x, e.y, tx, ty, e.r)) { e.tx = tx; e.ty = ty; break; }
        }
      }
      if (dist(e.x, e.y, e.tx, e.ty) > 0.15) [tvx, tvy] = toward(nav, e, e.tx, e.ty, GLOOB.wander);
      if (spots) spotHero(w, e);
      break;
    }
    case "chase": {
      // Hunt on while the hero is anywhere in our patch of the world. Outside it,
      // only while they're still right there — and never stray absurdly far from home.
      const heroHome = dist(p.x, p.y, e.hx, e.hy);
      const keep = hunt && (heroHome < GLOOB.territory || (pd < GLOOB.forget && homeD < GLOOB.territory + 3));
      const s = navigate(w, allNav, e, 1, p.x, p.y, p.map);
      [tvx, tvy] = toward(nav, e, s.x, s.y, GLOOB.chase);
      trackStuck(e, s.ok && pd < 2.2);
      if (!keep || e.stuckT >= GLOOB.giveUp) giveUp(e);
      break;
    }
    case "return": {
      const s = navigate(w, allNav, e, 1, e.hx, e.hy, e.map);
      [tvx, tvy] = toward(nav, e, s.x, s.y, GLOOB.wander * 1.5);
      trackStuck(e, false);
      if (homeD < 0.6) { e.state = "idle"; e.stateT = 0.5; e.tx = e.hx; e.ty = e.hy; }
      else if (spots) spotHero(w, e);
      else if (e.stuckT > 6) { e.state = "idle"; e.stateT = 0.5; e.tx = e.x; e.ty = e.y; e.stuckT = 0; }
      break;
    }
    case "hurt": {
      [e.vx, e.vy] = approach(e.vx, e.vy, 0, 0, 20 * DT);
      // Getting smacked always makes it angry.
      if (e.stateT <= 0) { if (hunt) startChase(e); else giveUp(e); }
      break;
    }
  }
  if (e.state !== "hurt") {
    [e.vx, e.vy] = approach(e.vx, e.vy, tvx, tvy, 18 * DT);
    // Face the direction of active travel/steering so monsters never moonwalk
    if (Math.hypot(tvx, tvy) > 0.1) {
      e.face = Math.atan2(tvy, tvx);
    } else if (Math.hypot(e.vx, e.vy) > 0.1) {
      e.face = Math.atan2(e.vy, e.vx);
    }
  }
  moveBody(w, e, e.vx, e.vy, e.r, e.map, true, props);
  keepOutOfSafeZone(e);
}

/** The hero is somewhere the King's big body can't get to (or near enough to bump). */
function kingCanReach(e: Enemy, s: Steer, p: Player) {
  if (s.ok) return true;
  const n = e.path.length;
  const ex = n ? e.path[n - 2] : e.x, ey = n ? e.path[n - 1] : e.y;
  return dist(ex, ey, p.x, p.y) < e.r + PLAYER_R + 0.35;
}

function startInflate(w: World, e: Enemy) {
  e.state = "inflate";
  e.stateT = e.enraged ? KING.inflateRage : KING.inflate;
  sfx(w, "inflate");
}

function updateKing(w: World, e: Enemy, allNav: Record<MapId, Nav>, props: { x: number; y: number; r: number }[]) {
  const p = w.player;
  const q = w.quest;
  const nav = allNav[e.map];
  let tvx = 0, tvy = 0;
  e.stateT -= DT;
  e.rangedCd = Math.max(0, e.rangedCd - DT);
  const toP = () => {
    const d = dist(e.x, e.y, p.x, p.y) || 1;
    return [(p.x - e.x) / d, (p.y - e.y) / d] as const;
  };
  switch (e.state) {
    case "sleep": {
      if (p.map === "dungeon" && p.y < BOSS_ROOM_MAX_Y - 1.4 && !p.dead) {
        q.bossAwake = true;
        q.bossShut = true;
        invalidateNav(w);
        e.state = "idle";
        e.stateT = 1.3;
        w.fx.shake = 0.6;
        sfx(w, "bossRoar");
        sfx(w, "seal");
        fx(w, "dust", "dungeon", 8, GATE_ROW + 0.2, 0, 0, 16);
        say(w, "KING GLOOB awakens! The gate slams shut!", 2.6);
      }
      return;
    }
    case "idle": // wake-up wobble
      if (e.stateT <= 0) { e.state = "chase"; e.stateT = 0.9 + rand(w) * 0.6; }
      break;
    case "chase": {
      const s = navigate(w, allNav, e, 2, p.x, p.y, p.map);
      [tvx, tvy] = toward(nav, e, s.x, s.y, e.enraged ? KING.chaseRage : KING.chase);
      const reach = kingCanReach(e, s, p);
      e.unreachT = reach ? Math.max(0, e.unreachT - DT * 2) : e.unreachT + DT;
      if (p.dead) break;
      if (e.unreachT > KING.unreach && e.rangedCd <= 0) {
        // Hiding where he can't follow? He'll lob jelly over the pillars instead.
        startInflate(w, e);
      } else if (e.stateT <= 0) {
        const pd = dist(e.x, e.y, p.x, p.y);
        if (reach && pd > 6.5 && e.rangedCd <= 0 && rand(w) < 0.35) startInflate(w, e);
        // Only charge down a clear lane — no faceplanting into pillars.
        else if (reach && lineClear(nav, e.x, e.y, p.x, p.y, e.r * 0.8)) { e.state = "windup"; e.stateT = e.enraged ? 0.42 : 0.6; }
        else e.stateT = 0.25;
      }
      break;
    }
    case "windup": {
      const [dx, dy] = toP();
      e.ldx = dx; e.ldy = dy;
      e.face = Math.atan2(dy, dx);
      if (e.lunges <= 0) e.lunges = e.enraged ? 2 : 1;
      if (e.stateT <= 0) {
        e.state = "lunge"; e.stateT = 0.45;
        const s = e.enraged ? KING.lungeRage : KING.lunge;
        e.vx = e.ldx * s; e.vy = e.ldy * s;
        sfx(w, "lunge");
      }
      break;
    }
    case "lunge": {
      const s = e.enraged ? KING.lungeRage : KING.lunge;
      tvx = e.ldx * s; tvy = e.ldy * s;
      if (e.stateT <= 0) {
        e.lunges--;
        if (e.lunges > 0) { e.state = "windup"; e.stateT = 0.3; } // enraged: chain a second lunge
        else { e.state = "recover"; e.stateT = e.enraged ? 0.7 : 0.95; }
      }
      break;
    }
    case "inflate": {
      // Plants himself, puffs up and takes aim.
      const [dx, dy] = toP();
      e.face = Math.atan2(dy, dx);
      if (e.stateT <= 0) { spitJelly(w, e); e.state = "spit"; e.stateT = 0.45; }
      break;
    }
    case "spit":
      if (e.stateT <= 0) { e.state = "chase"; e.stateT = 1.0 + rand(w) * 0.6; }
      break;
    case "recover":
      if (e.stateT <= 0) { e.state = "chase"; e.stateT = e.enraged ? 1.0 + rand(w) * 0.8 : 1.6 + rand(w) * 1.0; }
      break;
    case "hurt":
      [e.vx, e.vy] = approach(e.vx, e.vy, 0, 0, 16 * DT);
      if (e.stateT <= 0) {
        // Often answers a hit with a quick counter-lunge.
        if (rand(w) < (e.enraged ? 0.6 : 0.4)) { e.state = "windup"; e.stateT = 0.42; }
        else { e.state = "chase"; e.stateT = 0.6 + rand(w) * 0.6; }
      }
      break;
  }
  if (e.state === "lunge") { e.vx = tvx; e.vy = tvy; }
  else if (e.state === "recover") [e.vx, e.vy] = approach(e.vx, e.vy, 0, 0, 38 * DT); // skid to a halt
  else if (e.state !== "hurt") [e.vx, e.vy] = approach(e.vx, e.vy, tvx, tvy, 12 * DT);
  if (e.state === "chase") {
    if (Math.hypot(tvx, tvy) > 0.1) e.face = Math.atan2(tvy, tvx);
    else if (Math.hypot(e.vx, e.vy) > 0.1) e.face = Math.atan2(e.vy, e.vx);
  }
  const hitWall = moveBody(w, e, e.vx, e.vy, e.r, e.map, true, props);
  if (e.state === "lunge" && hitWall) {
    // Splat into a wall: dazed for a good while.
    e.state = "recover"; e.stateT = 1.4; e.vx = e.vy = 0; e.lunges = 0;
    w.fx.shake = Math.max(w.fx.shake, 0.4);
    fx(w, "dust", e.map, e.x + e.ldx * e.r, e.y + e.ldy * e.r, 0, 0, 12);
    sfx(w, "smash");
  }
}

// ── Royal jelly (the King's ranged attack) ──────────────────────────────────
const JELLY_MOUTH_Z = 1.5;

function spitJelly(w: World, e: Enemy) {
  const p = w.player;
  // Aim a touch ahead of a moving hero, but never onto a wall.
  let tx = p.x + p.vx * 0.3, ty = p.y + p.vy * 0.3;
  if (solidFor(w, e.map, Math.floor(tx), Math.floor(ty), false)) { tx = p.x; ty = p.y; }
  const targets: [number, number, number][] = [[tx, ty, 0]];
  if (e.enraged) {
    // Furious: a three-glob spread, landing ba-da-BOOM one after another.
    const d = dist(e.x, e.y, tx, ty) || 1;
    const nx = -(ty - e.y) / d, ny = (tx - e.x) / d;
    for (const side of [-1, 1]) {
      const sx = tx + nx * 1.6 * side, sy = ty + ny * 1.6 * side;
      if (!solidFor(w, e.map, Math.floor(sx), Math.floor(sy), false)) targets.push([sx, sy, side < 0 ? 0.16 : 0.32]);
    }
  }
  const [fx_, fy_] = facingVec(e.face);
  const ox = e.x + fx_ * 0.55, oy = e.y + fy_ * 0.55;
  for (const [x, y, delay] of targets) {
    const d = dist(ox, oy, x, y);
    w.jellies.push({
      id: w.nextId++, map: e.map, x: ox, y: oy, px: ox, py: oy, z: JELLY_MOUTH_Z, pz: JELLY_MOUTH_Z,
      sx: ox, sy: oy, tx: x, ty: y, t: 0, dur: 0.85 + d * 0.05 + delay, arc: 2.3 + d * 0.12,
      returned: false, vx: 0, vy: 0, dead: false,
    });
  }
  e.rangedCd = e.enraged ? KING.rangedCdRage : KING.rangedCd;
  e.vx -= fx_ * 2; e.vy -= fy_ * 2; // recoil
  w.fx.shake = Math.max(w.fx.shake, 0.2);
  fx(w, "splat", e.map, ox, oy, 0, 0, 6);
  sfx(w, "spit");
  if (!w.jellyHint) {
    w.jellyHint = true;
    say(w, "Royal jelly incoming! Dodge the shadow… or swat it back!", 3.2);
  }
}

function maybeEnrage(w: World, e: Enemy) {
  if (e.enraged || e.hp > e.maxHp / 2) return;
  e.enraged = true;
  sfx(w, "bossRoar");
  sfx(w, "split");
  say(w, "King Gloob is furious! He splits off two little gloobs!", 2.4);
  for (const side of [-1, 1]) {
    const m = makeEnemy(w, "gloob", e.map, e.x + side * 0.9, e.y + 0.2);
    m.minion = true;
    m.hx = e.x + side * 3; m.hy = e.y;
    m.state = "hurt"; m.stateT = 0.4;
    m.vx = side * 6; m.vy = 2;
    w.enemies.push(m);
  }
  fx(w, "poof", e.map, e.x, e.y, 0, 0, 10);
}

/** A swatted glob smacks the King: real damage, and he's left reeling. */
function jellyHitsKing(w: World, k: Enemy, j: Jelly) {
  k.hp -= 1;
  k.flash = 0.2;
  k.iframes = 0;
  k.lunges = 0;
  const sp = Math.hypot(j.vx, j.vy) || 1;
  fx(w, "splat", k.map, k.x - (j.vx / sp) * k.r, k.y - (j.vy / sp) * k.r, j.vx / sp, j.vy / sp, 16);
  fx(w, "spark", k.map, k.x, k.y, j.vx / sp, j.vy / sp, 10);
  sfx(w, "splat");
  w.fx.shake = Math.max(w.fx.shake, 0.5);
  w.fx.hitstop = Math.max(w.fx.hitstop, 0.1);
  if (k.hp <= 0) { killEnemy(w, k); return; }
  sfx(w, "bossHit");
  k.state = "recover"; k.stateT = 1.7;
  k.vx = (j.vx / sp) * 2.5; k.vy = (j.vy / sp) * 2.5;
  say(w, "Direct hit! King Gloob is seeing stars!", 2);
  maybeEnrage(w, k);
}

function landJelly(w: World, j: Jelly) {
  const p = w.player;
  j.dead = true;
  fx(w, "splat", j.map, j.tx, j.ty, 0, 0, 18);
  sfx(w, "splat");
  w.fx.shake = Math.max(w.fx.shake, 0.22);
  if (p.map === j.map && !p.dead) {
    const d = dist(p.x, p.y, j.tx, j.ty);
    // Bullseye costs a full heart; the outer ring only grazes for half.
    if (d < JELLY.splash + PLAYER_R * 0.5) hurtPlayer(w, d < JELLY.splash * 0.55 ? JELLY.dmg : 1, j.tx, j.ty);
  }
  w.puddles.push({ id: w.nextId++, map: j.map, x: j.tx, y: j.ty, r: JELLY.puddleR, life: JELLY.puddleLife, max: JELLY.puddleLife });
  if (w.puddles.length > 6) w.puddles.shift();
}

function updateJellies(w: World) {
  const king = w.enemies.find((e) => e.kind === "king");
  for (const j of w.jellies) {
    j.px = j.x; j.py = j.y; j.pz = j.z;
    j.t += DT;
    if (j.returned) {
      // Flies flat and fast at the King, curving gently after him.
      if (king && king.alive) {
        const d = dist(j.x, j.y, king.x, king.y) || 1;
        const sp = Math.hypot(j.vx, j.vy) || 1;
        const [nvx, nvy] = approach(j.vx / sp, j.vy / sp, (king.x - j.x) / d, (king.y - j.y) / d, 2.5 * DT);
        const nl = Math.hypot(nvx, nvy) || 1;
        j.vx = (nvx / nl) * JELLY.returnSpeed; j.vy = (nvy / nl) * JELLY.returnSpeed;
      }
      j.x += j.vx * DT; j.y += j.vy * DT;
      j.z = approachScalar(j.z, 0.75, 3 * DT);
      if (king && king.alive && king.map === j.map && dist(j.x, j.y, king.x, king.y) < king.r + 0.3) {
        jellyHitsKing(w, king, j);
        j.dead = true;
        if (!king.alive) return; // killEnemy already cleared every glob
      } else if (solidFor(w, j.map, Math.floor(j.x), Math.floor(j.y), false) || j.t > 2.5) {
        j.dead = true;
        fx(w, "splat", j.map, j.x, j.y, 0, 0, 10);
        sfx(w, "splat");
      }
      continue;
    }
    const u = Math.min(1, j.t / j.dur);
    j.x = j.sx + (j.tx - j.sx) * u;
    j.y = j.sy + (j.ty - j.sy) * u;
    j.z = JELLY_MOUTH_Z * (1 - u) + 4 * j.arc * u * (1 - u);
    if (u >= 1) landJelly(w, j);
  }
  w.jellies = w.jellies.filter((j) => !j.dead);
  for (const pd of w.puddles) pd.life -= DT;
  w.puddles = w.puddles.filter((pd) => pd.life > 0);
}

function approachScalar(v: number, t: number, step: number) {
  return v < t ? Math.min(t, v + step) : Math.max(t, v - step);
}

function updateEnemies(w: World) {
  const p = w.player;
  const allNav = getAllNav(w, true);
  pathScheduler.tick(allNav);

  for (const e of w.enemies) {
    e.px = e.x; e.py = e.y;
    e.flash = Math.max(0, e.flash - DT);
    e.iframes = Math.max(0, e.iframes - DT);
    e.contactCd = Math.max(0, e.contactCd - DT);
    e.alertT = Math.max(0, e.alertT - DT);
    if (!e.alive) {
      if (e.kind === "king") continue;
      e.respawnT -= DT;
      if (e.respawnT <= 0 && (p.map !== e.map || dist(p.x, p.y, e.hx, e.hy) > 7)) {
        Object.assign(e, { alive: true, hp: e.maxHp, x: e.hx, y: e.hy, px: e.hx, py: e.hy, vx: 0, vy: 0, state: "idle", stateT: 1 });
        resetAi(e);
        if (e.map === p.map) fx(w, "poof", e.map, e.x, e.y, 0, 0, 8);
      }
      continue;
    }

    // Portal traversal for AI (only when portal is marked traversableByAI)
    const activePortals = getPortals();
    for (const pt of activePortals) {
      if (!pt.traversableByAI) continue;
      const from = chunkToUnified(pt.fromChunk, pt.fromTile.x, pt.fromTile.y);
      if (e.map === from.map && dist(e.x, e.y, from.x + 0.5, from.y + 0.5) < 0.6) {
        const to = chunkToUnified(pt.toChunk, pt.toTile.x, pt.toTile.y);
        e.map = to.map;
        e.x = e.px = to.x + 0.5;
        e.y = e.py = to.y + 0.5;
        e.path = [];
        e.pathI = 0;
        e.repathT = 0;
        break;
      }
    }

    const enemyProps = propCircles(w, e.map);
    if (e.map !== p.map) {
      // Monsters on another map update if they are active
      if (e.state === "chase" || e.state === "return") {
        if (e.kind === "king") updateKing(w, e, allNav, enemyProps);
        else updateGloob(w, e, allNav, enemyProps);
      }
      continue;
    }

    if (e.kind === "king") updateKing(w, e, allNav, enemyProps);
    else updateGloob(w, e, allNav, enemyProps);
  }
}

/** Hero and monsters are solid to each other — they shove apart, never stack. */
function separateBodies(w: World) {
  const p = w.player;
  const list = w.enemies.filter((e) => e.alive && e.map === p.map);
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = a.r + b.r;
        if (d < min) {
          const wa = b.r * b.r / (a.r * a.r + b.r * b.r);
          const push = min - d;
          a.x -= (dx / d) * push * wa; a.y -= (dy / d) * push * wa;
          b.x += (dx / d) * push * (1 - wa); b.y += (dy / d) * push * (1 - wa);
        }
      }
      if (!p.dead) {
        const dx = p.x - a.x, dy = p.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = a.r + PLAYER_R;
        if (d < min) {
          const push = min - d;
          const pw = a.kind === "king" ? 0.85 : 0.5;
          p.x += (dx / d) * push * pw; p.y += (dy / d) * push * pw;
          a.x -= (dx / d) * push * (1 - pw); a.y -= (dy / d) * push * (1 - pw);
        }
      }
    }
    for (const e of list) { resolveTiles(w, e, e.r, e.map, true); keepOutOfSafeZone(e); }
    resolveTiles(w, p, PLAYER_R, p.map, false);
  }
}

function contactDamage(w: World) {
  const p = w.player;
  if (p.dead) return;
  for (const e of w.enemies) {
    if (!e.alive || e.map !== p.map || e.state === "hurt" || e.state === "sleep") continue;
    // A dazed King is the punish window: harmless once he's stopped skidding.
    if (e.state === "recover" && Math.hypot(e.vx, e.vy) < 2) continue;
    if (e.contactCd > 0) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < e.r + PLAYER_R + 0.07) {
      if (p.invuln <= 0) {
        hurtPlayer(w, e.kind === "king" ? KING.dmg : GLOOB.dmg, e.x, e.y);
        e.contactCd = e.kind === "king" ? 1.2 : 0.9;
        // Bounce back a touch after landing a hit.
        const nx = (e.x - p.x) / (d || 1), ny = (e.y - p.y) / (d || 1);
        if (e.kind !== "king") { e.vx = nx * 3; e.vy = ny * 3; }
        else if (e.state === "lunge") { e.state = "recover"; e.stateT = 0.6; e.vx = e.vy = 0; e.lunges = 0; }
      }
    }
  }
}

// ── Pickups ─────────────────────────────────────────────────────────────────
function updatePickups(w: World) {
  const p = w.player;
  for (const k of w.pickups) {
    k.px = k.x; k.py = k.y;
    k.age += DT;
    if (!k.permanent) k.life -= DT;
    if (k.map !== p.map) continue;
    // Little hop when dropped
    if (k.z > 0 || k.vz > 0) {
      k.vz -= 30 * DT;
      k.z += k.vz * DT;
      if (k.z <= 0) { k.z = 0; k.vz = k.vz < -3 ? -k.vz * 0.35 : 0; }
    }
    const d = dist(p.x, p.y, k.x, k.y);
    if (!p.dead && k.age > 0.3 && d < 1.7) {
      // Magnet pull
      const pull = 14 * (1 - d / 1.7) + 4;
      k.vx += ((p.x - k.x) / (d || 1)) * pull * DT * 4;
      k.vy += ((p.y - k.y) / (d || 1)) * pull * DT * 4;
    } else {
      [k.vx, k.vy] = approach(k.vx, k.vy, 0, 0, 6 * DT);
    }
    const sp = Math.hypot(k.vx, k.vy);
    if (sp > 10) { k.vx *= 10 / sp; k.vy *= 10 / sp; }
    k.x += k.vx * DT; k.y += k.vy * DT;
    resolveTiles(w, k, 0.18, k.map, false);
    if (!p.dead && k.age > 0.3 && d < 0.5) {
      k.life = -1;
      k.permanent = false;
      if (k.kind === "heart") {
        p.hp = Math.min(p.maxHp, p.hp + 2);
        sfx(w, "heart");
      } else {
        w.rupees += k.kind === "rupee5" ? 5 : 1;
        sfx(w, "rupee");
      }
      fx(w, "sparkle", k.map, k.x, k.y, 0, 0, 5);
    }
  }
  w.pickups = w.pickups.filter((k) => k.permanent || k.life > 0);
}

// ── Main step ───────────────────────────────────────────────────────────────
export function step(w: World, input: InputFrame) {
  w.tick++;
  if (w.outcome) return;
  w.time += DT;

  if (input.attack) w.player.attackBuf = 0.2;
  else w.player.attackBuf = Math.max(0, w.player.attackBuf - DT);
  // Purely-cosmetic decays always run so shakes settle during freezes.
  w.fx.shake = Math.max(0, w.fx.shake - DT * 2.2);
  w.fx.hurt = Math.max(0, w.fx.hurt - DT * 2.2);
  for (const b of w.breakables) b.wobble = Math.max(0, b.wobble - DT * 2.5);
  if (w.message) {
    w.message.t -= DT;
    if (w.message.t <= 0) w.message = null;
  }

  // Hit-stop: the whole world holds its breath for a few frames on impact.
  if (w.fx.hitstop > 0) {
    w.fx.hitstop = Math.max(0, w.fx.hitstop - DT);
    syncPrev(w);
    return;
  }

  // Item-get freeze (hero holds the prize aloft).
  if (w.fx.freeze > 0) {
    w.fx.freeze = Math.max(0, w.fx.freeze - DT);
    syncPrev(w);
    if (w.victoryT > 0) {
      w.victoryT -= DT;
      if (w.victoryT <= 0) w.outcome = "victory";
    }
    if (w.fx.freeze <= 0 && w.player.holding === "key") w.player.holding = null;
    return;
  }

  // Screen transitions (barrow door / stairs)
  const tr = w.transition;
  if (tr) {
    tr.t += DT;
    const p = w.player;
    if (!tr.swapped && tr.t >= tr.dur / 2) {
      tr.swapped = true;
      p.map = tr.to;
      p.x = p.px = tr.x; p.y = p.py = tr.y;
      p.vx = p.vy = 0; p.face = tr.face;
      if (tr.to === "dungeon") {
        w.quest.enteredDungeon = true;
        w.checkpoint = { map: "dungeon", x: tr.x, y: tr.y, face: tr.face };
      } else {
        w.checkpoint = { map: "over", x: tr.x, y: tr.y, face: tr.face };
      }
      w.pickups = w.pickups.filter((k) => k.permanent);
    }
    if (tr.t >= tr.dur) w.transition = null;
  }

  updatePlayer(w, input);
  updateEnemies(w);
  separateBodies(w);
  contactDamage(w);
  updateJellies(w);
  updatePickups(w);
}

function syncPrev(w: World) {
  const p = w.player;
  p.px = p.x; p.py = p.y;
  for (const e of w.enemies) { e.px = e.x; e.py = e.y; }
  for (const k of w.pickups) { k.px = k.x; k.py = k.y; }
  for (const j of w.jellies) { j.px = j.x; j.py = j.y; j.pz = j.z; }
}

/** 0 → 1 → 0 fade amount for the current door transition. */
export function transitionFade(w: World): number {
  const tr = w.transition;
  if (!tr) return 0;
  return clamp(1 - Math.abs(tr.t / (tr.dur / 2) - 1), 0, 1);
}
