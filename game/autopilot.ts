// ─────────────────────────────────────────────────────────────────────────────
//  Tap-to-move "autopilot": a virtual gamepad for touch screens. Given a tapped
//  target (a spot, a monster, a pot, a sign, the chest) it walks the hero there
//  along an A* route and presses the sword button when in reach.
//
//  It only ever produces an InputFrame, exactly like a human would, so the
//  simulation stays oblivious to how it's being driven (and deterministic).
// ─────────────────────────────────────────────────────────────────────────────
import { CHEST_POS, MAPS } from "./maps";
import type { MapId } from "./maps";
import { findPath, lineClear } from "./path";
import type { Nav } from "./path";
import { PLAYER_R, heroNav } from "./sim";
import type { InputFrame, World } from "./types";

export type TapKind = "move" | "enemy" | "break" | "sign" | "chest";

export interface TapTarget {
  kind: TapKind;
  map: MapId;
  /** Ground point (move/sign/chest) — for enemy/break it's looked up live by id. */
  x: number; y: number;
  id: number;
}

export interface Marker {
  map: MapId;
  x: number; y: number;
  /** Ring radius in tiles. */
  r: number;
  hostile: boolean;
  /** Monster being locked on to (hostile markers only). */
  enemyId: number;
  /** Bumped on every new tap so the view can replay its pop-in. */
  serial: number;
}

const STEP = Math.PI / 4;
const snap = (a: number) => Math.round(a / STEP) * STEP;
const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

class Autopilot {
  private t: TapTarget | null = null;
  private serial = 0;
  private nav: Nav | null = null;
  private navT = 0;
  private path: number[] = [];
  private pathI = 0;
  private pathOk = true;
  private pgx = NaN;
  private pgy = NaN;
  private ax = 0;
  private ay = 0;
  private anchorT = 0;
  private stuckT = 0;
  private acted = false;

  get active() { return this.t !== null; }

  /** Work out what the player meant by tapping at (gx, gy) (optionally on a monster). */
  tap(w: World, gx: number, gy: number, enemyId: number | null) {
    const p = w.player;
    const map = p.map;
    let t: TapTarget = { kind: "move", map, x: gx, y: gy, id: -1 };
    const e = enemyId !== null ? w.enemies.find((q) => q.id === enemyId && q.alive && q.map === map) : undefined;
    if (e) t = { kind: "enemy", map, x: e.x, y: e.y, id: e.id };
    else {
      // Tall things: a tap on the top of a sign lands on the ground just behind it.
      const sign = map === "over"
        ? MAPS.over.signs.find((s) => Math.hypot(s.x - gx, s.y - 0.35 - gy) < 1.0)
        : undefined;
      if (sign) t = { kind: "sign", map, x: sign.x, y: sign.y, id: -1 };
      else if (map === "dungeon" && w.quest.bossDead && !w.quest.chestOpen && Math.hypot(CHEST_POS.x - gx, CHEST_POS.y - 0.3 - gy) < 1.3) {
        t = { kind: "chest", map, x: CHEST_POS.x, y: CHEST_POS.y, id: -1 };
      } else {
        let bestD = 0.65, best = -1;
        for (const b of w.breakables) {
          if (b.broken || b.map !== map) continue;
          const d = Math.hypot(b.x - gx, b.y - 0.15 - gy);
          if (d < bestD) { bestD = d; best = b.id; }
        }
        if (best >= 0) {
          const b = w.breakables.find((q) => q.id === best)!;
          t = { kind: "break", map, x: b.x, y: b.y, id: b.id };
        }
      }
    }
    this.t = t;
    this.serial++;
    this.path = []; this.pathI = 0; this.pathOk = true;
    this.pgx = this.pgy = NaN;
    this.nav = null; this.navT = 0;
    this.ax = p.x; this.ay = p.y; this.anchorT = 0; this.stuckT = 0; this.acted = false;
  }

  cancel() { this.t = null; }

  marker(w: World): Marker | null {
    const t = this.t;
    if (!t) return null;
    if (t.kind === "enemy") {
      const e = w.enemies.find((q) => q.id === t.id);
      if (!e) return null;
      return { map: t.map, x: e.x, y: e.y, r: e.r + 0.25, hostile: true, enemyId: e.id, serial: this.serial };
    }
    return { map: t.map, x: t.x, y: t.y, r: t.kind === "move" ? 0.42 : 0.55, hostile: false, enemyId: -1, serial: this.serial };
  }

