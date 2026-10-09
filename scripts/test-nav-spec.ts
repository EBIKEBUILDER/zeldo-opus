import { createWorld, getAllNav, invalidateNav, step } from "../game/sim";
import {
  findPath,
  findPathGlobal,
  chunkToUnified,
  unifiedToChunk,
  getPortals,
  setPortalAITraversable,
  resetPortals,
  pathScheduler,
  wallSlideVector,
  getStandoffPoint,
} from "../game/path";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

console.log("=== 1. Unified 3x2 Overworld Nav Grid Tests ===");
{
  const w = createWorld();
  const allNavAI = getAllNav(w, true);
  const allNavHero = getAllNav(w, false);

  assert(allNavAI.over.w === 48 && allNavAI.over.h === 24, "Overworld grid is 48x24 unified");

  // Coordinate resolution
  const c1 = chunkToUnified("whisperpine", 15, 5);
  const c2 = chunkToUnified("meadow", 0, 5);
  assert(c1.x === 15 && c1.y === 5, "Whisperpine (15,5) maps to unified (15,5)");
  assert(c2.x === 16 && c2.y === 5, "Meadow (0,5) maps to unified (16,5)");

  const u1 = unifiedToChunk("over", 15, 5);
  const u2 = unifiedToChunk("over", 16, 5);
  assert(u1.chunk === "whisperpine" && u1.localX === 15, "Unified (15,5) resolves to whisperpine");
  assert(u2.chunk === "meadow" && u2.localX === 0, "Unified (16,5) resolves to meadow");

  // 1a. AI Cross-chunk path between Meadow (chunk 1,0) and Whisperpine (chunk 0,0) across vertical boundary x=15/16
  const meadowX = 20.5, meadowY = 6.5;
  const pineX = 14.5, pineY = 5.5; // Open floor tile in Whisperpine
  const resAI = findPath(allNavAI.over, 1, meadowX, meadowY, pineX, pineY);
  assert(resAI.ok, "AI can path across adjacent chunks seamlessly without invisible walls");
  assert(resAI.pts.length > 0, `AI path found across chunk boundary with ${resAI.pts.length / 2} waypoints`);

  // 1b. Hero Cross-chunk path from Hearthside (chunk 1,1) north to Meadow (chunk 1,0) across horizontal boundary y=11/12
  const hearthX = 24.5, hearthY = 17.5;
  const northMeadowX = 24.5, northMeadowY = 8.5;
  const resHero = findPath(allNavHero.over, 1, hearthX, hearthY, northMeadowX, northMeadowY);
  assert(resHero.ok, "Hero can path from Hearthside north into Meadow across chunk boundary");
  assert(resHero.pts.length > 0, `Hero path found across horizontal boundary with ${resHero.pts.length / 2} waypoints`);
}

