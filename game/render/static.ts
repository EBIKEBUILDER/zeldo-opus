// Builds every static mesh for both maps: terrain, water, foliage, props,
// the cottage, the barrow arch, and the dungeon's rooms. Runs once at load.
import {
  Color3, Mesh, MeshBuilder, PointLight, Scene, StandardMaterial, TransformNode, Vector3, VertexData,
} from "@babylonjs/core";
import {
  MAPS, ParsedMap, SCREEN_W, SCREEN_H, KEY_PEDESTAL, CHEST_POS, GATE_ROW,
} from "../maps";
import {
  Lib, PAL, decoGrass, flower, hedge, keyMesh, lanternPost, leafyTree, pineTree, rock, signpost,
} from "./models";
import { colorize, hash2, hex, makeMat, merge, Placement, setThinInstances, toB } from "./util";

// ── Palette per overworld screen ────────────────────────────────────────────
const AREA_GRASS = [
  [hex("#5f9e5a"), hex("#a6cf6a"), hex("#9aa875")],
  [hex("#79c08a"), hex("#8cc96b"), hex("#86c25f")],
];
const LEAFY_CHANCE = [
  [0.12, 0.45, 0.2],
  [0.65, 0.5, 0.35],
];
const PATH = hex("#e3c08d");
const BANK = hex("#8a6a4a");
const WATER_BED = hex("#2b6f8f");

function areaIndex(x: number, y: number) {
  const sx = Math.min(2, Math.max(0, Math.floor(x / SCREEN_W)));
  const sy = Math.min(1, Math.max(0, Math.floor(y / SCREEN_H)));
  return [sx, sy] as const;
}

/** Grass colour softly blended across screen borders. */
function grassAt(x: number, y: number): Color3 {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const [sx, sy] = areaIndex(x + dx, y + dy);
      const c = AREA_GRASS[sy][sx];
      r += c.r; g += c.g; b += c.b; n++;
    }
  }
  const j = 0.97 + hash2(x, y, 3) * 0.05;
  const chk = (x + y) % 2 === 0 ? 1 : 0.988;
  return new Color3((r / n) * j * chk, (g / n) * j * chk, (b / n) * j * chk);
}

// ── Generic tiled terrain mesh ──────────────────────────────────────────────
interface GroundTile { h: number; color: Color3; bank: Color3 }

class MeshAcc {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** Adds a quad facing `normal` (winding fixed up to match Babylon's convention). */
  quad(p: Vector3[], c: Color3 | Color3[], normal: Vector3) {
    const e1 = p[1].subtract(p[0]), e2 = p[2].subtract(p[0]);
    // Babylon front faces satisfy cross(c − a, b − a) · n > 0.
    const n = Vector3.Cross(e2, e1);
    const pts = Vector3.Dot(n, normal) >= 0 ? p : [p[0], p[3], p[2], p[1]];
    const cols = Array.isArray(c) ? (Vector3.Dot(n, normal) >= 0 ? c : [c[0], c[3], c[2], c[1]]) : [c, c, c, c];
    const v = this.pos.length / 3;
    pts.forEach((q, i) => {
      this.pos.push(q.x, q.y, q.z);
      this.col.push(cols[i].r, cols[i].g, cols[i].b, 1);
    });
    this.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  build(name: string, scene: Scene, mat: StandardMaterial): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.indices = this.idx;
    vd.colors = this.col;
    const nrm: number[] = [];
    VertexData.ComputeNormals(this.pos, this.idx, nrm);
    vd.normals = nrm;
    vd.uvs = new Array((this.pos.length / 3) * 2).fill(0); // keeps attributes mergeable with builder meshes
    vd.applyToMesh(m);
    m.material = mat;
    return m;
  }
}

function buildGround(name: string, scene: Scene, mat: StandardMaterial, x0: number, y0: number, x1: number, y1: number,
  get: (x: number, y: number) => GroundTile | null): Mesh {
  const acc = new MeshAcc();
  const up = new Vector3(0, 1, 0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const t = get(x, y);
      if (!t) continue;
      const X0 = x, X1 = x + 1, Z0 = -y - 1, Z1 = -y; // tile row y spans z ∈ [-(y+1), -y]
      acc.quad([new Vector3(X0, t.h, Z0), new Vector3(X1, t.h, Z0), new Vector3(X1, t.h, Z1), new Vector3(X0, t.h, Z1)], t.color, up);
      const sides: [number, number, Vector3[], Vector3][] = [
        [0, -1, [new Vector3(X0, 0, Z1), new Vector3(X1, 0, Z1)], new Vector3(0, 0, 1)],
        [0, 1, [new Vector3(X1, 0, Z0), new Vector3(X0, 0, Z0)], new Vector3(0, 0, -1)],
        [-1, 0, [new Vector3(X0, 0, Z0), new Vector3(X0, 0, Z1)], new Vector3(-1, 0, 0)],
        [1, 0, [new Vector3(X1, 0, Z1), new Vector3(X1, 0, Z0)], new Vector3(1, 0, 0)],
      ];
      for (const [dx, dy, [a, b], n] of sides) {
        const nt = get(x + dx, y + dy);
        if (!nt || nt.h >= t.h - 0.001) continue;
        const top = t.bank, bot = t.bank.scale(0.6);
        acc.quad([
          new Vector3(a.x, t.h, a.z), new Vector3(b.x, t.h, b.z), new Vector3(b.x, nt.h, b.z), new Vector3(a.x, nt.h, a.z),
        ], [top, top, bot, bot], n);
      }
    }
  }
  const m = acc.build(name, scene, mat);
  m.receiveShadows = true;
  return m;
}

