// ─────────────────────────────────────────────────────────────────────────────
//  Navigation: unified cross-chunk grid A*, portal nodes, per-tick budget,
//  and graceful no-path fallbacks. Pure deterministic functions & scheduler.
// ─────────────────────────────────────────────────────────────────────────────
import type { MapId } from "./maps";

export const SCREEN_W = 16;
export const SCREEN_H = 12;
export const OVERWORLD_COLS = 3;
export const OVERWORLD_ROWS = 2;
export const OVERWORLD_W = SCREEN_W * OVERWORLD_COLS; // 48
export const OVERWORLD_H = SCREEN_H * OVERWORLD_ROWS; // 24

/** Tile solidity snapshot for one map (1 = blocked). Out of bounds is solid. */
export interface Nav {
  w: number;
  h: number;
  solid: Uint8Array;
  map?: MapId;
  revision?: number;
}

export function navSolid(nav: Nav, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= nav.w || ty >= nav.h) return true;
  return nav.solid[ty * nav.w + tx] === 1;
}

/** Does a circle at (x, y) overlap any blocked tile? */
export function circleBlocked(nav: Nav, x: number, y: number, r: number): boolean {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  const r2 = r * r;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!navSolid(nav, tx, ty)) continue;
      const cx = x < tx ? tx : x > tx + 1 ? tx + 1 : x;
      const cy = y < ty ? ty : y > ty + 1 ? ty + 1 : y;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r2) return true;
    }
  }
  return false;
}

/** Can a body of radius r slide in a straight line from A to B without touching a wall? */
export function lineClear(nav: Nav, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(len / 0.2));
  // Small tolerance: bodies resting exactly against a wall still count as clear.
  const rr = Math.max(0.05, r - 0.03);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (circleBlocked(nav, ax + (bx - ax) * t, ay + (by - ay) * t, rr)) return false;
  }
  return true;
}

// ── Chunk Coordinate Helpers (3x2 Overworld) ────────────────────────────────

export type OverworldChunkName =
  | "whisperpine"
  | "meadow"
  | "cragmaw"
  | "willowmere"
  | "hearthside"
  | "brambleford";

export const OVERWORLD_CHUNKS: Record<OverworldChunkName, { cx: number; cy: number }> = {
  whisperpine: { cx: 0, cy: 0 },
  meadow:      { cx: 1, cy: 0 },
  cragmaw:     { cx: 2, cy: 0 },
  willowmere:  { cx: 0, cy: 1 },
  hearthside:  { cx: 1, cy: 1 },
  brambleford: { cx: 2, cy: 1 },
};

/** Convert chunk-local or chunk-identified tile coordinates to unified map tile coords. */
export function chunkToUnified(chunk: string, tx: number, ty: number): { map: MapId; x: number; y: number } {
  const c = OVERWORLD_CHUNKS[chunk.toLowerCase() as OverworldChunkName];
  if (c) {
    const gx = tx < SCREEN_W ? c.cx * SCREEN_W + tx : tx;
    const gy = ty < SCREEN_H ? c.cy * SCREEN_H + ty : ty;
    return { map: "over", x: gx, y: gy };
  }
  if (chunk.toLowerCase() === "dungeon") {
    return { map: "dungeon", x: tx, y: ty };
  }
  return { map: "over", x: tx, y: ty };
}

/** Convert unified map tile coordinates back to chunk name and local tile coords. */
export function unifiedToChunk(map: MapId, x: number, y: number): { chunk: string; localX: number; localY: number } {
  if (map === "dungeon") {
    return { chunk: "dungeon", localX: x, localY: y };
  }
  const cx = Math.max(0, Math.min(OVERWORLD_COLS - 1, Math.floor(x / SCREEN_W)));
  const cy = Math.max(0, Math.min(OVERWORLD_ROWS - 1, Math.floor(y / SCREEN_H)));
  const names: OverworldChunkName[][] = [
    ["whisperpine", "meadow", "cragmaw"],
    ["willowmere", "hearthside", "brambleford"],
  ];
  const chunk = names[cy][cx];
  return {
    chunk,
    localX: x - cx * SCREEN_W,
    localY: y - cy * SCREEN_H,
  };
}

