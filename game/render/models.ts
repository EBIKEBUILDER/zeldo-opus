// Low-poly model factories. Every model is a merged, flat-shaded,
// vertex-coloured mesh so the scene stays cheap and faceted.
import {
  Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, VertexData,
} from "@babylonjs/core";
import { colorize, hex, jitter, makeMat, merge, mergeSmooth, Rng } from "./util";

export const PAL = {
  trunk: hex("#7a5236"),
  trunkDark: hex("#5e3d27"),
  pine: [hex("#2f7d5b"), hex("#3b8f5e"), hex("#276b50"), hex("#3f8a55")],
  leafy: [hex("#5aa84f"), hex("#6cb85a"), hex("#4f9a52"), hex("#78b24c")],
  rock: [hex("#8d8f94"), hex("#9a968e"), hex("#7c8088"), hex("#a39d92"), hex("#878278")],
  cliff: [hex("#7f7a70"), hex("#8a857a"), hex("#736f68")],
  hedge: hex("#3f8a4a"),
  hedgeTop: hex("#58a558"),
  clay: hex("#c8714a"),
  clayDark: hex("#9e5234"),
  clayLight: hex("#e09a6c"),
  tuft: hex("#4f9e3e"),
  tuftTip: hex("#a9dc6a"),
  flowers: [hex("#ff7a7a"), hex("#ffd166"), hex("#c9a3ff"), hex("#fff4e0")],
  wood: hex("#a8784a"),
  woodDark: hex("#6e4a2c"),
  plank: hex("#b98a55"),
  gloob: hex("#8e5bd6"),
  gloobLight: hex("#b48af0"),
  king: hex("#c03a8a"),
  kingLight: hex("#e070b0"),
  gold: hex("#ffcc33"),
  goldDark: hex("#d19a1c"),
  stone: hex("#6d6a75"),
  wall: hex("#57525f"),
  wallTop: hex("#7a7584"),
};

export interface Lib {
  vc: StandardMaterial;
  vcTwo: StandardMaterial;
}

export function makeLib(scene: Scene): Lib {
  const vc = makeMat(scene, "vc", new Color3(1, 1, 1), { spec: 0.03 });
  // Double-sided but lit with the authored normal on both faces (no flip), so
  // grass blades stay bright from every angle.
  const vcTwo = makeMat(scene, "vcTwo", new Color3(1, 1, 1), { spec: 0 });
  vcTwo.backFaceCulling = false;
  return { vc, vcTwo };
}

// ── Nature ──────────────────────────────────────────────────────────────────

export function pineTree(scene: Scene, lib: Lib, variant: number): Mesh {
  const rng = new Rng(100 + variant * 17);
  const parts: Mesh[] = [];
  const trunk = MeshBuilder.CreateCylinder("trunk", { height: 0.7, diameterTop: 0.13, diameterBottom: 0.24, tessellation: 6 }, scene);
  trunk.position.y = 0.35;
  parts.push(colorize(trunk, PAL.trunk));
  const base = PAL.pine[variant % PAL.pine.length];
  const layers = 3 + (variant % 2);
  let y = 0.55;
  let d = 1.3 - (variant % 3) * 0.06;
  for (let i = 0; i < layers; i++) {
    const h = 0.85 - i * 0.08;
    const cone = MeshBuilder.CreateCylinder("cone", { height: h, diameterTop: 0, diameterBottom: d, tessellation: 7 }, scene);
    cone.position.y = y + h / 2;
    cone.rotation.y = rng.next() * Math.PI;
    cone.rotation.z = (rng.next() - 0.5) * 0.08;
    const shade = Color3.Lerp(base, hex("#9fd38a"), i * 0.09);
    parts.push(colorize(cone, (_x, _y, _z, ny) => (ny < -0.5 ? base.scale(0.6) : shade)));
    y += h * 0.52;
    d *= 0.74;
  }
  return merge(`pine${variant}`, parts, lib.vc, 0.09, variant);
}