// ── Output handle ───────────────────────────────────────────────────────────
export interface StaticWorld {
  overRoot: TransformNode;
  dungeonRoot: TransformNode;
  casters: Mesh[];
  water: Mesh;
  waterMat: StandardMaterial;
  glints: Mesh;
  torchFlames: { outer: Mesh; inner: Mesh; pos: Vector3; seed: number }[];
  torchLights: PointLight[];
  gate: TransformNode;
  chestLid: TransformNode;
  chestSeal: Mesh;
  key: Mesh;
  chimney: Vector3;
  lampMat: StandardMaterial;
}

export function buildStatic(scene: Scene, lib: Lib): StaticWorld {
  const overRoot = new TransformNode("overRoot", scene);
  const dungeonRoot = new TransformNode("dungeonRoot", scene);
  const casters: Mesh[] = [];
  const over = MAPS.over;

  // ── Overworld terrain ──
  const W = over.w, H = over.h;
  const BX0 = -11, BX1 = W + 11, BY0 = -13, BY1 = H + 9;
  const borderChar = (x: number, y: number) => over.tiles[Math.min(H - 1, Math.max(0, y))][Math.min(W - 1, Math.max(0, x))];
  const charAt = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) return over.tiles[y][x];
    const c = borderChar(x, y);
    if (c === "~") return Math.abs(x - Math.min(W - 1, Math.max(0, x))) + Math.abs(y - Math.min(H - 1, Math.max(0, y))) < 9 ? "~" : "B";
    return c === "^" || c === "R" || c === "D" ? "C" : "B"; // C = border cliff, B = border forest
  };
  const ground = buildGround("overGround", scene, lib.vc, BX0, BY0, BX1, BY1, (x, y) => {
    if (x < BX0 || y < BY0 || x >= BX1 || y >= BY1) return null;
    const c = charAt(x, y);
    const g = grassAt(x, y);
    switch (c) {
      case "~": case "=": return { h: -0.42, color: WATER_BED.scale(0.9 + hash2(x, y) * 0.15), bank: BANK };
      case ":": return { h: 0, color: PATH.scale(0.95 + hash2(x, y, 1) * 0.08), bank: BANK };
      case "D": return { h: 0, color: hex("#5a4a3c"), bank: BANK };
      case ",": return { h: 0, color: Color3.Lerp(g, hex("#c8e88a"), 0.12), bank: BANK };
      case "^": case "C": return { h: 0, color: Color3.Lerp(g, hex("#857f72"), 0.6), bank: BANK };
      case "B": return { h: 0, color: g.scale(0.72), bank: BANK };
      case "#": return { h: 0, color: g.scale(0.8), bank: BANK };
      default: return { h: 0, color: g, bank: BANK };
    }
  });
  ground.parent = overRoot;

  // Water surface
  const wAcc = new MeshAcc();
  const up = new Vector3(0, 1, 0);
  for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) {
    const c = charAt(x, y);
    if (c !== "~" && c !== "=") continue;
    wAcc.quad([new Vector3(x, -0.13, -y - 1), new Vector3(x + 1, -0.13, -y - 1), new Vector3(x + 1, -0.13, -y), new Vector3(x, -0.13, -y)], new Color3(1, 1, 1), up);
  }
  const waterMat = makeMat(scene, "water", hex("#2f8fc0"), { spec: 0.35, alpha: 0.86 });
  waterMat.specularPower = 40;
  waterMat.emissiveColor = hex("#06202e");
  const water = wAcc.build("water", scene, waterMat);
  water.parent = overRoot;
  water.receiveShadows = true;

  // Glints & lily pads
  const glintMaster = MeshBuilder.CreatePolyhedron("glint", { type: 1, size: 0.06 }, scene);
  glintMaster.scaling.set(1.8, 0.1, 0.6);
  glintMaster.bakeCurrentTransformIntoVertices();
  glintMaster.material = makeMat(scene, "glintMat", hex("#ffffff"), { emissive: hex("#d8f6ff"), unlit: true });
  glintMaster.parent = overRoot;
  const glintP: Placement[] = [];
  const padMaster = MeshBuilder.CreateCylinder("pad", { height: 0.02, diameter: 0.42, tessellation: 7 }, scene);
  colorize(padMaster, hex("#4f9a3e"));
  padMaster.convertToFlatShadedMesh();
  padMaster.material = lib.vc;
  padMaster.parent = overRoot;
  const padP: Placement[] = [];
  const blossomMaster = flower(scene, lib, hex("#ffb3c8"), 99);
  blossomMaster.parent = overRoot;
  const blossomP: Placement[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (over.tiles[y][x] !== "~") continue;
    if (hash2(x, y, 40) < 0.3) glintP.push({ x: x + hash2(x, y, 41), y: y + hash2(x, y, 42), h: -0.11, sx: 1, sy: 1, sz: 1, ry: hash2(x, y, 43) * 0.6 });
    const [sx, sy] = areaIndex(x, y);
    if (sx === 0 && sy === 1 && hash2(x, y, 44) < 0.3) {
      const px = x + 0.2 + hash2(x, y, 45) * 0.6, py = y + 0.2 + hash2(x, y, 46) * 0.6;
      padP.push({ x: px, y: py, h: -0.12, sx: 1, sy: 1, sz: 1, ry: hash2(x, y, 47) * 6 });
      if (hash2(x, y, 48) < 0.4) blossomP.push({ x: px, y: py, h: -0.2, sx: 1.4, sy: 1, sz: 1.4, ry: 0 });
    }
  }
  setThinInstances(glintMaster, glintP);
  setThinInstances(padMaster, padP);
  setThinInstances(blossomMaster, blossomP);

  // ── Foliage & rocks ──
  const pines = [0, 1, 2, 3].map((v) => pineTree(scene, lib, v));
  const leafies = [0, 1, 2, 3].map((v) => leafyTree(scene, lib, v));
  const rocks = [0, 1, 2, 3, 4].map((v) => rock(scene, lib, v));
  const cliffs = [0, 1, 2].map((v) => rock(scene, lib, 10 + v, PAL.cliff));
  const hedges = [0, 1].map((v) => hedge(scene, lib, v));
  const pineP: Placement[][] = pines.map(() => []);
  const leafyP: Placement[][] = leafies.map(() => []);
  const rockP: Placement[][] = rocks.map(() => []);
  const cliffP: Placement[][] = cliffs.map(() => []);
  const hedgeP: Placement[][] = hedges.map(() => []);
  const pebbleP: Placement[] = [];

  const addTree = (x: number, y: number, leafyChance: number, big = 1) => {
    const h = (k: number) => hash2(x * 3 + 1, y * 5 + 2, k);
    const jx = (h(1) - 0.5) * 0.3, jy = (h(2) - 0.5) * 0.3;
    const s = (0.85 + h(3) * 0.35) * big;
    const p: Placement = { x: x + 0.5 + jx, y: y + 0.5 + jy, sx: s * (0.9 + h(4) * 0.2), sy: s * (0.85 + h(5) * 0.45), sz: s * (0.9 + h(6) * 0.2), ry: h(7) * Math.PI * 2, rx: (h(8) - 0.5) * 0.1, rz: (h(9) - 0.5) * 0.1 };
    if (h(10) < leafyChance) leafyP[Math.floor(h(11) * leafies.length)].push(p);
    else pineP[Math.floor(h(11) * pines.length)].push(p);
  };
  const addRock = (x: number, y: number, cx: number, cy: number, sMin: number, sMax: number, flat: number) => {
    const h = (k: number) => hash2(x * 7 + 3, y * 11 + 5, k);
    const s = sMin + h(1) * (sMax - sMin);
    rockP[Math.floor(h(2) * rocks.length)].push({
      x: cx, y: cy, sx: s * (0.85 + h(3) * 0.35), sy: s * (flat + h(4) * 0.35), sz: s * (0.85 + h(5) * 0.35),
      ry: h(6) * Math.PI * 2, rx: (h(7) - 0.5) * 0.35, rz: (h(8) - 0.5) * 0.35,
    });
  };
  const addCliff = (x: number, y: number) => {
    const h = (k: number) => hash2(x * 13 + 7, y * 17 + 3, k);
    cliffP[Math.floor(h(1) * cliffs.length)].push({
      x: x + 0.5 + (h(2) - 0.5) * 0.2, y: y + 0.5 + (h(3) - 0.5) * 0.2,
      sx: 1.25 + h(4) * 0.3, sy: 1.5 + h(5) * 1.0, sz: 1.25 + h(6) * 0.3, ry: h(7) * 6.28, rx: (h(8) - 0.5) * 0.2, rz: (h(9) - 0.5) * 0.2,
    });
    if (h(10) < 0.6) {
      cliffP[Math.floor(h(11) * cliffs.length)].push({
        x: x + 0.2 + h(12) * 0.6, y: y + 0.2 + h(13) * 0.6, h: 0.5 + h(14) * 0.6,
        sx: 0.7 + h(15) * 0.3, sy: 0.8 + h(16) * 0.5, sz: 0.7 + h(17) * 0.3, ry: h(18) * 6.28,
      });
    }
  };

  for (let y = BY0; y < BY1; y++) {
    for (let x = BX0; x < BX1; x++) {
      const c = charAt(x, y);
      const inside = x >= 0 && y >= 0 && x < W && y < H;
      const [sx, sy] = areaIndex(x, y);
      if (c === "T") addTree(x, y, LEAFY_CHANCE[sy][sx]);
      else if (c === "B") {
        if (hash2(x, y, 60) < 0.86) addTree(x, y, LEAFY_CHANCE[sy][sx] * 0.7, 1.05);
      } else if (c === "R") {
        const nextToDoor = inside && (over.tiles[y][x - 1] === "D" || over.tiles[y][x + 1] === "D");
        if (!nextToDoor) addRock(x, y, x + 0.5 + (hash2(x, y, 70) - 0.5) * 0.15, y + 0.5 + (hash2(x, y, 71) - 0.5) * 0.15, 0.9, 1.15, 0.55);
      } else if (c === "^" || c === "C") addCliff(x, y);
      else if (c === "#") {
        const h = hash2(x, y, 80);
        hedgeP[h < 0.5 ? 0 : 1].push({ x: x + 0.5, y: y + 0.5, sx: 1, sy: 0.92 + hash2(x, y, 81) * 0.18, sz: 1, ry: Math.floor(hash2(x, y, 82) * 4) * Math.PI / 2 });
      }
      if (inside && (c === ":" || c === ".") && hash2(x, y, 90) < 0.12) {
        pebbleP.push({ x: x + 0.2 + hash2(x, y, 91) * 0.6, y: y + 0.2 + hash2(x, y, 92) * 0.6, sx: 0.12, sy: 0.08, sz: 0.1, ry: hash2(x, y, 93) * 6 });
      }
    }
  }
  pines.forEach((m, i) => { setThinInstances(m, pineP[i]); m.parent = overRoot; casters.push(m); });
  leafies.forEach((m, i) => { setThinInstances(m, leafyP[i]); m.parent = overRoot; casters.push(m); });
  rocks.forEach((m, i) => { setThinInstances(m, rockP[i]); m.parent = overRoot; casters.push(m); m.receiveShadows = true; });
  cliffs.forEach((m, i) => { setThinInstances(m, cliffP[i]); m.parent = overRoot; casters.push(m); m.receiveShadows = true; });
  hedges.forEach((m, i) => { setThinInstances(m, hedgeP[i]); m.parent = overRoot; casters.push(m); m.receiveShadows = true; });
  const pebble = rock(scene, lib, 20);
  setThinInstances(pebble, pebbleP);
  pebble.parent = overRoot;

  // ── Ground cover: flowers + decorative blades ──
  const flowerMasters = PAL.flowers.map((c, i) => flower(scene, lib, c, i));
  const flowerP: Placement[][] = flowerMasters.map(() => []);
  const decoMasters = [0, 1, 2].map((v) => decoGrass(scene, lib, v, hex("#6fb85a")));
  const decoP: Placement[][] = decoMasters.map(() => []);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = over.tiles[y][x];
    if (c === ",") {
      const n = 3 + Math.floor(hash2(x, y, 100) * 4);
      for (let i = 0; i < n; i++) {
        const k = Math.floor(hash2(x, y, 101 + i) * flowerMasters.length);
        const s = 0.8 + hash2(x, y, 120 + i) * 0.6;
        flowerP[k].push({ x: x + 0.12 + hash2(x, y, 130 + i) * 0.76, y: y + 0.12 + hash2(x, y, 140 + i) * 0.76, sx: s, sy: s, sz: s, ry: hash2(x, y, 150 + i) * 6 });
      }
    }
    if (c === "." || c === ",") {
      const n = Math.floor(hash2(x, y, 160) * 3.2);
      for (let i = 0; i < n; i++) {
        const s = 0.8 + hash2(x, y, 170 + i) * 0.7;
        decoP[i % 3].push({ x: x + 0.1 + hash2(x, y, 180 + i) * 0.8, y: y + 0.1 + hash2(x, y, 190 + i) * 0.8, sx: s, sy: s, sz: s, ry: hash2(x, y, 200 + i) * 6 });
      }
    }
  }
  flowerMasters.forEach((m, i) => { setThinInstances(m, flowerP[i]); m.parent = overRoot; });
  decoMasters.forEach((m, i) => { setThinInstances(m, decoP[i]); m.parent = overRoot; });

  // ── Lanterns & signs ──
  const lantern = lanternPost(scene, lib);
  const lanternP: Placement[] = [];
  const sign = signpost(scene, lib);
  const signP: Placement[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = over.tiles[y][x];
    if (c === "l") lanternP.push({ x: x + 0.5, y: y + 0.5, sx: 1, sy: 1, sz: 1, ry: hash2(x, y, 210) * 0.5 });
    if (c === "n") signP.push({ x: x + 0.5, y: y + 0.5, sx: 1, sy: 1, sz: 1, ry: (hash2(x, y, 211) - 0.5) * 0.3 });
  }
  setThinInstances(lantern.body, lanternP);
  setThinInstances(lantern.lamp, lanternP);
  setThinInstances(sign, signP);
  [lantern.body, lantern.lamp, sign].forEach((m) => { m.parent = overRoot; });
  casters.push(lantern.body, sign);

  // ── Hearthside cottage ──
  const chimney = buildCottage(scene, lib, overRoot, casters);

  // ── Brambleford bridge ──
  buildBridge(scene, lib, over, overRoot, casters);

  // ── Barrow arch ──
  buildArch(scene, lib, over, overRoot, casters);

  // ── Dungeon ──
  const dz = buildDungeon(scene, lib, dungeonRoot, casters);

  return {
    overRoot, dungeonRoot, casters, water, waterMat, glints: glintMaster, chimney,
    lampMat: lantern.lamp.material as StandardMaterial, ...dz,
  };
}

