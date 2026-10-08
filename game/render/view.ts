// ─────────────────────────────────────────────────────────────────────────────
//  The Babylon view layer. It owns no game logic: every frame it reads the
//  World (plain data) and poses meshes, lights and the camera to match.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Color3, Color4, DirectionalLight, Engine, FreeCamera, GlowLayer, HemisphericLight, InstancedMesh, Matrix, Mesh,
  MeshBuilder, PointLight, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData,
} from "@babylonjs/core";
import type { Marker } from "../autopilot";
import type { MapId } from "../maps";
import { HERO_SPAWN } from "../maps";
import type { Enemy, GameEvent, Phase, World } from "../types";
import { JELLY_SPLASH, SWING_DUR, SWING_HALF_ARC } from "../sim";
import {
  HeroRig, Lib, alertMesh, crown, gloobMesh, hero, heartMesh, jellyBallMesh, keyMesh, makeLib, pot, puddleMesh,
  rupeeMesh, sunstoneMesh, tuft,
} from "./models";
import { Particles } from "./particles";
import { buildStatic, StaticWorld } from "./static";
import { hex, makeMat, toB, yawOf } from "./util";

const CAM_HEIGHT = 10.6;
const CAM_BACK = 7.4;
const CAM_DIST = Math.hypot(CAM_HEIGHT, CAM_BACK);
const BASE_FOV = 0.72;
/** Narrow (portrait) screens still see at least twice this many tiles across. */
const MIN_HALF_WIDTH = 5.0;
const TRAIL_SEGS = 14;

interface EnemyView {
  root: TransformNode;
  body: Mesh;
  mat: StandardMaterial;
  crown?: Mesh;
  alert?: Mesh;
  wasAlive: boolean;
  spawnT: number;
  yaw: number;
  /** 0 → 1 while the King puffs up for a spit. */
  puff: number;
}

