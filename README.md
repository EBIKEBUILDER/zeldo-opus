# ZELDO & the Sunstone

A tiny low-poly overhead 3D adventure, A Link to the Past style. Help Zeldo find the
hidden Barrow Halls, take the key, defeat King Gloob and bring back the Sunstone.
You can finish it in 5–10 minutes.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript 7, Tailwind CSS 4,
Babylon.js 9, Zustand 5. Requires Node 20.9+ (Node 22/24 LTS recommended).

If you ever see `Cannot find module './NNN.js'`, a stale build cache is the cause.
Stop the server, run `rm -rf .next`, and start it again.

## Controls

| Action | Keys |
| --- | --- |
| Move (8-way) | WASD / arrow keys |
| Sword / interact | Space or left click |
| Start / retry | Enter or click |
| Mute | M |

## The quest (spoilers)

Leave Hearthside heading east, cross the bridge in Brambleford, then go north into
Cragmaw Rocks. The arch in the cliffs leads to the Barrow Halls. Take the key from its
pedestal, open the gate and wake King Gloob. Wait for his lunge, then hit him while
he's **dazed**, especially after he slams into a wall. If you hide where he can't
reach, he puffs up and lobs **royal jelly**. Step out of the pink ring, or time a
sword swing as the glob comes down to bat it straight back at his crown.

## Architecture

- `game/sim.ts`: deterministic fixed-timestep (60 Hz) simulation. It handles movement,
  collision with wall sliding, combat, AI, pickups and quest flags. Everything is plain
  serializable data (`game/types.ts`).
- `game/path.ts`: size-aware 8-way A* on the tile grid, plus swept line-of-sight checks
  that enemies use to route around obstacles.
- `game/store.ts`: Zustand store that holds the world, the game phase and the HUD values.
- `game/runner.ts`: accumulator loop. It steps the sim, sends sim events to audio and
  particles, and renders with interpolation.
- `game/render/*`: Babylon.js view layer only. It builds procedural low-poly meshes and
  reads the world each frame.
- `game/audio.ts`: Web Audio synthesized SFX and a small music sequencer. No audio files.
- `game/maps.ts`: ASCII tile maps for the 3×2 screen overworld (16×12 tiles per screen)
  and the 2-room dungeon.
- `components/*`: React UI only (HUD, title, game over and victory screens).

Add `?debug` to the URL to expose `window.__zeldo = { store, input }` for testing.