// ── Portals (Non-adjacent Connections) ──────────────────────────────────────

export interface Portal {
  id: string;
  fromChunk: string;
  fromTile: { x: number; y: number };
  toChunk: string;
  toTile: { x: number; y: number };
  cost: number;
  /** False for dungeon mouths (classic Zelda leashing: AI gives up at entrance), true where chase continues. */
  traversableByAI: boolean;
}

export const DEFAULT_PORTALS: Portal[] = [
  {
    id: "cragmaw_dungeon_entry",
    fromChunk: "cragmaw",
    fromTile: { x: 8, y: 0 }, // Cragmaw local (8,0) = overworld unified (40,0)
    toChunk: "dungeon",
    toTile: { x: 8, y: 21 },  // Dungeon entrance hall
    cost: 1.5,
    traversableByAI: false, // monsters don't follow through dungeon entrances by default
  },
  {
    id: "dungeon_cragmaw_exit",
    fromChunk: "dungeon",
    fromTile: { x: 8, y: 22 }, // Dungeon exit stairs
    toChunk: "cragmaw",
    toTile: { x: 8, y: 1 },    // Overworld return point (40, 1)
    cost: 1.5,
    traversableByAI: false,
  },
];

let activePortals: Portal[] = DEFAULT_PORTALS.map((p) => ({ ...p }));

export function getPortals(): Portal[] {
  return activePortals;
}

export function registerPortal(portal: Portal): void {
  activePortals = activePortals.filter((p) => p.id !== portal.id);
  activePortals.push(portal);
}

export function setPortalAITraversable(id: string, traversable: boolean): void {
  const p = activePortals.find((item) => item.id === id);
  if (p) p.traversableByAI = traversable;
}

export function resetPortals(): void {
  activePortals = DEFAULT_PORTALS.map((p) => ({ ...p }));
}

// ── A* Navigation ───────────────────────────────────────────────────────────

/** Body footprint in tiles: 1 → tile-centre nodes, 2 → tile-corner nodes. */
export type NavSize = 1 | 2;

const off = (size: NavSize) => (size === 1 ? 0.5 : 1);

export function nodeFree(nav: Nav, size: NavSize, i: number, j: number): boolean {
  if (size === 1) return !navSolid(nav, i, j);
  return !navSolid(nav, i, j) && !navSolid(nav, i + 1, j) && !navSolid(nav, i, j + 1) && !navSolid(nav, i + 1, j + 1);
}

/** The free node nearest to a world position on a map (searching small neighbourhood). */
function nearestNodeOnMap(nav: Nav, size: NavSize, x: number, y: number): { tx: number; ty: number } | null {
  const o = off(size);
  const ci = Math.round(x - o), cj = Math.round(y - o);
  let bestX = -1, bestY = -1, bestD = Infinity;
  for (let rad = 0; rad <= 3 && bestX < 0; rad++) {
    for (let j = cj - rad; j <= cj + rad; j++) {
      for (let i = ci - rad; i <= ci + rad; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== rad) continue;
        if (i < 0 || j < 0 || i >= nav.w || j >= nav.h || !nodeFree(nav, size, i, j)) continue;
        const d = (i + o - x) ** 2 + (j + o - y) ** 2;
        if (d < bestD) { bestD = d; bestX = i; bestY = j; }
      }
    }
  }
  return bestX >= 0 ? { tx: bestX, ty: bestY } : null;
}

function nearestNode(nav: Nav, size: NavSize, x: number, y: number): number {
  const n = nearestNodeOnMap(nav, size, x, y);
  return n ? n.ty * nav.w + n.tx : -1;
}

/** Binary min-heap of node IDs keyed by f-score. */
class Heap {
  ids: number[] = [];
  keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

export interface PathWaypoint {
  map: MapId;
  x: number;
  y: number;
}

export interface PathResult {
  /** Waypoints [x0, y0, x1, y1, …] on the start map (up to goal or first portal). */
  pts: number[];
  /** Complete waypoints with map metadata across all traversed maps. */
  nodes?: PathWaypoint[];
  /** True if the route ends at the goal; false if it ends as close as it can get. */
  ok: boolean;
  /** Whether the path traverses one or more portals. */
  crossesPortal?: boolean;
}

export interface PathOptions {
  isAI?: boolean;
  startMap?: MapId;
  goalMap?: MapId;
  allNav?: Record<MapId, Nav>;
  portals?: Portal[];
  maxExpansions?: number;
}

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
] as const;

function octileDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

// Global node encoding across multiple maps:
// Map "over" (48 x 24 = 1152 nodes): 0 .. 1151
// Map "dungeon" (16 x 23 = 368 nodes): 1152 .. 1519
const OVER_NODE_COUNT = OVERWORLD_W * OVERWORLD_H; // 1152
const DUNGEON_W = 16;
const DUNGEON_H = 23;
const TOTAL_GLOBAL_NODES = OVER_NODE_COUNT + DUNGEON_W * DUNGEON_H; // 1520

function encodeGlobalNode(map: MapId, tx: number, ty: number): number {
  if (map === "over") return ty * OVERWORLD_W + tx;
  return OVER_NODE_COUNT + ty * DUNGEON_W + tx;
}

function decodeGlobalNode(id: number): { map: MapId; tx: number; ty: number } {
  if (id < OVER_NODE_COUNT) {
    const tx = id % OVERWORLD_W;
    const ty = Math.floor(id / OVERWORLD_W);
    return { map: "over", tx, ty };
  }
  const rem = id - OVER_NODE_COUNT;
  const tx = rem % DUNGEON_W;
  const ty = Math.floor(rem / DUNGEON_W);
  return { map: "dungeon", tx, ty };
}

/**
 * Full multi-map A* with stitched 3x2 overworld chunks and data-driven portals.
 * Respects traversableByAI flag per portal.
 */
