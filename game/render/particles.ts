// Purely-visual particle bursts (sparks, grass bits, pot shards, poofs…).
// They never feed back into the simulation.
import { InstancedMesh, Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { FxKind } from "../types";
import { hex, makeMat, toB } from "./util";

interface P {
  mesh: InstancedMesh;
  pos: Vector3;
  vel: Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  spin: Vector3;
  grav: number;
  drag: number;
  bounce: boolean;
}

interface KindDef {
  master: Mesh;
  pool: InstancedMesh[];
}

export class Particles {
  private kinds = new Map<string, KindDef>();
  private live: P[] = [];
  private root: TransformNode;

  constructor(private scene: Scene) {
    this.root = new TransformNode("fxRoot", scene);
    const mk = (name: string, mesh: Mesh, color: string, emissive?: string, unlit = false) => {
      mesh.material = makeMat(scene, name + "Mat", hex(color), { emissive: emissive ? hex(emissive) : undefined, unlit });
      mesh.isVisible = false;
      mesh.parent = this.root;
      mesh.isPickable = false;
      this.kinds.set(name, { master: mesh, pool: [] });
    };
    mk("spark", MeshBuilder.CreatePolyhedron("spark", { type: 1, size: 0.07 }, scene), "#fff6c8", "#ffe27a", true);
    mk("ring", MeshBuilder.CreateTorus("ring", { diameter: 0.6, thickness: 0.05, tessellation: 14 }, scene), "#ffffff", "#fff2b0", true);
    mk("blade", MeshBuilder.CreateBox("pblade", { width: 0.04, height: 0.16, depth: 0.015 }, scene), "#79c24f", "#1c3a10");
    mk("bladeLight", MeshBuilder.CreateBox("pbladeL", { width: 0.04, height: 0.12, depth: 0.015 }, scene), "#b4e26e", "#2a4a14");
    mk("shard", MeshBuilder.CreatePolyhedron("shard", { type: 0, size: 0.07 }, scene), "#c8714a", "#3a1a0a");
    mk("shardLight", MeshBuilder.CreatePolyhedron("shardL", { type: 0, size: 0.05 }, scene), "#e09a6c", "#3a1a0a");
    mk("puff", MeshBuilder.CreateIcoSphere("puff", { radius: 0.18, subdivisions: 1 }, scene), "#f4eefc", "#6a6080");
    mk("jelly", MeshBuilder.CreateIcoSphere("jelly", { radius: 0.09, subdivisions: 1 }, scene), "#a77be8", "#3a1a6a");
    mk("royal", MeshBuilder.CreateIcoSphere("royal", { radius: 0.1, subdivisions: 1 }, scene), "#e070b0", "#5a1040");
    mk("star", MeshBuilder.CreatePolyhedron("star", { type: 1, size: 0.06 }, scene), "#fff3a0", "#ffd84a", true);
    mk("dust", MeshBuilder.CreateIcoSphere("dust", { radius: 0.14, subdivisions: 0 }, scene), "#b9ab95", "#3a3020");
    mk("smoke", MeshBuilder.CreateIcoSphere("smoke", { radius: 0.13, subdivisions: 1 }, scene), "#e8e4e0", "#555050");
    mk("drop", MeshBuilder.CreatePolyhedron("drop", { type: 1, size: 0.05 }, scene), "#bfeaff", "#4aa0c0");
    const gooRing = MeshBuilder.CreateTorus("gooRing", { diameter: 0.6, thickness: 0.07, tessellation: 18 }, scene);
    gooRing.scaling.y = 0.25;
    gooRing.bakeCurrentTransformIntoVertices();
    mk("goo", gooRing, "#f08ac8", "#c03a8a", true);
  }

  private get(kind: string): InstancedMesh {
    const k = this.kinds.get(kind)!;
    const m = k.pool.pop();
    if (m) { m.setEnabled(true); return m; }
    const inst = k.master.createInstance(kind + "_i");
    inst.parent = this.root;
    inst.isPickable = false;
    (inst as InstancedMesh & { _kind?: string })._kind = kind;
    return inst;
  }

  private add(kind: string, pos: Vector3, vel: Vector3, life: number, size: number, opts: Partial<Pick<P, "grow" | "grav" | "drag" | "bounce">> & { spin?: number } = {}) {
    if (this.live.length > 600) return;
    const mesh = this.get(kind);
    const s = opts.spin ?? 0;
    this.live.push({
      mesh, pos: pos.clone(), vel, life, max: life, size, grow: opts.grow ?? 0,
      spin: new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s),
      grav: opts.grav ?? 0, drag: opts.drag ?? 0, bounce: opts.bounce ?? false,
    });
    mesh.position.copyFrom(pos);
    mesh.scaling.setAll(size);
  }

  burst(kind: FxKind, x: number, y: number, dx = 0, dy = 0, n?: number) {
    const R = Math.random;
    const at = (h: number) => toB(x, y, h);
    const radial = (speed: number, up: number, spread = 1) => {
      const a = R() * Math.PI * 2;
      const s = speed * (0.5 + R() * 0.5) * spread;
      return new Vector3(Math.cos(a) * s, up * (0.6 + R() * 0.6), Math.sin(a) * s);
    };
    switch (kind) {
      case "spark": {
        const count = n ?? 7;
        // Sparks spray away from the blow (dx,dy is the hit direction in sim space).
        for (let i = 0; i < count; i++) {
          const a = Math.atan2(-dy, dx) + (R() - 0.5) * 1.8;
          const s = 4 + R() * 4;
          this.add("spark", at(0.5), new Vector3(Math.cos(a) * s, 1.5 + R() * 3, Math.sin(a) * s), 0.18 + R() * 0.15, 1, { grav: 12, drag: 4, spin: 20 });
        }
        this.add("ring", at(0.5), Vector3.Zero(), 0.14, 0.3, { grow: 9 });
        break;
      }
      case "grass":
        for (let i = 0; i < (n ?? 12); i++) {
          this.add(R() < 0.5 ? "blade" : "bladeLight", at(0.25), radial(2.6, 4.5), 0.6 + R() * 0.4, 1, { grav: 14, drag: 1.5, spin: 18, bounce: true });
        }
        break;
      case "shards":
        for (let i = 0; i < (n ?? 14); i++) {
          this.add(R() < 0.6 ? "shard" : "shardLight", at(0.3), radial(3, 5), 0.8 + R() * 0.4, 0.8 + R() * 0.8, { grav: 16, drag: 0.6, spin: 16, bounce: true });
        }
        for (let i = 0; i < 4; i++) this.add("dust", at(0.2), radial(1, 0.8), 0.45, 0.8, { grow: 1.8, drag: 3 });
        break;
      case "poof":
        for (let i = 0; i < (n ?? 12); i++) {
          this.add("puff", at(0.35), radial(2.2, 1.2), 0.45 + R() * 0.2, 0.7 + R() * 0.5, { grow: 1.5, drag: 4, grav: -1.5 });
        }
        for (let i = 0; i < 6; i++) this.add("jelly", at(0.4), radial(3, 5), 0.6, 1, { grav: 14, bounce: true });
        break;
      case "bigpoof":
        for (let i = 0; i < (n ?? 40); i++) {
          this.add("puff", at(0.6 + R()), radial(4.5, 2), 0.7 + R() * 0.5, 1.2 + R() * 1.2, { grow: 1.2, drag: 3, grav: -1 });
        }
        for (let i = 0; i < 24; i++) this.add("royal", at(0.8), radial(5, 7), 0.9 + R() * 0.4, 1 + R(), { grav: 14, bounce: true, spin: 10 });
        for (let i = 0; i < 16; i++) this.add("star", at(1), radial(4, 6), 1.0, 1.2, { grav: 6, spin: 20, drag: 1 });
        break;
      case "sparkle":
        for (let i = 0; i < (n ?? 10); i++) {
          const p = at(0.3 + R() * 0.8);
          p.x += (R() - 0.5) * 0.8; p.z += (R() - 0.5) * 0.8;
          this.add("star", p, new Vector3((R() - 0.5) * 0.6, 1 + R() * 1.6, (R() - 0.5) * 0.6), 0.6 + R() * 0.6, 0.8 + R() * 0.8, { spin: 12, drag: 1 });
        }
        break;
      case "dust":
        for (let i = 0; i < (n ?? 12); i++) {
          const p = at(0.15);
          p.x += (R() - 0.5) * 1.6;
          this.add("dust", p, radial(1.6, 0.9), 0.6 + R() * 0.3, 0.8 + R() * 0.8, { grow: 1.6, drag: 2.5 });
        }
        break;
      case "splash":
        for (let i = 0; i < (n ?? 8); i++) this.add("drop", at(0), radial(1.5, 4), 0.5, 1, { grav: 14 });
        break;
      case "splat": {
        // Royal jelly hitting the floor: heavy pink droplets + a low shock ring.
        const count = n ?? 16;
        for (let i = 0; i < count; i++) {
          this.add(R() < 0.7 ? "royal" : "jelly", at(0.2), radial(3.2, 5.5), 0.6 + R() * 0.35, 0.8 + R() * 1.1, { grav: 16, bounce: true, spin: 8 });
        }
        if (count >= 10) {
          this.add("goo", at(0.06), Vector3.Zero(), 0.32, 0.5, { grow: 3.4 });
          for (let i = 0; i < 4; i++) this.add("puff", at(0.25), radial(1.4, 0.8), 0.4, 0.6, { grow: 1.2, drag: 4 });
        }
        break;
      }
    }
  }

  /** Free-form single particle, for view-driven effects (trails, dizzy stars…). */
  emit(kind: "royal" | "jelly" | "star" | "spark" | "puff", pos: Vector3, vel: Vector3, life: number, size: number, opts: { grow?: number; grav?: number; drag?: number; spin?: number; bounce?: boolean } = {}) {
    this.add(kind, pos, vel, life, size, opts);
  }

  smoke(pos: Vector3) {
    this.add("smoke", pos, new Vector3(0.25 + Math.random() * 0.2, 0.7, (Math.random() - 0.5) * 0.2), 2.2, 0.5, { grow: 0.9, drag: 0.2 });
  }

  clear() {
    for (const p of this.live) this.release(p);
    this.live = [];
  }

  private release(p: P) {
    p.mesh.setEnabled(false);
    const kind = (p.mesh as InstancedMesh & { _kind?: string })._kind!;
    this.kinds.get(kind)!.pool.push(p.mesh);
  }

  update(dt: number) {
    const keep: P[] = [];
    for (const p of this.live) {
      p.life -= dt;
      if (p.life <= 0) { this.release(p); continue; }
      p.vel.y -= p.grav * dt;
      if (p.drag) p.vel.scaleInPlace(Math.max(0, 1 - p.drag * dt));
      p.pos.addInPlace(p.vel.scale(dt));
      if (p.pos.y < 0.02) {
        p.pos.y = 0.02;
        if (p.bounce) { p.vel.y = Math.abs(p.vel.y) * 0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
        else p.vel.y = 0;
      }
      const t = p.life / p.max;
      const s = (p.size + p.grow * (1 - t)) * Math.min(1, t * 3);
      p.mesh.position.copyFrom(p.pos);
      p.mesh.scaling.setAll(Math.max(0.001, s));
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      keep.push(p);
    }
    this.live = keep;
  }
}