console.log("\n=== 2. Non-Adjacent Connections (Portals) & traversableByAI Flag ===");
{
  resetPortals();
  const w = createWorld();
  const allNavAI = getAllNav(w, true);
  const allNavHero = getAllNav(w, false);

  const portals = getPortals();
  const mouth = portals.find((p) => p.id === "cragmaw_dungeon_entry");
  assert(!!mouth, "Cragmaw to dungeon portal exists in portal registry");
  assert(mouth?.traversableByAI === false, "Portal has traversableByAI: false by default (Zelda leashing)");

  // Monster in Overworld (Cragmaw) pathing toward hero in Dungeon
  // With traversableByAI = false, monster CANNOT path into dungeon
  const monsterX = 38.5, monsterY = 4.5;
  const heroDungeonX = 8.5, heroDungeonY = 16.5;

  const aiRes = findPathGlobal(allNavAI, 1, "over", monsterX, monsterY, "dungeon", heroDungeonX, heroDungeonY, {
    isAI: true,
  });
  assert(!aiRes.ok, "AI does NOT cross into dungeon when traversableByAI is false");
  assert(aiRes.crossesPortal === false, "AI path does not cross portal");
  // Monster path ends at the barrow door entrance threshold (closest reachable node on overworld)
  const lastX = aiRes.pts[aiRes.pts.length - 2];
  const lastY = aiRes.pts[aiRes.pts.length - 1];
  assert(Math.hypot(lastX - 40.5, lastY - 0.5) < 3.0, `Monster leashes at the entrance threshold (ends at ${lastX}, ${lastY})`);

  // Hero pathing across the same portal (isAI = false)
  const heroRes = findPathGlobal(allNavHero, 1, "over", monsterX, monsterY, "dungeon", heroDungeonX, heroDungeonY, {
    isAI: false,
  });
  assert(heroRes.ok, "Hero (or tap-to-move) CAN cross through dungeon portal");
  assert(heroRes.crossesPortal === true, "Hero path crosses portal");
  assert(Boolean(heroRes.nodes && heroRes.nodes.some((n) => n.map === "dungeon")), "Path contains dungeon waypoints");

  // Now flip traversableByAI = true for the portal
  setPortalAITraversable("cragmaw_dungeon_entry", true);
  invalidateNav(w);
  const allNavAllowed = getAllNav(w, true);
  const aiResAllowed = findPathGlobal(allNavAllowed, 1, "over", monsterX, monsterY, "dungeon", heroDungeonX, heroDungeonY, {
    isAI: true,
  });
  assert(aiResAllowed.ok, "When traversableByAI is flipped to true, AI CAN chase into dungeon");
  assert(aiResAllowed.crossesPortal === true, "AI path crosses portal when allowed");

  resetPortals();
}

console.log("\n=== 3. Graceful No-Path Fallback (Never Freeze or Vibrate) ===");
{
  const w = createWorld();
  const allNav = getAllNav(w, true);
  const overNav = allNav.over;

  // Target inside a solid tree/cliff tile
  const startX = 20.5, startY = 5.5;
  const blockedTargetX = 20.5, blockedTargetY = 0.5; // Top solid tree border in Meadow

  const noPathRes = findPath(overNav, 1, startX, startY, blockedTargetX, blockedTargetY);
  assert(!noPathRes.ok, "Path correctly reports unreachable (ok = false)");

  // Standoff point test: ensure target is kept back from wall, not inside it
  const standoff = getStandoffPoint(overNav, startX, startY, blockedTargetX, blockedTargetY, 0.36);
  assert(
    standoff.y >= 1.0,
    `Standoff point (${standoff.x.toFixed(2)}, ${standoff.y.toFixed(2)}) is clear of top wall border`
  );

  // Wall slide test: moving into a solid horizontal wall (heading north into y=0)
  const slideVec = wallSlideVector(overNav, 20.5, 1.36, 0, -3.0, 0.36);
  assert(
    slideVec[1] >= -0.01,
    `Wall slide removes direct velocity into wall (vy changed from -3.0 to ${slideVec[1]})`
  );

  // Corner / angled approach: smooth tangent sliding along wall
  const cornerSlide = wallSlideVector(overNav, 20.5, 1.36, 2.0, -2.0, 0.36);
  assert(
    cornerSlide[0] > 0 && Math.abs(cornerSlide[1]) < 0.01,
    `Wall slide maintains tangential sliding velocity (${cornerSlide[0].toFixed(2)}, ${cornerSlide[1].toFixed(2)})`
  );
}

