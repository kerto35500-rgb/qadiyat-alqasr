// ======================= BOARD DATA =======================
// Original manor layout — 24x25 grid, 9 rooms + blocked central stairs.
// Tile types mirror the flag system studied from the original game:
// ROOM=1, CORRIDOR=2, DOOR=4 (flag), START=8 (flag), PASSAGE=64 (flag)
(function (global) {
  const W = 24, H = 25;

  // Layout matches the real Tudor Mansion floor plan, so the authentic 3D
  // mansion meshes (models/rooms/*.obj) line up tile-for-tile with the grid.
  // `part` is the mesh file name for that room in mansion mode.
  const ROOMS = {
    kitchen:      { name: 'المطبخ',        part: 'kitchen',      rect: [0, 1, 5, 6],    color: 0x8fb3a0 },
    ballroom:     { name: 'قاعة الرقص',    part: 'ballroom',     rect: [8, 1, 15, 7],   color: 0xb3a08f },
    conservatory: { name: 'المشتل',        part: 'conservatory', rect: [18, 1, 23, 5],  color: 0x8fa8b3 },
    dining:       { name: 'قاعة الطعام',   part: 'diningroom',   rect: [0, 9, 7, 15],   color: 0xb38f8f },
    billiard:     { name: 'غرفة البلياردو',part: 'billiardroom', rect: [18, 8, 23, 12], color: 0x9d8fb3 },
    library:      { name: 'المكتبة',       part: 'library',      rect: [17, 14, 23, 18],color: 0xb3ab8f },
    lounge:       { name: 'الصالون',       part: 'lounge',       rect: [0, 19, 6, 24],  color: 0x8f9db3 },
    hall:         { name: 'الردهة',        part: 'hall',         rect: [9, 18, 14, 24], color: 0xa3b38f },
    study:        { name: 'المكتب',        part: 'study',        rect: [17, 21, 23, 24],color: 0xb391a8 },
  };
  const STAIRS = { rect: [9, 10, 14, 14] }; // blocked centre (envelope display)

  // door: [roomTileX, roomTileY, corridorX, corridorY]
  const DOORS = {
    kitchen:      [[4, 6, 4, 7]],
    ballroom:     [[8, 5, 7, 5], [9, 7, 9, 8], [14, 7, 14, 8], [15, 5, 16, 5]],
    conservatory: [[18, 5, 18, 6]],
    dining:       [[7, 12, 8, 12], [6, 15, 6, 16]],
    billiard:     [[18, 9, 17, 9], [22, 12, 22, 13]],
    library:      [[20, 14, 20, 13], [17, 16, 16, 16]],
    lounge:       [[6, 19, 6, 18]],
    hall:         [[11, 18, 11, 17], [12, 18, 12, 17], [14, 20, 15, 20]],
    study:        [[17, 21, 17, 20]],
  };

  const PASSAGES = [ ['kitchen', 'study'], ['conservatory', 'lounge'] ];

  // The mansion's own floor plan ends one row short of the grid: the exported
  // house spans 24 tiles in depth, the board 25. Row 0 is therefore *outside*
  // the building, and a pawn standing there stands on the lawn. It is walled
  // off in both styles so the whole game happens inside the house.
  const OUTSIDE_ROWS = [0];

  // Single tiles the house footprint also leaves out: the exported walls cut
  // across them, so a pawn there would stand in the garden or inside masonry.
  const OUTSIDE_TILES = [[0, 7], [0, 8], [23, 13], [15, 24], [16, 24]];

  // start tiles (corridor, inside the house) — index matches suspect order
  // [crimson, saffron, emerald, violet, azure, pearl]
  const STARTS = [ [7, 24], [0, 17], [16, 1], [23, 19], [23, 7], [7, 1] ];

  // Steps the grid allows but the house does not: measured by firing rays
  // between neighbouring tile centres through the real mansion mesh at ankle,
  // waist and head height (see window.__edgeAudit). Blocking them here is what
  // stops a pawn from walking through a wall — in both styles, so the two keep
  // the same map.
  const BLOCKED_EDGES = [
    [6, 1, 7, 1], [16, 1, 17, 1],
    [10, 15, 10, 16],
    [0, 16, 0, 17], [0, 18, 1, 18],
  ];
  const edgeKey = (ax, ay, bx, by) =>
    (ax < bx || (ax === bx && ay < by)) ? `${ax},${ay}|${bx},${by}` : `${bx},${by}|${ax},${ay}`;
  const BLOCKED = new Set(BLOCKED_EDGES.map(e => edgeKey(e[0], e[1], e[2], e[3])));

  function inRect(x, y, r) { return x >= r[0] && y >= r[1] && x <= r[2] && y <= r[3]; }

  function buildBoard() {
    const tiles = new Array(W * H).fill(null);
    const roomOf = {};      // "x,y" -> roomId
    const idx = (x, y) => y * W + x;

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (inRect(x, y, STAIRS.rect)) { tiles[idx(x, y)] = { x, y, type: 0 }; continue; }
      if (OUTSIDE_ROWS.includes(y) || OUTSIDE_TILES.some(t => t[0] === x && t[1] === y)) {
        tiles[idx(x, y)] = { x, y, type: 0, outside: true }; continue;
      }
      let placed = false;
      for (const [id, r] of Object.entries(ROOMS)) {
        if (inRect(x, y, r.rect)) {
          tiles[idx(x, y)] = { x, y, type: 1, room: id };
          roomOf[x + ',' + y] = id; placed = true; break;
        }
      }
      if (!placed) tiles[idx(x, y)] = { x, y, type: 2 };
    }
    // mark doors
    const doorLinks = []; // {room, roomTile:[x,y], corridor:[x,y]}
    for (const [room, doors] of Object.entries(DOORS)) {
      for (const [rx, ry, cx, cy] of doors) {
        const rt = tiles[idx(rx, ry)], ct = tiles[idx(cx, cy)];
        if (!rt || rt.type !== 1 || rt.room !== room) throw new Error('bad door room tile ' + room + ' ' + rx + ',' + ry);
        if (!ct || ct.type !== 2) throw new Error('bad door corridor tile ' + room + ' ' + cx + ',' + cy);
        rt.door = true; ct.doorFor = room;
        doorLinks.push({ room, roomTile: [rx, ry], corridor: [cx, cy] });
      }
    }
    for (const [x, y] of STARTS) {
      const t = tiles[idx(x, y)];
      if (!t || t.type !== 2) throw new Error('bad start tile ' + x + ',' + y);
      t.start = true;
    }
    return { W, H, tiles, idx, roomOf, doorLinks };
  }

  const B = buildBoard();

  // corridor adjacency (4-dir), corridors only
  function corridorNeighbors(x, y) {
    const out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const t = B.tiles[B.idx(nx, ny)];
      if (t.type !== 2) continue;
      if (BLOCKED.has(edgeKey(x, y, nx, ny))) continue;   // a wall stands here
      out.push(t);
    }
    return out;
  }

  // Reachable destinations given a dice roll.
  // from: {room: id} or {x,y}. blocked: Set of "x,y" occupied corridor tiles.
  // Returns { corridors: [{x,y,path}], rooms: {roomId: path} }
  function reachable(from, steps, blocked, bannedRoom) {
    const results = { corridors: [], rooms: {} };
    const startPoints = [];
    if (from.room) {
      for (const dl of B.doorLinks) {
        if (dl.room !== from.room) continue;
        const key = dl.corridor[0] + ',' + dl.corridor[1];
        if (blocked.has(key)) continue;
        startPoints.push({ x: dl.corridor[0], y: dl.corridor[1], cost: 1, path: [dl.roomTile, dl.corridor] });
      }
    } else {
      startPoints.push({ x: from.x, y: from.y, cost: 0, path: [[from.x, from.y]] });
    }
    const best = new Map(); // "x,y" -> cost
    const queue = [...startPoints];
    while (queue.length) {
      const cur = queue.shift();
      const key = cur.x + ',' + cur.y;
      if (best.has(key) && best.get(key) <= cur.cost) continue;
      best.set(key, cur.cost);
      const t = B.tiles[B.idx(cur.x, cur.y)];
      // entering a door corridor tile allows stepping into the room (ends move)
      if (t.doorFor && cur.cost <= steps && t.doorFor !== from.room && t.doorFor !== bannedRoom) {
        const rEntry = B.doorLinks.find(d => d.room === t.doorFor && d.corridor[0] === cur.x && d.corridor[1] === cur.y);
        if (!results.rooms[t.doorFor] || results.rooms[t.doorFor].length > cur.path.length + 1) {
          results.rooms[t.doorFor] = [...cur.path, rEntry.roomTile];
        }
      }
      if (cur.cost === steps) continue;
      for (const nb of corridorNeighbors(cur.x, cur.y)) {
        const nkey = nb.x + ',' + nb.y;
        if (blocked.has(nkey)) continue;
        if (best.has(nkey) && best.get(nkey) <= cur.cost + 1) continue;
        queue.push({ x: nb.x, y: nb.y, cost: cur.cost + 1, path: [...cur.path, [nb.x, nb.y]] });
      }
    }
    for (const [key, cost] of best) {
      if (cost === steps) {
        const [x, y] = key.split(',').map(Number);
        // reconstruct: find in queue history — store path when reaching exact cost
      }
    }
    // second pass to collect exact-step corridor stops with paths (BFS again, keeping paths)
    const seen = new Map();
    const q2 = [...startPoints];
    while (q2.length) {
      const cur = q2.shift();
      const key = cur.x + ',' + cur.y;
      if (seen.has(key) && seen.get(key) <= cur.cost) continue;
      seen.set(key, cur.cost);
      if (cur.cost === steps) { results.corridors.push({ x: cur.x, y: cur.y, path: cur.path }); continue; }
      for (const nb of corridorNeighbors(cur.x, cur.y)) {
        const nkey = nb.x + ',' + nb.y;
        if (blocked.has(nkey)) continue;
        if (seen.has(nkey) && seen.get(nkey) <= cur.cost + 1) continue;
        q2.push({ x: nb.x, y: nb.y, cost: cur.cost + 1, path: [...cur.path, [nb.x, nb.y]] });
      }
    }
    return results;
  }

  // Shortest walking route from one place to another, ignoring the dice.
  // Used when a pawn has to be walked back somewhere rather than moved by a roll.
  // `from` / `target`: {room} or {x,y}. Returns the tile-by-tile path, or null.
  function pathTo(from, target, blocked) {
    if (from.room && target.room && from.room === target.room) return null;
    const startPoints = [];
    if (from.room) {
      for (const dl of B.doorLinks) {
        if (dl.room !== from.room) continue;
        const key = dl.corridor[0] + ',' + dl.corridor[1];
        if (blocked && blocked.has(key)) continue;
        startPoints.push({ x: dl.corridor[0], y: dl.corridor[1], path: [dl.roomTile, dl.corridor] });
      }
    } else {
      if (!target.room && from.x === target.x && from.y === target.y) return [[from.x, from.y]];
      startPoints.push({ x: from.x, y: from.y, path: [[from.x, from.y]] });
    }
    const seen = new Set(startPoints.map(s => s.x + ',' + s.y));
    const q = [...startPoints];
    while (q.length) {
      const cur = q.shift();
      const t = B.tiles[B.idx(cur.x, cur.y)];
      if (target.room) {
        if (t.doorFor === target.room) {
          const link = B.doorLinks.find(d => d.room === target.room && d.corridor[0] === cur.x && d.corridor[1] === cur.y);
          return [...cur.path, link.roomTile];
        }
      } else if (cur.x === target.x && cur.y === target.y) {
        return cur.path;
      }
      for (const nb of corridorNeighbors(cur.x, cur.y)) {
        const k = nb.x + ',' + nb.y;
        if (seen.has(k)) continue;
        if (blocked && blocked.has(k)) continue;
        seen.add(k);
        q.push({ x: nb.x, y: nb.y, path: [...cur.path, [nb.x, nb.y]] });
      }
    }
    return null;
  }

  // nearest corridor tile that nobody is standing on
  function nearestFree(x, y, blocked) {
    const seen = new Set([x + ',' + y]);
    const q = [[x, y]];
    while (q.length) {
      const [cx, cy] = q.shift();
      const t = B.tiles[B.idx(cx, cy)];
      if (t && t.type === 2 && !(blocked && blocked.has(cx + ',' + cy))) return { x: cx, y: cy };
      for (const nb of corridorNeighbors(cx, cy)) {
        const k = nb.x + ',' + nb.y;
        if (seen.has(k)) continue;
        seen.add(k);
        q.push([nb.x, nb.y]);
      }
    }
    return null;
  }

  // BFS distance from a position to each room (ignoring dice), for bot planning
  function roomDistances(from, blocked) {
    const dist = {};
    const startPoints = [];
    if (from.room) {
      for (const dl of B.doorLinks) if (dl.room === from.room) startPoints.push({ x: dl.corridor[0], y: dl.corridor[1], cost: 1 });
      // secret passage counts as distance 1
      for (const [a, b] of PASSAGES) {
        if (a === from.room) dist[b] = 1;
        if (b === from.room) dist[a] = 1;
      }
    } else startPoints.push({ x: from.x, y: from.y, cost: 0 });
    const seen = new Map();
    const q = [...startPoints];
    while (q.length) {
      const cur = q.shift();
      const key = cur.x + ',' + cur.y;
      if (seen.has(key) && seen.get(key) <= cur.cost) continue;
      seen.set(key, cur.cost);
      const t = B.tiles[B.idx(cur.x, cur.y)];
      if (t.doorFor && (dist[t.doorFor] === undefined || dist[t.doorFor] > cur.cost + 1)) dist[t.doorFor] = cur.cost + 1;
      for (const nb of corridorNeighbors(cur.x, cur.y)) {
        const nkey = nb.x + ',' + nb.y;
        if (blocked && blocked.has(nkey)) continue;
        if (seen.has(nkey) && seen.get(nkey) <= cur.cost + 1) continue;
        q.push({ x: nb.x, y: nb.y, cost: cur.cost + 1 });
      }
    }
    return dist;
  }

  // free display spot inside a room for a token
  function roomSpot(roomId, taken) {
    const r = ROOMS[roomId].rect;
    const spots = [];
    const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
    for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) {
      const t = B.tiles[B.idx(x, y)];
      if (t.door) continue;
      spots.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
    }
    spots.sort((a, b) => a.d - b.d);
    for (const s of spots) if (!taken.has(s.x + ',' + s.y)) return s;
    return spots[0];
  }

  global.Board = { W, H, ROOMS, STAIRS, DOORS, PASSAGES, STARTS, OUTSIDE_ROWS, OUTSIDE_TILES, BLOCKED_EDGES, tiles: B.tiles, idx: B.idx, doorLinks: B.doorLinks, reachable, roomDistances, roomSpot, corridorNeighbors, pathTo, nearestFree };
})(typeof window !== 'undefined' ? window : globalThis);