export function leafyTree(scene: Scene, lib: Lib, variant: number): Mesh {
  const rng = new Rng(300 + variant * 31);
  const parts: Mesh[] = [];
  const trunk = MeshBuilder.CreateCylinder("trunk", { height: 0.9, diameterTop: 0.14, diameterBottom: 0.26, tessellation: 6 }, scene);
  trunk.position.y = 0.45;
  parts.push(colorize(trunk, PAL.trunkDark));
  const base = PAL.leafy[variant % PAL.leafy.length];
  const blobs = 2 + (variant % 2);
  for (let i = 0; i < blobs; i++) {
    const r = 0.52 - i * 0.1;
    const s = MeshBuilder.CreateIcoSphere("leaf", { radius: r, subdivisions: 1 }, scene);
    jitter(s, 0.07, variant * 10 + i);
    s.position.set((rng.next() - 0.5) * 0.35, 1.05 + i * 0.38, (rng.next() - 0.5) * 0.35);
    s.scaling.y = 0.85;
    const col = Color3.Lerp(base, hex("#b8e07a"), i * 0.12);
    parts.push(colorize(s, (_x, _y, _z, ny) => (ny < -0.3 ? col.scale(0.7) : col)));
  }
  return merge(`leafy${variant}`, parts, lib.vc, 0.1, variant + 50);
}

export function rock(scene: Scene, lib: Lib, variant: number, palette = PAL.rock): Mesh {
  const s = MeshBuilder.CreateIcoSphere("rock", { radius: 0.5, subdivisions: 1 }, scene);
  jitter(s, 0.13, 900 + variant * 13, 0.8);
  s.position.y = 0.32;
  const base = palette[variant % palette.length];
  colorize(s, (_x, y) => (y < -0.25 ? base.scale(0.75) : y > 0.25 ? Color3.Lerp(base, hex("#d8d4cc"), 0.18) : base));
  // Tiny moss cap on some variants.
  const parts = [s];
  if (variant % 3 === 0) {
    const moss = MeshBuilder.CreateIcoSphere("moss", { radius: 0.24, subdivisions: 1 }, scene);
    jitter(moss, 0.05, variant);
    moss.scaling.set(1.3, 0.35, 1.1);
    moss.position.set(0.05, 0.72, -0.02);
    parts.push(colorize(moss, hex("#6f9a4a")));
  }
  return merge(`rock${variant}`, parts, lib.vc, 0.12, variant + 7);
}

export function hedge(scene: Scene, lib: Lib, variant: number): Mesh {
  const rng = new Rng(500 + variant);
  const box = MeshBuilder.CreateBox("hedge", { width: 1.0, height: 0.82, depth: 1.0 }, scene);
  box.position.y = 0.41;
  const parts = [colorize(box, (_x, _y, _z, ny) => (ny > 0.5 ? PAL.hedgeTop : PAL.hedge))];
  for (let i = 0; i < 3; i++) {
    const b = MeshBuilder.CreateIcoSphere("bump", { radius: 0.24 + rng.next() * 0.08, subdivisions: 1 }, scene);
    jitter(b, 0.04, variant * 5 + i);
    b.position.set((rng.next() - 0.5) * 0.6, 0.8, (rng.next() - 0.5) * 0.6);
    b.scaling.y = 0.6;
    parts.push(colorize(b, Color3.Lerp(PAL.hedgeTop, hex("#7cc070"), rng.next() * 0.5)));
  }
  return merge(`hedge${variant}`, parts, lib.vc, 0.08, variant + 21);
}