  /** Input for one fixed step (null = not driving). */
  frame(w: World, dt: number): InputFrame | null {
    const t = this.t;
    if (!t) return null;
    const p = w.player;
    if (p.map !== t.map || p.dead || w.outcome) { this.t = null; return null; }
    const idle: InputFrame = { mx: 0, my: 0, attack: false };
    if (w.transition || p.holding || w.fx.freeze > 0) return idle;

    // Where's the goal now, and how close counts as "there"?
    let gx = t.x, gy = t.y, reach = 0.18;
    switch (t.kind) {
      case "enemy": {
        const e = w.enemies.find((q) => q.id === t.id);
        if (!e || !e.alive || e.map !== p.map) { this.t = null; return idle; }
        gx = e.x; gy = e.y; reach = e.r + PLAYER_R + 0.45;
        break;
      }
      case "break": {
        const b = w.breakables.find((q) => q.id === t.id);
        if (!b || b.broken) { this.t = null; return idle; }
        reach = 0.25 + PLAYER_R + 0.42;
        break;
      }
      case "sign": reach = 1.15; break;
      case "chest":
        if (w.quest.chestOpen) { this.t = null; return idle; }
        reach = 1.25;
        break;
    }

    const dx = gx - p.x, dy = gy - p.y;
    const d = Math.hypot(dx, dy);

    // Arrived: face it and press the button.
    if (d <= reach) {
      if (t.kind === "move") { this.t = null; return idle; }
      const want = snap(Math.atan2(dy, dx));
      const facing = Math.abs(angDiff(p.face, want)) < 0.05;
      const k = d > 1e-3 ? 0.14 / d : 0;
      const ready = facing && p.attackT <= 0 && p.attackCd <= 0;
      if (ready && (t.kind === "sign" || t.kind === "chest")) {
        if (this.acted) { this.t = null; return idle; }
        this.acted = true;
      }
      return { mx: dx * k, my: dy * k, attack: ready };
    }

    // Give up when the hero hasn't actually gone anywhere for a while.
    this.anchorT += dt;
    if (this.anchorT >= 0.5) {
      const moved = Math.hypot(p.x - this.ax, p.y - this.ay);
      this.stuckT = moved > 0.2 ? 0 : this.stuckT + this.anchorT;
      this.anchorT = 0; this.ax = p.x; this.ay = p.y;
      if (this.stuckT >= 1.5) { this.t = null; return idle; }
    }

    // Steer: straight when the way is clear, else along an A* route.
    this.navT -= dt;
    let fresh = false;
    if (!this.nav || this.navT <= 0) { this.nav = heroNav(w, p.map); this.navT = 0.3; fresh = true; }
    const nav = this.nav;
    let sx = gx, sy = gy;
    if (!lineClear(nav, p.x, p.y, gx, gy, PLAYER_R)) {
      if (this.path.length === 0 || fresh || Math.hypot(gx - this.pgx, gy - this.pgy) > 1) {
        const r = findPath(nav, 1, p.x, p.y, gx, gy);
        this.path = r.pts; this.pathI = 0; this.pathOk = r.ok;
        this.pgx = gx; this.pgy = gy;
        // Tapped somewhere unreachable (water, a tree): go as close as we can.
        if (!r.ok && t.kind === "move" && r.pts.length >= 2) {
          t.x = r.pts[r.pts.length - 2]; t.y = r.pts[r.pts.length - 1];
        }
      }
      const n = this.path.length / 2;
      while (this.pathI < n - 1 && lineClear(nav, p.x, p.y, this.path[(this.pathI + 1) * 2], this.path[(this.pathI + 1) * 2 + 1], PLAYER_R)) this.pathI++;
      if (this.pathI < n) {
        sx = this.path[this.pathI * 2]; sy = this.path[this.pathI * 2 + 1];
        if (Math.hypot(sx - p.x, sy - p.y) < 0.25 && this.pathI < n - 1) {
          this.pathI++;
          sx = this.path[this.pathI * 2]; sy = this.path[this.pathI * 2 + 1];
        }
      } else if (!this.pathOk && t.kind === "move") { this.t = null; return idle; }
      // Route ran out next to a solid target (pot, sign, chest): lean straight in.
      if (this.pathI >= n - 1 && t.kind !== "move" && Math.hypot(sx - p.x, sy - p.y) < 0.3) { sx = gx; sy = gy; }
    }
    const ex = sx - p.x, ey = sy - p.y;
    const el = Math.hypot(ex, ey) || 1;
    // Ease off on the final approach so we don't overshoot a tapped spot.
    const mag = t.kind === "move" ? Math.min(1, 0.35 + d * 0.9) : 1;
    return { mx: (ex / el) * mag, my: (ey / el) * mag, attack: false };
  }
}

export const autopilot = new Autopilot();
