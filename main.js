// ======================= 3D + UI =======================
(function () {
  const { Game, SUSPECTS, WEAPONS, ROOM_IDS, cardKey } = GameCore;
  const $ = s => document.querySelector(s);
  const ART = window.ART || {};
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

  // ---------- audio ----------
  const AudioFX = (() => {
    let ctx = null, muted = false;
    const ac = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
    function tone(freq, dur, type, gain, when = 0, slide = 0) {
      if (muted) return;
      try {
        const a = ac(), o = a.createOscillator(), g = a.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, a.currentTime + when);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + when + dur);
        g.gain.setValueAtTime(0, a.currentTime + when);
        g.gain.linearRampToValueAtTime(gain, a.currentTime + when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + dur);
        o.connect(g); g.connect(a.destination);
        o.start(a.currentTime + when); o.stop(a.currentTime + when + dur + 0.05);
      } catch (e) { }
    }
    function noise(dur, gain, when = 0) {
      if (muted) return;
      try {
        const a = ac(), len = a.sampleRate * dur, buf = a.createBuffer(1, len, a.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const s = a.createBufferSource(), g = a.createGain();
        g.gain.value = gain; s.buffer = buf; s.connect(g); g.connect(a.destination); s.start(a.currentTime + when);
      } catch (e) { }
    }
    return {
      toggle() { muted = !muted; return muted; },
      setMuted(v) { muted = !!v; },
      isMuted() { return muted; },
      click() { tone(660, 0.06, 'triangle', 0.12); },
      dice() { for (let i = 0; i < 5; i++) noise(0.05, 0.15, i * 0.09); tone(220, 0.15, 'triangle', 0.1, 0.5); },
      step() { tone(180 + Math.random() * 60, 0.05, 'triangle', 0.08); },
      door() { tone(120, 0.25, 'sine', 0.15, 0, -40); },
      card() { noise(0.12, 0.12); tone(880, 0.1, 'sine', 0.06, 0.05); },
      suggest() { tone(392, 0.2, 'triangle', 0.12); tone(523, 0.25, 'triangle', 0.12, 0.15); },
      bad() { tone(196, 0.35, 'sawtooth', 0.1); tone(147, 0.5, 'sawtooth', 0.1, 0.2); },
      win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.14, i * 0.13)); },
      pull() { tone(300, 0.3, 'sine', 0.1, 0, 200); },
    };
  })();

  // ---------- settings ----------
  // Everything the settings screen can change lives here. Values are kept in
  // localStorage so the next session opens the way the player left it.
  const SET_KEY = 'qasr.settings';
  const SET_DEFAULTS = { sfx: true, labels: true, follow: true, speed: 'normal', cutscene: true, ui: 'normal' };
  const SPEEDS = { slow: 0.7, normal: 1, fast: 1.6 };
  const UI_SCALE = { small: 0.88, normal: 1, large: 1.15 };
  const SETTINGS = Object.assign({}, SET_DEFAULTS);
  let animSpeed = 1;
  try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) {}

  function applySettings() {
    AudioFX.setMuted(!SETTINGS.sfx);
    animSpeed = SPEEDS[SETTINGS.speed] || 1;
    document.documentElement.style.setProperty('--ui-scale', UI_SCALE[SETTINGS.ui] || 1);
    const mb = document.getElementById('btn-mute');
    if (mb) mb.textContent = SETTINGS.sfx ? '🔊' : '🔇';
    if (typeof labelGroup !== 'undefined') labelGroup.visible = SETTINGS.labels;
  }
  function setSetting(k, v) {
    SETTINGS[k] = v;
    try { localStorage.setItem(SET_KEY, JSON.stringify(SETTINGS)); } catch (e) {}
    applySettings();
  }

  // ---------- three.js scene ----------
  const TILE = 1, GAP = 0.06;
  const W = Board.W, H = Board.H;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141110);
  scene.fog = new THREE.Fog(0x141110, 40, 90);
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('#canvas-wrap').appendChild(renderer.domElement);

  const worldX = x => (x - W / 2 + 0.5) * TILE;
  const worldZ = y => (y - H / 2 + 0.5) * TILE;

  // Everything that makes up the stylised board lives here, so the whole look
  // can be swapped for the authentic mansion meshes with one visible flag.
  const styleGroup = new THREE.Group(); scene.add(styleGroup);
  // The case-file pedestal stays on screen in both looks.
  const caseGroup = new THREE.Group(); scene.add(caseGroup);
  // Room name plates stay readable in both looks.
  const labelGroup = new THREE.Group(); scene.add(labelGroup);

  // lights
  const hemi = new THREE.HemisphereLight(0xffe9c4, 0x2a2019, 0.75); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdfae, 1.35);
  sun.position.set(10, 22, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = 18; Object.assign(sun.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc });
  scene.add(sun);
  const candle1 = new THREE.PointLight(0xffa64d, 12, 20, 1.8); candle1.position.set(-9, 3, -9); scene.add(candle1);
  const candle2 = new THREE.PointLight(0xffa64d, 12, 20, 1.8); candle2.position.set(9, 3, 9); scene.add(candle2);

  // table under board
  const table = new THREE.Mesh(new THREE.BoxGeometry(W + 6, 1, H + 6), new THREE.MeshStandardMaterial({ color: 0x1d150f, roughness: 0.9 }));
  table.position.y = -0.62; table.receiveShadow = true; styleGroup.add(table);
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.3, H + 0.8), new THREE.MeshStandardMaterial({ color: 0x30241a, roughness: 0.85 }));
  base.position.y = -0.16; base.receiveShadow = true; styleGroup.add(base);

  // corridor tiles (instanced)
  const corridorTiles = Board.tiles.filter(t => t.type === 2);
  const tileGeo = new THREE.BoxGeometry(TILE - GAP, 0.1, TILE - GAP);
  const tileMatA = new THREE.MeshStandardMaterial({ color: 0x6d5338, roughness: 0.8 });
  const tileMatB = new THREE.MeshStandardMaterial({ color: 0x7a5d40, roughness: 0.8 });
  const instA = new THREE.InstancedMesh(tileGeo, tileMatA, corridorTiles.length);
  const instB = new THREE.InstancedMesh(tileGeo, tileMatB, corridorTiles.length);
  let ca = 0, cb = 0; const m4 = new THREE.Matrix4();
  for (const t of corridorTiles) {
    m4.setPosition(worldX(t.x), 0.05, worldZ(t.y));
    if ((t.x + t.y) % 2) instA.setMatrixAt(ca++, m4); else instB.setMatrixAt(cb++, m4);
  }
  instA.count = ca; instB.count = cb;
  instA.receiveShadow = instB.receiveShadow = true;
  styleGroup.add(instA, instB);

  // start markers
  for (let i = 0; i < Board.STARTS.length; i++) {
    const [x, y] = Board.STARTS[i];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 24), new THREE.MeshBasicMaterial({ color: SUSPECTS[i].hex, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(worldX(x), 0.12, worldZ(y));
    styleGroup.add(ring);
  }

  // rooms: floor slab + walls with door gaps + labels
  const roomMeshes = {};
  function makeLabel(text, color = '#e9dcc0', size = 42, w = 512, h = 128) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.font = `bold ${size}px "Aref Ruqaa", Tajawal, serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 10;
    c.fillStyle = color;
    c.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }
  const doorTiles = new Set(Board.doorLinks.map(d => d.roomTile[0] + ',' + d.roomTile[1]));
  const doorCorr = new Map(Board.doorLinks.map(d => [d.corridor[0] + ',' + d.corridor[1], d.room]));
  for (const [id, r] of Object.entries(Board.ROOMS)) {
    const [x0, y0, x1, y1] = r.rect;
    const rw = (x1 - x0 + 1), rh = (y1 - y0 + 1);
    const cx = (worldX(x0) + worldX(x1)) / 2, cz = (worldZ(y0) + worldZ(y1)) / 2;
    const dark = new THREE.Color(r.color).multiplyScalar(0.5);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.05, 0.14, rh - 0.05), new THREE.MeshStandardMaterial({ color: dark, roughness: 0.75 }));
    floor.position.set(cx, 0.07, cz); floor.receiveShadow = true;
    floor.userData = { roomId: id };
    styleGroup.add(floor);
    roomMeshes[id] = floor;
    // walls along perimeter, skipping door tiles' outward edge
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x453626, roughness: 0.9 });
    const wallH = 0.72, wallT = 0.14;
    const segs = [];
    for (let x = x0; x <= x1; x++) {
      if (!doorFacing(x, y0, 0, -1)) segs.push([worldX(x), worldZ(y0) - TILE / 2 + wallT / 2, TILE, wallT]);
      if (!doorFacing(x, y1, 0, 1)) segs.push([worldX(x), worldZ(y1) + TILE / 2 - wallT / 2, TILE, wallT]);
    }
    for (let y = y0; y <= y1; y++) {
      if (!doorFacing(x0, y, -1, 0)) segs.push([worldX(x0) - TILE / 2 + wallT / 2, worldZ(y), wallT, TILE]);
      if (!doorFacing(x1, y, 1, 0)) segs.push([worldX(x1) + TILE / 2 - wallT / 2, worldZ(y), wallT, TILE]);
    }
    for (const [wx, wz, sx, sz] of segs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), wallMat);
      wall.position.set(wx, wallH / 2 + 0.1, wz);
      wall.castShadow = true; wall.receiveShadow = true;
      styleGroup.add(wall);
    }
    // label
    const lw = Math.min(rw - 0.4, 5.2);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * 0.25), new THREE.MeshBasicMaterial({ map: makeLabel(r.name, '#d8c690'), transparent: true, depthWrite: false }));
    label.rotation.set(-Math.PI / 2, 0, Math.PI);
    label.position.set(cx, 0.16, cz + (cz > 0 ? -(rh / 2 - 0.85) : (rh / 2 - 0.85)));
    labelGroup.add(label);
    // door strips (brass)
    for (const dl of Board.doorLinks) {
      if (dl.room !== id) continue;
      const [dx, dy] = dl.roomTile; const [ox, oy] = dl.corridor;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(ox - dx) ? 0.5 : 0.7, 0.05, Math.abs(oy - dy) ? 0.5 : 0.7),
        new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.6, emissive: 0x332200, emissiveIntensity: 0.3 }));
      strip.position.set((worldX(dx) + worldX(ox)) / 2, 0.16, (worldZ(dy) + worldZ(oy)) / 2);
      styleGroup.add(strip);
    }
  }
  function doorFacing(x, y, dx, dy) {
    const t = Board.tiles[Board.idx(x, y)];
    if (!t || !t.door) return false;
    const nx = x + dx, ny = y + dy;
    return Board.doorLinks.some(d => d.roomTile[0] === x && d.roomTile[1] === y && d.corridor[0] === nx && d.corridor[1] === ny);
  }

  // stairs / envelope pedestal
  {
    const [x0, y0, x1, y1] = Board.STAIRS.rect;
    const cx = (worldX(x0) + worldX(x1)) / 2, cz = (worldZ(y0) + worldZ(y1)) / 2;
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    const pit = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.1, 0.3, rh - 0.1), new THREE.MeshStandardMaterial({ color: 0x0d0a08, roughness: 1 }));
    pit.position.set(cx, 0.02, cz); styleGroup.add(pit);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.8 }));
    ped.position.set(cx, 0.5, cz); ped.castShadow = true; caseGroup.add(ped);
    const env = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1), new THREE.MeshStandardMaterial({ color: 0xd9c58f, roughness: 0.6 }));
    env.position.set(cx, 1, cz); env.rotation.y = 0.5; env.castShadow = true; caseGroup.add(env);
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x8e2f2f, roughness: 0.5 }));
    seal.position.set(cx, 1.09, cz); seal.rotation.y = 0.5; caseGroup.add(seal);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: makeLabel('ملف القضية', '#c9a227', 46), transparent: true, depthWrite: false }));
    label.rotation.set(-Math.PI / 2, 0, Math.PI); label.position.set(cx, 0.2, cz + rh / 2 - 0.7);
    caseGroup.add(label);
  }

  // ---------- board look: stylised board  <->  authentic mansion ----------
  // The mansion meshes only exist in the local build (they are the installed
  // game's own assets), so this whole section stays dormant in the web build.
  const LOOK_KEY = 'qasr.boardLook';
  let boardLook = 'flat';
  let mansion = null;

  // The extracted mansion covers the house itself; the outer ring of the board
  // (the walk around the grounds) can fall outside it. This plate makes sure a
  // pawn always has ground under it instead of hanging over nothing.
  const groundGroup = new THREE.Group();
  groundGroup.visible = false;
  scene.add(groundGroup);
  {
    const pad = 2.2;
    const gw = W + pad * 2, gh = H + pad * 2;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(gw, gh),
      new THREE.MeshBasicMaterial({ color: 0x070a0f }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.06;
    groundGroup.add(g);
    // a paler apron so the walk around the house reads as a terrace, not a void
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 1.6, H + 1.6),
      new THREE.MeshBasicMaterial({ color: 0x141a22 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.04;
    groundGroup.add(apron);
    // a brass hairline marking where the board itself ends
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)),
      new THREE.LineBasicMaterial({ color: 0x6d5a33, transparent: true, opacity: 0.55 }));
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = -0.02;
    groundGroup.add(edge);
  }

  // pawns stand on the flat board's tile tops, but directly on the mansion floor
  const TOKEN_Y = { flat: 0.12, mansion: 0.015 };
  let tokenY = TOKEN_Y.flat;

  function mansionAvailable() { return !mansionBlocker(); }

  // Why the mansion style can't run here — null when everything is in place.
  // Spelled out on the card so a broken local setup is never a silent lock.
  function mansionBlocker() {
    if (!window.MANSION_CONFIG) return 'web';
    if (!window.Mansion) return 'mansion.js لم يُحمَّل — تأكد أن الملف موجود بجانب الصفحة.';
    if (!THREE.MTLLoader || !THREE.OBJLoader) return 'OBJLoader.js / MTLLoader.js لم يُحمَّلا — تأكد أنهما بجانب الصفحة.';
    return null;
  }

  function ensureMansion() {
    if (mansion || !mansionAvailable()) return mansion;
    toast('جارٍ تحميل القصر الأصلي…');
    mansion = window.Mansion.build({
      THREE, scene, W, H,
      onProgress: (done, total) => {
        if (done < total) toast(`جارٍ تحميل القصر… ${done} / ${total}`);
        else toast(mansion && mansion.failed ? `اكتمل التحميل (${mansion.failed} جزء لم يُحمَّل)` : 'اكتمل تحميل القصر');
        if (boardLook === 'mansion' && mansion) mansion.setVisible(true);
        standCache.clear();   // more of the house arrived — re-feel the tiles
      },
    });
    return mansion;
  }

  function applyLook() {
    const m = boardLook === 'mansion';
    styleGroup.visible = !m;
    groundGroup.visible = m;
    tokenY = m ? TOKEN_Y.mansion : TOKEN_Y.flat;
    for (const s of SUSPECTS) {
      tokens[s.id].mesh.position.y = tokenY;
      // life-size rooms need smaller figures — and it keeps them clear of walls
      tokens[s.id].mesh.scale.setScalar(m ? 0.8 : 1);
    }
    labelGroup.position.y = m ? 0.16 : 0;
    // the mansion carries its own baked lighting, so soften ours and drop the
    // shadow pass (nothing in the mesh receives it anyway)
    sun.castShadow = !m;
    sun.intensity = m ? 0.55 : 1.35;
    hemi.intensity = m ? 0.5 : 0.75;
    candle1.visible = candle2.visible = !m;
    scene.background.set(m ? 0x05080e : 0x141110);
    scene.fog = m ? new THREE.FogExp2(0x05080e, 0.006) : new THREE.Fog(0x141110, 40, 90);
    if (m) {
      const mm = ensureMansion(); if (mm) mm.setVisible(true);
      // the mansion is much taller than the flat board — pull back once
      if (!applyLook._framed) { applyLook._framed = true; frameBoard(); }
    } else if (mansion) mansion.setVisible(false);
    const btn = $('#btn-look');
    if (btn) btn.textContent = m ? '▦ بدون أثاث' : '🏛️ مع أثاث';
  }

  function setBoardLook(mode) {
    boardLook = mode === 'mansion' && mansionAvailable() ? 'mansion' : 'flat';
    standCache.clear();
    try { localStorage.setItem(LOOK_KEY, boardLook); } catch (e) {}
    applyLook();
  }

  // in-game shortcut for flipping the look mid-match
  {
    const btn = $('#btn-look');
    if (btn && mansionAvailable()) {
      btn.style.display = '';
      btn.onclick = () => { AudioFX.click(); setBoardLook(boardLook === 'mansion' ? 'flat' : 'mansion'); };
    } else if (btn) {
      btn.remove();
    }
  }

  // ---------- style picker (first screen) ----------
  // Both styles share the same rules, board and bots — only the look differs,
  // so picking one just sets boardLook and dresses the title screen.
  const TITLE_THEME = {
    flat: {
      tagline: 'جريمة في قصرٍ معزول… ستة مشتبه بهم، وسرٌّ واحد داخل ملف القضية',
      chip: 'الشكل الحالي: اللوح الكلاسيكي',
      bgOpacity: '0.72',
    },
    mansion: {
      tagline: 'ادخل القصر نفسه… بغرفه وأثاثه وإضاءته، وابحث عن الحقيقة بين جدرانه',
      chip: 'الشكل الحالي: القصر بالأثاث',
      bgOpacity: '0.5',
    },
  };

  function dressTitle() {
    const t = TITLE_THEME[boardLook] || TITLE_THEME.flat;
    const tag = document.querySelector('#screen-title .tagline');
    if (tag) tag.textContent = t.tagline;
    const bg = document.getElementById('title-bg');
    if (bg) bg.style.opacity = t.bgOpacity;
    let chip = document.getElementById('style-chip');
    if (!chip) {
      chip = el('p', 'style-chip'); chip.id = 'style-chip';
      const note = document.querySelector('#screen-title .note');
      if (note && note.parentNode) note.parentNode.insertBefore(chip, note);
    }
    chip.textContent = t.chip;
  }

  {
    const flatCard = $('#style-flat'), mansionCard = $('#style-mansion');
    const lock = $('#style-lock'), art = $('#style-art-mansion');
    if (art && ART.bg) art.style.backgroundImage = `url(${ART.bg})`;

    const pick = mode => {
      AudioFX.click();
      setBoardLook(mode);
      if (mode === 'mansion' && window.MansionMenu) { window.MansionMenu.enter(); return; }
      dressTitle();
      show('#screen-title');
    };
    if (flatCard) flatCard.onclick = () => pick('flat');
    if (mansionCard) {
      const blocked = mansionBlocker();
      if (!blocked) {
        if (lock) lock.remove();
        mansionCard.onclick = () => pick('mansion');
      } else {
        mansionCard.disabled = true;
        if (lock && blocked !== 'web') lock.textContent = blocked;
        console.warn('[qasr] mansion style unavailable:', blocked);
      }
    }
    const back = $('#btn-style-back');
    if (back) back.onclick = () => { AudioFX.click(); show('#screen-style'); };

    // The remembered choice only pre-selects the card; the meshes are not
    // fetched until the player actually picks the mansion.
    let saved = 'flat';
    try { saved = localStorage.getItem(LOOK_KEY) || 'flat'; } catch (e) {}
    boardLook = saved === 'mansion' && mansionAvailable() ? 'mansion' : 'flat';
    const preferred = boardLook === 'mansion' ? mansionCard : flatCard;
    if (preferred) preferred.classList.add('preferred');
    boardLook = 'flat';
    dressTitle();
  }

  // tokens (meeple-style pawns)
  function pawnGeo() {
    const pts = [];
    const prof = [[0, 0], [0.34, 0], [0.36, 0.05], [0.22, 0.12], [0.16, 0.35], [0.13, 0.5], [0.2, 0.62], [0.24, 0.78], [0.18, 0.92], [0.07, 1.0], [0, 1.02]];
    for (const [r, y] of prof) pts.push(new THREE.Vector2(r * 0.9, y * 1.15));
    return new THREE.LatheGeometry(pts, 24);
  }
  const PGEO = pawnGeo();
  const tokens = {};
  for (const s of SUSPECTS) {
    const mat = new THREE.MeshStandardMaterial({ color: s.hex, roughness: 0.35, metalness: 0.15 });
    const mesh = new THREE.Mesh(PGEO, mat);
    mesh.castShadow = true;
    mesh.visible = false;
    mesh.position.y = 0.12;
    scene.add(mesh);
    tokens[s.id] = { mesh, mat };
  }

  // highlights
  const hlGroup = new THREE.Group(); scene.add(hlGroup);
  const discGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.07, 22);
  const discMat = new THREE.MeshBasicMaterial({ color: 0xf2e9d2, transparent: true, opacity: 0.9 });
  const discRingGeo = new THREE.TorusGeometry(0.36, 0.05, 8, 22);
  const discRingMat = new THREE.MeshBasicMaterial({ color: 0x8e2f2f });
  const roomHl = {};
  for (const [id, r] of Object.entries(Board.ROOMS)) {
    const [x0, y0, x1, y1] = r.rect;
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    const g = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.02, 0.18, rh - 0.02), new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.16 }));
    g.position.set((worldX(x0) + worldX(x1)) / 2, 0.1, (worldZ(y0) + worldZ(y1)) / 2);
    g.visible = false; g.userData = { roomId: id, isRoomHl: true };
    scene.add(g); roomHl[id] = g;
  }

  // dice
  function diceTexture(n) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = '#e9dcc0'; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#b39b6d'; c.lineWidth = 6; c.strokeRect(3, 3, 122, 122);
    c.fillStyle = '#2b241c';
    const P = { 1: [[64, 64]], 2: [[36, 36], [92, 92]], 3: [[32, 32], [64, 64], [96, 96]], 4: [[36, 36], [92, 36], [36, 92], [92, 92]], 5: [[36, 36], [92, 36], [64, 64], [36, 92], [92, 92]], 6: [[36, 32], [92, 32], [36, 64], [92, 64], [36, 96], [92, 96]] };
    for (const [x, y] of P[n]) { c.beginPath(); c.arc(x, y, 11, 0, 7); c.fill(); }
    return new THREE.CanvasTexture(cv);
  }
  const diceMats = [3, 4, 1, 6, 2, 5].map(n => new THREE.MeshStandardMaterial({ map: diceTexture(n), roughness: 0.4 }));
  // face order for BoxGeometry: +x,-x,+y,-y,+z,-z → values 3,4,1,6,2,5
  const faceRot = { 1: [0, 0, 0], 2: [-Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2], 5: [Math.PI / 2, 0, 0], 6: [Math.PI, 0, 0] };
  const dice = [0, 1].map(i => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), diceMats);
    m.castShadow = true; m.visible = false; scene.add(m);
    return m;
  });

  // ---------- camera control ----------
  const camCtl = { theta: Math.PI, phi: 0.98, dist: 26, target: new THREE.Vector3(0, 0, 0), tTarget: new THREE.Vector3(0, 0, 0), tDist: 26 };
  function applyCam() {
    camCtl.dist += (camCtl.tDist - camCtl.dist) * 0.08;
    camCtl.target.lerp(camCtl.tTarget, 0.06);
    const y = Math.cos(camCtl.phi) * camCtl.dist;
    const r = Math.sin(camCtl.phi) * camCtl.dist;
    camera.position.set(camCtl.target.x + Math.sin(camCtl.theta) * r, y, camCtl.target.z + Math.cos(camCtl.theta) * r);
    camera.lookAt(camCtl.target.x, 0, camCtl.target.z);
  }
  // One finger (or the mouse) swings the camera; two fingers pinch to zoom and
  // drag to pan. The wheel still zooms for anyone on a desktop.
  let dragging = false, px = 0, py = 0, moved2 = 0;
  const wrap = $('#canvas-wrap');
  const touches = new Map();
  let pinchDist = 0, pinchMid = null;

  const setDist = d => { camCtl.tDist = Math.min(46, Math.max(8, d)); };
  function twoFingerState() {
    const [a, b] = [...touches.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  wrap.addEventListener('pointerdown', e => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) { dragging = true; moved2 = 0; px = e.clientX; py = e.clientY; }
    else if (touches.size === 2) {
      dragging = false;
      const st = twoFingerState(); pinchDist = st.dist; pinchMid = st.mid;
    }
  });
  addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      const st = twoFingerState();
      if (pinchDist > 0) setDist(camCtl.tDist * (pinchDist / Math.max(1, st.dist)));
      // dragging both fingers together slides the board under the camera
      if (pinchMid) {
        const mdx = st.mid.x - pinchMid.x, mdy = st.mid.y - pinchMid.y;
        const k = camCtl.dist * 0.0016;
        const cos = Math.cos(camCtl.theta), sin = Math.sin(camCtl.theta);
        camCtl.tTarget.x -= (mdx * cos - mdy * sin) * k;
        camCtl.tTarget.z += (mdx * sin + mdy * cos) * k;
      }
      pinchDist = st.dist; pinchMid = st.mid;
      moved2 += 20;
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    moved2 += Math.abs(dx) + Math.abs(dy);
    camCtl.theta -= dx * 0.005;
    camCtl.phi = Math.min(1.35, Math.max(0.25, camCtl.phi - dy * 0.004));
  });
  function endPointer(e) {
    touches.delete(e.pointerId);
    if (touches.size < 2) { pinchDist = 0; pinchMid = null; }
    if (touches.size === 0) dragging = false;
    else if (touches.size === 1) {
      const [t] = [...touches.values()];
      px = t.x; py = t.y; dragging = true;
    }
  }
  addEventListener('pointerup', endPointer);
  addEventListener('pointercancel', endPointer);
  wrap.addEventListener('wheel', e => { setDist(camCtl.tDist + e.deltaY * 0.02); e.preventDefault(); }, { passive: false });

  // a tall phone screen needs the camera further back to see the same board
  const isPortrait = () => innerHeight > innerWidth * 1.05;
  const WALK_DIST = 18;      // how close the camera pulls in while a pawn walks
  function frameBoard() {
    const base = boardLook === 'mansion' ? 34 : 26;
    setDist(isPortrait() ? base * 1.45 : base);
    camCtl.phi = isPortrait() ? 0.78 : 0.9;
  }
  function focusOn(x, z, dist) {
    if (!SETTINGS.follow) return;      // the player would rather steer themselves
    camCtl.tTarget.set(x * 0.8, 0, z * 0.8);
    // a tall screen shows less of the board at the same distance, so back off
    if (dist) setDist(dist * (isPortrait() ? 1.5 : 1));
  }

  // ---------- raycast picking ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  wrap.addEventListener('click', e => {
    if (moved2 > 6) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...hlGroup.children, ...Object.values(roomHl).filter(m => m.visible)], false);
    if (hits.length) {
      const o = hits[0].object;
      if (o.userData.isRoomHl) UI.pickRoom(o.userData.roomId);
      else if (o.userData.tile) UI.pickTile(o.userData.tile);
    }
  });

  // ---------- animation helpers ----------
  const anims = [];
  function animate(dur, fn, done) { anims.push({ t: 0, dur, fn, done }); }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ---- standing room ----
  // The board grid and the mansion mesh agree on the floor plan, but a tile
  // centre can still land inside a wall corner or a piece of furniture. Before
  // a pawn comes to rest on a tile we feel around it and slide it to the
  // nearest open spot. Purely cosmetic: the grid, and so the rules, never move.
  const standCache = new Map();
  const PROBE_DIRS = [];
  function standOffset(x, y) {
    if (boardLook !== 'mansion' || !mansion || !mansion.group) return null;
    const key = x + ',' + y;
    if (standCache.has(key)) return standCache.get(key);
    if (!PROBE_DIRS.length)
      for (let i = 0; i < 8; i++) PROBE_DIRS.push(new THREE.Vector3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)));
    const ray = new THREE.Raycaster();
    const org = new THREE.Vector3();
    const clearance = (wx, wz) => {
      let min = 0.6;
      org.set(wx, tokenY + 0.45, wz);
      for (const d of PROBE_DIRS) {
        ray.set(org, d); ray.far = 0.6;
        const h = ray.intersectObject(mansion.group, true)[0];
        ray.far = Infinity;
        if (h && h.distance < min) { min = h.distance; if (min < 0.06) break; }
      }
      return min;
    };
    const wx = worldX(x), wz = worldZ(y);
    const c0 = clearance(wx, wz);
    let res = null;
    if (c0 < 0.28) {
      const d = 0.32, h = 0.23;
      let best = { dx: 0, dz: 0, c: c0 };
      for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d], [h, h], [h, -h], [-h, h], [-h, -h]]) {
        const c = clearance(wx + dx, wz + dz);
        if (c > best.c + 0.02) best = { dx, dz, c };
      }
      if (best.dx || best.dz) res = [best.dx, best.dz];
    }
    standCache.set(key, res);
    return res;
  }
  function standX(x, y) { const o = standOffset(x, y); return worldX(x) + (o ? o[0] : 0); }
  function standZ(x, y) { const o = standOffset(x, y); return worldZ(y) + (o ? o[1] : 0); }

  function tokenToWorld(tok, x, y, inst) {
    tok.mesh.position.set(standX(x, y), tokenY, standZ(x, y));
  }
  // The camera rides along with whoever is walking — yours or a rival's — so
  // every move is watched rather than guessed at from the log.
  function walkCam(tok) {
    if (!SETTINGS.follow) return;
    camCtl.tTarget.set(tok.mesh.position.x * 0.8, 0, tok.mesh.position.z * 0.8);
  }

  function animatePath(suspectId, path, onDone) {
    const tok = tokens[suspectId];
    let i = 0;
    if (SETTINGS.follow && path.length > 1) setDist(WALK_DIST * (isPortrait() ? 1.5 : 1));
    function step() {
      if (i >= path.length - 1) { onDone && onDone(); return; }
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      i++;
      const last = i >= path.length - 1;
      // mid-walk the pawn cuts the corners; only where it stops do we make room
      const x0 = i === 1 ? tok.mesh.position.x : worldX(ax);
      const z0 = i === 1 ? tok.mesh.position.z : worldZ(ay);
      const x1 = last ? standX(bx, by) : worldX(bx);
      const z1 = last ? standZ(bx, by) : worldZ(by);
      AudioFX.step();
      animate(0.14, t => {
        const e2 = ease(t);
        tok.mesh.position.set(x0 + (x1 - x0) * e2, tokenY + Math.sin(t * Math.PI) * 0.35, z0 + (z1 - z0) * e2);
        walkCam(tok);
      }, step);
    }
    step();
  }
  function fadeTokenTo(suspectId, x, y, onDone) {
    const tok = tokens[suspectId];
    AudioFX.pull();
    animate(0.4, t => { tok.mat.transparent = true; tok.mat.opacity = 1 - t; }, () => {
      tokenToWorld(tok, x, y);
      walkCam(tok);
      animate(0.4, t => { tok.mat.opacity = t; }, () => { tok.mat.transparent = false; tok.mat.opacity = 1; onDone && onDone(); });
    });
  }
  function rollDiceAnim(d1, d2, onDone) {
    AudioFX.dice();
    const tgt = camCtl.tTarget;
    const vals = [d1, d2];
    dice.forEach((m, i) => {
      m.visible = true;
      const sx = tgt.x + (i ? 1.4 : -1.4), sz = tgt.z + 2;
      m.position.set(sx, 7, sz + 4);
      const rot = faceRot[vals[i]];
      const spins = 2 + Math.floor(Math.random() * 2);
      const r0 = { x: Math.random() * 6, y: Math.random() * 6, z: Math.random() * 6 };
      animate(1.1, t => {
        const e2 = 1 - Math.pow(1 - t, 3);
        m.position.set(sx, 7 - 6.4 * e2 + Math.abs(Math.sin(t * Math.PI * 2.2)) * (1 - t) * 1.6, sz + 4 - 4 * e2);
        m.rotation.set(
          r0.x + (rot[0] + Math.PI * 2 * spins - r0.x) * e2,
          r0.y + (rot[1] + Math.PI * 2 * spins - r0.y) * e2,
          r0.z + (rot[2] - r0.z) * e2);
      }, i === 0 ? null : () => { setTimeout(() => { onDone && onDone(); }, 350); });
    });
    setTimeout(() => dice.forEach(m => animate(0.3, t => { m.position.y = 0.6 - t * 1.4; }, () => m.visible = false)), 2600);
  }

  // render loop
  const clock = new THREE.Clock();
  let flick = 0;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt * animSpeed;
      const t = Math.min(1, a.t / a.dur);
      a.fn(t);
      if (t >= 1) { anims.splice(i, 1); a.done && a.done(); }
    }
    flick += dt;
    candle1.intensity = 11 + Math.sin(flick * 9) * 1.2 + Math.sin(flick * 23) * 0.7;
    candle2.intensity = 11 + Math.cos(flick * 7) * 1.2 + Math.sin(flick * 19) * 0.7;
    for (const id in roomHl) if (roomHl[id].visible) roomHl[id].material.opacity = 0.13 + Math.sin(flick * 4) * 0.06;
    for (const d of hlGroup.children) d.material.opacity = 0.75 + Math.sin(flick * 5) * 0.2;
    applyCam();
    renderer.render(scene, camera);
  }
  loop();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ================= UI =================
  let game = null;
  let clueMarks = {}; // manual marks: key -> 0..3
  let autoMarks = {}; // key -> {holder} known info for human

  const HINTS = {
    ROLL_DICE: 'دورك — ارمِ النرد أو استخدم الممر السري إن وُجد',
    MOVE: 'اختر مربعًا مضيئًا للتحرك إليه، أو غرفة مضيئة لدخولها',
    SUGGEST: 'أنت داخل الغرفة — قدّم اقتراحًا للتحقيق',
    TURN_END: 'أنهِ دورك، أو وجّه اتهامًا نهائيًا إذا كنت متأكدًا',
  };

  const UI = {
    pickTile(t) {
      if (!game || game.state !== 'MOVE' || !game.player().human) return;
      clearHighlights();
      game.moveTo({ x: t.x, y: t.y });
    },
    pickRoom(roomId) {
      if (!game || game.state !== 'MOVE' || !game.player().human) return;
      clearHighlights();
      game.moveTo({ room: roomId });
    },
  };
  window.UI = UI;

  function clearHighlights() {
    hlGroup.clear();
    for (const id in roomHl) roomHl[id].visible = false;
  }
  function showMoveOptions(options) {
    clearHighlights();
    for (const c of options.corridors) {
      const d = new THREE.Mesh(discGeo, discMat.clone());
      d.position.set(worldX(c.x), tokenY + 0.02, worldZ(c.y));
      d.userData = { tile: c };
      const ring = new THREE.Mesh(discRingGeo, discRingMat);
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
      ring.userData = { tile: c };
      d.add(ring);
      hlGroup.add(d);
    }
    for (const roomId in options.rooms) roomHl[roomId].visible = true;
  }

  function hint(txt) { $('#hint').textContent = txt || ''; $('#hint').classList.toggle('show', !!txt); }
  function setButtons(list) {
    const bar = $('#actions'); bar.innerHTML = '';
    for (const b of list) {
      const btn = el('button', 'act-btn' + (b.cls ? ' ' + b.cls : ''), b.label);
      btn.onclick = () => { AudioFX.click(); b.fn(); };
      bar.appendChild(btn);
    }
  }

  function suspectName(id) { return SUSPECTS.find(s => s.id === id).name; }
  function weaponName(id) { return WEAPONS.find(w => w.id === id).name; }
  function artOf(c) {
    if (c.cat === 'suspect') return ART['s_' + c.id];
    if (c.cat === 'weapon') return ART['w_' + c.id];
    if (c.cat === 'room') return ART['r_' + c.id];
    return null;
  }
  function cardHTML(c, big) {
    let icon = '', name = '', style = '';
    if (c.cat === 'suspect') { const s = SUSPECTS.find(x => x.id === c.id); name = s.name; style = `border-color:${s.color}`; icon = `<span class="sus-dot" style="background:${s.color}"></span>`; }
    if (c.cat === 'weapon') { const w = WEAPONS.find(x => x.id === c.id); icon = `<span class="w-ico">${w.icon}</span>`; name = w.name; }
    if (c.cat === 'room') { icon = '<span class="w-ico">🚪</span>'; name = Board.ROOMS[c.id].name; }
    const src = artOf(c);
    const art = src ? `<img class="pc-art" src="${src}" alt="">` : icon;
    return `<div class="pcard${big ? ' big' : ''}" style="${style}">${art}<span>${name}</span></div>`;
  }

  // ----- screens -----
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('on');
    if (id) $(id).classList.add('on');
  }

  // setup state
  let chosen = { suspect: 'crimson', bots: 3, diff: 'normal' };
  let skinFilter = 'classic';
  function renderSetup() {
    const grid = $('#pick-suspects'); grid.innerHTML = '';
    for (const s of SUSPECTS) {
      const c = el('div', 'sus-pick' + (chosen.suspect === s.id ? ' sel' : ''));
      c.innerHTML = ART['s_' + s.id]
        ? `<img class="sus-portrait" src="${ART['s_' + s.id]}" alt=""><div>${s.name}</div><div class="sus-bar" style="background:${s.color}"></div>`
        : `<div class="sus-avatar" style="background:${s.color}"></div><div>${s.name}</div>`;
      c.onclick = () => { AudioFX.click(); chosen.suspect = s.id; renderSetup(); };
      grid.appendChild(c);
    }
    const bots = $('#pick-bots'); bots.innerHTML = '';
    for (let n = 2; n <= 5; n++) {
      const b = el('button', 'chip' + (chosen.bots === n ? ' sel' : ''), n + ' بوتات');
      b.onclick = () => { AudioFX.click(); chosen.bots = n; renderSetup(); };
      bots.appendChild(b);
    }
    const dd = $('#pick-diff'); dd.innerHTML = '';
    for (const [k, label] of [['easy', 'مبتدئ'], ['normal', 'محقق محترف']]) {
      const b = el('button', 'chip' + (chosen.diff === k ? ' sel' : ''), label);
      b.onclick = () => { AudioFX.click(); chosen.diff = k; renderSetup(); };
      dd.appendChild(b);
    }
  }

  if (ART.bg) { const tb = document.getElementById('title-bg'); if (tb) tb.style.backgroundImage = `url(${ART.bg})`; }

  applySettings();   // everything above is built, so the saved choices can land now

  if (window.MansionMenu) {
    window.MansionMenu.init({
      click: () => AudioFX.click(),
      toast: msg => toast(msg),
      onLeave: () => show('#screen-style'),
      onStart: cfg => {
        chosen = { suspect: cfg.suspect, bots: cfg.bots, diff: cfg.diff, botSuspects: cfg.botSuspects };
        skinFilter = cfg.skin || 'classic';
        startGame();
      },
    });
  }

  $('#btn-start').onclick = () => { AudioFX.click(); renderSetup(); show('#screen-setup'); };
  $('#btn-how').onclick = () => { AudioFX.click(); show('#screen-how'); };
  $('#btn-how-back').onclick = () => { AudioFX.click(); show('#screen-title'); };
  $('#btn-setup-back').onclick = () => { AudioFX.click(); show('#screen-title'); };
  $('#btn-mute').onclick = () => setSetting('sfx', !SETTINGS.sfx);
  $('#btn-play').onclick = () => { AudioFX.click(); startGame(); };

  function startGame() {
    show(null);
    $('#hud').classList.add('on');
    clueMarks = {}; autoMarks = {};
    game = new Game({
      playerCount: chosen.bots + 1,
      humanSuspect: chosen.suspect,
      suspects: chosen.botSuspects,
      difficulty: chosen.diff,
      emit: onEvent,
    });
    game.onReenact = playReenactment;
    game.onReturnHome = walkHome;
    // place tokens
    for (const s of SUSPECTS) tokens[s.id].mesh.visible = false;
    for (const p of game.players) {
      tokenToWorld(tokens[p.suspect], p.pos.x, p.pos.y);
      tokens[p.suspect].mesh.visible = true;
      tokens[p.suspect].mat.color.set(SUSPECTS.find(s => s.id === p.suspect).hex);
    }
    for (const c of game.players[0].hand) autoMarks[cardKey(c)] = 'me';
    for (const c of game.publicCards) autoMarks[cardKey(c)] = 'pub';
    renderPlayers();
    renderClueSheet();
    renderHand();
    $('#log-feed').innerHTML = '';
    frameBoard();
    game.startTurn();
  }

  function renderPlayers() {
    const bar = $('#players'); bar.innerHTML = '';
    for (const p of game.players) {
      const s = SUSPECTS.find(x => x.id === p.suspect);
      const d = el('div', 'pl-chip' + (game.turn === p.idx && game.state !== 'GAME_OVER' ? ' active' : '') + (p.eliminated ? ' out' : ''));
      const face = ART['s_' + p.suspect];
      if (face) {
        d.classList.add('rich');
        d.innerHTML = `<img class="pl-face" src="${face}" alt="" style="filter:${skinFilterCss(p.human ? skinFilter : 'classic')}">` +
          `<span class="pl-name" style="background:${s.color}">${p.human ? 'أنت' : s.short}</span>` +
          `<span class="pl-cards">${p.hand.length}🂠</span>`;
      } else {
        d.innerHTML = `<span class="pl-dot" style="background:${s.color}"></span><span>${p.human ? 'أنت' : s.short}</span><span class="pl-cards">${p.hand.length}🂠</span>`;
      }
      bar.appendChild(d);
    }
    syncHudTop();
  }

  // the player row can wrap to two lines with six detectives — keep whatever
  // sits under it (hint, toast) below the row instead of on top of it.
  function syncHudTop() {
    const bar = $('#players');
    const h = bar.getBoundingClientRect().height || 40;
    document.documentElement.style.setProperty('--hud-top', Math.round(12 + h) + 'px');
  }
  window.addEventListener('resize', syncHudTop);

  function renderHand() {
    const h = $('#hand'); h.innerHTML = '<div class="hand-label">أوراقك</div>';
    for (const c of game.players[0].hand) h.innerHTML += cardHTML(c);
    if (game.publicCards.length) {
      h.innerHTML += '<div class="hand-label">أوراق مكشوفة</div>';
      for (const c of game.publicCards) h.innerHTML += cardHTML(c);
    }
  }

  // clue sheet
  const MARKS = ['', '✗', '✓', '؟'];
  function renderClueSheet() {
    const div = $('#clue-body'); div.innerHTML = '';
    const sections = [
      ['المشتبه بهم', SUSPECTS.map(s => ({ cat: 'suspect', id: s.id, name: s.name }))],
      ['الأدوات', WEAPONS.map(w => ({ cat: 'weapon', id: w.id, name: w.name }))],
      ['الغرف', ROOM_IDS.map(r => ({ cat: 'room', id: r, name: Board.ROOMS[r].name }))],
    ];
    for (const [title, items] of sections) {
      div.appendChild(el('div', 'cs-sec', title));
      for (const it of items) {
        const k = it.cat + ':' + it.id;
        const row = el('div', 'cs-row');
        const auto = autoMarks[k];
        let autoTxt = '';
        if (auto === 'me') autoTxt = '<span class="cs-auto">معك</span>';
        else if (auto === 'pub') autoTxt = '<span class="cs-auto">مكشوف</span>';
        else if (typeof auto === 'number') autoTxt = `<span class="cs-auto">عند ${SUSPECTS.find(s => s.id === game.players[auto].suspect).short}</span>`;
        const m = clueMarks[k] || (auto !== undefined ? 1 : 0);
        row.innerHTML = `<span>${it.name}</span>${autoTxt}<button class="cs-mark m${m}">${MARKS[m] || '·'}</button>`;
        row.querySelector('button').onclick = () => {
          clueMarks[k] = ((clueMarks[k] || 0) + 1) % 4;
          AudioFX.click(); renderClueSheet();
        };
        div.appendChild(row);
      }
    }
  }
  $('#btn-clue').onclick = () => { AudioFX.click(); $('#clue-sheet').classList.toggle('open'); };
  $('#clue-close').onclick = () => { AudioFX.click(); $('#clue-sheet').classList.remove('open'); };

  function addLogLine(msg, cls) {
    const f = $('#log-feed');
    f.appendChild(el('div', 'log-line' + (cls ? ' ' + cls : ''), msg));
    while (f.children.length > 40) f.removeChild(f.firstChild);
    f.scrollTop = f.scrollHeight;
  }

  // ----- modal helpers -----
  function modal(html, noClose) {
    const m = $('#modal'); m.innerHTML = '';
    const box = el('div', 'modal-box');
    box.innerHTML = html;
    m.appendChild(box);
    m.classList.add('on');
    return box;
  }
  function closeModal() { $('#modal').classList.remove('on'); }

  function pickerModal(title, confirmLabel, cb, includeRooms) {
    let sel = { suspect: null, weapon: null, room: includeRooms ? null : undefined };
    const box = modal(`<h3>${title}</h3><div id="pk"></div><div class="modal-actions"><button class="act-btn ghost" id="pk-cancel">إلغاء</button><button class="act-btn primary" id="pk-ok" disabled>${confirmLabel}</button></div>`);
    const pk = box.querySelector('#pk');
    function render() {
      pk.innerHTML = '';
      const sec = (label, items, key) => {
        pk.appendChild(el('div', 'pk-label', label));
        const g = el('div', 'pk-grid');
        for (const it of items) {
          const c = el('div', 'pk-item' + (sel[key] === it.id ? ' sel' : ''));
          c.innerHTML = it.html;
          c.onclick = () => { AudioFX.click(); sel[key] = it.id; render(); };
          g.appendChild(c);
        }
        pk.appendChild(g);
      };
      const thumb = k => ART[k] ? `<img class="pk-thumb" src="${ART[k]}" alt="">` : '';
      sec('المشتبه به', SUSPECTS.map(s => ({ id: s.id, html: `${thumb('s_' + s.id) || `<span class="sus-dot" style="background:${s.color}"></span>`}<span>${s.short}</span>` })), 'suspect');
      sec('الأداة', WEAPONS.map(w => ({ id: w.id, html: `${thumb('w_' + w.id) || w.icon}<span>${w.name}</span>` })), 'weapon');
      if (includeRooms) sec('الغرفة', ROOM_IDS.map(r => ({ id: r, html: `${thumb('r_' + r) || '🚪'}<span>${Board.ROOMS[r].name}</span>` })), 'room');
      box.querySelector('#pk-ok').disabled = !(sel.suspect && sel.weapon && (!includeRooms || sel.room));
      box.querySelector('#pk-ok').onclick = () => { closeModal(); cb(sel); };
      box.querySelector('#pk-cancel').onclick = () => { AudioFX.click(); closeModal(); humanButtons(); };
    }
    render();
  }

  // ----- suggestion / accusation bar -----
  // Three cards along the bottom: tap one to open a picker. For a suggestion the
  // room card is fixed to the room you are standing in; an accusation lets you
  // name any room.
  const skinFilterCss = id => (window.MansionMenu ? window.MansionMenu.skinFilter(id) : 'none');

  const sugBar = {
    open: false, roomFixed: true, sel: { suspect: null, weapon: null, room: null },
    onConfirm: null, title: '',
  };

  function sugArt(kind, id) {
    return ART[(kind === 'suspect' ? 's_' : kind === 'weapon' ? 'w_' : 'r_') + id];
  }
  function sugName(kind, id) {
    if (kind === 'suspect') return SUSPECTS.find(x => x.id === id).short;
    if (kind === 'weapon') return WEAPONS.find(x => x.id === id).name;
    return Board.ROOMS[id].name;
  }
  function sugPlaceholder(kind) {
    return kind === 'suspect' ? '👤' : kind === 'weapon' ? '🗡️' : '🚪';
  }

  function renderSugBar() {
    for (const kind of ['suspect', 'weapon', 'room']) {
      const card = $('#sug-' + kind);
      const id = sugBar.sel[kind];
      card.classList.toggle('filled', !!id);
      card.classList.toggle('fixed', kind === 'room' && sugBar.roomFixed);
      if (!id) { card.innerHTML = `<span class="sug-ph">${sugPlaceholder(kind)}</span>`; continue; }
      const art = sugArt(kind, id);
      card.innerHTML = (art ? `<img src="${art}" alt="">` : `<span class="sug-ph">${sugPlaceholder(kind)}</span>`) +
        `<span class="sug-tag">${sugName(kind, id)}</span>`;
    }
    $('#sug-go').disabled = !(sugBar.sel.suspect && sugBar.sel.weapon && sugBar.sel.room);
  }

  function openSugBar(opts) {
    sugBar.open = true;
    sugBar.roomFixed = !!opts.roomFixed;
    sugBar.sel = { suspect: null, weapon: null, room: opts.room || null };
    sugBar.onConfirm = opts.onConfirm;
    $('#sug-go').textContent = opts.confirmLabel || 'اقترح';
    $('#sug-bar').classList.add('on');
    $('#actions').style.display = 'none';
    document.body.classList.add('sug-open');
    hint(opts.hint || 'اختر المشتبه به والأداة');
    renderSugBar();
  }

  function closeSugBar() {
    sugBar.open = false;
    closeSugPick();
    $('#sug-bar').classList.remove('on');
    $('#actions').style.display = '';
    document.body.classList.remove('sug-open');
  }

  // ----- crime re-enactment cutscene -----
  // Plays between "someone suggests" and "someone answers": the room goes dark,
  // a beam falls on the accused and the weapon, and the line is read out.
  const reenact = { timer: 0, done: null };

  function playReenactment(sug, done) {
    const box = $('#reenact');
    if (!box || !game || !SETTINGS.cutscene) { done(); return; }
    const by = game.players[sug.by];
    const sus = SUSPECTS.find(x => x.id === sug.suspect);
    const wep = WEAPONS.find(x => x.id === sug.weapon);
    const room = Board.ROOMS[sug.room];
    const human = game.players[0];

    $('#re-bg').style.backgroundImage = ART['r_' + sug.room] ? `url(${ART['r_' + sug.room]})` : 'none';
    const face = ART['s_' + sug.suspect];
    const susImg = $('#re-sus-img');
    susImg.src = face || '';
    susImg.style.display = face ? '' : 'none';
    susImg.style.filter = (human && human.suspect === sug.suspect) ? skinFilterCss(skinFilter) : '';
    const wIco = ART['w_' + sug.weapon];
    const wepImg = $('#re-wep-img');
    wepImg.src = wIco || '';
    wepImg.style.display = wIco ? '' : 'none';

    $('#re-kicker').textContent = by.human ? 'إعادة تمثيل — اقتراحك' : `إعادة تمثيل — اقتراح ${game.displayName(by)}`;
    $('#re-sus-name').textContent = sus.name;
    $('#re-wep-name').textContent = wep.name;
    $('#re-room-name').textContent = `في ${room.name}`;
    $('#re-line').textContent = `«${sus.name}… بـ${wep.name}… في ${room.name}»`;

    // restart the CSS animations
    box.classList.remove('on');
    void box.offsetWidth;
    box.classList.add('on');
    AudioFX.suggest();

    reenact.done = () => {
      if (!reenact.done) return;
      reenact.done = null;
      clearTimeout(reenact.timer);
      box.classList.remove('on');
      done();
    };
    reenact.timer = setTimeout(() => reenact.done && reenact.done(), by.human ? 4200 : 3200);
  }

  // ----- walking back after being dragged into a room -----
  // A suggestion pulls your pawn across the board. At the start of your turn it
  // walks back to where it was, in full view, so the board still reads as the
  // moves people actually made.
  function walkHome(info, done) {
    const pl = info.player;
    const tok = tokens[pl.suspect];
    toast(pl.human
      ? '↩️ تعود إلى مكانك قبل أن يُشتبه بك'
      : `↩️ ${game.suspectOf(pl).name} يعود إلى مكانه`);
    focusOn(tok.mesh.position.x, tok.mesh.position.z, WALK_DIST);
    const land = () => { tokenToWorld(tok, pl.pos.x, pl.pos.y); walkCam(tok); done(); };
    if (!info.path || info.path.length < 2) { setTimeout(land, 500); return; }
    setTimeout(() => animatePath(pl.suspect, info.path, land), 550);
  }

  function skipReenactment() { if (reenact.done) { AudioFX.click(); reenact.done(); } }
  $('#re-skip').onclick = skipReenactment;
  $('#reenact').onclick = e => { if (e.target.id === 'reenact' || e.target.classList.contains('re-vig')) skipReenactment(); };

  function closeSugPick() { $('#sug-pick').classList.remove('on'); }

  function openSugPick(kind) {
    if (kind === 'room' && sugBar.roomFixed) return;
    AudioFX.click();
    const titles = { suspect: 'اختر المشتبه به', weapon: 'اختر الأداة', room: 'اختر الغرفة' };
    $('#sug-pick-title').textContent = titles[kind];
    const grid = $('#sug-pick-grid'); grid.innerHTML = '';
    const items = kind === 'suspect' ? SUSPECTS.map(x => x.id)
      : kind === 'weapon' ? WEAPONS.map(x => x.id)
      : ROOM_IDS;
    for (const id of items) {
      const art = sugArt(kind, id);
      // a card already in your hand can still be named — the note just reminds you
      const mine = game && game.players[0].hand.some(c => c.cat === kind && c.id === id);
      const b = el('button', 'sug-opt' + (mine ? ' mine' : ''),
        (art ? `<img src="${art}" alt="">` : `<div class="sug-ph">${sugPlaceholder(kind)}</div>`) +
        `<span>${sugName(kind, id)}</span>` + (mine ? '<span class="sug-mark">في يدك</span>' : ''));
      b.onclick = () => {
        AudioFX.click();
        sugBar.sel[kind] = id;
        closeSugPick();
        renderSugBar();
      };
      grid.appendChild(b);
    }
    $('#sug-pick').classList.add('on');
  }

  for (const kind of ['suspect', 'weapon', 'room']) {
    $('#sug-' + kind).onclick = () => openSugPick(kind);
  }
  $('#sug-pick').onclick = e => { if (e.target.id === 'sug-pick') closeSugPick(); };
  $('#sug-cancel').onclick = () => { AudioFX.click(); closeSugBar(); humanButtons(); };
  $('#sug-go').onclick = () => {
    if ($('#sug-go').disabled) return;
    AudioFX.click();
    const sel = { ...sugBar.sel };
    closeSugBar();
    sugBar.onConfirm(sel);
  };

  // ----- human action buttons per state -----
  function humanButtons() {
    if (!game || game.state === 'GAME_OVER') { closeSugBar(); return; }
    const p = game.player();
    if (!p.human || p.eliminated) { closeSugBar(); setButtons([]); return; }
    if (sugBar.open) return;
    const btns = [];
    const accuseBtn = { label: '⚖️ اتهام نهائي', cls: 'danger', fn: () => openSugBar({
      roomFixed: false, confirmLabel: 'وجّه الاتهام',
      hint: 'الاتهام النهائي — إجابة خاطئة تخرجك من التحقيق!',
      onConfirm: sel => game.makeAccusation(sel.suspect, sel.weapon, sel.room),
    }) };
    if (game.state === 'ROLL_DICE') {
      btns.push({ label: '🎲 ارمِ النرد', cls: 'primary', fn: () => { setButtons([]); game.rollDice(); } });
      const pd = game.canUsePassage();
      if (pd) btns.push({ label: `🕳️ الممر السري إلى ${Board.ROOMS[pd].name}`, fn: () => { clearHighlights(); game.usePassage(); } });
      btns.push(accuseBtn);
    } else if (game.state === 'MOVE') {
      const opts = game.moveOptions;
      if (!opts.corridors.length && !Object.keys(opts.rooms).length)
        btns.push({ label: 'لا مسار متاح — إنهاء الدور', fn: () => { clearHighlights(); game.endTurn(); } });
      btns.push(accuseBtn);
    } else if (game.state === 'SUGGEST') {
      btns.push({ label: '🔍 قدّم اقتراحًا', cls: 'primary', fn: () => openSugBar({
        roomFixed: true, room: p.pos.room, confirmLabel: 'اقترح',
        hint: `اقتراح في ${Board.ROOMS[p.pos.room].name} — اختر المشتبه به والأداة`,
        onConfirm: sel => game.makeSuggestion(sel.suspect, sel.weapon),
      }) });
      btns.push({ label: 'إنهاء الدور', cls: 'ghost', fn: () => game.endTurn() });
      btns.push(accuseBtn);
    } else if (game.state === 'TURN_END') {
      btns.push({ label: 'إنهاء الدور', cls: 'primary', fn: () => game.endTurn() });
      btns.push(accuseBtn);
    }
    setButtons(btns);
    hint(HINTS[game.state]);
  }

  // ----- game events -----
  function onEvent(type, data) { (handlers[type] || (() => {}))(data); }
  const handlers = {
    log: d => addLogLine(d.msg, d.cls),
    turnStart: d => {
      renderPlayers();
      const tok = tokens[d.player.suspect];
      focusOn(tok.mesh.position.x, tok.mesh.position.z, 22);
      if (d.player.human) { humanButtons(); }
      else { setButtons([]); hint(`دور ${game.suspectOf(d.player).name}...`); }
    },
    diceRolled: d => {
      setButtons([]); hint('');
      rollDiceAnim(d.d1, d.d2, () => {
        $('#dice-res').textContent = `🎲 ${d.d1} + ${d.d2} = ${d.total}`;
        $('#dice-res').classList.add('show');
        setTimeout(() => $('#dice-res').classList.remove('show'), 2600);
        if (d.player.human) { showMoveOptions(d.options); humanButtons(); }
      });
    },
    moved: d => {
      clearHighlights();
      animatePath(d.player.suspect, d.path.length > 1 ? d.path : [[d.player.pos.x, d.player.pos.y]], () => {
        if (d.room) { AudioFX.door(); tokenToWorld(tokens[d.player.suspect], d.player.pos.x, d.player.pos.y); }
        if (d.player.human) humanButtons();
      });
      if (d.room) focusOn(worldX(d.player.pos.x), worldZ(d.player.pos.y), 17);
    },
    movedToRoom: d => {
      fadeTokenTo(d.player.suspect, d.player.pos.x, d.player.pos.y, () => { if (d.player.human) humanButtons(); });
      focusOn(worldX(d.player.pos.x), worldZ(d.player.pos.y), 17);
    },
    suspectPulled: d => fadeTokenTo(d.player.suspect, d.player.pos.x, d.player.pos.y),
    suggestionMade: d => {
      AudioFX.suggest();
      const s = game.suggestion;
      toast(`🔍 ${game.displayName(game.players[s.by])}: «${suspectName(s.suspect)} بـ${weaponName(s.weapon)} في ${Board.ROOMS[s.room].name}»`);
    },
    cannotDisprove: d => {},
    chooseCardToShow: d => {
      const box = modal(`<h3>يجب أن تُظهر كرتًا لدحض الاقتراح</h3><div class="pk-grid" id="show-pick"></div>`);
      const g = box.querySelector('#show-pick');
      for (const c of d.matching) {
        const div = el('div', 'pk-item');
        div.innerHTML = cardHTML(c);
        div.onclick = () => { AudioFX.card(); closeModal(); game.showCard(d.responder, c); };
        g.appendChild(div);
      }
    },
    cardShown: d => {
      AudioFX.card();
      if (d.card) {
        // human saw the card
        autoMarks[cardKey(d.card)] = d.responder.idx;
        renderClueSheet();
        const box = modal(`<h3>${game.displayName(d.responder)} أظهر لك:</h3><div class="reveal-card">${cardHTML(d.card, true)}</div><div class="modal-actions"><button class="act-btn primary" id="ok">تدوين في ورقة التحقيق</button></div>`);
        box.querySelector('#ok').onclick = () => { closeModal(); if (game.player().human) humanButtons(); };
      } else if (game.player().human) humanButtons();
      renderPlayers();
    },
    nobodyDisproved: d => {
      toast('❗ لا أحد استطاع الدحض — دوّن ذلك جيدًا!');
      if (game.player().human) humanButtons();
    },
    accusationWrong: d => {
      AudioFX.bad();
      renderPlayers();
      if (d.player.human) {
        toast('اتهام خاطئ! خرجت من التحقيق لكن يمكنك متابعة المشاهدة', 'bad');
        setButtons([]); hint('تشاهد بقية التحقيق...');
      }
      tokens[d.player.suspect].mat.color.multiplyScalar(0.35);
    },
    turnEnd: d => { renderPlayers(); },
    gameOver: d => {
      setButtons([]); hint('');
      clearHighlights();
      recordCase(d);
      setTimeout(() => showGameOver(d), 900);
    },
  };

  function toast(msg, cls) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show' + (cls ? ' ' + cls : '');
    clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 3400);
  }

  function showGameOver(d) {
    const e = game.envelope;
    const win = d.winner && d.winner.human;
    if (win) AudioFX.win(); else AudioFX.bad();
    const cards = [{ cat: 'suspect', id: e.suspect }, { cat: 'weapon', id: e.weapon }, { cat: 'room', id: e.room }];
    let title = '';
    if (!d.winner) title = 'خرج الجميع من التحقيق — أُغلقت القضية بلا حل!';
    else if (win) title = d.lastStanding ? '🏆 فزت! أنت آخر محقق صامد' : '🏆 قضية محلولة! تحقيق رائع';
    else title = `فاز ${game.suspectOf(d.winner).name} بحل القضية`;
    const box = modal(`
      <div class="go-seal">${win ? '🏆' : '🕯️'}</div>
      <h3>${title}</h3>
      <p class="go-sub">الحقيقة داخل ملف القضية:</p>
      <div class="reveal-row">${cards.map(c => cardHTML(c, true)).join('')}</div>
      <div class="modal-actions">
        <button class="act-btn primary" id="again">قضية جديدة</button>
        <button class="act-btn ghost" id="menu">القائمة الرئيسية</button>
      </div>`);
    box.querySelector('#again').onclick = () => { closeModal(); startGame(); };
    box.querySelector('#menu').onclick = () => {
      closeModal();
      $('#hud').classList.remove('on');
      if (boardLook === 'mansion' && window.MansionMenu) window.MansionMenu.enter();
      else show('#screen-title');
    };
  }

  // patch Game emit signature (Game calls emit(type, data))
  // done via constructing with emit: onEvent

  // ---------- case files (local record of finished games) ----------
  const STAT_KEY = 'qasr.stats';
  function readStats() {
    const base = { played: 0, won: 0, lost: 0, bestTurns: null, log: [] };
    try { return Object.assign(base, JSON.parse(localStorage.getItem(STAT_KEY) || '{}')); } catch (e) { return base; }
  }
  function writeStats(st) { try { localStorage.setItem(STAT_KEY, JSON.stringify(st)); } catch (e) {} }
  function recordCase(d) {
    if (!game) return;
    const st = readStats();
    const won = !!(d.winner && d.winner.human);
    st.played++;
    if (won) st.won++; else st.lost++;
    const turns = game.turnCount || 0;
    if (won && (st.bestTurns === null || turns < st.bestTurns)) st.bestTurns = turns;
    st.log.unshift({
      won, turns,
      winner: d.winner ? game.suspectOf(d.winner).name : null,
      me: suspectName(game.players[0].suspect),
      solution: [suspectName(game.envelope.suspect), weaponName(game.envelope.weapon), Board.ROOMS[game.envelope.room].name],
      bots: game.players.length - 1,
    });
    st.log = st.log.slice(0, 12);
    writeStats(st);
  }

  // the menu layer talks to the game through this
  window.GameApi = {
    settings: () => Object.assign({}, SETTINGS),
    set: (k, v) => setSetting(k, v),
    look: () => boardLook,
    setLook: mode => setBoardLook(mode),
    lookAvailable: () => mansionAvailable(),
    stats: () => readStats(),
    clearStats: () => { writeStats({ played: 0, won: 0, lost: 0, bestTurns: null, log: [] }); },
  };

  // expose for tests
  window._dbg = () => game;
  window.__scene = () => ({ scene, THREE, mansion, worldX, worldZ, W, H, tokens });
  window.__standProbe = (x, y) => [standX(x, y), standZ(x, y)];
  window.__anims = () => anims.length;
  window.__camState = () => ({ target: camCtl.tTarget.clone(), dist: camCtl.tDist, phi: camCtl.phi });
  // Walks every step the board allows and asks the mansion whether a wall is in
  // the way — the board graph and the house should never disagree.
  window.__edgeAudit = () => {
    if (!mansion || !mansion.group) return { error: 'mansion not loaded' };
    const ray = new THREE.Raycaster();
    const from = new THREE.Vector3(), dir = new THREE.Vector3();
    const blocked = [];
    let tested = 0;
    const probe = (ax, az, bx, bz, h) => {
      from.set(ax, tokenY + h, az);
      dir.set(bx - ax, 0, bz - az);
      const len = dir.length();
      dir.normalize();
      ray.set(from, dir); ray.far = len;
      const hit = ray.intersectObject(mansion.group, true).length > 0;
      ray.far = Infinity;
      return hit;
    };
    for (let y = 0; y < Board.H; y++) for (let x = 0; x < Board.W; x++) {
      const t = Board.tiles[Board.idx(x, y)];
      if (!t || t.type !== 2) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= Board.W || ny >= Board.H) continue;
        const n = Board.tiles[Board.idx(nx, ny)];
        if (!n || n.type !== 2) continue;
        tested++;
        // three heights: ankle, waist, head — a wall blocks all of them
        const hits = [0.12, 0.5, 0.85].filter(h => probe(worldX(x), worldZ(y), worldX(nx), worldZ(ny), h)).length;
        if (hits === 3) blocked.push([x, y, nx, ny]);
      }
    }
    return { tested, blocked: blocked.length, list: blocked };
  };
  // drops a ray on every walkable tile to prove the pawns stand on real floor
  window.__floorAudit = () => {
    if (!mansion || !mansion.group) return { error: 'mansion not loaded' };
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const rows = [];
    const dirs = [];
    for (let i = 0; i < 8; i++) dirs.push(new THREE.Vector3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)));
    for (let y = 0; y < Board.H; y++) for (let x = 0; x < Board.W; x++) {
      const t = Board.tiles[Board.idx(x, y)];
      if (!t || t.type === 0) continue;
      ray.set(new THREE.Vector3(worldX(x), 12, worldZ(y)), down);
      const hits = ray.intersectObject(mansion.group, true);
      // the nearest hit is whatever prop sits on top; the ground is the lowest one
      const y0 = hits.length ? +(12 - hits[hits.length - 1].distance).toFixed(3) : null;
      let walled = 0;
      if (y0 !== null) {
        const org = new THREE.Vector3(worldX(x), y0 + 0.5, worldZ(y));
        for (const d of dirs) {
          ray.set(org, d); ray.far = 0.42;
          if (ray.intersectObject(mansion.group, true).length) walled++;
          ray.far = Infinity;
        }
      }
      rows.push({ x, y, kind: t.type === 1 ? (t.room || 'room') : 'corridor', y0, walled });
    }
    const miss = rows.filter(r => r.y0 === null);
    const hits = rows.filter(r => r.y0 !== null).map(r => r.y0);
    return {
      tiles: rows.length, missing: miss.length,
      missingList: miss.slice(0, 40).map(r => `${r.kind} ${r.x},${r.y}`),
      floorMin: hits.length ? Math.min(...hits) : null,
      floorMax: hits.length ? Math.max(...hits) : null,
      tokenY: tokens[SUSPECTS[0].id].mesh.position.y,
      rows,
    };
  };
  window.__mansionStat = () => (mansion
    ? { done: mansion.done, failed: mansion.failed, total: mansion.total, visible: mansion.group.visible, look: boardLook }
    : { look: boardLook, built: false });
  window.__cam = (phi, dist) => { camCtl.phi = phi; camCtl.dist = camCtl.tDist = dist; applyCam(); };
  window.__sug = room => openSugBar({
    roomFixed: !!room, room: room || null,
    confirmLabel: room ? 'اقترح' : 'وجّه الاتهام',
    onConfirm: () => closeSugBar(),
  });
  window.__reenact = (room, suspect, weapon) => playReenactment(
    { by: 0, room: room || 'hall', suspect: suspect || 'crimson', weapon: weapon || 'dagger' },
    () => {});
})();
