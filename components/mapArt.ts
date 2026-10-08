// ─────────────────────────────────────────────────────────────────────────────
//  2D map art for the HUD minimap and the pause-menu world map. Tiles are
//  painted once per map into an offscreen canvas; markers (hero, monsters,
//  objective, fog of war) are drawn live on top. Reads World, never writes it.
// ─────────────────────────────────────────────────────────────────────────────
import { CHEST_POS, GATE_ROW, KEY_PEDESTAL, MAPS, SCREEN_H, SCREEN_W } from "@/game/maps";
import type { MapId } from "@/game/maps";
import { BARROW_DOOR, BARROW_STAIRS, objective, regionKey } from "@/game/objective";
import type { World } from "@/game/types";

const CELL = 8; // offscreen pixels per tile

const OVER_COLORS: Record<string, string> = {
  ".": "#62b04f", ",": "#7cc45e", ":": "#d9bb7c", "~": "#3d8fd1", "=": "#a8743d",
  "#": "#2c6a36", T: "#22552b", R: "#8f9198", "^": "#76685a", D: "#140c18",
  h: "#c2553c", l: "#f6c453", n: "#a8794a",
};
const DUNGEON_COLORS: Record<string, string> = {
  W: "#2a2436", t: "#ff9a3a", ".": "#5f5772", ",": "#554d68", P: "#3b3449",
  G: "#c9a040", X: "#efe0a6",
};
const SOLIDISH = new Set(["#", "T", "R", "^", "h", "W", "P", "t"]);

const cache = new Map<string, HTMLCanvasElement>();