export function findPathGlobal(
  allNav: Record<MapId, Nav>,
  size: NavSize,
  startMap: MapId,
  sx: number,
  sy: number,
  goalMap: MapId,
  gx: number,
  gy: number,
  options?: PathOptions
): PathResult {
  const isAI = options?.isAI ?? true;
  const portals = options?.portals ?? getPortals();
  const maxExpansions = options?.maxExpansions ?? 1200;
  const o = off(size);

  const startNav = allNav[startMap];
  const goalNav = allNav[goalMap];
  if (!startNav || !goalNav) return { pts: [], ok: false };

  const startCoord = nearestNodeOnMap(startNav, size, sx, sy);
  if (!startCoord) return { pts: [], ok: false };
  const startId = encodeGlobalNode(startMap, startCoord.tx, startCoord.ty);

  const goalCoord = nearestNodeOnMap(goalNav, size, gx, gy);
  const goalId = goalCoord ? encodeGlobalNode(goalMap, goalCoord.tx, goalCoord.ty) : -1;

  // Build resolved portal lookup
  interface ResolvedPortalEdge {
    toId: number;
    cost: number;
    toMap: MapId;
    toX: number;
    toY: number;
    traversableByAI: boolean;
  }
  const portalEdges = new Map<number, ResolvedPortalEdge[]>();
  const validCrossPortals: { fromMap: MapId; fromX: number; fromY: number; toMap: MapId; toX: number; toY: number; cost: number }[] = [];

  for (const p of portals) {
    const from = chunkToUnified(p.fromChunk, p.fromTile.x, p.fromTile.y);
    const to = chunkToUnified(p.toChunk, p.toTile.x, p.toTile.y);
    if (!allNav[from.map] || !allNav[to.map]) continue;
    const fromId = encodeGlobalNode(from.map, from.x, from.y);
    const toId = encodeGlobalNode(to.map, to.x, to.y);
    const edge: ResolvedPortalEdge = {
      toId,
      cost: p.cost,
      toMap: to.map,
      toX: to.x,
      toY: to.y,
      traversableByAI: p.traversableByAI,
    };
    if (!portalEdges.has(fromId)) portalEdges.set(fromId, []);
    portalEdges.get(fromId)!.push(edge);

    if (!isAI || p.traversableByAI) {
      validCrossPortals.push({
        fromMap: from.map,
        fromX: from.x + o,
        fromY: from.y + o,
        toMap: to.map,
        toX: to.x + o,
        toY: to.y + o,
        cost: p.cost,
      });
    }
  }

  // Admissible heuristic across maps & portals
  const h = (id: number): number => {
    const { map: m, tx, ty } = decodeGlobalNode(id);
    const wx = tx + o, wy = ty + o;
    if (m === goalMap) {
      return octileDist(wx, wy, gx, gy);
    }
    // Cross-map: estimate via valid portals
    let minH = Infinity;
    for (const cp of validCrossPortals) {
      if (cp.fromMap === m && cp.toMap === goalMap) {
        const est = octileDist(wx, wy, cp.fromX, cp.fromY) + cp.cost + octileDist(cp.toX, cp.toY, gx, gy);
        if (est < minH) minH = est;
      }
    }
    if (minH !== Infinity) return minH;
    // For AI when cross-portal into goalMap is not traversable (dungeon leashing):
    // Fall back to guiding toward the portal entrance on this map.
    for (const p of portals) {
      const from = chunkToUnified(p.fromChunk, p.fromTile.x, p.fromTile.y);
      if (from.map === m) {
        const est = octileDist(wx, wy, from.x + o, from.y + o) + 10;
        if (est < minH) minH = est;
      }
    }
    return minH !== Infinity ? minH : 9999;
  };

  const N = TOTAL_GLOBAL_NODES;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap();

  g[startId] = 0;
  heap.push(startId, h(startId));
  let best = startId, bestH = h(startId);
  let expansions = 0;

  while (heap.size > 0 && expansions++ < maxExpansions) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;

    if (cur === goalId) {
      best = cur;
      bestH = 0;
      break;
    }
    const hc = h(cur);
    if (hc < bestH) {
      bestH = hc;
      best = cur;
    }

    const { map: curMap, tx: ci, ty: cj } = decodeGlobalNode(cur);
    const curNav = allNav[curMap];
    const W = curNav.w;

    // 1. Standard 8-way adjacent neighbors on the current map
    for (const [di, dj, cost] of DIRS) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= curNav.h) continue;
      const nb = encodeGlobalNode(curMap, ni, nj);
      if (closed[nb] || !nodeFree(curNav, size, ni, nj)) continue;
      // Diagonals only when both orthogonal neighbours are open (no corner clipping)
      if (di !== 0 && dj !== 0 && (!nodeFree(curNav, size, ci + di, cj) || !nodeFree(curNav, size, ci, cj + dj))) continue;

      const ng = g[cur] + cost;
      if (ng < g[nb]) {
        g[nb] = ng;
        came[nb] = cur;
        heap.push(nb, ng + h(nb));
      }
    }

    // 2. Portal transitions (cross-chunk / cross-map edges)
    const pEdges = portalEdges.get(cur);
    if (pEdges) {
      for (const edge of pEdges) {
        if (isAI && !edge.traversableByAI) continue; // classic Zelda leashing at entrance
        const destNav = allNav[edge.toMap];
        if (!destNav || !nodeFree(destNav, size, edge.toX, edge.toY)) continue;
        const nb = edge.toId;
        if (closed[nb]) continue;
        const ng = g[cur] + edge.cost;
        if (ng < g[nb]) {
          g[nb] = ng;
          came[nb] = cur;
          heap.push(nb, ng + h(nb));
        }
      }
    }
  }

  // Reconstruct path
  const rev: number[] = [];
  for (let n = best; n !== -1 && n !== startId; n = came[n]) rev.push(n);

  const fullNodes: PathWaypoint[] = [];
  const startMapPts: number[] = [];
  let crossed = false;

  for (let k = rev.length - 1; k >= 0; k--) {
    const id = rev[k];
    const { map: m, tx, ty } = decodeGlobalNode(id);
    const wx = tx + o, wy = ty + o;
    fullNodes.push({ map: m, x: wx, y: wy });
    if (m === startMap && !crossed) {
      startMapPts.push(wx, wy);
    } else {
      crossed = true;
    }
  }

  const { map: bestMap, tx: bx, ty: by } = decodeGlobalNode(best);
  const reachX = bx + o, reachY = by + o;
  const ok = best === goalId && bestMap === goalMap && Math.hypot(reachX - gx, reachY - gy) <= (size === 1 ? 0.75 : 1.1);

  return {
    pts: startMapPts,
    nodes: fullNodes,
    ok,
    crossesPortal: crossed,
  };
}