function bladeMesh(scene: Scene, name: string, blades: number, hMin: number, hMax: number, spread: number, seed: number, base: Color3, tip: Color3): Mesh {
  const rng = new Rng(seed);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rng.next() * 0.6;
    const r = rng.next() * spread;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const h = hMin + rng.next() * (hMax - hMin);
    const w = 0.05 + rng.next() * 0.04;
    const face = a + Math.PI / 2 + (rng.next() - 0.5) * 0.8;
    const lean = 0.12 + rng.next() * 0.18;
    const fx = Math.cos(face) * w, fz = Math.sin(face) * w;
    const v = pos.length / 3;
    pos.push(cx - fx, 0, cz - fz, cx + fx, 0, cz + fz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    const tipC = Color3.Lerp(base, tip, 0.6 + rng.next() * 0.4);
    col.push(base.r, base.g, base.b, 1, base.r, base.g, base.b, 1, tipC.r, tipC.g, tipC.b, 1);
    idx.push(v, v + 1, v + 2);
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos; vd.indices = idx; vd.colors = col;
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  // Point blade normals mostly up so both sides catch the sun the same way.
  for (let i = 0; i < nrm.length; i += 3) { nrm[i] *= 0.3; nrm[i + 1] = 0.9; nrm[i + 2] *= 0.3; }
  vd.normals = nrm;
  vd.uvs = new Array((pos.length / 3) * 2).fill(0);
  vd.applyToMesh(m);
  return m;
}

export function tuft(scene: Scene, lib: Lib, variant: number): Mesh {
  // Three crossed-blade clumps make one cuttable tuft.
  const parts: Mesh[] = [];
  const rng = new Rng(700 + variant);
  for (let k = 0; k < 3; k++) {
    const m = bladeMesh(scene, "tuftPart", 7, 0.32, 0.55, 0.08, 710 + variant * 7 + k, PAL.tuft, PAL.tuftTip);
    const a = (k / 3) * Math.PI * 2 + rng.next();
    m.position.set(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14);
    parts.push(m);
  }
  const out = Mesh.MergeMeshes(parts, true, true)!;
  out.name = `tuft${variant}`;
  out.material = lib.vcTwo;
  return out;
}

export function decoGrass(scene: Scene, lib: Lib, variant: number, base: Color3): Mesh {
  const m = bladeMesh(scene, `deco${variant}`, 5, 0.12, 0.26, 0.07, 800 + variant, base.scale(0.85), Color3.Lerp(base, hex("#e6f5a0"), 0.45));
  m.material = lib.vcTwo;
  return m;
}

export function flower(scene: Scene, lib: Lib, color: Color3, seed: number): Mesh {
  const stem = MeshBuilder.CreateBox("stem", { width: 0.025, height: 0.22, depth: 0.025 }, scene);
  stem.position.y = 0.11;
  const head = MeshBuilder.CreatePolyhedron("head", { type: 1, size: 0.055 }, scene);
  head.position.y = 0.24;
  head.scaling.y = 0.6;
  const leaf = MeshBuilder.CreateBox("leaf", { width: 0.1, height: 0.015, depth: 0.04 }, scene);
  leaf.position.set(0.04, 0.07, 0);
  leaf.rotation.z = 0.4;
  return merge(`flower${seed}`, [colorize(stem, hex("#4f8a3a")), colorize(head, color), colorize(leaf, hex("#5f9e45"))], lib.vc, 0.05, seed);
}

export function pot(scene: Scene, lib: Lib): Mesh {
  const shape = [
    new Vector3(0.0, 0, 0), new Vector3(0.17, 0, 0), new Vector3(0.26, 0.1, 0), new Vector3(0.29, 0.24, 0),
    new Vector3(0.24, 0.38, 0), new Vector3(0.14, 0.46, 0), new Vector3(0.17, 0.52, 0), new Vector3(0.12, 0.53, 0),
  ];
  const body = MeshBuilder.CreateLathe("pot", { shape, tessellation: 9, closed: true }, scene);
  colorize(body, (_x, y) => (y > 0.44 ? PAL.clayLight : y > 0.27 && y < 0.33 ? PAL.clayDark : PAL.clay));
  const hole = MeshBuilder.CreateDisc("hole", { radius: 0.13, tessellation: 9 }, scene);
  hole.rotation.x = Math.PI / 2;
  hole.position.y = 0.525;
  colorize(hole, hex("#3a2016"));
  return merge("pot", [body, hole], lib.vc, 0.06, 3);
}

export function signpost(scene: Scene, lib: Lib): Mesh {
  const post = MeshBuilder.CreateBox("post", { width: 0.1, height: 0.75, depth: 0.1 }, scene);
  post.position.y = 0.37;
  const board = MeshBuilder.CreateBox("board", { width: 0.72, height: 0.42, depth: 0.07 }, scene);
  board.position.y = 0.68;
  board.position.z = -0.02;
  const trim = MeshBuilder.CreateBox("trim", { width: 0.5, height: 0.04, depth: 0.08 }, scene);
  trim.position.set(0, 0.74, -0.03);
  const trim2 = trim.clone("trim2"); trim2.position.y = 0.64;
  return merge("sign", [colorize(post, PAL.woodDark), colorize(board, PAL.wood), colorize(trim, PAL.woodDark), colorize(trim2, PAL.woodDark)], lib.vc, 0.05, 4);
}

export function lanternPost(scene: Scene, lib: Lib): { body: Mesh; lamp: Mesh } {
  const base = MeshBuilder.CreateBox("lbase", { width: 0.26, height: 0.12, depth: 0.26 }, scene);
  base.position.y = 0.06;
  const post = MeshBuilder.CreateCylinder("lpost", { height: 1.25, diameter: 0.09, tessellation: 6 }, scene);
  post.position.y = 0.68;
  const cap = MeshBuilder.CreateCylinder("lcap", { height: 0.18, diameterTop: 0, diameterBottom: 0.34, tessellation: 4 }, scene);
  cap.position.y = 1.62;
  cap.rotation.y = Math.PI / 4;
  const frame = MeshBuilder.CreateBox("lframe", { width: 0.26, height: 0.04, depth: 0.26 }, scene);
  frame.position.y = 1.3;
  const body = merge("lantern", [colorize(base, hex("#4a4450")), colorize(post, hex("#3d3742")), colorize(cap, hex("#3d3742")), colorize(frame, hex("#3d3742"))], lib.vc, 0.05, 5);
  const lamp = MeshBuilder.CreateBox("lamp", { width: 0.2, height: 0.24, depth: 0.2 }, scene);
  lamp.position.y = 1.43;
  lamp.bakeCurrentTransformIntoVertices();
  lamp.material = makeMat(scene, "lampMat", hex("#ffd27a"), { emissive: hex("#ffb547"), unlit: true });
  return { body, lamp };
}

// ── Characters ──────────────────────────────────────────────────────────────

export interface HeroRig {
  root: TransformNode;
  body: TransformNode;
  footL: Mesh;
  footR: Mesh;
  handL: Mesh;
  handR: Mesh;
  scarf: Mesh;
  swordPivot: TransformNode;
  sword: Mesh;
  sheath: Mesh;
  meshes: Mesh[];
}

export function hero(scene: Scene, lib: Lib): HeroRig {
  const root = new TransformNode("hero", scene);
  const body = new TransformNode("heroBody", scene);
  body.parent = root;
  const meshes: Mesh[] = [];
  const add = (m: Mesh, parent: TransformNode) => { m.parent = parent; meshes.push(m); return m; };

  const tunicC = hex("#2f9e5a"), skinC = hex("#f6c9a0"), bootC = hex("#6b4226"), beltC = hex("#7a4a22"),
    leafC = hex("#86e05a"), scarfC = hex("#f2b33d"), hairC = hex("#8a4b2a");

  const torso = MeshBuilder.CreateCylinder("torso", { height: 0.5, diameterTop: 0.34, diameterBottom: 0.5, tessellation: 8 }, scene);
  torso.position.y = 0.38;
  const belt = MeshBuilder.CreateCylinder("belt", { height: 0.07, diameter: 0.44, tessellation: 8 }, scene);
  belt.position.y = 0.3;
  const buckle = MeshBuilder.CreateBox("buckle", { width: 0.08, height: 0.07, depth: 0.04 }, scene);
  buckle.position.set(0, 0.3, 0.215);
  const head = MeshBuilder.CreateIcoSphere("head", { radius: 0.23, subdivisions: 2 }, scene);
  head.position.y = 0.8;
  const hair = MeshBuilder.CreateIcoSphere("hair", { radius: 0.24, subdivisions: 1 }, scene);
  hair.position.set(0, 0.86, -0.04);
  hair.scaling.set(1.02, 0.78, 1.0);
  const eyeL = MeshBuilder.CreateBox("eyeL", { width: 0.05, height: 0.085, depth: 0.04 }, scene);
  eyeL.position.set(-0.08, 0.8, 0.226);
  const eyeR = eyeL.clone("eyeR"); eyeR.position.x = 0.08;
  const cheekL = MeshBuilder.CreateBox("cheekL", { width: 0.06, height: 0.03, depth: 0.02 }, scene);
  cheekL.position.set(-0.13, 0.74, 0.19);
  const cheekR = cheekL.clone("cheekR"); cheekR.position.x = 0.13;
  const stem = MeshBuilder.CreateCylinder("stem", { height: 0.16, diameter: 0.035, tessellation: 5 }, scene);
  stem.position.set(0, 1.1, -0.02);
  const leaf1 = MeshBuilder.CreateIcoSphere("leaf1", { radius: 0.1, subdivisions: 1 }, scene);
  leaf1.scaling.set(1.5, 0.3, 0.8);
  leaf1.position.set(0.1, 1.18, -0.02);
  leaf1.rotation.z = 0.5;
  const leaf2 = leaf1.clone("leaf2");
  leaf2.position.x = -0.09; leaf2.position.y = 1.15; leaf2.rotation.z = -0.6; leaf2.scaling.x = 1.2;

  const bodyMesh = merge("heroBodyMesh", [
    colorize(torso, (_x, y) => (y > 0.16 ? tunicC : tunicC.scale(0.85))), colorize(belt, beltC), colorize(buckle, PAL.gold),
    colorize(head, skinC), colorize(hair, hairC), colorize(eyeL, hex("#2a1f1a")), colorize(eyeR, hex("#2a1f1a")),
    colorize(cheekL, hex("#f59a8a")), colorize(cheekR, hex("#f59a8a")),
    colorize(stem, hex("#5a9e3a")), colorize(leaf1, leafC), colorize(leaf2, leafC.scale(0.9)),
  ], lib.vc, 0.04, 77);
  add(bodyMesh, body);

  const scarf = MeshBuilder.CreateTorus("scarf", { diameter: 0.34, thickness: 0.09, tessellation: 10 }, scene);
  scarf.position.y = 0.6;
  colorize(scarf, scarfC);
  const tail = MeshBuilder.CreateBox("tail", { width: 0.1, height: 0.04, depth: 0.26 }, scene);
  tail.position.set(0.08, 0.6, -0.26);
  tail.rotation.x = -0.4;
  colorize(tail, scarfC.scale(0.9));
  const scarfMesh = merge("scarf", [scarf, tail], lib.vc, 0.04, 78);
  add(scarfMesh, body);

  const foot = (name: string, x: number) => {
    const f = MeshBuilder.CreateBox(name, { width: 0.13, height: 0.12, depth: 0.2 }, scene);
    colorize(f, bootC);
    f.convertToFlatShadedMesh();
    f.material = lib.vc;
    f.position.set(x, 0.06, 0.02);
    return add(f, root);
  };
  const footL = foot("footL", -0.11), footR = foot("footR", 0.11);
  const hand = (name: string, x: number) => {
    const h = MeshBuilder.CreateIcoSphere(name, { radius: 0.07, subdivisions: 1 }, scene);
    colorize(h, skinC);
    h.convertToFlatShadedMesh();
    h.material = lib.vc;
    h.position.set(x, 0.38, 0.04);
    return add(h, body);
  };
  const handL = hand("handL", -0.27), handR = hand("handR", 0.27);

  // Sword: built pointing along local +Z from its pivot (the hero's center).
  const swordPivot = new TransformNode("swordPivot", scene);
  swordPivot.parent = root;
  swordPivot.position.y = 0.42;
  const blade = MeshBuilder.CreateBox("blade", { width: 0.09, height: 0.03, depth: 0.72 }, scene);
  blade.position.z = 0.7;
  const tip = MeshBuilder.CreateCylinder("tip", { height: 0.12, diameterTop: 0, diameterBottom: 0.09, tessellation: 4 }, scene);
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 1.12;
  tip.scaling.z = 0.35;
  const guard = MeshBuilder.CreateBox("guard", { width: 0.28, height: 0.06, depth: 0.06 }, scene);
  guard.position.z = 0.32;
  const grip = MeshBuilder.CreateBox("grip", { width: 0.05, height: 0.05, depth: 0.16 }, scene);
  grip.position.z = 0.22;
  const pommel = MeshBuilder.CreateIcoSphere("pommel", { radius: 0.045, subdivisions: 0 }, scene);
  pommel.position.z = 0.13;
  const sword = merge("sword", [
    colorize(blade, hex("#e6eef5")), colorize(tip, hex("#e6eef5")), colorize(guard, PAL.gold),
    colorize(grip, hex("#5a3a22")), colorize(pommel, PAL.gold),
  ], lib.vc, 0.05, 79);
  sword.parent = swordPivot;
  meshes.push(sword);

  const sheath = MeshBuilder.CreateBox("sheath", { width: 0.08, height: 0.5, depth: 0.05 }, scene);
  colorize(sheath, hex("#5a3a22"));
  sheath.convertToFlatShadedMesh();
  sheath.material = lib.vc;
  sheath.position.set(0.08, 0.45, -0.22);
  sheath.rotation.z = 0.6;
  add(sheath, body);

  return { root, body, footL, footR, handL, handR, scarf: scarfMesh, swordPivot, sword, sheath, meshes };
}

export function gloobMesh(scene: Scene, lib: Lib, king: boolean): Mesh {
  const base = king ? PAL.king : PAL.gloob;
  const light = king ? PAL.kingLight : PAL.gloobLight;
  // High-resolution smooth sphere: 32 segments for King (scaled 2.5x in game), 24 for gloobs
  const body = MeshBuilder.CreateSphere("gbody", { diameter: 1.0, segments: king ? 32 : 24 }, scene);
  body.scaling.set(1, 0.78, 1);
  body.position.y = 0.39;
  // Soft, smooth vertical color gradient across the body
  colorize(body, (_x, y) => {
    if (y > 0) {
      const t = Math.min(1, y / 0.45);
      return Color3.Lerp(base, light, t);
    } else {
      const t = Math.min(1, -y / 0.45);
      return Color3.Lerp(base, base.scale(0.7), t);
    }
  });
  const parts = [body];
  const eye = (x: number) => {
    // Body surface sits at z≈0.47 at eye height, so eyes must poke out past it.
    const w = MeshBuilder.CreateSphere("eyeW", { diameter: 0.3, segments: king ? 20 : 16 }, scene);
    w.position.set(x, 0.54, 0.44);
    w.scaling.z = 0.55;
    const p = MeshBuilder.CreateSphere("eyeP", { diameter: 0.15, segments: king ? 20 : 16 }, scene);
    p.position.set(x * 1.04, 0.52, 0.52);
    p.scaling.z = 0.5;
    const glint = MeshBuilder.CreateSphere("eyeG", { diameter: 0.05, segments: 12 }, scene);
    glint.position.set(x * 1.04 - 0.025, 0.55, 0.555);
    parts.push(colorize(w, hex("#ffffff")), colorize(p, hex("#1d1426")), colorize(glint, hex("#ffffff")));
  };
  eye(-0.16); eye(0.16);
  const shine = MeshBuilder.CreateSphere("shine", { diameter: 0.16, segments: 14 }, scene);
  shine.position.set(-0.2, 0.72, 0.15);
  shine.scaling.set(1, 0.5, 1);
  parts.push(colorize(shine, hex("#f4ecff")));
  if (!king) {
    const smile = MeshBuilder.CreateTorus("smile", { diameter: 0.16, thickness: 0.03, tessellation: 20 }, scene);
    smile.rotation.x = Math.PI / 2;
    smile.scaling.z = 0.6;
    smile.position.set(0, 0.36, 0.475);
    parts.push(colorize(smile, hex("#3a1a5a")));
  }
  if (king) {
    const brow = (x: number, rz: number) => {
      const b = MeshBuilder.CreateBox("brow", { width: 0.2, height: 0.05, depth: 0.05 }, scene);
      b.position.set(x, 0.7, 0.46);
      b.rotation.z = rz;
      parts.push(colorize(b, hex("#3a0f2a")));
    };
    brow(-0.16, -0.45); brow(0.16, 0.45);
    const mouth = MeshBuilder.CreateBox("mouth", { width: 0.22, height: 0.04, depth: 0.04 }, scene);
    mouth.position.set(0, 0.36, 0.49);
    parts.push(colorize(mouth, hex("#3a0f2a")));
  }
  return mergeSmooth(king ? "kingBody" : "gloobBody", parts, lib.vc);
}

export function crown(scene: Scene, lib: Lib): Mesh {
  const parts: Mesh[] = [];
  const ring = MeshBuilder.CreateCylinder("ring", { height: 0.14, diameter: 0.42, tessellation: 16 }, scene);
  parts.push(colorize(ring, PAL.gold));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const sp = MeshBuilder.CreateCylinder("spike", { height: 0.16, diameterTop: 0, diameterBottom: 0.1, tessellation: 4 }, scene);
    sp.position.set(Math.cos(a) * 0.18, 0.14, Math.sin(a) * 0.18);
    parts.push(colorize(sp, PAL.gold));
  }
  const gem = MeshBuilder.CreatePolyhedron("gem", { type: 1, size: 0.05 }, scene);
  gem.position.set(0, 0.02, 0.21);
  parts.push(colorize(gem, hex("#ff3355")));
  return merge("crown", parts, lib.vc, 0.08, 13);
}

