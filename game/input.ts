// Keyboard/mouse/touch → InputFrame. Held keys (or the virtual stick) give the
// movement vector; attack is an edge-triggered press consumed by the next step.
import type { InputFrame } from "./types";

const held = new Set<string>();
let attackPending = false;
/** Virtual joystick vector (touch), magnitude 0..1. */
let stickX = 0, stickY = 0;

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export const input = {
  keyDown(code: string, repeat: boolean) {
    held.add(code);
    if (!repeat && (code === "Space" || code === "KeyJ" || code === "KeyK")) attackPending = true;
  },
  keyUp(code: string) {
    held.delete(code);
  },
  click() {
    attackPending = true;
  },
  setStick(x: number, y: number) {
    stickX = x; stickY = y;
  },
  clear() {
    held.clear();
    attackPending = false;
    stickX = stickY = 0;
  },
  isMoveKey(code: string) {
    return code in MOVE_KEYS || code === "Space";
  },
  /** True while the player is steering by hand (keys or stick). */
  steering(): boolean {
    if (stickX !== 0 || stickY !== 0) return true;
    for (const code of held) if (MOVE_KEYS[code]) return true;
    return false;
  },
  /** Builds the input for one simulation step (consumes the attack press). */
  frame(): InputFrame {
    let mx = 0, my = 0;
    for (const code of held) {
      const v = MOVE_KEYS[code];
      if (v) { mx += v[0]; my += v[1]; }
    }
    mx = Math.max(-1, Math.min(1, mx));
    my = Math.max(-1, Math.min(1, my));
    if (mx === 0 && my === 0) { mx = stickX; my = stickY; }
    const attack = attackPending;
    attackPending = false;
    return { mx, my, attack };
  },
};