// ── Set pieces ──────────────────────────────────────────────────────────────
function buildCottage(scene: Scene, lib: Lib, root: TransformNode, casters: Mesh[]): Vector3 {
  const t = MAPS.over.tiles;
  let minX = 99, minY = 99, maxX = -1, maxY = -1;
  t.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === "h") { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }));
  const cx = (minX + maxX + 1) / 2, cy = (minY + maxY + 1) / 2;
  const w = maxX - minX + 1 - 0.25, d = maxY - minY + 1 - 0.2;
  const parts: Mesh[] = [];
  const wall = MeshBuilder.CreateBox("cwall", { width: w, height: 1.25, depth: d }, scene);
  wall.position.y = 0.625;
  parts.push(colorize(wall, hex("#f3e3c3")));
  const beamC = hex("#7a5236");
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const b = MeshBuilder.CreateBox("beam", { width: 0.14, height: 1.3, depth: 0.14 }, scene);
    b.position.set(sx * w / 2, 0.65, sz * d / 2);
    parts.push(colorize(b, beamC));
  }
  const sill = MeshBuilder.CreateBox("sill", { width: w + 0.1, height: 0.12, depth: d + 0.1 }, scene);
  sill.position.y = 1.22;
  parts.push(colorize(sill, beamC));
  const base = MeshBuilder.CreateBox("base", { width: w + 0.12, height: 0.18, depth: d + 0.12 }, scene);
  base.position.y = 0.09;
  parts.push(colorize(base, hex("#9a9286")));
  const door = MeshBuilder.CreateBox("door", { width: 0.5, height: 0.85, depth: 0.08 }, scene);
  door.position.set(-0.45, 0.43, -d / 2 - 0.03);
  parts.push(colorize(door, hex("#7a4a2a")));
  const knob = MeshBuilder.CreateBox("knob", { size: 0.06 }, scene);
  knob.position.set(-0.28, 0.45, -d / 2 - 0.08);
  parts.push(colorize(knob, PAL.gold));
  // Roof: a triangular prism with eaves.
  const roofC = hex("#c8553d");
  const rw = w + 0.5, rd = d + 0.55, rh = 1.0;
  const acc = new MeshAcc();
  const y0 = 1.25;
  const A = new Vector3(-rw / 2, y0, -rd / 2), B = new Vector3(rw / 2, y0, -rd / 2);
  const C = new Vector3(rw / 2, y0, rd / 2), D = new Vector3(-rw / 2, y0, rd / 2);
  const R0 = new Vector3(-rw / 2, y0 + rh, 0), R1 = new Vector3(rw / 2, y0 + rh, 0);
  acc.quad([A, B, R1, R0], roofC, new Vector3(0, 0.7, -0.7));
  acc.quad([C, D, R0, R1], roofC.scale(0.85), new Vector3(0, 0.7, 0.7));
  const gableC = hex("#e8d2a8");
  const gx = w / 2;
  acc.quad([new Vector3(-gx, y0, -d / 2), new Vector3(-gx, y0, d / 2), new Vector3(-gx, y0 + rh * 0.92, 0.001), new Vector3(-gx, y0 + rh * 0.92, -0.001)], gableC, new Vector3(-1, 0, 0));
  acc.quad([new Vector3(gx, y0, d / 2), new Vector3(gx, y0, -d / 2), new Vector3(gx, y0 + rh * 0.92, -0.001), new Vector3(gx, y0 + rh * 0.92, 0.001)], gableC, new Vector3(1, 0, 0));
  const roof = acc.build("roof", scene, lib.vcTwo);
  parts.push(roof);
  const chim = MeshBuilder.CreateBox("chim", { width: 0.32, height: 0.8, depth: 0.32 }, scene);
  chim.position.set(w / 2 - 0.55, y0 + rh * 0.75, 0.25);
  parts.push(colorize(chim, hex("#9a6a56")));
  const m = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
  m.name = "cottage";
  m.convertToFlatShadedMesh();
  m.material = lib.vcTwo;
  m.position = toB(cx, cy);
  m.parent = root;
  m.receiveShadows = true;
  casters.push(m);
  // Glowing windows
  const winMat = makeMat(scene, "window", hex("#ffe9a8"), { emissive: hex("#f5c25a"), unlit: true });
  for (const wx of [0.45, 1.0]) {
    const win = MeshBuilder.CreateBox("win", { width: 0.34, height: 0.34, depth: 0.04 }, scene);
    win.material = winMat;
    win.position = toB(cx + wx - 0.2, cy + d / 2 + 0.03, 0.72);
    win.parent = root;
    const frame = MeshBuilder.CreateBox("winf", { width: 0.42, height: 0.06, depth: 0.06 }, scene);
    colorize(frame, beamC); frame.material = lib.vc;
    frame.position = toB(cx + wx - 0.2, cy + d / 2 + 0.05, 0.72);
    frame.parent = root;
  }
  return toB(cx + w / 2 - 0.55, cy - 0.25, y0 + rh * 0.75 + 0.45);
}