/**
 * 8-way A* over a Nav grid. Compatible with original signature.
 * When options are omitted, searches within the single map Nav.
 */
export function findPath(
  nav: Nav,
  size: NavSize,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  options?: PathOptions
): PathResult {
  // If multi-map navigation options provided:
  if (options?.allNav && options.goalMap && options.startMap && (options.startMap !== options.goalMap || options.portals)) {
    return findPathGlobal(options.allNav, size, options.startMap, sx, sy, options.goalMap, gx, gy, options);
  }

  const W = nav.w, N = nav.w * nav.h;
  const o = off(size);
  const start = nearestNode(nav, size, sx, sy);
  if (start < 0) return { pts: [], ok: false };
  const goal = nearestNode(nav, size, gx, gy);

  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap();
  const h = (n: number) => {
    const dx = Math.abs((n % W) + o - gx), dy = Math.abs(Math.floor(n / W) + o - gy);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy); // octile
  };

  g[start] = 0;
  heap.push(start, h(start));
  let best = start, bestH = h(start);
  let expansions = 0;
  const maxExpansions = options?.maxExpansions ?? 1000;

  while (heap.size > 0 && expansions++ < maxExpansions) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) { best = cur; bestH = 0; break; }
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    const ci = cur % W, cj = (cur - ci) / W;
    for (const [di, dj, cost] of DIRS) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= nav.h) continue;
      const nb = nj * W + ni;
      if (closed[nb] || !nodeFree(nav, size, ni, nj)) continue;
      // Diagonals only when both orthogonal neighbours are open: no corner clipping.
      if (di !== 0 && dj !== 0 && (!nodeFree(nav, size, ci + di, cj) || !nodeFree(nav, size, ci, cj + dj))) continue;
      const ng = g[cur] + cost;
      if (ng < g[nb]) {
        g[nb] = ng;
        came[nb] = cur;
        heap.push(nb, ng + h(nb));
      }
    }
  }

  const rev: number[] = [];
  for (let n = best; n !== -1 && n !== start; n = came[n]) rev.push(n);
  const pts: number[] = [];
  for (let k = rev.length - 1; k >= 0; k--) {
    const n = rev[k];
    pts.push((n % W) + o, Math.floor(n / W) + o);
  }
  const bx = (best % W) + o, by = Math.floor(best / W) + o;
  const ok = best === goal && Math.hypot(bx - gx, by - gy) <= (size === 1 ? 0.75 : 1.1);
  return { pts, ok };
}

// ── Graceful No-Path Fallback & Wall Sliding ─────────────────────────────────

/**
 * Computes a smoothed slide velocity when pressing against walls, eliminating
 * vibration and jitter. Deflects movement along open wall tangents.
 */
export function wallSlideVector(
  nav: Nav,
  x: number,
  y: number,
  vx: number,
  vy: number,
  r: number
): [number, number] {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-4) return [0, 0];

  const dt = 1 / 60;
  const testDist = Math.max(0.08, speed * dt * 1.5);
  const nx = vx / speed, ny = vy / speed;

  // Use small tolerance so bodies resting against a wall can slide along it
  const rr = Math.max(0.05, r - 0.04);

  // Direct probe forward
  const blockedForward = circleBlocked(nav, x + nx * testDist, y + ny * testDist, rr);
  if (!blockedForward) return [vx, vy];

  // Test purely horizontal and purely vertical components
  const canMoveX = !circleBlocked(nav, x + Math.sign(vx) * testDist, y, rr);
  const canMoveY = !circleBlocked(nav, x, y + Math.sign(vy) * testDist, rr);

  if (canMoveX && !canMoveY) {
    // Slide horizontally along the wall
    return [Math.sign(vx) * speed * 0.95, 0];
  }
  if (canMoveY && !canMoveX) {
    // Slide vertically along the wall
    return [0, Math.sign(vy) * speed * 0.95];
  }

  // If both blocked (corner): try 45-degree tangent deflections
  const leftAngle = Math.atan2(ny, nx) + Math.PI / 3;
  const rightAngle = Math.atan2(ny, nx) - Math.PI / 3;
  const lx = Math.cos(leftAngle), ly = Math.sin(leftAngle);
  const rx = Math.cos(rightAngle), ry = Math.sin(rightAngle);

  const canLeft = !circleBlocked(nav, x + lx * testDist, y + ly * testDist, rr);
  const canRight = !circleBlocked(nav, x + rx * testDist, y + ry * testDist, rr);

  if (canLeft && !canRight) return [lx * speed * 0.75, ly * speed * 0.75];
  if (canRight && !canLeft) return [rx * speed * 0.75, ry * speed * 0.75];

  // Completely boxed in or facing flat wall: zero out to prevent vibration
  return [0, 0];
}

