// ─────────────────────────────────────────────────────────────────────────────
//  Static world data: hand-drawn ASCII maps, parsed once into tile grids and
//  spawn lists. Pure data — no Babylon, no React.
//
//  Coordinates: 1 unit = 1 tile. x grows east (screen right), y grows south
//  (screen down). Tile (c, r) covers [c, c+1) × [r, r+1); its center is c+.5.
// ─────────────────────────────────────────────────────────────────────────────

export type MapId = "over" | "dungeon";

export const SCREEN_W = 16;
export const SCREEN_H = 12;

/*  Overworld legend
    .  grass          ,  flowers        :  dirt path       ~  water
    =  bridge         #  hedge          T  tree            R  rock
    ^  cliff          D  barrow door    h  cottage         l  lantern post
    n  signpost       g  grass tuft     p  clay pot        e  gloob spawn
    r  rupee          *  heart          S  hero spawn                         */

// Row 0 of screens: Whisperpine | Lantern Meadow | Cragmaw
const WHISPERPINE = [
  "TTTTTTTTTTTTTTTT",
  "TTTr.gT...TTTTTT",
  "TT..T....T..pTTT",
  "T..e...TT.....TT",
  "T.TT.g.....e..TT",
  "T.....T..TT.....",
  "TT.g......T.,...",
  "T..TT.T.e....TTT",
  "TTp...TT...T*.TT",
  "T...T....g..TTTT",
  "TT..g..T.T...TTT",
  "TTTTTT...TTTTTTT",
];
const MEADOW = [
  "################",
  "#,,....,,..,,.r^",
  "#.,.g..l...g.,.^",
  "#..###..,..###.^",
  "#..#,.....e.,#.^",
  "...#..g..g...#.^",
  ".....l....,.l..^",
  "#.,.e..,,.....g^",
  "#..###....###..^",
  "#.g...,.:n..,..^",
  "#,....g.:.,..,.^",
  "#######:::######",
];
const CRAGMAW = [
  "^^^^^^^RDR^^^^^^",
  "^^R..Rn.:..RR.^^",
  "^R...g..:...g.R^",
  "^..R...::..R...^",
  "^.e...::..p...e^",
  "^R...::.R....R.^",
  "^^..R:......R..^",
  "^R...:::::::p..^",
  "^R.RR~~RR..:..R^",
  "^.RR~~~~R..:...^",
  "^.R~~~~~R.:.e..^",
  "^^RRR~~R..:...^^",
];
// Row 1 of screens: Willowmere | Hearthside | Brambleford
const WILLOWMERE = [
  "TTTTT,...,TTTTTT",
  "TT....:::....gTT",
  "T.g..::~~~::...T",
  "T...:~~~~~~~:..#",
  "T.,.:~~~~~~~~:..",
  "T...:~~~~~~~~:..",
  "T.p.:~~~~~~~:.,.",
  "T....::~~~:::..#",
  "TT.g...:::..e..#",
  "T..,,....g...pTT",
  "TT.*...,,..TTTTT",
  "TTTTTTTTTTTTTTTT",
];
const HEARTHSIDE = [
  "#######:::######",
  "#.T....:::..,T.#",
  "#,hhh..:.:.....#",
  "#.hhh..:.:..g..#",
  "...:...:::.....#",
  "::::::::S:::::::",
  ".....n.:.:..,...",
  "#.,..g..:...p..#",
  "#T.g....:..,,.T#",
  "#..,,..:::.g...#",
  "#.p..,,.....,.p#",
  "################",
];
const BRAMBLEFORD = [
  "TTRRR~~R..:...TT",
  "T.g..~~...:..e.T",
  "T....~~.,.:....T",
  "T.p..~~..::..g.T",
  "T,...~~..:.....T",
  "::.g.==..:..R..T",
  ".::::==:::...,.T",
  "T....~~....e...T",
  "T.,..~~.g...R..T",
  "TR...~~..p..,.rT",
  "TT.g.~~...g..TTT",
  "TTTTT~~TTTTTTTTT",
];

/*  Dungeon legend (16 × 23; boss room on top, entry hall below)
    W  wall           t  wall torch     .  floor           ,  cracked floor
    P  pillar         G  gate           X  exit stairs     K  key pedestal
    C  chest          B  boss           p  pot             e  gloob spawn     */
const DUNGEON = [
  "WWWWtWWWWWWtWWWW",
  "Wp.............W",
  "W......C......pW",
  "W.PP........PP.W",
  "W.PP........PP.W",
  "t......B.......t",
  "W..............W",
  "W.PP........PP.W",
  "W.PP........PP.W",
  "W..............W",
  "WWWWWWWGGWWWWWWW",
  "Wp............pW",
  "W..............W",
  "W..K...WW......W",
  "t......WW..e...t",
  "W..,...........W",
  "W..e...........W",
  "W.........,....W",
  "t..PP......PP..t",
  "W..............W",
  "Wp............pW",
  "W..............W",
  "WWWWWWWXXWWWWWWW",
];

function joinScreens(rows: string[][][]): string[] {
  const out: string[] = [];
  for (const screenRow of rows) {
    for (let r = 0; r < SCREEN_H; r++) out.push(screenRow.map((s) => s[r]).join(""));
  }
  return out;
}