// ── Items & props ───────────────────────────────────────────────────────────

export function rupeeMesh(scene: Scene, color: string, name: string): Mesh {
  const m = MeshBuilder.CreatePolyhedron(name, { type: 1, size: 0.13 }, scene);
  m.scaling.set(0.8, 1.5, 0.45);
  m.bakeCurrentTransformIntoVertices();
  m.convertToFlatShadedMesh();
  const c = hex(color);
  m.material = makeMat(scene, name + "Mat", c, { emissive: c.scale(0.35), spec: 0.6 });
  return m;
}

export function heartMesh(scene: Scene, lib: Lib): Mesh {
  const red = hex("#ff4d6d");
  const l = MeshBuilder.CreateIcoSphere("hl", { radius: 0.1, subdivisions: 1 }, scene);
  l.position.set(-0.075, 0.05, 0);
  const r = MeshBuilder.CreateIcoSphere("hr", { radius: 0.1, subdivisions: 1 }, scene);
  r.position.set(0.075, 0.05, 0);
  const b = MeshBuilder.CreateBox("hb", { size: 0.17 }, scene);
  b.rotation.z = Math.PI / 4;
  b.position.y = -0.04;
  b.scaling.z = 0.8;
  const m = merge("heart", [colorize(l, red), colorize(r, red), colorize(b, red)], lib.vc, 0.05, 14);
  m.scaling.z = 0.6;
  m.bakeCurrentTransformIntoVertices();
  m.material = makeMat(scene, "heartMat", new Color3(1, 1, 1), { emissive: hex("#661020") });
  return m;
}