function buildBridge(scene: Scene, lib: Lib, over: ParsedMap, root: TransformNode, casters: Mesh[]) {
  let minX = 99, minY = 99, maxX = -1, maxY = -1;
  over.tiles.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === "=") { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }));
  if (maxX < 0) return;
  const parts: Mesh[] = [];
  const x0 = minX - 0.25, x1 = maxX + 1.25;
  const y0 = minY + 0.02, y1 = maxY + 0.98;
  let i = 0;
  for (let x = x0; x < x1 - 0.1; x += 0.25, i++) {
    const p = MeshBuilder.CreateBox("plank", { width: 0.22, height: 0.08, depth: y1 - y0 + (hash2(i, 1) - 0.5) * 0.12 }, scene);
    p.position = toB(x + 0.12, (y0 + y1) / 2 + (hash2(i, 2) - 0.5) * 0.06, 0.03 + hash2(i, 3) * 0.02);
    p.rotation.y = (hash2(i, 4) - 0.5) * 0.06;
    parts.push(colorize(p, PAL.plank.scale(0.88 + hash2(i, 5) * 0.2)));
  }
  for (const ry of [y0, y1]) {
    const rail = MeshBuilder.CreateBox("rail", { width: x1 - x0, height: 0.07, depth: 0.08 }, scene);
    rail.position = toB((x0 + x1) / 2, ry, 0.42);
    parts.push(colorize(rail, PAL.woodDark));
    for (const px of [x0 + 0.05, (x0 + x1) / 2, x1 - 0.05]) {
      const post = MeshBuilder.CreateBox("bpost", { width: 0.1, height: 0.6, depth: 0.1 }, scene);
      post.position = toB(px, ry, 0.15);
      parts.push(colorize(post, PAL.woodDark));
    }
  }
  const m = merge("bridge", parts, lib.vc, 0.05, 31);
  m.parent = root;
  m.receiveShadows = true;
  casters.push(m);
}