const OVER_RAW = joinScreens([
  [WHISPERPINE, MEADOW, CRAGMAW],
  [WILLOWMERE, HEARTHSIDE, BRAMBLEFORD],
]);

// ── Parsed representation ───────────────────────────────────────────────────

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface ParsedMap {
  id: MapId;
  w: number;
  h: number;
  /** Ground/terrain character per tile (spawn markers replaced by floor). */
  tiles: string[];
  enemies: SpawnPoint[];
  grass: SpawnPoint[];
  pots: SpawnPoint[];
  rupees: SpawnPoint[];
  hearts: SpawnPoint[];
  signs: SpawnPoint[];
  torches: { x: number; y: number; nx: number; ny: number }[];
  spawn: SpawnPoint | null;
}

const FLOOR_FOR: Record<string, string> = {
  g: ".", p: ".", e: ".", r: ".", "*": ".", S: ":",
  K: ".", C: ".", B: ".",
};

function parse(id: MapId, raw: string[]): ParsedMap {
  const h = raw.length;
  const w = raw[0].length;
  raw.forEach((row, i) => {
    if (row.length !== w) throw new Error(`Map ${id} row ${i} has length ${row.length}, expected ${w}`);
  });
  const m: ParsedMap = {
    id, w, h, tiles: [], enemies: [], grass: [], pots: [], rupees: [], hearts: [],
    signs: [], torches: [], spawn: null,
  };
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const ch = raw[y][x];
      const p = { x: x + 0.5, y: y + 0.5 };
      switch (ch) {
        case "e": m.enemies.push(p); break;
        case "g": m.grass.push(p); break;
        case "p": m.pots.push(p); break;
        case "r": m.rupees.push(p); break;
        case "*": m.hearts.push(p); break;
        case "n": m.signs.push(p); break;
        case "S": m.spawn = p; break;
      }
      line += FLOOR_FOR[ch] ?? ch;
    }
    m.tiles.push(line);
  }
  // Torches face whichever orthogonal neighbour is open floor.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (m.tiles[y][x] !== "t") continue;
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const c = m.tiles[y + dy]?.[x + dx];
        if (c && c !== "W" && c !== "t") {
          m.torches.push({ x: x + 0.5 + dx * 0.5, y: y + 0.5 + dy * 0.5, nx: dx, ny: dy });
          break;
        }
      }
    }
  }
  return m;
}

export const MAPS: Record<MapId, ParsedMap> = {
  over: parse("over", OVER_RAW),
  dungeon: parse("dungeon", DUNGEON),
};

// ── Hand-placed points of interest ──────────────────────────────────────────

export const HERO_SPAWN = { x: 24.5, y: 17.5 };
/** No gloob may aggro on, or even enter, this circle. */
export const SAFE_ZONE = { x: HERO_SPAWN.x, y: HERO_SPAWN.y, r: 6.5 };

export const DUNGEON_ENTRY = { x: 8, y: 20.9 };
export const OVERWORLD_RETURN = { x: 40.5, y: 1.7 };
export const KEY_PEDESTAL = { x: 3.5, y: 13.5 };
export const CHEST_POS = { x: 8, y: 2.6 };
export const BOSS_SPAWN = { x: 8, y: 5.6 };
/** Boss room spans dungeon rows 0..9; the gate row is 10. */
export const BOSS_ROOM_MAX_Y = 10;
export const GATE_ROW = 10;

export const SIGN_TEXT: Record<string, string> = {
  "21,18": "HEARTHSIDE  ·  East, over Brambleford bridge, lie the Cragmaw rocks. Grandma swears a Sunstone sleeps beneath them.",
  "25,9": "LANTERN MEADOW  ·  The lanterns were lit the day the Sunstone vanished. They have never gone out.",
  "38,1": "BARROW HALLS  ·  Here naps KING GLOOB. Please do not poke the King.",
};

export function signKey(x: number, y: number) {
  return `${Math.floor(x)},${Math.floor(y)}`;
}

// ── Areas ───────────────────────────────────────────────────────────────────

const OVER_AREAS = [
  ["Whisperpine Woods", "Lantern Meadow", "Cragmaw Rocks"],
  ["Willowmere", "Hearthside", "Brambleford"],
];

export function areaName(map: MapId, x: number, y: number): string {
  if (map === "dungeon") return y < BOSS_ROOM_MAX_Y ? "Sunstone Sanctum" : "Barrow Halls";
  const sx = Math.min(2, Math.max(0, Math.floor(x / SCREEN_W)));
  const sy = Math.min(1, Math.max(0, Math.floor(y / SCREEN_H)));
  return OVER_AREAS[sy][sx];
}

// ── Tile queries ────────────────────────────────────────────────────────────

const SOLID = new Set(["~", "#", "T", "R", "^", "h", "l", "n", "W", "t", "P"]);

export function tileAt(map: MapId, tx: number, ty: number): string {
  const m = MAPS[map];
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return map === "over" ? "T" : "W";
  return m.tiles[ty][tx];
}

/** Static solidity; the gate is handled by the simulation (it depends on quest flags). */
export function isStaticSolid(ch: string) {
  return SOLID.has(ch);
}