console.log("\n=== 4. Per-Tick Pathfinding Budget Scheduler ===");
{
  const w = createWorld();
  const allNav = getAllNav(w, true);
  pathScheduler.clear();
  pathScheduler.maxSearchesPerTick = 3;

  let completedCallbacks = 0;
  const requests = [];

  // Enqueue 12 monster repath requests
  for (let i = 0; i < 12; i++) {
    const res = pathScheduler.requestPath(allNav, {
      id: 100 + i,
      size: 1,
      startMap: "over",
      sx: 20 + (i % 3),
      sy: 15 + (i % 2),
      goalMap: "over",
      gx: 24.5,
      gy: 17.5,
      priority: 100 - i,
      callback: (r) => {
        completedCallbacks++;
      },
    });
    requests.push(res);
  }

  // Tick 0: Exactly 3 searches ran immediately (up to the budget of 3)
  const immediateRuns = requests.filter((r) => r !== null).length;
  assert(immediateRuns === 3, `Tick 0: Exactly 3 searches ran immediately (budget limit, got ${immediateRuns})`);
  assert(pathScheduler.pendingCount === 9, `Tick 0: 9 requests queued without hitching frame (got ${pathScheduler.pendingCount})`);
  assert(completedCallbacks === 3, `Tick 0: 3 callbacks executed`);

  // Tick 1: Process next 3
  pathScheduler.tick(allNav);
  assert(completedCallbacks === 6, `Tick 1: Total 6 requests completed (budget enforced)`);
  assert(pathScheduler.pendingCount === 6, `Tick 1: 6 requests remaining in queue`);

  // Tick 2: Process next 3
  pathScheduler.tick(allNav);
  assert(completedCallbacks === 9, `Tick 2: Total 9 requests completed`);
  assert(pathScheduler.pendingCount === 3, `Tick 2: 3 requests remaining in queue`);

  // Tick 3: Process final 3
  pathScheduler.tick(allNav);
  assert(completedCallbacks === 12, `Tick 3: All 12 requests completed smoothly across 4 frames`);
  assert(pathScheduler.pendingCount === 0, `Tick 3: Queue is now empty`);
}

console.log("\n=== 5. Nav-Grid Rebuilds when Tiles Change State ===");
{
  const w = createWorld();
  const initialNav = getAllNav(w, true);
  const initialRev = w.navRevision;

  // Verify caching: calling getAllNav again returns identical cached instances (0 allocations)
  const cachedNav = getAllNav(w, true);
  assert(initialNav.over === cachedNav.over, "Cached Nav is reused when navRevision is unchanged (0 allocations)");

  // 1. Break a pot in dungeon
  const pot = w.breakables.find((b) => b.map === "dungeon" && b.kind === "pot" && !b.broken)!;
  const potTileX = Math.floor(pot.x), potTileY = Math.floor(pot.y);

  // Before breaking: tile is solid for AI
  assert(initialNav.dungeon.solid[potTileY * initialNav.dungeon.w + potTileX] === 1, "Pot tile is solid initially");

  // Break the pot: triggers invalidateNav
  pot.broken = true;
  invalidateNav(w);
  assert(w.navRevision === initialRev + 1, "navRevision incremented after pot broken");

  const rebuiltNav = getAllNav(w, true);
  assert(rebuiltNav.dungeon !== initialNav.dungeon, "Nav grid rebuilt on tile state change");
  assert(rebuiltNav.dungeon.solid[potTileY * rebuiltNav.dungeon.w + potTileX] === 0, "Broken pot tile is now walkable!");

  // 2. Open gate in dungeon
  const gateRev = w.navRevision;
  w.quest.gateOpen = true;
  invalidateNav(w);
  assert(w.navRevision === gateRev + 1, "navRevision incremented when gate opened");

  const gateNav = getAllNav(w, true);
  // Gate is at x=7,8, y=10
  assert(gateNav.dungeon.solid[10 * gateNav.dungeon.w + 7] === 0, "Gate tile 7 is open and walkable");
  assert(gateNav.dungeon.solid[10 * gateNav.dungeon.w + 8] === 0, "Gate tile 8 is open and walkable");
}

