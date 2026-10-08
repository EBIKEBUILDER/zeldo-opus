// Rendering helpers shared by the Babylon view layer.
import {
  Color3, Color4, Matrix, Mesh, Quaternion, Scene, StandardMaterial, Vector3, VertexBuffer,
} from "@babylonjs/core";

/** Sim (x right, y down) → Babylon (x right, y up, z forward/north). */
export function toB(x: number, y: number, h = 0, out?: Vector3): Vector3 {
  if (out) { out.set(x, h, -y); return out; }
  return new Vector3(x, h, -y);
}

/**
 * Sim facing angle → Babylon yaw for a model whose "front" is local +Z.
 * Babylon's RotationY maps +Z to (sin a, cos a); a sim direction (cos θ, sin θ)
 * lands in world as (cos θ, −sin θ) on XZ, so a = θ + π/2.
 */
export function yawOf(simAngle: number): number {
  return simAngle + Math.PI / 2;
}

export const hex = (h: string) => Color3.FromHexString(h);

export class Rng {
  s: number;
  constructor(seed: number) { this.s = seed | 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
}

/** Stable pseudo-random value for a tile coordinate. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function makeMat(scene: Scene, name: string, color: Color3, opts: { emissive?: Color3; spec?: number; alpha?: number; unlit?: boolean; twoSided?: boolean } = {}) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(opts.spec ?? 0.04, opts.spec ?? 0.04, opts.spec ?? 0.04);
  if (opts.emissive) m.emissiveColor = opts.emissive;
  if (opts.alpha !== undefined) m.alpha = opts.alpha;
  if (opts.unlit) m.disableLighting = true;
  if (opts.twoSided) { m.backFaceCulling = false; m.twoSidedLighting = true; }
  m.maxSimultaneousLights = 6;
  return m;
}

export function colorize(mesh: Mesh, c: Color3 | ((x: number, y: number, z: number, ny: number) => Color3)): Mesh {
  const n = mesh.getTotalVertices();
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  const cols = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const col = typeof c === "function" ? c(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nrm ? nrm[i * 3 + 1] : 0) : c;
    cols[i * 4] = col.r; cols[i * 4 + 1] = col.g; cols[i * 4 + 2] = col.b; cols[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, cols);
  return mesh;
}

/** Offsets vertices by a hash of their position so shared corners stay welded. */
export function jitter(mesh: Mesh, amount: number, seed: number, yScale = 1) {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) {
    const kx = Math.round(pos[i] * 1000), ky = Math.round(pos[i + 1] * 1000), kz = Math.round(pos[i + 2] * 1000);
    const h1 = hash2(kx + ky * 7, kz, seed), h2 = hash2(ky, kz + kx * 3, seed + 1), h3 = hash2(kz, kx - ky, seed + 2);
    pos[i] += (h1 - 0.5) * 2 * amount;
    pos[i + 1] += (h2 - 0.5) * 2 * amount * yScale;
    pos[i + 2] += (h3 - 0.5) * 2 * amount;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, pos);
}

/** Per-triangle brightness variation (call after flat shading). */
export function faceShade(mesh: Mesh, amount: number, seed: number) {
  const cols = mesh.getVerticesData(VertexBuffer.ColorKind);
  const idx = mesh.getIndices();
  if (!cols || !idx) return;
  for (let t = 0; t < idx.length; t += 3) {
    const f = 1 + (hash2(t, seed, 9) - 0.5) * 2 * amount;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k] * 4;
      cols[v] = Math.min(1, cols[v] * f); cols[v + 1] = Math.min(1, cols[v + 1] * f); cols[v + 2] = Math.min(1, cols[v + 2] * f);
    }
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, cols);
}

export function merge(name: string, parts: Mesh[], mat: StandardMaterial, shade = 0.06, seed = 1): Mesh {
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.name = name;
  m.convertToFlatShadedMesh();
  if (shade > 0) faceShade(m, shade, seed);
  m.material = mat;
  return m;
}

const tmpS = new Vector3(), tmpT = new Vector3(), tmpQ = new Quaternion(), tmpM = new Matrix();

export interface Placement {
  x: number; y: number; h?: number;
  sx: number; sy: number; sz: number;
  rx?: number; ry: number; rz?: number;
}

/** Bakes placements into a thin-instance matrix buffer on `mesh`. */
export function setThinInstances(mesh: Mesh, list: Placement[]) {
  if (list.length === 0) { mesh.setEnabled(false); return; }
  const buf = new Float32Array(list.length * 16);
  list.forEach((p, i) => {
    tmpS.set(p.sx, p.sy, p.sz);
    Quaternion.RotationYawPitchRollToRef(p.ry, p.rx ?? 0, p.rz ?? 0, tmpQ);
    toB(p.x, p.y, p.h ?? 0, tmpT);
    Matrix.ComposeToRef(tmpS, tmpQ, tmpT, tmpM);
    tmpM.copyToArray(buf, i * 16);
  });
  mesh.thinInstanceSetBuffer("matrix", buf, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
}

export function c4(c: Color3, a = 1) {
  return new Color4(c.r, c.g, c.b, a);
}

export function lerpColor(a: Color3, b: Color3, t: number) {
  return Color3.Lerp(a, b, t);
}