export function keyMesh(scene: Scene): Mesh {
  const bow = MeshBuilder.CreateTorus("bow", { diameter: 0.2, thickness: 0.05, tessellation: 10 }, scene);
  bow.rotation.x = Math.PI / 2;
  bow.position.y = 0.18;
  const shaft = MeshBuilder.CreateBox("shaft", { width: 0.05, height: 0.32, depth: 0.05 }, scene);
  shaft.position.y = -0.04;
  const t1 = MeshBuilder.CreateBox("t1", { width: 0.09, height: 0.04, depth: 0.05 }, scene);
  t1.position.set(0.06, -0.16, 0);
  const t2 = t1.clone("t2"); t2.position.y = -0.09; t2.scaling.x = 0.7;
  const m = Mesh.MergeMeshes([bow, shaft, t1, t2], true, true)!;
  m.name = "key";
  m.convertToFlatShadedMesh();
  m.material = makeMat(scene, "keyMat", PAL.gold, { emissive: hex("#8a5a00"), spec: 0.8 });
  return m;
}

export function sunstoneMesh(scene: Scene): Mesh {
  const m = MeshBuilder.CreateIcoSphere("sunstone", { radius: 0.22, subdivisions: 0 }, scene);
  m.scaling.y = 1.3;
  m.bakeCurrentTransformIntoVertices();
  m.convertToFlatShadedMesh();
  m.material = makeMat(scene, "sunMat", hex("#ffd34d"), { emissive: hex("#ff9a1f"), spec: 1 });
  return m;
}