function staticLayer(map: MapId, gateOpen: boolean): HTMLCanvasElement {
  const key = `${map}:${gateOpen}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = MAPS[map];
  const c = document.createElement("canvas");
  c.width = m.w * CELL; c.height = m.h * CELL;
  const g = c.getContext("2d")!;
  const pal = map === "over" ? OVER_COLORS : DUNGEON_COLORS;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      let ch = m.tiles[y][x];
      if (ch === "G" && gateOpen) ch = ".";
      g.fillStyle = pal[ch] ?? pal["."] ?? "#555";
      g.fillRect(x * CELL, y * CELL, CELL, CELL);
      // Chunky pixel-art depth: solid tiles get a darker lip on their south edge.
      if (SOLIDISH.has(ch)) {
        g.fillStyle = "rgba(0,0,0,0.28)";
        g.fillRect(x * CELL, y * CELL + CELL - 2, CELL, 2);
      }
      if (ch === "T") {
        g.fillStyle = "rgba(140,220,120,0.35)";
        g.fillRect(x * CELL + 2, y * CELL + 1, 3, 3);
      }
      if (ch === "~" && (x + y) % 3 === 0) {
        g.fillStyle = "rgba(255,255,255,0.28)";
        g.fillRect(x * CELL + 2, y * CELL + 3, 4, 1);
      }
    }
  }
  cache.set(key, c);
  return c;
}

/** Rectangles (in tiles) of every fog-of-war region on a map. */
function regions(map: MapId): { key: string; x: number; y: number; w: number; h: number; name: string }[] {
  if (map === "dungeon") {
    return [
      { key: "dungeon:boss", x: 0, y: 0, w: 16, h: GATE_ROW, name: "Sunstone Sanctum" },
      { key: "dungeon:hall", x: 0, y: GATE_ROW, w: 16, h: 23 - GATE_ROW, name: "Barrow Halls" },
    ];
  }
  const names = [["Whisperpine Woods", "Lantern Meadow", "Cragmaw Rocks"], ["Willowmere", "Hearthside", "Brambleford"]];
  const out = [];
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      out.push({ key: `over:${sx},${sy}`, x: sx * SCREEN_W, y: sy * SCREEN_H, w: SCREEN_W, h: SCREEN_H, name: names[sy][sx] });
    }
  }
  return out;
}

export interface MapView {
  map: MapId;
  /** Tile coordinate at the centre of the drawing. */
  cx: number; cy: number;
  /** CSS pixels per tile. */
  scale: number;
  /** Drawing size in CSS pixels. */
  width: number; height: number;
  /** Circular radar (clip + edge arrow for off-screen objectives). */
  radar: boolean;
  labels: boolean;
  /** Seconds, for pulsing markers. */
  t: number;
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

/** Draws the map + live markers into a context already scaled to CSS pixels. */
export function drawMap(g: CanvasRenderingContext2D, w: World, visited: Record<string, true>, v: MapView) {
  const { map, cx, cy, scale, width, height } = v;
  const toX = (x: number) => width / 2 + (x - cx) * scale;
  const toY = (y: number) => height / 2 + (y - cy) * scale;

  g.save();
  g.clearRect(0, 0, width, height);
  if (v.radar) {
    g.beginPath();
    g.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
    g.clip();
  }
  g.fillStyle = map === "over" ? "#173b22" : "#0e0b14";
  g.fillRect(0, 0, width, height);

  // Terrain
  g.imageSmoothingEnabled = false;
  const layer = staticLayer(map, w.quest.gateOpen);
  g.drawImage(layer, toX(0), toY(0), (layer.width / CELL) * scale, (layer.height / CELL) * scale);

  // Points of interest (only once their region has been explored)
  const seen = (x: number, y: number) => !!visited[regionKey(map, x, y)];
  const poi = (x: number, y: number, color: string, glyph: "door" | "key" | "chest") => {
    if (!seen(x, y)) return;
    const px = toX(x), py = toY(y), s = Math.max(4, scale * 0.7);
    g.fillStyle = "rgba(20,12,26,0.85)";
    g.beginPath(); g.arc(px, py, s + 1.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    if (glyph === "door") { g.fillRect(px - s * 0.5, py - s * 0.55, s, s * 1.1); g.fillStyle = "#140c18"; g.fillRect(px - s * 0.25, py - s * 0.2, s * 0.5, s * 0.75); }
    else if (glyph === "key") { g.beginPath(); g.arc(px - s * 0.25, py, s * 0.38, 0, Math.PI * 2); g.fill(); g.fillRect(px - s * 0.1, py - s * 0.12, s * 0.8, s * 0.26); }
    else { g.fillRect(px - s * 0.6, py - s * 0.4, s * 1.2, s * 0.8); g.fillStyle = "#6b3a1c"; g.fillRect(px - s * 0.6, py - s * 0.08, s * 1.2, s * 0.16); }
  };
  if (map === "over") poi(BARROW_DOOR.x, BARROW_DOOR.y + 0.3, "#c9b38a", "door");
  else {
    poi(BARROW_STAIRS.x, BARROW_STAIRS.y, "#efe0a6", "door");
    if (!w.quest.keyTaken) poi(KEY_PEDESTAL.x, KEY_PEDESTAL.y, "#ffcc33", "key");
    if (!w.quest.chestOpen) poi(CHEST_POS.x, CHEST_POS.y, "#e0a040", "chest");
  }

  // Monsters (nearby, in explored areas)
  const p = w.player;
  for (const e of w.enemies) {
    if (!e.alive || e.map !== map || !seen(e.x, e.y)) continue;
    if (v.radar && Math.hypot(e.x - p.x, e.y - p.y) > 14) continue;
    const king = e.kind === "king";
    g.fillStyle = king ? "#ff5fb4" : "#ff4d5e";
    g.strokeStyle = "rgba(20,10,20,0.9)";
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(toX(e.x), toY(e.y), king ? 4.5 : 2.8, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  // Fog of war
  for (const r of regions(map)) {
    if (visited[r.key]) continue;
    const x0 = toX(r.x), y0 = toY(r.y), ww = r.w * scale, hh = r.h * scale;
    g.fillStyle = "rgba(16,11,24,0.9)";
    g.fillRect(x0, y0, ww, hh);
    if (v.labels) {
      g.fillStyle = "rgba(255,240,210,0.25)";
      g.font = `900 ${Math.max(12, scale * 2.2)}px ui-rounded, system-ui, sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("?", x0 + ww / 2, y0 + hh / 2);
    }
  }
  if (v.labels) {
    g.font = `800 ${Math.max(10, Math.min(14, scale * 0.9))}px ui-rounded, system-ui, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "top";
    for (const r of regions(map)) {
      if (!visited[r.key]) continue;
      const lx = toX(r.x + r.w / 2), ly = toY(r.y) + 6;
      g.lineWidth = 3; g.strokeStyle = "rgba(20,12,26,0.85)";
      g.strokeText(r.name.toUpperCase(), lx, ly);
      g.fillStyle = "#fff4d6";
      g.fillText(r.name.toUpperCase(), lx, ly);
    }
  }

  // Objective waypoint: pulsing gold star (clamped to the rim on the radar).
  const obj = objective(w);
  if (obj.waypoint && obj.waypoint.map === map) {
    let ox = toX(obj.waypoint.x), oy = toY(obj.waypoint.y);
    const pulse = 1 + Math.sin(v.t * 5) * 0.15;
    let edge = false;
    if (v.radar) {
      const dx = ox - width / 2, dy = oy - height / 2, d = Math.hypot(dx, dy), R = width / 2 - 9;
      if (d > R) { ox = width / 2 + (dx / d) * R; oy = height / 2 + (dy / d) * R; edge = true; }
    }
    g.save();
    g.shadowColor = "rgba(255,200,60,0.9)"; g.shadowBlur = 8;
    g.fillStyle = "#ffd34a"; g.strokeStyle = "#5a3a08"; g.lineWidth = 1.4;
    if (edge) {
      const a = Math.atan2(oy - height / 2, ox - width / 2);
      g.translate(ox, oy); g.rotate(a);
      g.beginPath(); g.moveTo(7 * pulse, 0); g.lineTo(-4, -5.5); g.lineTo(-1.5, 0); g.lineTo(-4, 5.5); g.closePath();
    } else star(g, ox, oy, 6.5 * pulse);
    g.fill(); g.stroke();
    g.restore();
  }

  // The hero: a bright arrow pointing the way he faces.
  if (p.map === map) {
    const hx = toX(p.x), hy = toY(p.y);
    g.save();
    g.translate(hx, hy); g.rotate(p.face);
    g.shadowColor = "rgba(255,255,255,0.8)"; g.shadowBlur = 6;
    g.fillStyle = "#ffffff"; g.strokeStyle = "#1b4a30"; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -5); g.lineTo(-2.5, 0); g.lineTo(-5, 5); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
  g.restore();
}

export function mapSize(map: MapId) {
  return { w: MAPS[map].w, h: MAPS[map].h };
}
