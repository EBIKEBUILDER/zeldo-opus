// ─────────────────────────────────────────────────────────────────────────────
//  Navigation: grid A* + line-of-walk checks for monsters. Pure functions over
//  a solidity grid, no Babylon, no React, no randomness (fully deterministic).
//
//  Body size matters. A small gloob (r ≈ 0.36) fits through any 1-tile gap, so
//  its nodes are tile centres. The King (r ≈ 0.85) needs a 2×2 clear block, so
//  his nodes sit on tile *corners*, each one requiring the four tiles around it
//  to be open. That way his routes never try to squeeze him through a gap he
//  can't fit, and "can the King reach the hero?" falls out of the same search.
// ─────────────────────────────────────────────────────────────────────────────

/** Tile solidity snapshot for one map (1 = blocked). Out of bounds is solid. */
export interface Nav {
  w: number;
  h: number;
  solid: Uint8Array;
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

// ── A* ──────────────────────────────────────────────────────────────────────

/** Body footprint in tiles: 1 → tile-centre nodes, 2 → tile-corner nodes. */
export type NavSize = 1 | 2;

function nodeFree(nav: Nav, size: NavSize, i: number, j: number): boolean {
  if (size === 1) return !navSolid(nav, i, j);
  return !navSolid(nav, i, j) && !navSolid(nav, i + 1, j) && !navSolid(nav, i, j + 1) && !navSolid(nav, i + 1, j + 1);
}

const off = (size: NavSize) => (size === 1 ? 0.5 : 1);

/** The free node nearest to a world position (searching a small neighbourhood). */
function nearestNode(nav: Nav, size: NavSize, x: number, y: number): number {
  const o = off(size);
  const ci = Math.round(x - o), cj = Math.round(y - o);
  let best = -1, bestD = Infinity;
  for (let rad = 0; rad <= 2 && best < 0; rad++) {
    for (let j = cj - rad; j <= cj + rad; j++) {
      for (let i = ci - rad; i <= ci + rad; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== rad) continue;
        if (i < 0 || j < 0 || i >= nav.w || j >= nav.h || !nodeFree(nav, size, i, j)) continue;
        const d = (i + o - x) ** 2 + (j + o - y) ** 2;
        if (d < bestD) { bestD = d; best = j * nav.w + i; }
      }
    }
  }
  return best;
}

/** Minimal binary min-heap of node ids keyed by f-score. */
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

export interface PathResult {
  /** Waypoints [x0, y0, x1, y1, …] from (just after) the start to the end. */
  pts: number[];
  /** True if the route ends at the goal; false if it ends as close as it can get. */
  ok: boolean;
}

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
] as const;

/**
 * 8-way A* (no corner cutting) from (sx, sy) toward (gx, gy). If the goal can't
 * be reached, returns the route to the reachable node closest to it.
 */
export function findPath(nav: Nav, size: NavSize, sx: number, sy: number, gx: number, gy: number): PathResult {
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
  while (heap.size > 0) {
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
  // "Reached" means the last node really sits on the goal, not merely the nearest
  // free node to it (which may be on the far side of a gate or a pillar).
  const bx = (best % W) + o, by = Math.floor(best / W) + o;
  const ok = best === goal && Math.hypot(bx - gx, by - gy) <= (size === 1 ? 0.75 : 1.1);
  return { pts, ok };
}