interface JellyView {
  ball: Mesh;
  shadow: Mesh;
  ring: Mesh;
  fill: Mesh;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class GameView {
  engine: Engine;
  scene: Scene;
  private camera: FreeCamera;
  private hemi: HemisphericLight;
  private sun: DirectionalLight;
  private shadows: ShadowGenerator;
  private lib: Lib;
  private stat: StaticWorld;
  private particles: Particles;
  private hero: HeroRig;
  private heroLight: PointLight;
  private trail: Mesh;
  private trailMat: StandardMaterial;
  private heldKey: Mesh;
  private heldSun: Mesh;
  private tuftMasters: Mesh[];
  private potMaster: Mesh;
  private gloobMaster: Mesh;
  private kingMaster: Mesh;
  private crownMaster: Mesh;
  private pickupMasters: Record<string, Mesh>;
  private alertMaster: Mesh;
  private jellyMaster: Mesh;
  private jellyMat: StandardMaterial;
  private jellyGoldMat: StandardMaterial;
  private puddleMaster: Mesh;
  private shadowMaster: Mesh;
  private ringMaster: Mesh;
  private fillMaster: Mesh;
  private moveRing: Mesh;
  private lockRing: Mesh;
  private markerSerial = -1;
  private markerT = 0;
  /** Camera pull-back for narrow screens, and the visible half-width in tiles. */
  private zoom = 1;
  private halfW = 8.65;

  private boundWorld: World | null = null;
  private enemyViews = new Map<number, EnemyView>();
  private breakViews: InstancedMesh[] = [];
  private pickupViews = new Map<number, InstancedMesh>();
  private jellyViews = new Map<number, JellyView>();
  private puddleViews = new Map<number, Mesh>();
  private currentMap: MapId | null = null;
  private camTarget = new Vector3(HERO_SPAWN.x, 0, HERO_SPAWN.y);
  private time = 0;
  private heroYaw = yawOf(Math.PI / 2);
  private gateY = 0;
  private lidRot = 0;
  private sealS = 1;
  private smokeT = 0;
  private lastSwingId = -1;
  private trailFade = 0;
  private fxT = 0;
  private gooT = 0;

  constructor(canvas: HTMLCanvasElement) {
    const engine = new Engine(canvas, true, { stencil: true, antialias: true, preserveDrawingBuffer: false }, true);
    // Phones: cap the render resolution a little lower to keep a steady frame rate.
    const mobile = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    engine.setHardwareScalingLevel(1 / Math.min(mobile ? 1.5 : 2, window.devicePixelRatio || 1));
    this.engine = engine;
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.66, 0.86, 0.94, 1);
    scene.skipPointerMovePicking = true;
    scene.ambientColor = new Color3(0, 0, 0);

    const cam = new FreeCamera("cam", new Vector3(HERO_SPAWN.x, CAM_HEIGHT, -HERO_SPAWN.y - CAM_BACK), scene);
    cam.fov = 0.72;
    cam.minZ = 0.5;
    cam.maxZ = 140;
    cam.inputs.clear();
    this.camera = cam;

    this.hemi = new HemisphericLight("hemi", new Vector3(0.1, 1, -0.2), scene);
    this.sun = new DirectionalLight("sun", new Vector3(0.45, -1, -0.32).normalize(), scene);
    this.sun.autoUpdateExtends = false;
    this.sun.shadowFrustumSize = 34;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 90;

    const sg = new ShadowGenerator(mobile ? 1024 : 2048, this.sun);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    sg.bias = 0.0015;
    sg.normalBias = 0.015;
    sg.darkness = 0.38;
    this.shadows = sg;

    const glow = new GlowLayer("glow", scene, { mainTextureSamples: 2, blurKernelSize: 32 });
    glow.intensity = 0.55;

    this.lib = makeLib(scene);
    this.stat = buildStatic(scene, this.lib);
    glow.addExcludedMesh(this.stat.water);
    for (const m of this.stat.casters) sg.addShadowCaster(m, false);

    this.particles = new Particles(scene);

    // Hero
    this.hero = hero(scene, this.lib);
    this.hero.root.scaling.setAll(1.15);
    for (const m of this.hero.meshes) sg.addShadowCaster(m, false);
    this.heroLight = new PointLight("heroLight", new Vector3(0, 2, 0), scene);
    this.heroLight.diffuse = hex("#ffe2b8");
    this.heroLight.specular = new Color3(0, 0, 0);
    this.heroLight.range = 6;
    this.heroLight.intensity = 0.55;
    this.heroLight.setEnabled(false);

    // Sword trail (updatable ring sector, vertex alpha fades toward the tail)
    this.trail = new Mesh("trail", scene);
    const tv = new VertexData();
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    for (let i = 0; i <= TRAIL_SEGS; i++) {
      const a = i / TRAIL_SEGS;
      pos.push(0, 0, 0, 0, 0, 0);
      col.push(1, 1, 0.92, a * a * 0.55, 1, 0.97, 0.8, a * 0.3);
      if (i < TRAIL_SEGS) { const v = i * 2; idx.push(v, v + 1, v + 3, v, v + 3, v + 2); }
    }
    tv.positions = pos; tv.colors = col; tv.indices = idx;
    tv.applyToMesh(this.trail, true);
    this.trail.hasVertexAlpha = true;
    this.trailMat = makeMat(scene, "trailMat", new Color3(1, 1, 1), { emissive: hex("#d8d2bc"), unlit: true });
    this.trailMat.backFaceCulling = false;
    this.trail.material = this.trailMat;
    this.trail.parent = this.hero.root;
    this.trail.position.y = 0.42;
    this.trail.isVisible = false;

    this.heldKey = keyMesh(scene);
    this.heldKey.parent = this.hero.root;
    this.heldKey.position.set(0, 1.62, 0);
    this.heldKey.isVisible = false;
    this.heldSun = sunstoneMesh(scene);
    this.heldSun.parent = this.hero.root;
    this.heldSun.position.set(0, 1.7, 0);
    this.heldSun.isVisible = false;

    // Masters for per-entity instances
    this.tuftMasters = [0, 1, 2].map((v) => tuft(scene, this.lib, v));
    this.potMaster = pot(scene, this.lib);
    this.gloobMaster = gloobMesh(scene, this.lib, false);
    this.kingMaster = gloobMesh(scene, this.lib, true);
    this.crownMaster = crown(scene, this.lib);
    this.pickupMasters = {
      rupee: rupeeMesh(scene, "#3ddc84", "rupeeG"),
      rupee5: rupeeMesh(scene, "#4aa8ff", "rupeeB"),
      heart: heartMesh(scene, this.lib),
    };
    for (const m of [...this.tuftMasters, this.potMaster, this.gloobMaster, this.kingMaster, this.crownMaster, ...Object.values(this.pickupMasters)]) {
      m.isVisible = false;
    }
    sg.addShadowCaster(this.potMaster, false);
    for (const m of Object.values(this.pickupMasters)) sg.addShadowCaster(m, false);

    // Royal jelly: glossy pink glob; turns molten gold once swatted back.
    this.alertMaster = alertMesh(scene);
    this.jellyMaster = jellyBallMesh(scene, this.lib);
    this.jellyMat = makeMat(scene, "jellyMat", new Color3(1, 1, 1), { emissive: hex("#4a0a2c"), spec: 0.7 });
    this.jellyMat.specularPower = 24;
    this.jellyGoldMat = makeMat(scene, "jellyGoldMat", hex("#ffe08a"), { emissive: hex("#ff9a1f"), spec: 0.9 });
    this.jellyMaster.material = this.jellyMat;
    this.shadowMaster = MeshBuilder.CreateDisc("jshadow", { radius: 0.34, tessellation: 14, sideOrientation: Mesh.DOUBLESIDE }, scene);
    this.shadowMaster.rotation.x = Math.PI / 2;
    this.shadowMaster.bakeCurrentTransformIntoVertices();
    this.shadowMaster.material = makeMat(scene, "jshadowMat", hex("#140814"), { unlit: true, alpha: 0.4 });
    // Target reticle: unit-radius ring + fill, scaled to the splash radius.
    this.ringMaster = MeshBuilder.CreateTorus("jring", { diameter: 2, thickness: 0.07, tessellation: 40 }, scene);
    this.ringMaster.scaling.y = 0.3;
    this.ringMaster.bakeCurrentTransformIntoVertices();
    this.ringMaster.material = makeMat(scene, "jringMat", hex("#ff5f9a"), { emissive: hex("#ff3d7f"), unlit: true });
    this.fillMaster = MeshBuilder.CreateDisc("jfill", { radius: 1, tessellation: 32, sideOrientation: Mesh.DOUBLESIDE }, scene);
    this.fillMaster.rotation.x = Math.PI / 2;
    this.fillMaster.bakeCurrentTransformIntoVertices();
    this.fillMaster.material = makeMat(scene, "jfillMat", hex("#ff4f86"), { emissive: hex("#c0205a"), unlit: true, alpha: 0.32 });
    this.puddleMaster = puddleMesh(scene, this.lib);
    const pmat = makeMat(scene, "puddleMat", new Color3(1, 1, 1), { emissive: hex("#3a0622"), spec: 0.8 });
    pmat.specularPower = 40;
    this.puddleMaster.material = pmat;
    for (const m of [this.alertMaster, this.jellyMaster, this.shadowMaster, this.ringMaster, this.fillMaster, this.puddleMaster]) {
      m.isVisible = false;
      m.isPickable = false;
    }

    // Tap-to-move markers: a soft cream ring for "walk here", a spinning red
    // lock-on reticle (ring + four inward chevrons) for "attack that".
    this.moveRing = MeshBuilder.CreateTorus("moveRing", { diameter: 2, thickness: 0.11, tessellation: 36 }, scene);
    this.moveRing.scaling.y = 0.35;
    this.moveRing.bakeCurrentTransformIntoVertices();
    this.moveRing.material = makeMat(scene, "moveRingMat", hex("#fff3c4"), { emissive: hex("#ffe08a"), unlit: true });
    const lr = MeshBuilder.CreateTorus("lockTorus", { diameter: 2, thickness: 0.08, tessellation: 36 }, scene);
    lr.scaling.y = 0.35;
    lr.bakeCurrentTransformIntoVertices();
    const parts: Mesh[] = [lr];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const c = MeshBuilder.CreateCylinder("lockChev", { height: 0.05, diameterTop: 0.34, diameterBottom: 0.34, tessellation: 3 }, scene);
      c.scaling.set(0.9, 1, 1.25);
      c.rotation.y = -a + Math.PI / 2;
      c.position.set(Math.cos(a) * 1.28, 0, Math.sin(a) * 1.28);
      c.bakeCurrentTransformIntoVertices();
      parts.push(c);
    }
    this.lockRing = Mesh.MergeMeshes(parts, true, true)!;
    this.lockRing.name = "lockRing";
    this.lockRing.material = makeMat(scene, "lockRingMat", hex("#ff5a6a"), { emissive: hex("#ff2d48"), unlit: true });
    for (const m of [this.moveRing, this.lockRing]) { m.isVisible = false; m.isPickable = false; }
    this.resize();
  }

  resize() {
    this.engine.resize();
    // Portrait phones: widen the lens a touch and pull the camera back so the
    // hero still sees ~10 tiles across instead of a narrow keyhole.
    const wpx = this.engine.getRenderWidth(), hpx = this.engine.getRenderHeight();
    const aspect = hpx > 0 ? wpx / hpx : 16 / 9;
    const fov = aspect < 1 ? Math.min(0.95, BASE_FOV + (1 - aspect) * 0.35) : BASE_FOV;
    this.camera.fov = fov;
    const half0 = CAM_DIST * Math.tan(fov / 2) * aspect;
    this.zoom = Math.max(1, MIN_HALF_WIDTH / half0);
    this.halfW = half0 * this.zoom;
  }

  /**
   * Touch picking: screen point (CSS px relative to the canvas) → the ground
   * point under it, plus the monster under the finger (generous, screen-space).
   */
  pick(px: number, py: number, w: World): { x: number; y: number; enemyId: number | null } | null {
    const ray = this.scene.createPickingRay(px, py, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    const gx = ray.origin.x + ray.direction.x * t;
    const gz = ray.origin.z + ray.direction.z * t;
    const canvas = this.engine.getRenderingCanvas();
    const cw = canvas?.clientWidth ?? 1, ch = canvas?.clientHeight ?? 1;
    const vp = this.camera.viewport.toGlobal(cw, ch);
    const tm = this.scene.getTransformMatrix();
    let enemyId: number | null = null;
    let bestD = Infinity;
    for (const e of w.enemies) {
      if (!e.alive || e.map !== w.player.map) continue;
      const king = e.kind === "king";
      const allow = king ? 78 : 46;
      for (const h of king ? [0.4, 1.3] : [0.25, 0.6]) {
        const s = Vector3.Project(new Vector3(e.x, h, -e.y), Matrix.Identity(), tm, vp);
        const d = Math.hypot(s.x - px, s.y - py);
        if (d < allow && d < bestD) { bestD = d; enemyId = e.id; }
      }
    }
    return { x: gx, y: -gz, enemyId };
  }

  dispose() {
    this.scene.dispose();
    this.engine.dispose();
  }

  // ── Per-world bindings ──
  private bindWorld(w: World) {
    for (const v of this.enemyViews.values()) v.root.dispose(false, false);
    for (const b of this.breakViews) b.dispose();
    for (const p of this.pickupViews.values()) p.dispose();
    this.clearJellyViews();
    this.enemyViews.clear();
    this.breakViews = [];
    this.pickupViews.clear();
    this.particles.clear();

    for (const e of w.enemies) this.createEnemyView(e);
    for (const b of w.breakables) {
      const master = b.kind === "pot" ? this.potMaster : this.tuftMasters[b.id % 3];
      const inst = master.createInstance(`brk${b.id}`);
      inst.parent = b.map === "over" ? this.stat.overRoot : this.stat.dungeonRoot;
      inst.position = toB(b.x, b.y);
      const r = ((b.id * 9301 + 49297) % 233280) / 233280;
      inst.rotation.y = r * Math.PI * 2;
      const s = b.kind === "pot" ? 0.95 + r * 0.15 : 0.85 + r * 0.35;
      inst.scaling.set(s, b.kind === "pot" ? s * (0.95 + r * 0.12) : s, s);
      this.breakViews.push(inst);
    }
    this.boundWorld = w;
    this.currentMap = null;
    this.lastSwingId = -1;
    this.gateY = w.quest.gateOpen ? -1.25 : 0;
    this.lidRot = w.quest.chestOpen ? 1.9 : 0;
    this.sealS = w.quest.bossDead ? 0 : 1;
  }

  private createEnemyView(e: Enemy): EnemyView {
    const root = new TransformNode(`enemy${e.id}`, this.scene);
    root.parent = e.map === "over" ? this.stat.overRoot : this.stat.dungeonRoot;
    const king = e.kind === "king";
    const body = (king ? this.kingMaster : this.gloobMaster).clone(`ebody${e.id}`, root)!;
    body.isVisible = true;
    const mat = this.lib.vc.clone(`emat${e.id}`) as StandardMaterial;
    mat.specularColor = new Color3(0.5, 0.5, 0.55);
    mat.specularPower = 28; // glossy jelly
    body.material = mat;
    this.shadows.addShadowCaster(body, false);
    let cr: Mesh | undefined;
    let alert: Mesh | undefined;
    if (king) {
      cr = this.crownMaster.clone(`crown${e.id}`, body)!;
      cr.isVisible = true;
      cr.position.set(0, 0.78, -0.02);
      cr.rotation.x = -0.12;
      this.shadows.addShadowCaster(cr, false);
    } else {
      alert = this.alertMaster.clone(`alert${e.id}`, root)!;
      alert.position.set(0, 1.15, 0);
      alert.isVisible = false;
    }
    const v: EnemyView = { root, body, mat, crown: cr, alert, wasAlive: e.alive, spawnT: e.minion ? 0 : 1, yaw: yawOf(e.face), puff: 0 };
    this.enemyViews.set(e.id, v);
    return v;
  }

  private applyMap(map: MapId, w: World) {
    this.currentMap = map;
    const over = map === "over";
    this.stat.overRoot.setEnabled(over);
    this.stat.dungeonRoot.setEnabled(!over);
    if (over) {
      this.scene.clearColor = new Color4(0.66, 0.86, 0.94, 1);
      this.hemi.intensity = 0.62;
      this.hemi.diffuse = hex("#fff3df");
      this.hemi.groundColor = hex("#5d6b52");
      this.sun.setEnabled(true);
      this.sun.intensity = 1.05;
      this.sun.diffuse = hex("#fff0d2");
      this.heroLight.setEnabled(false);
      for (const l of this.stat.torchLights) l.setEnabled(false);
    } else {
      this.scene.clearColor = new Color4(0.04, 0.035, 0.06, 1);
      this.hemi.intensity = 0.36;
      this.hemi.diffuse = hex("#9aa0d8");
      this.hemi.groundColor = hex("#2a2030");
      this.sun.setEnabled(false);
      this.heroLight.setEnabled(true);
      for (const l of this.stat.torchLights) l.setEnabled(true);
    }
    this.particles.clear();
    for (const v of this.pickupViews.values()) v.dispose();
    this.pickupViews.clear();
    this.clearJellyViews();
    // Snap the camera so a map change never swoops across the void.
    const t = this.cameraGoal(w);
    this.camTarget.copyFrom(t);
  }

  private cameraGoal(w: World): Vector3 {
    const p = w.player;
    // Keep the map edges just off-screen; narrow screens follow the hero sideways.
    const follow = (x: number, mapW: number) => {
      const lo = this.halfW + 0.85, hi = mapW - this.halfW - 0.85;
      return lo >= hi ? mapW / 2 : clamp(x, lo, hi);
    };
    if (p.map === "over") return new Vector3(follow(p.x, 48), 0, clamp(p.y, 4.6, 20.2));
    return new Vector3(follow(p.x, 16), 0, clamp(p.y, 5.2, 18.2));
  }

  // ── Events from the simulation ──
  handleEvent(e: GameEvent) {
    if (e.t !== "fx") return;
    if (e.map !== this.currentMap) return;
    this.particles.burst(e.kind, e.x, e.y, e.dx, e.dy, e.n);
  }

  // ── Frame ──
  render(w: World, alpha: number, dt: number, phase: Phase, marker: Marker | null = null) {
    this.time += dt;
    const t = this.time;
    if (w !== this.boundWorld) this.bindWorld(w);
    const p = w.player;
    if (p.map !== this.currentMap) this.applyMap(p.map, w);

    // Camera
    let goal = this.cameraGoal(w);
    if (phase === "title") {
      goal = new Vector3(HERO_SPAWN.x + Math.sin(t * 0.12) * 3.5, 0, HERO_SPAWN.y - 1.5 + Math.cos(t * 0.09) * 1.2);
    }
    const k = 1 - Math.exp(-dt * 6.5);
    this.camTarget.x = lerp(this.camTarget.x, goal.x, k);
    this.camTarget.z = lerp(this.camTarget.z, goal.z, k);
    const sh = w.fx.shake * w.fx.shake * 0.42;
    const sx = (Math.sin(t * 57.3) + Math.sin(t * 91.7)) * 0.5 * sh;
    const sz = (Math.sin(t * 63.1 + 1.3) + Math.sin(t * 79.9)) * 0.5 * sh;
    const z = this.zoom;
    this.camera.position.set(this.camTarget.x + sx, CAM_HEIGHT * z + sz * 0.5, -this.camTarget.z - CAM_BACK * z + sz);
    this.camera.setTarget(new Vector3(this.camTarget.x + sx * 0.6, 0.6, -this.camTarget.z + sz * 0.6));

    // Sun & shadows follow the view
    const focus = new Vector3(this.camTarget.x, 0, -this.camTarget.z + 2);
    this.sun.position = focus.subtract(this.sun.direction.scale(40));

    this.poseHero(w, alpha, dt, phase);
    this.poseEnemies(w, alpha, dt);
    this.poseBreakables(w);
    this.posePickups(w, alpha);
    this.poseJellies(w, alpha, dt);
    this.poseMarker(marker, w, alpha, dt);
    this.poseWorldProps(w, dt);
    // Shared emitter clock (~14 Hz) for trails and dazed stars.
    this.fxT = this.fxT <= 0 ? 0.07 : this.fxT - dt;

    this.particles.update(dt);
    this.scene.render();
  }

  private poseHero(w: World, alpha: number, dt: number, phase: Phase) {
    const p = w.player;
    const h = this.hero;
    const t = this.time;
    const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha);
    h.root.position.set(x, 0, -y);
    this.heroLight.position.set(x, 1.8, -y - 0.4);

    // Facing: near-instant turn, snapped while swinging so the arc reads true.
    const holdingPose = !!p.holding;
    const goalYaw = holdingPose ? yawOf(Math.PI / 2) : yawOf(p.face);
    this.heroYaw = p.attackT > 0 ? goalYaw : lerpAngle(this.heroYaw, goalYaw, 1 - Math.exp(-dt * 22));
    h.root.rotation.y = this.heroYaw;

    // Death: spin, then topple.
    if (p.dead) {
      const d = p.deathT;
      h.root.rotation.y = this.heroYaw + Math.min(d, 0.9) * 14;
      h.body.rotation.x = d > 0.9 ? -Math.min(1, (d - 0.9) * 4) * 1.35 : 0;
      h.body.position.y = d > 0.9 ? -Math.min(1, (d - 0.9) * 4) * 0.12 : 0;
      h.root.setEnabled(true);
      h.sword.isVisible = false;
      this.trail.isVisible = false;
      return;
    }
    h.body.rotation.x = 0;

    // Invulnerability blink
    const blink = p.invuln > 0 && Math.floor(t * 18) % 2 === 0;
    h.root.setEnabled(!blink);

    // Walk cycle
    const sp = Math.hypot(p.vx, p.vy);
    const ph = p.walkPhase * Math.PI;
    const walkAmt = Math.min(1, sp / 4);
    const idle = phase === "title" ? Math.sin(t * 2.2) * 0.015 : Math.sin(t * 2.6) * 0.012;
    h.body.position.y = Math.abs(Math.sin(ph)) * 0.07 * walkAmt + idle;
    h.body.rotation.x = 0.12 * walkAmt;
    h.footL.position.z = 0.02 + Math.sin(ph) * 0.13 * walkAmt;
    h.footR.position.z = 0.02 - Math.sin(ph) * 0.13 * walkAmt;
    h.footL.position.y = 0.06 + Math.max(0, Math.cos(ph)) * 0.05 * walkAmt;
    h.footR.position.y = 0.06 + Math.max(0, -Math.cos(ph)) * 0.05 * walkAmt;
    h.scarf.rotation.y = Math.sin(t * 3) * 0.06;

    // Hands
    if (holdingPose) {
      h.handL.position.set(-0.16, 1.18, 0.02);
      h.handR.position.set(0.16, 1.18, 0.02);
    } else {
      h.handL.position.set(-0.27, 0.38, 0.04 - Math.sin(ph) * 0.1 * walkAmt);
      h.handR.position.set(0.27, 0.38, 0.04 + Math.sin(ph) * 0.1 * walkAmt);
    }
    this.heldKey.isVisible = p.holding === "key";
    this.heldSun.isVisible = p.holding === "sunstone";
    this.heldKey.rotation.y = t * 2;
    this.heldSun.rotation.y = t * 1.6;
    this.heldSun.position.y = 1.7 + Math.sin(t * 3) * 0.05;

    // Sword swing: the pivot sweeps from −arc to +arc around the facing.
    if (p.swingId !== this.lastSwingId && p.attackT > 0) {
      this.lastSwingId = p.swingId;
      this.trailFade = 0;
    }
    if (p.attackT > 0) {
      const prog = 1 - p.attackT / SWING_DUR;
      const e = 1 - Math.pow(1 - Math.min(1, prog * 1.15), 2.2);
      const cur = -SWING_HALF_ARC + SWING_HALF_ARC * 2 * e;
      h.swordPivot.rotation.y = cur;
      h.sword.isVisible = true;
      h.sheath.isVisible = false;
      h.handR.position.set(Math.sin(cur) * 0.32, 0.42, Math.cos(cur) * 0.32);
      h.body.rotation.y = cur * 0.25;
      this.updateTrail(-SWING_HALF_ARC, cur);
      this.trail.isVisible = true;
      this.trailMat.alpha = 1;
      this.trailFade = 1;
    } else {
      h.sword.isVisible = false;
      h.sheath.isVisible = true;
      h.body.rotation.y = 0;
      if (this.trailFade > 0) {
        this.trailFade = Math.max(0, this.trailFade - dt * 9);
        this.trailMat.alpha = this.trailFade;
        this.trail.isVisible = this.trailFade > 0;
      } else this.trail.isVisible = false;
    }
  }

  private updateTrail(a0: number, a1: number) {
    const arr = new Float32Array((TRAIL_SEGS + 1) * 6);
    const r0 = 0.42, r1 = 1.28;
    for (let i = 0; i <= TRAIL_SEGS; i++) {
      const a = a0 + (a1 - a0) * (i / TRAIL_SEGS);
      const s = Math.sin(a), c = Math.cos(a);
      arr.set([s * r0, 0, c * r0, s * r1, 0.02, c * r1], i * 6);
    }
    this.trail.updateVerticesData(VertexBuffer.PositionKind, arr);
    this.trail.refreshBoundingInfo();
  }

  private poseEnemies(w: World, alpha: number, dt: number) {
    const t = this.time;
    const live = new Set<number>();
    w.enemies.forEach((e: Enemy) => {
      live.add(e.id);
      const v = this.enemyViews.get(e.id) ?? this.createEnemyView(e);
      const visible = e.alive && e.map === w.player.map;
      if (e.alive && !v.wasAlive) v.spawnT = 0;
      v.wasAlive = e.alive;
      v.root.setEnabled(visible);
      if (!visible) return;
      v.spawnT = Math.min(1, v.spawnT + dt * 3.5);
      const x = lerp(e.px, e.x, alpha), y = lerp(e.py, e.y, alpha);
      const king = e.kind === "king";
      const base = king ? 1.85 : 0.8;
      v.yaw = lerpAngle(v.yaw, yawOf(e.face), 1 - Math.exp(-dt * 10));
      const sp = Math.hypot(e.vx, e.vy);
      const ph = t * (king ? 7 : 10) + e.id * 1.3;
      let sxz = 1, sy = 1, hop = 0, stretch = 1;
      // King's spit tell: he gulps air and swells up (eases in/out smoothly).
      v.puff = e.state === "inflate" ? Math.min(1, v.puff + dt * 1.25) : Math.max(0, v.puff - dt * 6);
      if (e.state === "sleep") {
        const b = Math.sin(t * 1.6);
        sy = 0.9 + b * 0.06; sxz = 1.04 - b * 0.03;
      } else if (e.state === "hurt") {
        sy = 0.78; sxz = 1.18;
      } else if (e.state === "windup") {
        sy = 0.72 + Math.sin(t * 60) * 0.03; sxz = 1.2;
      } else if (e.state === "lunge") {
        sy = 0.9; sxz = 0.95;
        hop = 0.15;
      } else if (e.state === "spit") {
        sy = 0.82; sxz = 1.06; stretch = 1.22; // lurches forward as the glob leaves
      } else if (sp > 0.3) {
        const b = Math.abs(Math.sin(ph));
        hop = b * (king ? 0.22 : 0.16);
        sy = 0.88 + b * 0.22; sxz = 1.08 - b * 0.1;
      } else {
        const b = Math.sin(t * 3 + e.id);
        sy = 1 + b * 0.04; sxz = 1 - b * 0.02;
      }
      if (v.puff > 0) {
        const p = v.puff * v.puff;
        const wob = Math.sin(t * 38) * 0.035 * v.puff;
        sxz *= 1 + 0.3 * p + wob; sy *= 1 + 0.22 * p - wob;
      }
      // "!" — startled hop when a gloob spots the hero.
      if (v.alert) {
        const a = e.alertT;
        v.alert.isVisible = a > 0;
        if (a > 0) {
          const k = 1 - a / 0.75;
          const popS = k < 0.25 ? (k / 0.25) * 1.35 : 1.35 - Math.min(0.35, (k - 0.25) * 1.4);
          v.alert.scaling.setAll(Math.max(0.01, popS) * 1.6);
          v.alert.position.y = 1.25 + Math.sin(k * Math.PI) * 0.15;
          if (k < 0.4) hop += Math.sin((k / 0.4) * Math.PI) * 0.3;
        }
      }
      const pop = v.spawnT < 1 ? Math.sin(v.spawnT * Math.PI * 0.5) * (1 + Math.sin(v.spawnT * Math.PI) * 0.25) : 1;
      v.root.position.set(x, hop, -y);
      v.root.rotation.y = v.yaw;
      const s = base * pop;
      v.body.scaling.set(s * sxz, s * sy, s * sxz * (e.state === "lunge" ? 1.25 : stretch));
      if (e.state === "windup") v.body.position.x = Math.sin(t * 70) * 0.04;
      else v.body.position.x = 0;
      // Dazed: a woozy sway with little stars circling the crown.
      const dazed = king && e.state === "recover";
      v.body.rotation.z = dazed ? Math.sin(t * 5.5) * 0.12 : 0;
      if (dazed && this.fxT <= 0) {
        for (let i = 0; i < 2; i++) {
          const a = t * 5 + i * Math.PI;
          const pos = new Vector3(x + Math.cos(a) * 0.75, 2.05 + Math.sin(t * 9 + i) * 0.08, -y + Math.sin(a) * 0.75);
          this.particles.emit("star", pos, new Vector3(-Math.sin(a) * 1.2, 0.15, Math.cos(a) * 1.2), 0.45, 1.1, { spin: 10 });
        }
      }
      if (v.crown) v.crown.position.y = 0.78 + v.puff * 0.1 * Math.abs(Math.sin(t * 22));
      // Hit flash (white) / windup glow (red) / puff-up glow (hot pink-gold) / rage tint
      if (e.flash > 0) v.mat.emissiveColor.set(1, 1, 1);
      else if (e.state === "windup") { const f = 0.35 + Math.sin(t * 30) * 0.25; v.mat.emissiveColor.set(f, 0.05, 0.1); }
      else if (v.puff > 0) { const f = (0.3 + Math.sin(t * 26) * 0.2) * v.puff; v.mat.emissiveColor.set(f * 1.2, f * 0.55, f * 0.3); }
      else if (e.iframes > 0 && Math.floor(t * 20) % 2 === 0) v.mat.emissiveColor.set(0.35, 0.1, 0.25);
      else v.mat.emissiveColor.set(0, 0, 0);
      if (king && e.enraged) v.mat.diffuseColor.set(1, 0.72, 0.68);
      else v.mat.diffuseColor.set(1, 1, 1);
    });
    for (const [id, v] of this.enemyViews) {
      if (!live.has(id)) { v.root.dispose(false, false); this.enemyViews.delete(id); }
    }
  }

  // ── Tap-to-move marker ──
  private poseMarker(m: Marker | null, w: World, alpha: number, dt: number) {
    const show = !!m && m.map === this.currentMap;
    this.moveRing.isVisible = show && !m!.hostile;
    this.lockRing.isVisible = show && m!.hostile;
    if (!show || !m) return;
    if (m.serial !== this.markerSerial) { this.markerSerial = m.serial; this.markerT = 0; }
    this.markerT += dt;
    const t = this.time;
    const k = Math.min(1, this.markerT / 0.22);
    const pop = 1 + (1 - k) * (1 - k) * 0.9;
    let x = m.x, y = m.y;
    if (m.hostile) {
      // Follow the monster smoothly (interpolated like its mesh).
      const e = w.enemies.find((q) => q.id === m.enemyId);
      if (e) { x = lerp(e.px, e.x, alpha); y = lerp(e.py, e.y, alpha); }
      const s = m.r * pop * (1 + Math.sin(t * 9) * 0.06);
      this.lockRing.position.set(x, 0.08, -y);
      this.lockRing.scaling.set(s, 1, s);
      this.lockRing.rotation.y = t * 2.4;
      this.lockRing.visibility = 0.65 + 0.35 * k;
    } else {
      const s = m.r * pop * (1 + Math.sin(t * 6) * 0.08);
      this.moveRing.position.set(x, 0.07, -y);
      this.moveRing.scaling.set(s, 1, s);
      this.moveRing.visibility = 0.55 + 0.35 * Math.abs(Math.sin(t * 4));
    }
  }

  // ── Royal jelly (King's lob) and the sticky puddles it leaves ──
  private clearJellyViews() {
    for (const v of this.jellyViews.values()) {
      v.ball.dispose(); v.shadow.dispose(); v.ring.dispose(); v.fill.dispose();
    }
    for (const m of this.puddleViews.values()) m.dispose();
    this.jellyViews.clear();
    this.puddleViews.clear();
  }

  private cloneShown(master: Mesh, name: string): Mesh {
    const m = master.clone(name)!;
    m.isVisible = true;
    m.isPickable = false;
    return m;
  }

  private poseJellies(w: World, alpha: number, dt: number) {
    const t = this.time;
    const map = this.currentMap;
    const emitNow = this.fxT <= 0;

    const seen = new Set<number>();
    for (const j of w.jellies) {
      if (j.map !== map || j.dead) continue;
      seen.add(j.id);
      let v = this.jellyViews.get(j.id);
      if (!v) {
        v = {
          ball: this.cloneShown(this.jellyMaster, `jb${j.id}`),
          shadow: this.cloneShown(this.shadowMaster, `js${j.id}`),
          ring: this.cloneShown(this.ringMaster, `jr${j.id}`),
          fill: this.cloneShown(this.fillMaster, `jf${j.id}`),
        };
        this.jellyViews.set(j.id, v);
      }
      const x = lerp(j.px, j.x, alpha), y = lerp(j.py, j.y, alpha);
      const z = Math.max(0, lerp(j.pz, j.z, alpha));
      // Ball: wobbling, spinning glob; molten gold once swatted back.
      const wob = Math.sin(t * 24 + j.id) * 0.12;
      v.ball.position.set(x, z + 0.3, -y);
      v.ball.rotation.set(t * 5 + j.id, t * 3.3, 0);
      v.ball.scaling.set(1.15 + wob, 1.15 - wob, 1.15 + wob);
      v.ball.material = j.returned ? this.jellyGoldMat : this.jellyMat;
      if (emitNow) {
        const pos = new Vector3(x + (Math.random() - 0.5) * 0.2, z + 0.3, -y + (Math.random() - 0.5) * 0.2);
        this.particles.emit("royal", pos, new Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4), 0.45, 0.8, { grav: 2, grow: -0.8 });
      }
      // Shadow on the floor right under the ball: tightens as it falls.
      const hk = clamp(z / 4, 0, 1);
      v.shadow.position.set(x, 0.04, -y);
      v.shadow.scaling.setAll(1.15 - hk * 0.5);
      v.shadow.visibility = 1 - hk * 0.55;
      // Landing reticle: a ring that shrinks onto the splash zone while the fill grows in.
      const showReticle = !j.returned;
      v.ring.isVisible = showReticle;
      v.fill.isVisible = showReticle;
      if (showReticle) {
        const u = clamp(j.t / j.dur, 0, 1);
        const rs = JELLY_SPLASH * (1.9 - 0.9 * u);
        v.ring.position.set(j.tx, 0.06, -j.ty);
        v.ring.scaling.set(rs, 1, rs);
        v.ring.rotation.y = t * 1.5;
        v.ring.visibility = 0.55 + 0.45 * Math.abs(Math.sin(t * (8 + u * 18)));
        const fs = Math.max(0.02, JELLY_SPLASH * u);
        v.fill.position.set(j.tx, 0.05, -j.ty);
        v.fill.scaling.set(fs, 1, fs);
        v.fill.visibility = 0.4 + 0.6 * u;
      }
    }
    for (const [id, v] of this.jellyViews) {
      if (seen.has(id)) continue;
      v.ball.dispose(); v.shadow.dispose(); v.ring.dispose(); v.fill.dispose();
      this.jellyViews.delete(id);
    }

    // Puddles: pop in with a little overshoot, fade as they dry.
    const pseen = new Set<number>();
    for (const pd of w.puddles) {
      if (pd.map !== map) continue;
      pseen.add(pd.id);
      let m = this.puddleViews.get(pd.id);
      if (!m) {
        m = this.cloneShown(this.puddleMaster, `pd${pd.id}`);
        m.rotation.y = ((pd.id * 2.399) % (Math.PI * 2));
        this.puddleViews.set(pd.id, m);
      }
      const age = pd.max - pd.life;
      const k = clamp(age / 0.25, 0, 1);
      const pop = k < 1 ? Math.sin(k * Math.PI * 0.5) * (1 + Math.sin(k * Math.PI) * 0.2) : 1 + Math.sin(t * 2.5 + pd.id) * 0.015;
      const s = (pd.r / 0.9) * Math.max(0.01, pop);
      m.position.set(pd.x, 0.03, -pd.y);
      m.scaling.set(s, 1, s);
      m.visibility = Math.min(1, pd.life / 0.8);
    }
    for (const [id, m] of this.puddleViews) {
      if (!pseen.has(id)) { m.dispose(); this.puddleViews.delete(id); }
    }

    // Gooey feet: the hero drips jelly while wading through a puddle.
    const p = w.player;
    this.gooT -= dt;
    if (p.goo > 0 && !p.dead && Math.hypot(p.vx, p.vy) > 0.4 && this.gooT <= 0) {
      this.gooT = 0.12;
      const pos = new Vector3(p.x + (Math.random() - 0.5) * 0.3, 0.12, -p.y + (Math.random() - 0.5) * 0.3);
      this.particles.emit("jelly", pos, new Vector3((Math.random() - 0.5) * 0.8, 1.4 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8), 0.5, 0.7, { grav: 9, bounce: true });
    }
  }

  private poseBreakables(w: World) {
    const t = this.time;
    w.breakables.forEach((b, i) => {
      const v = this.breakViews[i];
      if (!v) return;
      const show = !b.broken;
      if (v.isEnabled() !== show) v.setEnabled(show);
      if (!show || b.kind !== "grass") return;
      v.rotation.z = Math.sin(t * 28) * 0.28 * b.wobble + Math.sin(t * 1.4 + b.x) * 0.04;
      v.rotation.x = Math.cos(t * 1.1 + b.y) * 0.04;
    });
  }

  private posePickups(w: World, alpha: number) {
    const t = this.time;
    const seen = new Set<number>();
    for (const k of w.pickups) {
      if (k.map !== w.player.map) continue;
      seen.add(k.id);
      let v = this.pickupViews.get(k.id);
      if (!v) {
        v = this.pickupMasters[k.kind].createInstance(`pk${k.id}`);
        this.pickupViews.set(k.id, v);
      }
      const x = lerp(k.px, k.x, alpha), y = lerp(k.py, k.y, alpha);
      const bob = Math.sin(t * 4 + k.id) * 0.05;
      v.position.set(x, 0.28 + k.z + bob, -y);
      v.rotation.y = k.kind === "heart" ? Math.sin(t * 2 + k.id) * 0.6 : t * 3 + k.id;
      v.isVisible = k.permanent || k.life > 3 || Math.floor(t * 12) % 2 === 0;
    }
    for (const [id, v] of this.pickupViews) {
      if (!seen.has(id)) { v.dispose(); this.pickupViews.delete(id); }
    }
  }

  private poseWorldProps(w: World, dt: number) {
    const t = this.time;
    const s = this.stat;
    const q = w.quest;
    if (this.currentMap === "over") {
      s.water.position.y = Math.sin(t * 1.3) * 0.012;
      s.waterMat.emissiveColor.set(0.05 + Math.sin(t * 0.9) * 0.015, 0.22 + Math.sin(t * 1.1) * 0.02, 0.29);
      s.glints.visibility = 0.45 + Math.sin(t * 2.4) * 0.35;
      const f = 0.85 + Math.sin(t * 7) * 0.06 + Math.sin(t * 13.3) * 0.04;
      s.lampMat.emissiveColor.set(1 * f, 0.71 * f, 0.28 * f);
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.45; this.particles.smoke(s.chimney); }
      return;
    }
    // Dungeon
    const closed = !q.gateOpen || q.bossShut;
    const gGoal = closed ? 0 : -1.25;
    this.gateY = gGoal > this.gateY ? Math.min(gGoal, this.gateY + dt * 9) : Math.max(gGoal, this.gateY - dt * 1.4);
    s.gate.position.y = this.gateY + (this.gateY > gGoal - 0.01 && this.gateY < 0 && !closed ? Math.sin(t * 50) * 0.01 : 0);
    s.gate.setEnabled(this.gateY > -1.2);

    const lidGoal = q.chestOpen ? 1.9 : 0;
    this.lidRot = lerp(this.lidRot, lidGoal, 1 - Math.exp(-dt * 6));
    s.chestLid.rotation.x = this.lidRot;
    this.sealS = q.bossDead ? Math.max(0, this.sealS - dt * 1.5) : 1;
    const pulse = 1 + Math.sin(t * 3) * 0.04;
    s.chestSeal.scaling.set(this.sealS * pulse, 0.75 * this.sealS * (2 - pulse), 0.85 * this.sealS * pulse);
    s.chestSeal.setEnabled(this.sealS > 0.01);

    s.key.setEnabled(!q.keyTaken);
    s.key.position.y = 1.2 + Math.sin(t * 2.2) * 0.08;
    s.key.rotation.y = t * 1.6;

    // Torches: flicker, and the 4 nearest get real point lights.
    const px = w.player.x, py = w.player.y;
    const ranked = s.torchFlames
      .map((f) => ({ f, d: (f.pos.x - px) ** 2 + (-f.pos.z - py) ** 2 }))
      .sort((a, b) => a.d - b.d);
    for (const { f } of ranked) {
      const fl = 1 + Math.sin(t * 19 + f.seed) * 0.12 + Math.sin(t * 31 + f.seed * 2) * 0.07;
      f.outer.scaling.set(fl, 1.5 * fl * (1 + Math.sin(t * 23 + f.seed) * 0.08), fl);
      f.inner.scaling.setAll(fl * 0.95);
    }
    s.torchLights.forEach((l, i) => {
      const r = ranked[i];
      if (!r) { l.setEnabled(false); return; }
      l.position.copyFrom(r.f.pos);
      l.intensity = 0.85 + Math.sin(t * 17 + r.f.seed) * 0.1 + Math.sin(t * 29 + r.f.seed) * 0.06;
    });
  }
}