function buildArch(scene: Scene, lib: Lib, over: ParsedMap, root: TransformNode, casters: Mesh[]) {
  let dx = -1, dy = -1;
  over.tiles.forEach((row, y) => { const i = row.indexOf("D"); if (i >= 0) { dx = i; dy = y; } });
  if (dx < 0) return;
  const cx = dx + 0.5, cy = dy + 0.5;
  const stone = hex("#8b8578"), stoneDark = hex("#6b665c");
  const parts: Mesh[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const b = MeshBuilder.CreateBox("pil", { width: 0.75 - k * 0.04, height: 0.72, depth: 0.85 - k * 0.05 }, scene);
      b.position = toB(cx + side * 0.98 + (hash2(k, side) - 0.5) * 0.06, cy + 0.1, 0.36 + k * 0.7);
      b.rotation.y = (hash2(k, side, 2) - 0.5) * 0.12;
      parts.push(colorize(b, (k % 2 ? stone : stone.scale(0.92))));
    }
  }
  const lintel = MeshBuilder.CreateBox("lintel", { width: 2.9, height: 0.55, depth: 0.95 }, scene);
  lintel.position = toB(cx, cy + 0.1, 2.35);
  parts.push(colorize(lintel, (_x, _y, _z, ny) => (ny > 0.5 ? hex("#9c9586") : stoneDark)));
  const cap = MeshBuilder.CreateBox("cap", { width: 3.2, height: 0.18, depth: 1.05 }, scene);
  cap.position = toB(cx, cy + 0.1, 2.7);
  parts.push(colorize(cap, stone));
  // Moss tufts on top
  for (let i = 0; i < 4; i++) {
    const moss = MeshBuilder.CreateIcoSphere("moss", { radius: 0.2, subdivisions: 1 }, scene);
    moss.scaling.y = 0.4;
    moss.position = toB(cx - 1.2 + i * 0.75 + hash2(i, 9) * 0.2, cy + 0.1 + (hash2(i, 8) - 0.5) * 0.4, 2.82);
    parts.push(colorize(moss, hex("#6f9a4a")));
  }
  const m = merge("arch", parts, lib.vc, 0.1, 41);
  m.parent = root;
  m.receiveShadows = true;
  casters.push(m);
  // Dark mouth + sun emblem hinting at the treasure within.
  const mouth = MeshBuilder.CreateBox("mouth", { width: 1.3, height: 2.0, depth: 0.1 }, scene);
  mouth.material = makeMat(scene, "mouthMat", hex("#0d0b10"), { unlit: true });
  mouth.position = toB(cx, cy - 0.3, 1.0);
  mouth.parent = root;
  const sun = MeshBuilder.CreateCylinder("emblem", { height: 0.06, diameter: 0.36, tessellation: 8 }, scene);
  sun.rotation.x = Math.PI / 2;
  sun.material = makeMat(scene, "emblemMat", hex("#ffd34d"), { emissive: hex("#b87a10") });
  sun.position = toB(cx, cy + 0.1 + 0.5, 2.35);
  sun.parent = root;
}

