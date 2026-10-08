// Keyboard/mouse → InputFrame. Held keys give the movement vector; attack is an
// edge-triggered press that is consumed by the next simulation step.
import type { InputFrame } from "./types";

const held = new Set<string>();
let attackPending = false;

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
  clear() {
    held.clear();
    attackPending = false;
  },
  isMoveKey(code: string) {
    return code in MOVE_KEYS || code === "Space";
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
    const attack = attackPending;
    attackPending = false;
    return { mx, my, attack };
  },
};