/**
 * When target is unreachable, returns a standoff target at the closest
 * reachable node so the enemy holds or paces cleanly without driving into the wall.
 */
export function getStandoffPoint(
  nav: Nav,
  ex: number,
  ey: number,
  targetX: number,
  targetY: number,
  r: number
): { x: number; y: number } {
  const dx = targetX - ex, dy = targetY - ey;
  const d = Math.hypot(dx, dy);
  if (d < 1e-4) return { x: ex, y: ey };

  // Check if standing 0.3 units back from the obstacle is clear
  const backStep = 0.35 + r;
  const sx = targetX - (dx / d) * backStep;
  const sy = targetY - (dy / d) * backStep;
  if (!circleBlocked(nav, sx, sy, r)) {
    return { x: sx, y: sy };
  }
  return { x: ex, y: ey };
}

// ── Per-Tick Pathfinding Budget Scheduler ───────────────────────────────────

export interface QueuedPathRequest {
  id: number;
  size: NavSize;
  startMap: MapId;
  sx: number;
  sy: number;
  goalMap: MapId;
  gx: number;
  gy: number;
  isAI: boolean;
  priority: number;
  callback: (res: PathResult) => void;
}

export class PathScheduler {
  private budget = 3; // Maximum A* searches executed per tick
  private queue: QueuedPathRequest[] = [];
  private executedThisTick = 0;

  get maxSearchesPerTick(): number {
    return this.budget;
  }

  set maxSearchesPerTick(val: number) {
    this.budget = Math.max(1, val);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  resetTick(): void {
    this.executedThisTick = 0;
  }

  /**
   * Request a path calculation. If budget allows this tick, executes immediately
   * and returns the PathResult. Otherwise queues it and returns null.
   */
  requestPath(
    allNav: Record<MapId, Nav>,
    req: {
      id: number;
      size: NavSize;
      startMap: MapId;
      sx: number;
      sy: number;
      goalMap: MapId;
      gx: number;
      gy: number;
      isAI?: boolean;
      priority?: number;
      callback: (res: PathResult) => void;
    }
  ): PathResult | null {
    const isAI = req.isAI ?? true;
    const priority = req.priority ?? 0;

    if (this.executedThisTick < this.budget) {
      this.executedThisTick++;
      const res = findPathGlobal(allNav, req.size, req.startMap, req.sx, req.sy, req.goalMap, req.gx, req.gy, {
        isAI,
      });
      req.callback(res);
      return res;
    }

    // Budget exceeded this tick: enqueue with priority
    this.queue = this.queue.filter((q) => q.id !== req.id);
    this.queue.push({
      id: req.id,
      size: req.size,
      startMap: req.startMap,
      sx: req.sx,
      sy: req.sy,
      goalMap: req.goalMap,
      gx: req.gx,
      gy: req.gy,
      isAI,
      priority,
      callback: req.callback,
    });
    this.queue.sort((a, b) => b.priority - a.priority);
    return null;
  }

  /** Process queued path searches up to the per-tick budget. */
  tick(allNav: Record<MapId, Nav>): void {
    this.resetTick();
    while (this.queue.length > 0 && this.executedThisTick < this.budget) {
      const req = this.queue.shift()!;
      this.executedThisTick++;
      const res = findPathGlobal(allNav, req.size, req.startMap, req.sx, req.sy, req.goalMap, req.gx, req.gy, {
        isAI: req.isAI,
      });
      req.callback(res);
    }
  }

  cancel(id: number): void {
    this.queue = this.queue.filter((q) => q.id !== id);
  }

  clear(): void {
    this.queue = [];
    this.executedThisTick = 0;
  }
}

export const pathScheduler = new PathScheduler();