function buildDungeon(scene: Scene, lib: Lib, root: TransformNode, casters: Mesh[]) {
  const m = MAPS.dungeon;
  const isFloorish = (x: number, y: number) => { const c = m.tiles[y]?.[x]; return c !== undefined && c !== "W" && c !== "t"; };

  // Floor
  const floor = buildGround("dFloor", scene, lib.vc, 0, 0, m.w, m.h, (x, y) => {
    const c = m.tiles[y]?.[x];
    if (c === undefined || c === "W" || c === "t") return null;
    const base = (x + y) % 2 === 0 ? hex("#625e6c") : hex("#6c6877");
    let col = base.scale(0.92 + hash2(x, y, 5) * 0.14);
    if (c === ",") col = col.scale(0.75);
    if (c === "X") col = hex("#16131b");
    if (c === "G") col = hex("#4e4a57");
    return { h: 0, color: col, bank: hex("#3a3742") };
  });
  floor.parent = root;

  // Royal carpet up to the chest
  const carpet = MeshBuilder.CreateBox("carpet", { width: 1.5, height: 0.02, depth: GATE_ROW - CHEST_POS.y - 0.4 }, scene);
  carpet.material = makeMat(scene, "carpetMat", hex("#8a2b48"));
  carpet.position = toB(8, (CHEST_POS.y + 0.4 + GATE_ROW) / 2, 0.012);
  carpet.receiveShadows = true;
  carpet.parent = root;
  const trimMat = makeMat(scene, "carpetTrim", PAL.goldDark);
  for (const sx of [-0.78, 0.78]) {
    const tr = MeshBuilder.CreateBox("ctrim", { width: 0.07, height: 0.025, depth: GATE_ROW - CHEST_POS.y - 0.4 }, scene);
    tr.material = trimMat;
    tr.position = toB(8 + sx, (CHEST_POS.y + 0.4 + GATE_ROW) / 2, 0.014);
    tr.parent = root;
  }

  // Walls: only those touching floor; south-facing walls are cut low (ALttP cutaway).
  const wallVariants = [0, 1, 2].map((v) => {
    const b = MeshBuilder.CreateBox("wall", { size: 1 }, scene);
    b.position.y = 0.5;
    b.bakeCurrentTransformIntoVertices();
    const side = PAL.wall.scale(0.92 + v * 0.06);
    colorize(b, (_x, _y, _z, ny) => (ny > 0.5 ? PAL.wallTop : side));
    b.convertToFlatShadedMesh();
    b.material = lib.vc;
    b.parent = root;
    b.receiveShadows = true;
    return b;
  });
  const wallP: Placement[][] = [[], [], []];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const c = m.tiles[y][x];
    if (c !== "W" && c !== "t") continue;
    let touches = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloorish(x + dx, y + dy)) touches = true;
    if (!touches) continue;
    // Walls with open floor to their north would hide that floor from the
    // tilted camera, so they're cut low (the classic cutaway look).
    const border = x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1;
    const n = isFloorish(x, y - 1);
    const h = border ? (n ? 0.55 : 1.75) : y === GATE_ROW ? 1.0 : 1.1;
    const v = Math.floor(hash2(x, y, 7) * 3);
    wallP[v].push({ x: x + 0.5, y: y + 0.5, sx: 1, sy: h + (h > 1 ? hash2(x, y, 8) * 0.1 : 0), sz: 1, ry: 0 });
  }
  wallVariants.forEach((b, i) => setThinInstances(b, wallP[i]));

  // Pillars: one squat column per tile, so groups read as colonnades.
  const pillarParts: Mesh[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (m.tiles[y][x] !== "P") continue;
    const cx = x + 0.5, cy = y + 0.5;
    const base = MeshBuilder.CreateBox("pbase", { width: 0.92, height: 0.24, depth: 0.92 }, scene);
    base.position = toB(cx, cy, 0.12);
    pillarParts.push(colorize(base, hex("#5c5866")));
    const col = MeshBuilder.CreateCylinder("pcol", { height: 1.1, diameter: 0.62, tessellation: 8 }, scene);
    col.position = toB(cx, cy, 0.24 + 0.55);
    col.rotation.y = hash2(x, y, 3);
    pillarParts.push(colorize(col, (_x, _y, _z, ny) => (ny > 0.5 ? hex("#8a8594") : hex("#77727f"))));
    const capB = MeshBuilder.CreateBox("pcap", { width: 0.84, height: 0.18, depth: 0.84 }, scene);
    capB.position = toB(cx, cy, 1.43);
    pillarParts.push(colorize(capB, PAL.wallTop));
  }
  // Exit stairs: stepped slabs sinking into darkness.
  for (let k = 0; k < 3; k++) {
    const st = MeshBuilder.CreateBox("step", { width: 1.9, height: 0.05, depth: 0.22 }, scene);
    st.position = toB(8, m.h - 1 + 0.15 + k * 0.28, 0.01 - k * 0.001);
    pillarParts.push(colorize(st, hex("#4a4654").scale(1 - k * 0.3)));
  }
  // Key pedestal
  const ped1 = MeshBuilder.CreateCylinder("ped1", { height: 0.2, diameter: 0.8, tessellation: 8 }, scene);
  ped1.position = toB(KEY_PEDESTAL.x, KEY_PEDESTAL.y, 0.1);
  const ped2 = MeshBuilder.CreateCylinder("ped2", { height: 0.5, diameterTop: 0.4, diameterBottom: 0.5, tessellation: 8 }, scene);
  ped2.position = toB(KEY_PEDESTAL.x, KEY_PEDESTAL.y, 0.45);
  const ped3 = MeshBuilder.CreateCylinder("ped3", { height: 0.12, diameter: 0.62, tessellation: 8 }, scene);
  ped3.position = toB(KEY_PEDESTAL.x, KEY_PEDESTAL.y, 0.76);
  pillarParts.push(colorize(ped1, hex("#5c5866")), colorize(ped2, hex("#7a7584")), colorize(ped3, hex("#8a8594")));
  // Rubble
  for (let i = 0; i < 14; i++) {
    const r = MeshBuilder.CreateIcoSphere("rub", { radius: 0.08 + hash2(i, 3) * 0.1, subdivisions: 0 }, scene);
    const corner = i % 4;
    const bx = corner % 2 === 0 ? 1.3 : m.w - 1.3;
    const by = (i > 7 ? [GATE_ROW + 1.4, GATE_ROW + 1.4, GATE_ROW - 1.4, GATE_ROW - 1.4] : [1.4, 1.4, m.h - 2.4, m.h - 2.4])[corner];
    r.position = toB(bx + (hash2(i, 4) - 0.5) * 0.8, by + (hash2(i, 5) - 0.5) * 0.8, 0.05);
    r.scaling.y = 0.6;
    pillarParts.push(colorize(r, hex("#6a6574")));
  }
  const props = merge("dProps", pillarParts, lib.vc, 0.08, 51);
  props.parent = root;
  props.receiveShadows = true;
  casters.push(props);

  // Jelly puddles in the boss room
  const puddleMat = makeMat(scene, "puddle", PAL.king.scale(0.7), { spec: 0.8, alpha: 0.85 });
  for (let i = 0; i < 5; i++) {
    const p = MeshBuilder.CreateCylinder("puddle", { height: 0.02, diameter: 0.4 + hash2(i, 20) * 0.5, tessellation: 7 }, scene);
    p.material = puddleMat;
    p.position = toB(3 + hash2(i, 21) * 10, 5 + hash2(i, 22) * 4, 0.015);
    p.scaling.z = 0.6 + hash2(i, 23) * 0.4;
    p.parent = root;
  }

  // Torches
  const flameOuter = makeMat(scene, "flameO", hex("#ff7a1a"), { emissive: hex("#ff6a00"), unlit: true });
  const flameInner = makeMat(scene, "flameI", hex("#ffe27a"), { emissive: hex("#ffd35a"), unlit: true });
  const bracketParts: Mesh[] = [];
  const torchFlames: StaticWorld["torchFlames"] = [];
  m.torches.forEach((t, i) => {
    const wallTileY = Math.floor(t.y - t.ny * 0.5);
    const tall = !isFloorish(Math.floor(t.x - t.nx * 0.5), wallTileY - 1) || t.nx !== 0;
    const fh = tall ? 1.15 : 0.8;
    const bx = t.x + t.nx * 0.1, by = t.y + t.ny * 0.1;
    const br = MeshBuilder.CreateBox("bracket", { width: 0.12, height: 0.35, depth: 0.12 }, scene);
    br.position = toB(bx, by, fh - 0.25);
    const cup = MeshBuilder.CreateCylinder("cup", { height: 0.12, diameterTop: 0.24, diameterBottom: 0.12, tessellation: 6 }, scene);
    cup.position = toB(t.x + t.nx * 0.18, t.y + t.ny * 0.18, fh - 0.05);
    bracketParts.push(colorize(br, hex("#3a3338")), colorize(cup, hex("#4a4048")));
    const pos = toB(t.x + t.nx * 0.18, t.y + t.ny * 0.18, fh + 0.12);
    const outer = MeshBuilder.CreateIcoSphere("flame", { radius: 0.13, subdivisions: 1 }, scene);
    outer.scaling.y = 1.5;
    outer.material = flameOuter;
    outer.position = pos.clone();
    outer.parent = root;
    const inner = MeshBuilder.CreateIcoSphere("flameIn", { radius: 0.07, subdivisions: 1 }, scene);
    inner.material = flameInner;
    inner.position = pos.add(new Vector3(0, -0.02, 0));
    inner.parent = root;
    torchFlames.push({ outer, inner, pos, seed: i * 1.7 });
  });
  const brackets = merge("brackets", bracketParts, lib.vc, 0.05, 61);
  brackets.parent = root;

  const torchLights: PointLight[] = [];
  for (let i = 0; i < 4; i++) {
    const l = new PointLight(`torch${i}`, new Vector3(0, 1.3, 0), scene);
    l.diffuse = hex("#ffa850");
    l.specular = hex("#442200");
    l.range = 8;
    l.intensity = 0.9;
    l.setEnabled(false);
    torchLights.push(l);
  }

  // Gate: iron bars that sink into the floor when opened.
  const gate = new TransformNode("gate", scene);
  gate.parent = root;
  gate.position = toB(8, GATE_ROW + 0.5, 0);
  const iron = makeMat(scene, "iron", hex("#3b3a44"), { spec: 0.4 });
  const gateParts: Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const bar = MeshBuilder.CreateCylinder("bar", { height: 1.15, diameter: 0.09, tessellation: 6 }, scene);
    bar.position.set(-0.88 + i * 0.25, 0.575, 0);
    gateParts.push(bar);
    const spike = MeshBuilder.CreateCylinder("gspike", { height: 0.14, diameterTop: 0, diameterBottom: 0.12, tessellation: 4 }, scene);
    spike.position.set(-0.88 + i * 0.25, 1.2, 0);
    gateParts.push(spike);
  }
  for (const hy of [0.3, 0.9]) {
    const cross = MeshBuilder.CreateBox("cross", { width: 2.0, height: 0.08, depth: 0.1 }, scene);
    cross.position.y = hy;
    gateParts.push(cross);
  }
  const lock = MeshBuilder.CreateBox("lock", { width: 0.26, height: 0.3, depth: 0.16 }, scene);
  lock.position.set(0, 0.6, -0.06);
  const lockMesh = merge("lock", [colorize(lock, PAL.goldDark)], lib.vc, 0, 1);
  const gateMesh = Mesh.MergeMeshes(gateParts, true, true)!;
  gateMesh.convertToFlatShadedMesh();
  gateMesh.material = iron;
  gateMesh.parent = gate;
  lockMesh.parent = gate;
  casters.push(gateMesh);

  // Chest
  const chestRoot = new TransformNode("chest", scene);
  chestRoot.parent = root;
  chestRoot.position = toB(CHEST_POS.x, CHEST_POS.y, 0);
  const wood = hex("#8a5a32");
  const cb = MeshBuilder.CreateBox("cbody", { width: 1.0, height: 0.52, depth: 0.66 }, scene);
  cb.position.y = 0.26;
  const band1 = MeshBuilder.CreateBox("band", { width: 0.1, height: 0.54, depth: 0.68 }, scene);
  band1.position.set(-0.32, 0.27, 0);
  const band2 = band1.clone("band2"); band2.position.x = 0.32;
  const clasp = MeshBuilder.CreateBox("clasp", { width: 0.16, height: 0.16, depth: 0.05 }, scene);
  clasp.position.set(0, 0.46, -0.34);
  const chestBody = merge("chestBody", [colorize(cb, wood), colorize(band1, PAL.gold), colorize(band2, PAL.gold), colorize(clasp, PAL.gold)], lib.vc, 0.05, 71);
  chestBody.parent = chestRoot;
  casters.push(chestBody);
  const lidPivot = new TransformNode("lidPivot", scene);
  lidPivot.parent = chestRoot;
  lidPivot.position.set(0, 0.52, 0.33); // hinge on the back (north) edge
  const lid = MeshBuilder.CreateBox("lid", { width: 1.02, height: 0.2, depth: 0.68 }, scene);
  lid.position.set(0, 0.1, -0.33);
  const lidTop = MeshBuilder.CreateBox("lidTop", { width: 0.96, height: 0.1, depth: 0.46 }, scene);
  lidTop.position.set(0, 0.25, -0.33);
  const lband1 = MeshBuilder.CreateBox("lband", { width: 0.1, height: 0.32, depth: 0.7 }, scene);
  lband1.position.set(-0.32, 0.15, -0.33);
  const lband2 = lband1.clone("lband2"); lband2.position.x = 0.32;
  const lidMesh = merge("chestLid", [colorize(lid, wood.scale(1.1)), colorize(lidTop, wood.scale(1.2)), colorize(lband1, PAL.gold), colorize(lband2, PAL.gold)], lib.vc, 0.05, 72);
  lidMesh.parent = lidPivot;
  casters.push(lidMesh);
  const seal = MeshBuilder.CreateIcoSphere("seal", { radius: 0.85, subdivisions: 2 }, scene);
  seal.scaling.set(1.0, 0.75, 0.85);
  seal.position.y = 0.35;
  seal.material = makeMat(scene, "sealMat", PAL.king, { emissive: hex("#5a1040"), alpha: 0.4, spec: 0.9 });
  seal.parent = chestRoot;

  const key = keyMesh(scene);
  key.parent = root;
  key.position = toB(KEY_PEDESTAL.x, KEY_PEDESTAL.y, 1.2);

  return { torchFlames, torchLights, gate, chestLid: lidPivot, chestSeal: seal, key };
}