console.log("\n=== 6. Realistic Return Leashing & Facing (No Moonwalking) ===");
{
  const w = createWorld();
  // Find an enemy on the overworld map
  const e = w.enemies.find((en) => en.alive && en.map === "over" && en.kind === "gloob")!;
  assert(!!e, "Found living overworld gloob enemy for leashing test");

  const homeX = e.hx;
  const homeY = e.hy;

  // Set enemy in chase mode away from home
  e.x = homeX + 4.0;
  e.y = homeY + 0.5;
  w.player.x = homeX + 7.0;
  w.player.y = homeY + 0.5;
  w.player.map = "over";

  // 1 tick of chase to establish chase state and velocity towards player (+x direction)
  e.state = "chase";
  e.stateT = 1.0;
  e.vx = 2.0;
  e.vy = 0;
  e.face = 0; // facing right (toward player at +x)

  // Now trigger leashing: hero moves far away into distance
  w.player.x = homeX + 25.0;
  w.player.y = homeY + 20.0;

  // Step simulation: enemy notices hero is out of territory/range and calls giveUp(e)
  step(w, { mx: 0, my: 0, attack: false });

  assert((e.state as string) === "return", "Enemy transitions to 'return' state upon leashing");
  assert(e.pathPending === false, "Path pending is false or cleanly managed");
  assert(e.vx <= 0.1, "Enemy forward chase velocity was cleanly arrested (no forward sliding)");

  function angDiff(a: number, b: number) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // Direction to home is (-X, left, angle ~ PI or -PI)
  const dirToHome = Math.atan2(homeY - e.y, homeX - e.x);
  const initialFaceDiff = Math.abs(angDiff(e.face, dirToHome));
  assert(initialFaceDiff < 0.25, `Enemy immediately turns to face home spawn point (diff: ${initialFaceDiff.toFixed(3)} rad)`);

  // Now simulate multiple ticks of returning home:
  // In every frame that the enemy moves, verify:
  // 1. Enemy is moving toward home
  // 2. Enemy is facing in its direction of travel (Math.abs(angDiff(e.face, atan2(vy, vx))) < 0.35)
  // 3. Enemy is NOT moonwalking (diff is NEVER > 1.5 rad)
  let moonwalkDetected = false;
  let maxAngleError = 0;
  let movedSteps = 0;

  for (let t = 0; t < 60; t++) {
    step(w, { mx: 0, my: 0, attack: false });
    const curSpeed = Math.hypot(e.vx, e.vy);
    if (curSpeed > 0.1) {
      movedSteps++;
      const moveAngle = Math.atan2(e.vy, e.vx);
      const diff = Math.abs(angDiff(e.face, moveAngle));
      if (diff > maxAngleError) maxAngleError = diff;
      if (diff > 1.5) {
        moonwalkDetected = true;
      }
    }
    if ((e.state as string) === "idle") break;
  }

  assert(movedSteps > 0, `Enemy actually moved during return navigation (${movedSteps} moving frames)`);
  assert(!moonwalkDetected, `No moonwalking detected during return leashing (max facing vs velocity diff: ${maxAngleError.toFixed(3)} rad)`);
  assert(Math.hypot(e.x - homeX, e.y - homeY) < 4.0, "Enemy progressed significantly closer to home spawn point");

  // Also test navigation around an obstacle (navigational pathfinding back to spawn point)
  // Hearthside / Meadow open area with tree obstacle
  const targetX = 24.5, targetY = 6.5;
  e.hx = targetX;
  e.hy = targetY;
  // Place enemy behind an obstacle in Meadow
  e.x = 20.5;
  e.y = 8.5;
  e.state = "return";
  e.repathT = 0;
  e.path = [];
  e.pathI = 0;
  e.pathPending = false;

  step(w, { mx: 0, my: 0, attack: false });
  assert(e.path.length > 0 || Math.hypot(e.x - e.hx, e.y - e.hy) < 1.0, "Enemy computed pathfinding waypoints back around obstacles to home");
}

console.log("\n=== Final Results ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