// ── King's royal jelly ──────────────────────────────────────────────────────

/** A smooth glob of royal jelly with a little gold fleck suspended inside. */
export function jellyBallMesh(scene: Scene, lib: Lib): Mesh {
  const ball = MeshBuilder.CreateSphere("jball", { diameter: 0.6, segments: 20 }, scene);
  colorize(ball, (_x, y) => {
    if (y > 0) {
      const t = Math.min(1, y / 0.28);
      return Color3.Lerp(PAL.king, PAL.kingLight, t);
    } else {
      const t = Math.min(1, -y / 0.28);
      return Color3.Lerp(PAL.king, PAL.king.scale(0.75), t);
    }
  });
  const shine = MeshBuilder.CreateSphere("jshine", { diameter: 0.14, segments: 12 }, scene);
  shine.position.set(-0.12, 0.17, -0.1);
  shine.scaling.set(1, 0.55, 1);
  const fleck = MeshBuilder.CreatePolyhedron("jfleck", { type: 1, size: 0.07 }, scene);
  fleck.position.set(0.04, 0.02, 0.05);
  return mergeSmooth("jellyBall", [ball, colorize(shine, hex("#ffe6f4")), colorize(fleck, PAL.gold)], lib.vc);
}

/** Flat, blobby puddle (several overlapping discs plus a couple of bubbles). */
export function puddleMesh(scene: Scene, lib: Lib): Mesh {
  const parts: Mesh[] = [];
  const blobs: [number, number, number][] = [[0, 0, 0.78], [0.42, 0.18, 0.46], [-0.38, 0.26, 0.42], [0.1, -0.44, 0.44], [-0.3, -0.3, 0.36]];
  blobs.forEach(([x, z, r], i) => {
    const d = MeshBuilder.CreateDisc("pblob", { radius: r, tessellation: 11, sideOrientation: Mesh.DOUBLESIDE }, scene);
    d.rotation.x = Math.PI / 2;
    d.position.set(x, 0.012 + i * 0.002, z);
    parts.push(colorize(d, i === 0 ? PAL.king.scale(0.85) : PAL.king));
  });
  for (const [x, z, r] of [[0.22, 0.1, 0.09], [-0.25, -0.12, 0.07], [0.05, 0.35, 0.06]] as const) {
    const b = MeshBuilder.CreateIcoSphere("pbub", { radius: r, subdivisions: 0 }, scene);
    b.position.set(x, 0.03, z);
    b.scaling.y = 0.5;
    parts.push(colorize(b, PAL.kingLight));
  }
  return merge("puddle", parts, lib.vc, 0.03, 23);
}

/** A chunky "!" that pops over a gloob when it spots you. */
export function alertMesh(scene: Scene): Mesh {
  const bar = MeshBuilder.CreateBox("abar", { width: 0.1, height: 0.28, depth: 0.06 }, scene);
  bar.position.y = 0.2;
  bar.scaling.x = 1;
  const dot = MeshBuilder.CreateBox("adot", { width: 0.1, height: 0.09, depth: 0.06 }, scene);
  dot.position.y = -0.02;
  const m = Mesh.MergeMeshes([bar, dot], true, true)!;
  m.name = "alert";
  m.material = makeMat(scene, "alertMat", hex("#ffe14a"), { emissive: hex("#ffc21a"), unlit: true });
  m.billboardMode = Mesh.BILLBOARDMODE_ALL;
  return m;
}
