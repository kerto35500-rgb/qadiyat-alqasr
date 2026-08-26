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
  const SET_DEFAULTS = { sfx: true, labels: true, follow: true, speed: 'normal', cutscene: true, ui: 'normal', quality: 'auto', angle: 'tilt' };
  // how fast pieces move, and how long the bots pause between their moves
  // `SPEEDS` multiplies how fast pieces move (higher = faster); `PACE`
  // multiplies how long the bots think between their moves (higher = slower).
  // Both are deliberately unhurried: a board game is watched, not raced.
  const SPEEDS = { slow: 0.42, normal: 0.62, fast: 1.05 };
  const PACE = { slow: 2.6, normal: 1.8, fast: 1 };
  const UI_SCALE = { small: 0.88, normal: 1, large: 1.15 };
  // how many device pixels to actually draw — the single biggest lever on how
  // smooth the board feels on a phone
  const QUALITY = { high: 2, balanced: 1.5, fast: 1 };
  const SETTINGS = Object.assign({}, SET_DEFAULTS);
  let animSpeed = 1;
  try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) {}

  // filled in once the renderer and the camera exist
  let applyQuality = () => {};
  let applyCamAngle = () => {};

  function applySettings() {
    AudioFX.setMuted(!SETTINGS.sfx);
    applyQuality();
    animSpeed = SPEEDS[SETTINGS.speed] || 1;
    if (game) game.pace = PACE[SETTINGS.speed] || 1;
    document.documentElement.style.setProperty('--ui-scale', UI_SCALE[SETTINGS.ui] || 1);
    const mb = document.getElementById('btn-mute');
    if (mb) mb.textContent = SETTINGS.sfx ? '🔊' : '🔇';
    if (typeof labelGroup !== 'undefined') labelGroup.visible = SETTINGS.labels;
    applyCamAngle();
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
  const renderer = new THREE.WebGLRenderer({ antialias: !matchMedia('(pointer: coarse)').matches, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  applyQuality = () => {
    const touch = matchMedia('(pointer: coarse)').matches;
    const cap = SETTINGS.quality === 'auto' ? (touch ? 1.5 : 2) : (QUALITY[SETTINGS.quality] || 2);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
    renderer.setSize(innerWidth, innerHeight);
  };
  applyQuality();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('#canvas-wrap').appendChild(renderer.domElement);

  const worldX = x => (x - W / 2 + 0.5) * TILE;
  const worldZ = y => (y - H / 2 + 0.5) * TILE;

  // The case-file pedestal and the room name plates are drawn by us; everything
  // else you can see is the mansion's own geometry.
  const caseGroup = new THREE.Group(); scene.add(caseGroup);
  const labelGroup = new THREE.Group(); scene.add(labelGroup);

  // lights — the mansion carries its own baked lighting, so ours only has to
  // reach the pawns, the dice and the case file
  const hemi = new THREE.HemisphereLight(0xffe9c4, 0x2a2019, 0.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdfae, 0.55);
  sun.position.set(10, 22, 8);
  scene.add(sun);

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

  // a name plate lying on the floor of each room, so the house can be read
  for (const [id, r] of Object.entries(Board.ROOMS)) {
    const [x0, y0, x1, y1] = r.rect;
    const rw = (x1 - x0 + 1), rh = (y1 - y0 + 1);
    const cx = (worldX(x0) + worldX(x1)) / 2, cz = (worldZ(y0) + worldZ(y1)) / 2;
    const lw = Math.min(rw - 0.4, 5.2);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * 0.25), new THREE.MeshBasicMaterial({ map: makeLabel(r.name, '#d8c690'), transparent: true, depthWrite: false }));
    label.rotation.set(-Math.PI / 2, 0, Math.PI);
    label.position.set(cx, 0.16, cz + (cz > 0 ? -(rh / 2 - 0.85) : (rh / 2 - 0.85)));
    labelGroup.add(label);
  }

  // the envelope on its pedestal, in the stairwell at the centre of the house
  {
    const [x0, y0, x1, y1] = Board.STAIRS.rect;
    const cx = (worldX(x0) + worldX(x1)) / 2, cz = (worldZ(y0) + worldZ(y1)) / 2;
    const rh = y1 - y0 + 1;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0x2c2118, roughness: 0.8 }));
    ped.position.set(cx, 0.5, cz); caseGroup.add(ped);
    const env = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 1), new THREE.MeshStandardMaterial({ color: 0xd9c58f, roughness: 0.6 }));
    env.position.set(cx, 1, cz); env.rotation.y = 0.5; caseGroup.add(env);
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x8e2f2f, roughness: 0.5 }));
    seal.position.set(cx, 1.09, cz); seal.rotation.y = 0.5; caseGroup.add(seal);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: makeLabel('ملف القضية', '#c9a227', 46), transparent: true, depthWrite: false }));
    label.rotation.set(-Math.PI / 2, 0, Math.PI); label.position.set(cx, 0.2, cz + rh / 2 - 0.7);
    caseGroup.add(label);
  }

  // ---------- the mansion ----------
  // The house itself is the board. Its meshes are the installed game's own
  // assets and live on disk beside the page, so the page says plainly what is
  // missing rather than showing an empty floor.
  let mansion = null;

  // The house does not quite cover the outer ring of the board — the walk
  // around the grounds — so this plate makes sure a pawn always has ground
  // under it instead of hanging over nothing.
  const groundGroup = new THREE.Group();
  scene.add(groundGroup);
  {
    const pad = 2.2;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(W + pad * 2, H + pad * 2),
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

  // pawns stand directly on the mansion floor
  const boardLook = 'mansion';
  let tokenY = 0.015;

  function mansionAvailable() { return !mansionBlocker(); }

  // Why the house can't be drawn — null when everything is in place.
  function mansionBlocker() {
    if (!window.MANSION_CONFIG) return 'إعدادات القصر (MANSION_CONFIG) غير موجودة في الصفحة.';
    if (!window.Mansion) return 'mansion.js لم يُحمَّل — تأكد أن الملف موجود بجانب الصفحة.';
    if (!THREE.MTLLoader || !THREE.OBJLoader) return 'OBJLoader.js / MTLLoader.js لم يُحمَّلا — تأكد أنهما بجانب الصفحة.';
    return null;
  }

  function ensureMansion() {
    if (mansion || !mansionAvailable()) return mansion;
    toast('جارٍ تحميل القصر…');
    mansion = window.Mansion.build({
      THREE, scene, W, H,
      onProgress: (done, total) => {
        if (done < total) toast(`جارٍ تحميل القصر… ${done} / ${total}`);
        else toast(mansion && mansion.failed ? `اكتمل التحميل (${mansion.failed} جزء لم يُحمَّل)` : 'اكتمل تحميل القصر');
        if (mansion) mansion.setVisible(true);
        standCache.clear();   // more of the house arrived — re-feel the tiles
      },
    });
    return mansion;
  }

  function applyLook() {
    for (const s of SUSPECTS) {
      tokens[s.id].mesh.position.y = tokenY;
      // life-size rooms need smaller figures — and it keeps them clear of walls
      tokens[s.id].mesh.scale.setScalar(0.8);
    }
    labelGroup.position.y = 0.16;
    scene.background.set(0x05080e);
    scene.fog = new THREE.FogExp2(0x05080e, 0.006);
    const mm = ensureMansion(); if (mm) mm.setVisible(true);
    if (!applyLook._framed) { applyLook._framed = true; frameBoard(); }
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
    tokens[s.id] = { mesh, mat, wanted: false, figure: null };
  }

  // ---- pawn styles ----
  // The plain lathe pawn is always there. Where the game's own files sit beside
  // the page, the six detective figures it ships with can stand in for it —
  // each with a spare outfit — and the player picks which in the character sheet.
  const PAWN_STYLES = [
    { id: 'simple', name: 'قطعة بسيطة' },
    { id: 'main', name: 'زي المحقق' },
    { id: 'alt', name: 'الزي البديل' },
  ];
  // Each detective keeps their own look, the way the game does: the plain pawn,
  // their outfit, or their spare one.
  const PAWN_KEY = 'qasr.pawnStyles';
  let pawnStyles = {};
  try { pawnStyles = JSON.parse(localStorage.getItem(PAWN_KEY) || '{}') || {}; } catch (e) { pawnStyles = {}; }
  const figureCache = {};        // "id_variant" -> Object3D (the loaded figure)
  const figureFailed = {};
  const thumbCache = {};         // "id_variant" -> data URL of a rendered preview

  function pawnStyleOf(id) {
    if (pawnStyles[id]) return pawnStyles[id];
    return figuresAvailable() ? 'main' : 'simple';   // wear the real clothes when we have them
  }

  function figuresAvailable() { return !!(window.MANSION_CONFIG && window.MANSION_CONFIG.tokens && window.Mansion && window.Mansion.loadToken); }

  // a coloured ring keeps each detective identifiable once they wear real clothes
  const ringGeo = new THREE.RingGeometry(0.3, 0.42, 28);
  function makeFoot(hex) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: hex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    return m;
  }

  // Fetch one figure, keeping it around once it has arrived.
  function loadFigure(id, variant, cb) {
    const key = id + '_' + variant;
    if (figureCache[key]) { cb && cb(figureCache[key]); return; }
    if (figureFailed[key] || !figuresAvailable()) { cb && cb(null); return; }
    window.Mansion.loadToken({
      THREE, id, variant,
      onDone: o => {
        const wrap = new THREE.Group();
        wrap.add(o);
        wrap.add(makeFoot(SUSPECTS.find(x => x.id === id).hex));
        figureCache[key] = wrap;
        scene.add(wrap);
        wrap.visible = false;
        cb && cb(wrap);
      },
      onFail: () => { figureFailed[key] = true; cb && cb(null); },
    });
  }

  function applyPawnStyle() {
    for (const sus of SUSPECTS) {
      const tok = tokens[sus.id];
      const variant = pawnStyleOf(sus.id);
      if (variant === 'simple') { tok.figure = null; continue; }
      loadFigure(sus.id, variant, wrap => {
        if (wrap && pawnStyleOf(sus.id) === variant) swapFigure(tok, wrap);
      });
    }
  }

  function setPawnStyleFor(id, style) {
    pawnStyles[id] = PAWN_STYLES.some(p => p.id === style) ? style : 'simple';
    try { localStorage.setItem(PAWN_KEY, JSON.stringify(pawnStyles)); } catch (e) {}
    applyPawnStyle();
  }

  // ---- outfit previews ----
  // Render the actual figure once into an offscreen buffer so the character
  // sheet can show what each look really is, instead of describing it.
  // Framings: a head-and-shoulders preview for the wardrobe, and a full-length
  // cut-out for the talking scenes.
  const SHOTS = {
    bust: { w: 180, h: 260, fov: 26, camY: 1.15, camZ: 5.2, lookY: 0.95, rot: Math.PI * 0.08 },
    full: { w: 300, h: 560, fov: 24, camY: 1.0, camZ: 5.6, lookY: 0.88, rot: Math.PI * 0.1 },
  };
  function pawnThumb(id, variant, cb, shotName) {
    const s = SHOTS[shotName] || SHOTS.bust;
    const key = id + '_' + variant + '_' + (shotName || 'bust');
    if (variant === 'simple' || thumbCache[key]) { cb(thumbCache[key] || null); return; }
    loadFigure(id, variant, wrap => {
      if (!wrap) { cb(null); return; }
      // the atlas arrives after the mesh; a preview taken too early is a
      // silhouette, so wait for the texture to actually be decoded
      let tries = 0;
      const ready = () => {
        let ok = true;
        wrap.traverse(ch => {
          if (ch.isMesh && ch.material && ch.material.map && !ch.material.map.image) ok = false;
        });
        return ok;
      };
      const shoot = () => {
        if (!ready() && tries++ < 25) { setTimeout(shoot, 120); return; }
        draw();
      };
      const draw = () => {
      try {
        const W2 = s.w, H2 = s.h;
        const rt = new THREE.WebGLRenderTarget(W2, H2);
        const sc = new THREE.Scene();
        const cam = new THREE.PerspectiveCamera(s.fov, W2 / H2, 0.1, 40);
        cam.position.set(0, s.camY, s.camZ);
        cam.lookAt(0, s.lookY, 0);
        sc.add(new THREE.AmbientLight(0xffffff, 0.8));
        const key1 = new THREE.DirectionalLight(0xfff4e4, 1.05); key1.position.set(2, 4, 4); sc.add(key1);
        const key2 = new THREE.DirectionalLight(0xbfd0ff, 0.45); key2.position.set(-3, 2, -2); sc.add(key2);

        const home = wrap.parent, pos = wrap.position.clone(), rot = wrap.rotation.y, vis = wrap.visible, sc0 = wrap.scale.clone();
        sc.add(wrap);
        wrap.position.set(0, 0, 0); wrap.rotation.y = s.rot; wrap.scale.setScalar(1); wrap.visible = true;

        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(sc, cam);
        const buf = new Uint8Array(W2 * H2 * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, W2, H2, buf);
        renderer.setRenderTarget(null);

        // put the figure back exactly where it was
        if (home) home.add(wrap); else scene.add(wrap);
        wrap.position.copy(pos); wrap.rotation.y = rot; wrap.scale.copy(sc0); wrap.visible = vis;

        const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(W2, H2);
        // A render target hands back linear light; the canvas expects sRGB, so
        // without this step the preview comes out dark and over-saturated.
        if (!pawnThumb.gamma) {
          pawnThumb.gamma = new Uint8Array(256);
          for (let i = 0; i < 256; i++) {
            const v = i / 255;
            const o = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
            pawnThumb.gamma[i] = Math.round(Math.min(1, Math.max(0, o)) * 255);
          }
        }
        const g = pawnThumb.gamma;
        for (let y = 0; y < H2; y++) {                 // the buffer is bottom-up
          const src = (H2 - 1 - y) * W2 * 4, dst = y * W2 * 4;
          for (let x = 0; x < W2; x++) {
            const si = src + x * 4, di = dst + x * 4;
            img.data[di] = g[buf[si]];
            img.data[di + 1] = g[buf[si + 1]];
            img.data[di + 2] = g[buf[si + 2]];
            img.data[di + 3] = buf[si + 3];
          }
        }
        ctx.putImageData(img, 0, 0);
        rt.dispose();
        thumbCache[key] = cv.toDataURL('image/png');
        cb(thumbCache[key]);
      } catch (e) { cb(null); }
      };
      shoot();
    });
  }

  // A standing, background-free portrait of a detective for the talking scenes.
  // The mansion's own figures already have transparent surroundings once they
  // are rendered on their own, so nobody has to cut anything out by hand; where
  // the figures are not loaded (the flat board, or the web build without the
  // meshes) the painted portrait stands in, softened at its edges so it still
  // reads as a figure rather than a photograph pasted on the scene.
  const cutCache = {};
  function figureCut(id, cb) {
    if (cutCache[id]) { cb(cutCache[id]); return; }
    // a miss is never cached: the figure may simply not have finished loading
    // yet, and the next scene should try again rather than be stuck on the
    // painted stand-in for the rest of the game
    const done = v => { if (v) cutCache[id] = v; cb(v); };
    const variant = pawnStyleOf(id);
    if (variant === 'simple' || boardLook !== 'mansion') { cb(null); return; }
    let settled = false;
    const finish = v => { if (!settled) { settled = true; done(v); } };
    setTimeout(() => finish(null), 4000);      // never hold the scene waiting
    pawnThumb(id, variant, src => finish(src || null), 'full');
  }

  // Take the six pictures while nothing is happening, so the first suggestion
  // does not have to wait for them.
  function warmCuts() {
    if (boardLook !== 'mansion') return;
    let i = 0;
    const next = () => {
      if (i >= SUSPECTS.length) return;
      figureCut(SUSPECTS[i++].id, () => setTimeout(next, 120));
    };
    setTimeout(next, 2500);
  }

  // The figure is a stand-in for the pawn: same tile, same moment, same fade.
  // Driving it from the pawn keeps every animation in one place.
  function syncFigures() {
    const fs = boardLook === 'mansion' ? 1 : 0.85;
    for (const sus of SUSPECTS) {
      const tok = tokens[sus.id];
      const useFig = pawnStyleOf(sus.id) !== 'simple';
      const fig = tok.figure;
      const showFig = useFig && !!fig;
      tok.mesh.visible = tok.wanted && !showFig;
      if (!fig) continue;
      fig.visible = tok.wanted && useFig;
      if (!fig.visible) continue;
      fig.position.copy(tok.mesh.position);
      fig.rotation.y = tok.mesh.rotation.y;
      fig.scale.setScalar(fs);
      const op = tok.mat.opacity;
      if (op < 1 || fig.userData.faded) {
        fig.userData.faded = op < 1;
        fig.traverse(ch => {
          if (!ch.isMesh || !ch.material || Array.isArray(ch.material)) return;
          ch.material.transparent = op < 1;
          ch.material.opacity = op;
        });
      }
    }
  }

  function swapFigure(tok, wrap) {
    if (tok.figure && tok.figure !== wrap) tok.figure.visible = false;
    tok.figure = wrap;
    wrap.position.copy(tok.mesh.position);
  }

  function setPawnStyle(style) {          // every detective at once
    for (const sus of SUSPECTS) pawnStyles[sus.id] = style;
    try { localStorage.setItem(PAWN_KEY, JSON.stringify(pawnStyles)); } catch (e) {}
    applyPawnStyle();
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
  const DIE = 0.9;                       // the mesh is built at this size...
  const DIE_SCALE = { flat: 1, mansion: 1.1 };    // ...and the mansion gets the biggest
  // die that still fits down a one-tile corridor without clipping its walls
  const dice = [0, 1].map(i => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), diceMats);
    m.castShadow = true; m.visible = false; scene.add(m);
    return m;
  });

  // ---------- camera control ----------
  const camCtl = {
    theta: Math.PI, tTheta: Math.PI, phi: 0.62, tPhi: 0.62, dist: 26, tDist: 26, ease: 1,
    aimY: 0, tAimY: 0,      // how high up the camera looks: the floor, or a figure's chest
    target: new THREE.Vector3(0, 0, 0), tTarget: new THREE.Vector3(0, 0, 0),
  };
  // Turning is a target like every other, so the camera swings round to a new
  // bearing instead of teleporting there mid-walk.
  const shortAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const setTheta = t => { camCtl.tTheta = camCtl.theta + shortAngle(t - camCtl.theta); };
  const turnBy = d => { camCtl.theta += d; camCtl.tTheta += d; };
  function applyCam() {
    // A deliberate change of framing gets there quickly; ordinary drift is slow.
    const k = camCtl.ease;
    camCtl.ease += (1 - camCtl.ease) * 0.04;
    camCtl.dist += (camCtl.tDist - camCtl.dist) * (0.08 * k);
    camCtl.phi += (camCtl.tPhi - camCtl.phi) * (0.1 * k);
    camCtl.theta += shortAngle(camCtl.tTheta - camCtl.theta) * Math.min(0.5, 0.07 * k);
    camCtl.target.lerp(camCtl.tTarget, Math.min(0.6, 0.06 * k));
    camCtl.aimY += (camCtl.tAimY - camCtl.aimY) * (0.09 * k);
    const y = Math.cos(camCtl.phi) * camCtl.dist;
    const r = Math.sin(camCtl.phi) * camCtl.dist;
    // A close chase shot aimed at the floor puts the figure at the top of the
    // frame with the empty ground filling the rest; aiming at chest height sits
    // it in the middle where it belongs.
    camera.position.set(camCtl.target.x + Math.sin(camCtl.theta) * r, camCtl.aimY + y, camCtl.target.z + Math.cos(camCtl.theta) * r);
    camera.lookAt(camCtl.target.x, camCtl.aimY, camCtl.target.z);
  }
  // ---- camera gestures ----
  // A board game is read like a map, so a drag SLIDES the board rather than
  // swinging around it: one finger (or the left mouse button) pans in both
  // directions, two fingers pinch to zoom and twist to turn, and the mouse can
  // still orbit with the right button or by holding Shift.
  let dragMode = null;               // 'pan' | 'orbit'
  let px = 0, py = 0, moved2 = 0;
  const wrap = $('#canvas-wrap');
  const touches = new Map();
  let gest = null;                   // two-finger state

  // How far back the whole floor plan needs the camera to be, for this screen.
  function boardFitDist() {
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max((H / 2 + 1.5) / Math.tan(vFov / 2), (W / 2 + 1.5) / Math.tan(hFov / 2));
  }
  const maxDist = () => Math.max(46, boardFitDist() * 1.15);
  const setDist = d => { camCtl.tDist = Math.min(maxDist(), Math.max(8, d)); };
  const setDistManual = d => { lastManualMove = performance.now(); setDist(d); };
  // phi is the tilt: small looks straight down on the board, large sits it on
  // the horizon. A board game wants to be looked DOWN on, so the range stops
  // well short of a flat side-on view.
  const setPhi = v => { camCtl.tPhi = Math.min(1.15, Math.max(0.18, v)); };

  // keep the view over the board instead of drifting off into the dark
  const PAN_MARGIN = 6;
  function clampTarget(v) {
    v.x = Math.min(W / 2 + PAN_MARGIN, Math.max(-W / 2 - PAN_MARGIN, v.x));
    v.z = Math.min(H / 2 + PAN_MARGIN, Math.max(-H / 2 - PAN_MARGIN, v.z));
  }

  // Screen pixels -> ground movement, in the direction the camera is facing.
  // Vertical drags cover more ground the more the camera is tilted, so the
  // vertical step is divided by how flat the view is.
  let lastManualMove = 0;      // when the player last moved the view themselves
  function panBy(dx, dy) {
    lastManualMove = performance.now();
    const k = camCtl.dist * 0.0017;
    const sin = Math.sin(camCtl.theta), cos = Math.cos(camCtl.theta);
    const right = { x: cos, z: -sin };            // screen-right on the ground
    const fwd = { x: -sin, z: -cos };             // screen-up on the ground
    const lift = 1 / Math.max(0.45, Math.sin(camCtl.phi));
    const mx = -right.x * dx * k + fwd.x * dy * k * lift;
    const mz = -right.z * dx * k + fwd.z * dy * k * lift;
    camCtl.tTarget.x += mx; camCtl.tTarget.z += mz;
    clampTarget(camCtl.tTarget);
    // a drag should track the finger, so skip the smoothing while it happens
    camCtl.target.x = camCtl.tTarget.x;
    camCtl.target.z = camCtl.tTarget.z;
  }

  function twoFingerState() {
    const [a, b] = [...touches.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  wrap.addEventListener('pointerdown', e => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) {
      moved2 = 0; px = e.clientX; py = e.clientY;
      // mouse: right button or Shift orbits, plain drag pans. Touch always pans.
      dragMode = (e.pointerType !== 'touch' && (e.button === 2 || e.button === 1 || e.shiftKey)) ? 'orbit' : 'pan';
    } else if (touches.size === 2) {
      dragMode = null;
      gest = twoFingerState();
    }
  });

  addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touches.size >= 2) {
      const st = twoFingerState();
      if (gest) {
        if (gest.dist > 0) setDistManual(camCtl.tDist * (gest.dist / Math.max(1, st.dist)));
        // twisting the two fingers turns the board
        let da = st.angle - gest.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        turnBy(-da);
        panBy(st.mid.x - gest.mid.x, st.mid.y - gest.mid.y);
      }
      gest = st;
      moved2 += 20;
      return;
    }

    if (!dragMode) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    moved2 += Math.abs(dx) + Math.abs(dy);
    if (dragMode === 'pan') {
      panBy(dx, dy);
    } else {
      turnBy(-dx * 0.005);
      lastManualMove = performance.now();
      setPhi(camCtl.tPhi - dy * 0.004);
      camCtl.phi = camCtl.tPhi;
    }
  });

  function endPointer(e) {
    touches.delete(e.pointerId);
    if (touches.size < 2) gest = null;
    if (touches.size === 0) dragMode = null;
    else if (touches.size === 1) {
      const [t] = [...touches.values()];
      px = t.x; py = t.y; dragMode = 'pan';
    }
  }
  addEventListener('pointerup', endPointer);
  addEventListener('pointercancel', endPointer);
  wrap.addEventListener('contextmenu', e => e.preventDefault());
  wrap.addEventListener('wheel', e => { setDistManual(camCtl.tDist + e.deltaY * 0.02); e.preventDefault(); }, { passive: false });

  // keyboard: arrows pan, +/- zoom, [ ] turn
  addEventListener('keydown', e => {
    if (!$('#hud').classList.contains('on')) return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const step = 42;
    const map = {
      ArrowLeft: () => panBy(-step, 0), ArrowRight: () => panBy(step, 0),
      ArrowUp: () => panBy(0, -step), ArrowDown: () => panBy(0, step),
      '+': () => setDist(camCtl.tDist - 3), '=': () => setDist(camCtl.tDist - 3),
      '-': () => setDist(camCtl.tDist + 3),
      '[': () => { turnBy(-0.18); lastManualMove = performance.now(); },
      ']': () => { turnBy(0.18); lastManualMove = performance.now(); },
    };
    const fn = map[e.key];
    if (fn) { fn(); e.preventDefault(); }
  });

  // a tall phone screen needs the camera further back to see the same board
  const isPortrait = () => innerHeight > innerWidth * 1.05;
  // The walking shot is its own camera, not a nudge of the resting one. It sits
  // close and low behind the figure — a chase view — whatever angle the board is
  // normally looked at from. Tying it to the `angle` setting was a mistake: with
  // the board set to be viewed from overhead the walk stayed overhead too, so
  // the camera never appeared to swing round and the zoom never looked like one.
  const WALK_DIST = 8.5;     // how close the camera pulls in while a pawn walks
  const WALK_PHI = 0.66;     // and how low it sits; higher = more from behind
  const ANGLES = { top: 0.3, tilt: 0.55, low: 0.85 };
  const basePhi = () => ANGLES[SETTINGS.angle] || ANGLES.tilt;
  applyCamAngle = () => { if (!handOnBoard()) setPhi(basePhi()); };

  // ---- who is driving the camera ----
  // There used to be one rule for everything — "if the player has touched the
  // view in the last four seconds, keep out" — and it was the reason the walking
  // zoom sometimes never happened: a glance around the board while choosing a
  // square silently cancelled the shot that was supposed to follow the move.
  //
  // So the two are separated. Panning suppresses the camera's own DRIFT, but a
  // beat of the game — the roll, the move you just chose, a rival setting off —
  // hands the camera back and reframes. While a beat is playing, the player can
  // still take it away again simply by dragging.
  const handOnBoard = () => performance.now() - lastManualMove < 2500;
  const releaseCam = () => { lastManualMove = 0; };

  // What the camera is doing right now, so nothing fights anything else.
  const shot = { mode: 'free', walker: null, aim: null, lastCheck: 0, release: 0 };

  function frameBoard() {
    const base = boardLook === 'mansion' ? 34 : 26;
    setDist(isPortrait() ? base * 1.45 : base);
    setPhi(basePhi());
    camCtl.phi = camCtl.tPhi;
    camCtl.tAimY = camCtl.aimY = 0;
    shot.mode = 'free'; shot.walker = null; shot.aim = null;
  }

  // The whole floor plan, looked at from almost straight above — this is the
  // view you choose your move from, so every open square and every room label
  // has to be on screen at once.
  function framePlan() {
    if (!SETTINGS.follow) return;
    releaseCam();                       // a new roll always gets the plan view
    shot.mode = 'plan'; shot.walker = null; shot.aim = null;
    camCtl.tTarget.set(0, 0, 0);
    setDist(boardFitDist() * 1.1);
    setPhi(0.16);
    camCtl.tAimY = 0;
    camCtl.ease = 3.4;                  // a deliberate swing, not a snap
  }

  // ...and this is the view you watch the move from: down at pawn height,
  // standing BEHIND the figure and looking the way it is about to walk, so a
  // corridor squeezed between two blocks of rooms is seen along its length
  // instead of through a wall.
  function frameWalk(x, z, heading) {
    if (!SETTINGS.follow) return;
    releaseCam();                       // the move you just chose owns the camera
    clearTimeout(shot.release);
    shot.mode = 'walk';
    // during a walk the camera looks straight at the figure, not at a point
    // pulled back towards the middle of the board: the shot is about the pawn,
    // and the sightline maths below only works if the two agree
    camCtl.tTarget.set(x, 0, z);
    clampTarget(camCtl.tTarget);
    setDist(WALK_DIST * (isPortrait() ? 1.5 : 1));
    setPhi(WALK_PHI);
    camCtl.tAimY = 1.05;                // look at the figure, not at its feet
    aimBehind(x, z, heading, true);
    camCtl.ease = 3.4;
  }

  // Put the camera at the pawn's back. `heading` is the way the figure faces;
  // the camera belongs half a turn round from that.
  function aimBehind(x, z, heading, force) {
    if (heading === undefined || heading === null) { clearSightline(x, z); return; }
    const want = heading + Math.PI;
    // The camera turns with the walk rather than only at big corners: rounding a
    // corner should swing the whole house round the figure, which is the moment
    // that tells you which way it is heading. A small dead zone stops it
    // twitching on the sub-degree wobble of a straight line.
    if (!force && shot.aim !== null && Math.abs(shortAngle(want - shot.aim)) < 0.12
        && !blockedFrom(camCtl.tTheta, camCtl.tPhi, camCtl.tDist, x, z)) return;
    shot.aim = want;
    setTheta(want);
    clearSightline(x, z, want);
  }

  // A pawn in a corridor can still end up behind a block of rooms. Rather than
  // watch a wall, swing off the ideal bearing by as little as it takes to see
  // the figure, and failing that look down on it from higher up.
  const sightRay = new THREE.Raycaster();
  const sightFrom = new THREE.Vector3(), sightTo = new THREE.Vector3(), sightDir = new THREE.Vector3();
  function blockedFrom(theta, phi, dist, x, z) {
    if (!mansion || !mansion.group || !mansion.group.visible) return false;
    const r = Math.sin(phi) * dist, y = Math.cos(phi) * dist;
    sightFrom.set(x + Math.sin(theta) * r, camCtl.tAimY + y, z + Math.cos(theta) * r);
    sightTo.set(x, tokenY + 1.35, z);                // aim at the figure's head
    sightDir.copy(sightTo).sub(sightFrom);
    const len = sightDir.length();
    sightDir.normalize();
    sightRay.set(sightFrom, sightDir);
    sightRay.far = len - 0.6;                        // stop short of the pawn itself
    const hit = sightRay.intersectObject(mansion.group, true).length > 0;
    sightRay.far = Infinity;
    return hit;
  }

  function clearSightline(x, z, base) {
    const phi = camCtl.tPhi, dist = camCtl.tDist;
    const from = base === undefined ? camCtl.tTheta : base;
    if (!blockedFrom(from, phi, dist, x, z)) { setTheta(from); return; }
    // A wall in the way is answered in the order that costs the shot least:
    // first a small turn, then stepping closer (which steepens the look and
    // clears low walls), then a bigger turn, and only last by rising above it.
    // Stepping CLOSER is tried before turning away: it steepens the look over a
    // wall, and it is the answer the player actually wants — a tighter shot on
    // the figure rather than the camera abandoning its post behind them.
    for (const d of [dist * 0.8, dist * 0.62]) {
      if (!blockedFrom(from, phi, d, x, z)) { setTheta(from); setDist(d); return; }
    }
    for (const step of [0.3, -0.3, 0.6, -0.6, 1, -1]) {
      if (!blockedFrom(from + step, phi, dist * 0.8, x, z)) { setTheta(from + step); setDist(dist * 0.8); return; }
    }
    // lift a little — but never all the way to a floor plan, which is the view
    // the walk exists to escape
    setTheta(from);
    for (const ph of [0.58, 0.5, 0.42]) {
      if (!blockedFrom(from, ph, dist * 0.8, x, z)) { setPhi(ph); setDist(dist * 0.8); return; }
    }
    for (const step of [1.5, -1.5, 2.1, -2.1, Math.PI]) {
      if (!blockedFrom(from + step, phi, dist, x, z)) { setTheta(from + step); return; }
    }
    setPhi(0.42);
  }

  function focusOn(x, z, dist) {
    if (!SETTINGS.follow || handOnBoard()) return;   // don't fight the player's own view
    shot.mode = 'free'; shot.aim = null; camCtl.tAimY = 0;
    camCtl.tTarget.set(x * 0.8, 0, z * 0.8);
    clampTarget(camCtl.tTarget);
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

  // A figure should walk forwards. The exported tokens face +Z when unrotated,
  // so the heading is atan2 of the step it is taking, eased so corners turn
  // rather than snap.
  const FIGURE_FORWARD = 0;
  function faceTowards(tok, dx, dz, snap) {
    if (!dx && !dz) return;
    const want = Math.atan2(dx, dz) + FIGURE_FORWARD;
    tok.face = want;
    if (snap) tok.mesh.rotation.y = want;
  }
  function turnTokens(dt) {
    for (const sus of SUSPECTS) {
      const tok = tokens[sus.id];
      if (tok.face === undefined) continue;
      let d = tok.face - tok.mesh.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 0.002) continue;
      tok.mesh.rotation.y += d * Math.min(1, dt * 12);
    }
  }

  function tokenToWorld(tok, x, y, inst) {
    tok.mesh.position.set(standX(x, y), tokenY, standZ(x, y));
  }
  // The camera rides along with whoever is walking — yours or a rival's — so
  // every move is watched rather than guessed at from the log.
  function walkCam(tok) {
    if (!SETTINGS.follow || handOnBoard()) return;
    const k = shot.mode === 'walk' ? 1 : 0.8;
    camCtl.tTarget.set(tok.mesh.position.x * k, 0, tok.mesh.position.z * k);
    // keep the figure in sight as it passes behind things, but not every frame:
    // a raycast against the whole mansion is not free
    if (shot.mode === 'walk' && performance.now() - shot.lastCheck > 130) {
      shot.lastCheck = performance.now();
      aimBehind(tok.mesh.position.x, tok.mesh.position.z, tok.face);
    }
  }

  // A hop from one square to the next. Slower than it was: at the old pace the
  // figure skated across the board and there was nothing to watch.
  const HOP = 0.38;          // ~0.61s a square at the normal speed setting

  // Which way a walk sets off, in the same terms as a figure's facing.
  function pathHeading(path) {
    if (!path || path.length < 2) return undefined;
    const [ax, ay] = path[0], [bx, by] = path[1];
    return Math.atan2(worldX(bx) - worldX(ax), worldZ(by) - worldZ(ay));
  }

  function animatePath(suspectId, path, onDone) {
    const tok = tokens[suspectId];
    // catching up on a game already in progress: put the pawns where they
    // belong, do not walk them through every move that was missed
    if (Netplay.catchUp) {
      const end = path[path.length - 1];
      if (end) tokenToWorld(tok, end[0], end[1]);
      onDone && onDone();
      return;
    }
    let i = 0;
    const riding = SETTINGS.follow && path.length > 1;
    function step() {
      if (i >= path.length - 1) {
        // hold on the figure for a beat where it stopped, then let the board
        // settle back to the view it is normally read from
        if (riding && shot.mode === 'walk') {
          clearTimeout(shot.release);
          shot.release = setTimeout(() => {
            if (shot.mode !== 'walk') return;
            shot.mode = 'free'; shot.aim = null; camCtl.tAimY = 0;
            if (!handOnBoard()) { setPhi(basePhi()); setDist(WALK_DIST * 2.1 * (isPortrait() ? 1.5 : 1)); }
          }, Math.round(900 * (PACE[SETTINGS.speed] || 1) / 1.25));
        }
        onDone && onDone();
        return;
      }
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      i++;
      const last = i >= path.length - 1;
      // mid-walk the pawn cuts the corners; only where it stops do we make room
      const x0 = i === 1 ? tok.mesh.position.x : worldX(ax);
      const z0 = i === 1 ? tok.mesh.position.z : worldZ(ay);
      const x1 = last ? standX(bx, by) : worldX(bx);
      const z1 = last ? standZ(bx, by) : worldZ(by);
      AudioFX.step();
      faceTowards(tok, x1 - x0, z1 - z0);
      if (riding && !handOnBoard()) aimBehind(x0, z0, tok.face);
      animate(HOP, t => {
        const e2 = ease(t);
        tok.mesh.position.set(x0 + (x1 - x0) * e2, tokenY + Math.sin(t * Math.PI) * 0.22, z0 + (z1 - z0) * e2);
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
  // ---- dice with a bit of physics (mansion style) ----
  // The board already knows where every wall is, so the dice are bounced off
  // the grid rather than off the mesh: a die thrown in a corridor rattles down
  // it, one thrown in a room stays in that room, and neither passes through a
  // wall. Cheap, exact, and it agrees with what the player sees.
  const GRAV = 24, WALL_BOUNCE = 0.55, FLOOR_BOUNCE = 0.42, FRICTION = 0.72, SPIN_DAMP = 0.55;
  const diceSim = { on: false, settled: true, id: 0, bodies: [], done: null, t: 0, vals: [1, 1] };

  function dieRadius() { return DIE * (DIE_SCALE[boardLook] || 1) * 0.49; }

  // is this point inside a wall, from the point of view of where the roll began?
  function solidPoint(wx, wz, arenaRoom) {
    const tx = Math.round(wx + W / 2 - 0.5), ty = Math.round(wz + H / 2 - 0.5);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    const t = Board.tiles[Board.idx(tx, ty)];
    if (!t) return true;
    if (arenaRoom) return t.room !== arenaRoom;      // thrown indoors: stay in the room
    return t.type !== 2;                             // thrown in a corridor: stay in it
  }

  function stepDie(b, dt, arenaRoom) {
    if (b.rest) return;
    const r = b.r;
    b.vel.y -= GRAV * dt;

    // Test the whole leading face, not just its middle: one point lets a die
    // slip diagonally through a corner where both axes look clear on their own.
    const lead = 0.9 * r;
    const blockedX = dx => {
      const px = b.pos.x + dx + Math.sign(dx || 1) * r;
      return solidPoint(px, b.pos.z, arenaRoom)
          || solidPoint(px, b.pos.z + lead, arenaRoom)
          || solidPoint(px, b.pos.z - lead, arenaRoom);
    };
    const blockedZ = dz => {
      const pz = b.pos.z + dz + Math.sign(dz || 1) * r;
      return solidPoint(b.pos.x, pz, arenaRoom)
          || solidPoint(b.pos.x + lead, pz, arenaRoom)
          || solidPoint(b.pos.x - lead, pz, arenaRoom);
    };

    const stepX = b.vel.x * dt;
    if (blockedX(stepX)) { b.vel.x = -b.vel.x * WALL_BOUNCE; b.spin.z += b.vel.x * 0.6; b.hit = true; }
    else b.pos.x += stepX;

    const stepZ = b.vel.z * dt;
    if (blockedZ(stepZ)) { b.vel.z = -b.vel.z * WALL_BOUNCE; b.spin.x += b.vel.z * 0.6; b.hit = true; }
    else b.pos.z += stepZ;

    // A die dropped straight down beside a wall never bounced off it, so it can
    // land with a corner buried. Ease it back out before it settles.
    for (const [ax, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      for (let k = 0; k < 10; k++) {
        const px = b.pos.x + (ax === 'x' ? sgn * r : 0);
        const pz = b.pos.z + (ax === 'z' ? sgn * r : 0);
        if (!solidPoint(px, pz, arenaRoom)) break;
        b.pos[ax] -= sgn * 0.04;
      }
    }

    const ny = b.pos.y + b.vel.y * dt;
    const floor = tokenY + r;
    if (ny <= floor) {
      b.pos.y = floor;
      if (Math.abs(b.vel.y) > 1.2) { b.vel.y = -b.vel.y * FLOOR_BOUNCE; b.hit = true; }
      else b.vel.y = 0;
      b.vel.x *= FRICTION; b.vel.z *= FRICTION;
      b.spin.x *= SPIN_DAMP; b.spin.y *= SPIN_DAMP; b.spin.z *= SPIN_DAMP;
      b.grounded += dt;
    } else { b.pos.y = ny; b.grounded = 0; }

    b.rot.x += b.spin.x * dt; b.rot.y += b.spin.y * dt; b.rot.z += b.spin.z * dt;

    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z) + Math.hypot(b.spin.x, b.spin.y, b.spin.z) * 0.2;
    if (b.grounded > 0.18 && speed < 0.9) {
      b.rest = true;
      // Last resort: a die must never come to rest anywhere it could not have
      // rolled. Walk it back along the line to where it was thrown from —
      // that spot is legal by definition — until it is clear again.
      if (b.home && solidPoint(b.pos.x, b.pos.z, arenaRoom)) {
        for (let t = 0.1; t <= 1.001; t += 0.1) {
          const x = b.pos.x + (b.home.x - b.pos.x) * t;
          const z = b.pos.z + (b.home.z - b.pos.z) * t;
          if (!solidPoint(x, z, arenaRoom)) { b.pos.x = x; b.pos.z = z; break; }
        }
      }
    }
  }

  function updateDice(dt) {
    if (!diceSim.on) return;
    diceSim.t += dt;
    const sub = Math.min(dt, 0.033) / 3;
    for (let k = 0; k < 3; k++) {
      for (const b of diceSim.bodies) stepDie(b, sub, diceSim.arenaRoom);
    }
    let allRest = true;
    for (const b of diceSim.bodies) {
      b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
      b.mesh.rotation.set(b.rot.x, b.rot.y, b.rot.z);
      if (b.hit) { b.hit = false; AudioFX.step(); }
      if (!b.rest) allRest = false;
    }
    if (allRest || diceSim.t > 4) settleDice();
  }

  // however they tumbled, they must read the number the engine rolled
  function settleDice() {
    if (!diceSim.on) return;
    diceSim.on = false;
    // Rolls overlap: a bot's dice can still be settling when the next player
    // throws. Stamp this one so a stale callback cannot speak for the new dice.
    const roll = diceSim.id;
    diceSim.bodies.forEach((b, i) => {
      const target = faceRot[diceSim.vals[i]];
      const from = { x: b.rot.x, y: b.rot.y, z: b.rot.z };
      const to = {
        x: target[0] + Math.round((from.x - target[0]) / (Math.PI * 2)) * Math.PI * 2,
        y: target[1] + Math.round((from.y - target[1]) / (Math.PI * 2)) * Math.PI * 2,
        z: target[2] + Math.round((from.z - target[2]) / (Math.PI * 2)) * Math.PI * 2,
      };
      animate(0.28, t => {
        const e = ease(t);
        b.mesh.rotation.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, from.z + (to.z - from.z) * e);
        if (t >= 1) b.mesh.rotation.set(target[0], target[1], target[2]);   // land it exactly
      }, i === 0 ? null : () => {
        if (roll !== diceSim.id) return;
        diceSim.settled = true;
        const fn = diceSim.done; diceSim.done = null;
        setTimeout(() => fn && fn(), 260);
        setTimeout(() => {
          if (roll !== diceSim.id) return;
          dice.forEach(m => animate(0.3, t => { m.position.y = tokenY + b.r - t * 1.6; }, () => m.visible = false));
        }, 2200);
      });
    });
  }

  function rollDicePhysics(d1, d2, onDone) {
    AudioFX.dice();
    const p = game && game.player();
    const here = p ? p.pos : { x: 12, y: 12 };
    const arenaRoom = p && p.pos.room ? p.pos.room : null;
    const r = dieRadius();
    diceSim.vals = [d1, d2];
    // remember where this throw happened: by the time anyone inspects the dice
    // the turn may have moved on, and judging them against the next player's
    // room says the dice went through a wall when they did not
    diceSim.arena = arenaRoom;
    diceSim.from = { x: here.x, y: here.y };
    diceSim.bodies = dice.map((m, i) => {
      m.visible = true;
      m.scale.setScalar(DIE_SCALE[boardLook] || 1);
      const a = Math.random() * Math.PI * 2;
      const pos = new THREE.Vector3(worldX(here.x) + (i ? 0.22 : -0.22), tokenY + 2.6 + i * 0.4, worldZ(here.y) + 0.15);
      m.position.copy(pos);
      return {
        mesh: m, r, pos,
        vel: new THREE.Vector3(Math.cos(a) * (1.6 + Math.random() * 2.2), 0.4, Math.sin(a) * (1.6 + Math.random() * 2.2)),
        spin: { x: (Math.random() - 0.5) * 22, y: (Math.random() - 0.5) * 22, z: (Math.random() - 0.5) * 22 },
        rot: { x: Math.random() * 6, y: Math.random() * 6, z: Math.random() * 6 },
        home: { x: worldX(here.x), z: worldZ(here.y) },
        grounded: 0, rest: false, hit: false,
      };
    });
    diceSim.arenaRoom = arenaRoom;
    diceSim.t = 0;
    diceSim.done = onDone;
    diceSim.on = true;
    diceSim.settled = false;
    diceSim.id++;
    // pull in a little so the throw is worth watching
    if (SETTINGS.follow && !handOnBoard()) {
      focusOn(worldX(here.x), worldZ(here.y), 15);
      setPhi(Math.min(basePhi(), 0.5));
    }
  }

  function rollDiceAnim(d1, d2, onDone) {
    if (Netplay.catchUp) { onDone(); return; }
    if (boardLook === 'mansion') { rollDicePhysics(d1, d2, onDone); return; }
    AudioFX.dice();
    const tgt = camCtl.tTarget;
    const vals = [d1, d2];
    dice.forEach((m, i) => {
      m.visible = true;
      m.scale.setScalar(DIE_SCALE.flat);
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
    // Two clamps rather than one. The dice are a physics simulation and a long
    // frame would throw them through a wall, so they keep the tight limit; a
    // walking pawn only needs to finish in the time it was promised, and on a
    // slow phone the tight clamp made every walk crawl.
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.12);
    const dtPhys = Math.min(raw, 0.05);
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt * animSpeed;
      const t = Math.min(1, a.t / a.dur);
      a.fn(t);
      if (t >= 1) { anims.splice(i, 1); a.done && a.done(); }
    }
    flick += dt;
    for (const id in roomHl) if (roomHl[id].visible) roomHl[id].material.opacity = 0.13 + Math.sin(flick * 4) * 0.06;
    const dimOpts = hlGroup.userData.dim ? 0.45 : 1;
    // the markers pulse in waves outward from the pawn, so how far each square
    // is reads at a glance even when the whole reach is lit
    for (const d of hlGroup.children) {
      const wave = Math.sin(flick * 5 - (d.userData.steps || 0) * 0.55);
      d.material.opacity = (0.72 + wave * 0.22) * dimOpts;
    }
    updateDice(dtPhys * animSpeed);
    turnTokens(dt);
    syncFigures();
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
  // the draw for who opens the case is made once, by the host, and every screen
  // watches the same wheel; a guest may be told before its own table is ready
  const netStart = { begin: null, first: null };
  let catchUpLearned = 0;      // cards the stand-in was shown while we were away
  let clueMarks = {}; // manual marks: key -> 0..3
  let autoMarks = {}; // key -> {holder} known info for human

  // Around a networked table "a person is playing this seat" and "that seat is
  // MINE" are different questions; the UI almost always wants the second.
  const isMe = p => !!p && !!game && p.idx === game.mySeat;
  const myTurn = () => !!game && isMe(game.player());
  const nameOf = p => !p ? '' : isMe(p) ? playerLabel()
    : (p.human ? (p.name || game.suspectOf(p).name) : game.suspectOf(p).name);

  const HINTS = {
    ROLL_DICE: 'دورك — ارمِ النرد أو استخدم الممر السري إن وُجد',
    MOVE: 'اختر أي مربع مضيء — تمشي حتى عدد ما رميت، أو ادخل غرفة مضيئة',
    SUGGEST: 'أنت داخل الغرفة — قدّم اقتراحًا للتحقيق',
    TURN_END: 'أنهِ دورك، أو وجّه اتهامًا نهائيًا إذا كنت متأكدًا',
  };

  const UI = {
    pickTile(t) {
      if (!game || game.state !== 'MOVE' || !myTurn()) return;
      clearHighlights();
      game.moveTo({ x: t.x, y: t.y });
    },
    pickRoom(roomId) {
      if (!game || game.state !== 'MOVE' || !myTurn()) return;
      clearHighlights();
      game.moveTo({ room: roomId });
    },
  };
  window.UI = UI;

  function clearHighlights() {
    hlGroup.clear();
    for (const id in roomHl) roomHl[id].visible = false;
  }
  function showMoveOptions(options, dim) {
    clearHighlights();
    hlGroup.userData.dim = !!dim;
    for (const c of options.corridors) {
      const d = new THREE.Mesh(discGeo, discMat.clone());
      d.position.set(worldX(c.x), tokenY + 0.02, worldZ(c.y));
      d.userData = { tile: c, steps: c.steps || 0 };
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
  // A card is a card: portrait stock, a brass frame, the painting inset, the
  // name on a plate at the foot, and a corner index saying which of the three
  // questions it answers.
  const CARD_INDEX = { suspect: '♟', weapon: '⚔', room: '⌂' };
  function cardHTML(c, big) {
    let name = '', tint = '#8c7440', fallback = '';
    if (c.cat === 'suspect') {
      const s = SUSPECTS.find(x => x.id === c.id);
      name = s.name; tint = s.color; fallback = '<span class="pc-ph">👤</span>';
    } else if (c.cat === 'weapon') {
      const w = WEAPONS.find(x => x.id === c.id);
      name = w.name; tint = '#7c8794'; fallback = `<span class="pc-ph">${w.icon}</span>`;
    } else {
      name = Board.ROOMS[c.id].name; tint = '#a98a4e'; fallback = '<span class="pc-ph">🚪</span>';
    }
    const src = artOf(c);
    const art = src ? `<img src="${src}" alt="">` : fallback;
    return `<div class="pcard${big ? ' big' : ''}" data-cat="${c.cat}" style="--tint:${tint}">
      <span class="pc-index">${CARD_INDEX[c.cat] || ''}</span>
      <span class="pc-art">${art}</span>
      <span class="pc-name">${name}</span>
    </div>`;
  }

  // ----- screens -----
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('on');
    if (id) $(id).classList.add('on');
  }

  // setup state — the mansion lobby fills this in before starting
  let chosen = { suspect: 'crimson', bots: 3, diff: 'normal' };
  let skinFilter = 'classic';

  applySettings();   // everything above is built, so the saved choices can land now
  applyPawnStyle();  // and the figures, if the game's own files are beside us

  if (window.MansionMenu) {
    window.MansionMenu.init({
      click: () => AudioFX.click(),
      toast: msg => toast(msg),
      onLeave: () => {},                 // the mansion menu is the only menu
      onStart: cfg => {
        chosen = { suspect: cfg.suspect, bots: cfg.bots, diff: cfg.diff, botSuspects: cfg.botSuspects };
        skinFilter = cfg.skin || 'classic';
        startGame();
      },
      // the host lays the table for everyone: who sits where, and the deal
      onRoomStart: peers => {
        const seated = peers.slice(0, 6);
        const order = ['crimson', 'saffron', 'emerald', 'violet', 'azure', 'pearl'];
        const count = Math.max(3, seated.length);
        const suspects = order.slice(0, count);
        const seatNames = {};
        seated.forEach((p, i) => { seatNames[i] = p.name; });
        // deal once, here, and hand the same deal to every screen
        const dealer = new Game({
          playerCount: count, humanSuspect: suspects[0], suspects,
          difficulty: 'normal', emit: () => {},
        });
        const table = {
          suspects, diff: 'normal', deal: dealer.dealOut(),
          humanSeats: seated.map((p, i) => i), seatNames,
        };
        Room.send('start', table);
        startGame({ ...table, mySeat: Room.seat });
      },
    });

    // ---- messages from the table ----
    Room.onMessage = m => {
      if (!m || !m.type) return;
      if (m.type === 'act') { Netplay.apply(m); return; }
      if (m.type === 'start') {
        if (game) return;                 // the host already laid its own table
        startGame({ ...m.data, mySeat: Room.seat });
        return;
      }
      if (m.type === 'first') {
        netStart.first = m.data.idx;
        if (netStart.begin) { const b = netStart.begin; netStart.begin = null; b(m.data.idx); }
        return;
      }
      if (m.type === 'away') { seatAway(m.data.seat, true); return; }
      if (m.type === 'back') { seatAway(m.data.seat, false); return; }
      if (m.type === 'host') { return; }   // the poll already told us who hosts
      if (m.type === 'left') {
        if (!game) toast(`↩︎ ${(m.data && m.data.name) || 'أحد اللاعبين'} غادر الطاولة`);
        return;
      }
    };

    // Replay everything this machine missed, with the board silent: no wheel,
    // no walking, no dice, no cutscenes — just the state, brought up to date.
    Room.onCatchUp = msgs => {
      Netplay.catchUp = true;
      catchUpLearned = 0;
      try {
        for (const m of msgs) {
          if (m.type === 'start') { if (!game) startGame({ ...m.data, mySeat: Room.seat }); }
          else if (m.type === 'first') { if (game) { game.turn = m.data.idx; game.startTurn(); } }
          else if (m.type === 'act') Netplay.apply(m);
          else if (m.type === 'away') seatAway(m.data.seat, true);
          else if (m.type === 'back') seatAway(m.data.seat, false);
        }
      } catch (e) {
        console.warn('[qasr] catch-up stopped early:', e);
      }
      Netplay.catchUp = false;
      if (!game) return;
      renderPlayers(); renderHand(); renderClueSheet();
      for (const p of game.players) tokenToWorld(tokens[p.suspect], p.pos.x, p.pos.y);
      MansionMenu.show(null);
      $('#hud').classList.add('on');
      toast(catchUpLearned
        ? `عُدتَ إلى الطاولة — دوّنت لك شخصيتك الآلية ${catchUpLearned} كرتًا أثناء غيابك`
        : 'عُدتَ إلى الطاولة — اللعبة كما تركتها');
      if (myTurn()) humanButtons();
      // if the table was waiting on a bot, get it moving again
      if (Room.host && game.player() && !game.player().human) game.beginTurn(game.player());
    };

    // A seat whose player has stepped away is played by the house until they
    // come back — the table does not stop for anybody, and nobody loses their
    // place by closing a tab.
    function seatAway(seat, away) {
      const pl = game && game.players[seat];
      if (!pl || pl.human === !away) return;
      pl.human = !away;
      game.brains[seat] = away ? game.makeBrain(seat) : null;
      renderPlayers();
      if (!Netplay.catchUp) {
        const who = nameOf(pl);
        toast(away ? `⏸️ ${who} خرج — تلعب مكانه شخصية آلية` : `▶️ ${who} رجع وأكمل دوره`);
      }
      if (Netplay.catchUp || !Room.host) return;
      if (!away) return;
      // Whatever the table was waiting on them for, the house does now —
      // otherwise a suggestion that was waiting for their card waits for ever.
      if (game.turn === seat) game.beginTurn(pl);
      else if (game.state === 'RESPOND' && game.respondIdx === seat) game.processResponse();
    }

    // The host watches who is at the table and tells everyone when a chair
    // empties or fills again.
    const seatSeen = {};
    const menuPeers = Room.onPeers;
    Room.onPeers = peers => {
      if (menuPeers) menuPeers(peers);
      if (!game || !Room.host) return;
      for (const p of peers) {
        const pl = game.players[p.seat];
        if (!pl) continue;
        if (seatSeen[p.seat] === p.online) continue;
        seatSeen[p.seat] = p.online;
        if (pl.human !== p.online) Room.send(p.online ? 'back' : 'away', { seat: p.seat });
      }
    };
  }

  $('#btn-mute').onclick = () => setSetting('sfx', !SETTINGS.sfx);

  // Straight into the house: there is no other board to choose any more.
  {
    const blocked = mansionBlocker();
    if (blocked) {
      console.warn('[qasr] the mansion cannot be drawn:', blocked);
      const box = document.getElementById('boot-error');
      if (box) { box.classList.add('on'); const w = box.querySelector('#boot-why'); if (w) w.textContent = blocked; }
    } else {
      applyLook();
      if (window.MansionMenu) window.MansionMenu.enter();
      resumeTable();
    }
  }

  // Refreshing the page, or closing it and coming back, must not cost you your
  // seat. The room code is remembered, so the first thing the game does is ask
  // the table whether we are still expected — and if we are, it walks straight
  // back in and replays whatever was missed.
  function resumeTable() {
    const code = Room.lastSeat && Room.lastSeat();
    if (!code) return;
    Room.join(code, playerLabel()).then(j => {
      if (!j.rejoined) { Room.leave(); return; }
      if (j.started) return;                     // onCatchUp puts us back in
      // the game had not started yet: wait in the room with everyone else
      MansionMenu.show('#m-room');
      MansionMenu.roomShow('live');
      const out = $('#m-room-code-out'); if (out) out.textContent = Room.code;
      MansionMenu.renderRoom(j.peers || []);
    }).catch(() => { Room.leave(); });
  }

  // `table` is set when the game is being played across several machines: it
  // carries the seating, the deal, and which seat this screen is playing.
  function startGame(table) {
    show(null);
    $('#hud').classList.add('on');
    clueMarks = {}; autoMarks = {};
    game = new Game(table ? {
      playerCount: table.suspects.length,
      humanSuspect: table.suspects[0],
      suspects: table.suspects,
      difficulty: table.diff,
      deal: table.deal,
      humanSeats: table.humanSeats,
      seatNames: table.seatNames,
      mySeat: table.mySeat,
      emit: onEvent,
    } : {
      playerCount: chosen.bots + 1,
      humanSuspect: chosen.suspect,
      suspects: chosen.botSuspects,
      difficulty: chosen.diff,
      emit: onEvent,
    });
    game.pace = PACE[SETTINGS.speed] || 1;
    Netplay.attach(game, !!table);
    // the re-enactment plays first, then the table is asked to answer
    game.onReenact = (sug, go) => playReenactment(sug, () => {
      if (!sug.accusing) openReplyStage(sug);
      go();
    });
    // place tokens
    for (const s of SUSPECTS) tokens[s.id].wanted = false;
    for (const p of game.players) {
      tokenToWorld(tokens[p.suspect], p.pos.x, p.pos.y);
      tokens[p.suspect].wanted = true;
      tokens[p.suspect].mat.color.set(SUSPECTS.find(s => s.id === p.suspect).hex);
    }
    for (const c of game.me().hand) autoMarks[cardKey(c)] = 'me';
    for (const c of game.publicCards) autoMarks[cardKey(c)] = 'pub';
    renderPlayers();
    renderClueSheet();
    renderHand();
    $('#log-feed').innerHTML = '';
    frameBoard();
    showControlsHint();
    warmCuts();
    // who opens the case is drawn once and told to the table
    const begin = idx => spinForFirst(game.players, () => {
      game.turn = idx;
      game.startTurn();
    }, idx);
    if (!table) begin(Math.floor(Math.random() * game.players.length));
    else if (Room.host) { const i = Math.floor(Math.random() * game.players.length); Room.send('first', { idx: i }); begin(i); }
    else if (netStart.first !== null) { const i = netStart.first; netStart.first = null; begin(i); }
    else netStart.begin = begin;      // wait to be told
  }


  function playerLabel() {
    try { return localStorage.getItem('qasr.name') || 'أنت'; } catch (e) { return 'أنت'; }
  }

  // A tick or a cross over each detective as they answer the suggestion, so the
  // table can be read at a glance instead of from the log.
  const replies = {};
  function clearReplies() { for (const k in replies) delete replies[k]; renderPlayers(); }
  function markReply(pl, could) {
    if (!pl) return;
    replies[pl.idx] = could;
    renderPlayers();
  }

  function renderPlayers() {
    const bar = $('#players'); bar.innerHTML = '';
    for (const p of game.players) {
      const s = SUSPECTS.find(x => x.id === p.suspect);
      const d = el('div', 'pl-chip' + (game.turn === p.idx && game.state !== 'GAME_OVER' ? ' active' : '') + (p.eliminated ? ' out' : ''));
      const face = ART['s_' + p.suspect];
      if (face) {
        d.classList.add('rich');
        d.innerHTML =
          `<span class="pl-frame"><img class="pl-face" src="${face}" alt="">` +
          `<span class="pl-count">${p.hand.length}</span>` +
          (replies[p.idx] === undefined ? '' :
            `<span class="pl-reply ${replies[p.idx] ? 'yes' : 'no'}">${replies[p.idx] ? '✔' : '✕'}</span>`) +
          `</span>` +
          `<span class="pl-name" style="background:${s.color}">${isMe(p) ? playerLabel() : (p.human ? (p.name || s.short) : s.short)}</span>`;
      } else {
        d.innerHTML = `<span class="pl-dot" style="background:${s.color}"></span><span>${isMe(p) ? 'أنت' : s.short}</span><span class="pl-cards">${p.hand.length}🂠</span>`;
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
    const h = $('#hand');
    const deal = cards => `<div class="hand-cards">${cards.map(c => cardHTML(c)).join('')}</div>`;
    let html = '<div class="hand-label">أوراقك</div>' + deal(game.me().hand);
    if (game.publicCards.length) {
      html += '<div class="hand-label">أوراق مكشوفة</div>' + deal(game.publicCards);
    }
    h.innerHTML = html;
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
  // clear the box as well as hiding it: a closed modal that still holds its old
  // markup shows up in every 'is anything on screen' check, ours and the tests'
  function closeModal() { const m = $('#modal'); m.classList.remove('on'); m.innerHTML = ''; }

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
    for (const kind of ['suspect', 'weapon', 'room']) {
      $('#sug-' + kind).classList.toggle('picking', sugBar.picking === kind);
    }
    const susArt = sugBar.sel.suspect ? sugArt('suspect', sugBar.sel.suspect) : null;
    const wepArt = sugBar.sel.weapon ? sugArt('weapon', sugBar.sel.weapon) : null;
    const si = $('#sg-sus'), sp = $('#sg-sus-ph'), wi = $('#sg-wep');
    if (si) { si.hidden = !susArt; if (susArt) si.src = susArt; }
    if (sp) sp.hidden = !!susArt;
    const inner = document.querySelector('.sg-fig-inner');
    if (inner) inner.classList.toggle('filled', !!susArt);
    if (wi) { wi.hidden = !wepArt; if (wepArt) wi.src = wepArt; }
    $('#sug-go').disabled = !(sugBar.sel.suspect && sugBar.sel.weapon && sugBar.sel.room);
  }

  function openSugBar(opts) {
    sugBar.open = true;
    sugBar.roomFixed = !!opts.roomFixed;
    sugBar.accusing = !!opts.accusing;
    sugBar.sel = { suspect: null, weapon: null, room: opts.room || null };
    sugBar.onConfirm = opts.onConfirm;
    $('#sug-go').textContent = opts.confirmLabel || 'اقترح';
    $('#sug-stage').classList.toggle('accusing', sugBar.accusing);
    $('#sg-help').textContent = opts.help ||
      'اختر المشتبه به والأداة — الغرفة هي التي تقف فيها.';
    // the scene is set in whichever room you are standing in
    const art = opts.room ? ART['r_' + opts.room] : ART.bg;
    $('#sg-bg').style.backgroundImage = art ? `url(${art})` : 'none';
    $('#sug-stage').classList.add('on');
    $('#actions').style.display = 'none';
    document.body.classList.add('sug-open');
    hint('');
    openSugPick('suspect', true);
    renderSugBar();
  }

  function closeSugBar() {
    sugBar.open = false;
    sugBar.picking = null;
    $('#sug-stage').classList.remove('on', 'accusing');
    $('#actions').style.display = '';
    document.body.classList.remove('sug-open');
  }

  // ----- crime re-enactment cutscene -----
  // Plays between "someone suggests" and "someone answers": the room goes dark,
  // a beam falls on the accused and the weapon, and the line is read out.
  const reenact = { timer: 0, done: null };

  // Painted scenes, keyed suspect_weapon_room. Only a few exist so far; any
  // trio without one falls back to the two framed portraits.
  const SCENE_ART = {};
  function sceneKey(sug) { return `${sug.suspect}_${sug.weapon}_${sug.room}`; }
  function sceneFor(sug) {
    return ART['scene_' + sceneKey(sug)] || SCENE_ART[sceneKey(sug)] || ART.scene_default || null;
  }

  function playReenactment(sug, done) {
    const box = $('#reenact');
    if (!box || !game || !SETTINGS.cutscene || Netplay.catchUp) { done(); return; }
    // Only one scene can be on screen at a time, and there is only one slot to
    // remember how to carry on from it. If a scene is already playing, end it
    // properly first — dropping its callback used to leave whoever was waiting
    // on it (a suggestion's replies, or a final accusation) hanging forever.
    if (reenact.done) reenact.done();
    const by = game.players[sug.by];
    const sus = SUSPECTS.find(x => x.id === sug.suspect);
    const wep = WEAPONS.find(x => x.id === sug.weapon);
    const room = Board.ROOMS[sug.room];
    const human = game.me();

    // the room behind it all, and the painted scene over that when we have one
    $('#re-bg').style.backgroundImage = ART['r_' + sug.room] ? `url(${ART['r_' + sug.room]})` : 'none';
    const scene = sceneFor(sug);
    const sceneEl = $('#re-scene');
    sceneEl.style.backgroundImage = scene ? `url(${scene})` : 'none';
    sceneEl.classList.toggle('on', !!scene);
    $('#re-inner').classList.toggle('hidden', !!scene);

    const face = ART['s_' + sug.suspect];
    const susImg = $('#re-sus-img');
    susImg.src = face || '';
    susImg.style.display = face ? '' : 'none';
    const wIco = ART['w_' + sug.weapon];
    const wepImg = $('#re-wep-img');
    wepImg.src = wIco || '';
    wepImg.style.display = wIco ? '' : 'none';

    $('#re-kicker').textContent = sug.accusing ? 'اتهام نهائي' : 'إعادة تمثيل الجريمة';
    $('#re-sus-name').textContent = sus.name;
    $('#re-wep-name').textContent = wep.name;
    $('#re-room-name').textContent = `في ${room.name}`;

    // the claim, laid out as the three cards it is made of
    $('#re-cards').innerHTML =
      cardHTML({ cat: 'suspect', id: sug.suspect }) +
      cardHTML({ cat: 'weapon', id: sug.weapon }) +
      cardHTML({ cat: 'room', id: sug.room });

    // and you, watching from the edge of the room
    const wit = $('#re-witness');
    const witArt = human && ART['s_' + human.suspect];
    wit.hidden = !witArt;
    if (witArt) wit.src = witArt;

    $('#re-say-who').textContent = nameOf(by);
    $('#re-line').textContent = `«${sus.name} بـ${wep.name} في ${room.name}»`;

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
    const hold = (isMe(by) ? 5200 : 4000) * (PACE[SETTINGS.speed] || 1) / 1.25;
    reenact.timer = setTimeout(() => reenact.done && reenact.done(), hold);
  }

  // ----- the answer scene -----
  // A suggestion is a question put to the table. Staging it — the asker on one
  // side, whoever is answering on the other, the three cards between them, the
  // answer spoken in a bubble — means everyone can see WHO is holding one of
  // the three cards, which is the single most useful thing to watch for, and it
  // used to be a tick in the corner of a portrait.
  const rp = { open: false, closer: 0 };

  // A detective's picture for the scene: the mansion's own figure, rendered on
  // its own so it comes out cut out, or the painted portrait softened at the
  // edges when there is no figure to render.
  function setCut(img, suspectId) {
    const flat = () => {
      img.src = ART['s_' + suspectId] || '';
      img.classList.add('flat');
      img.style.visibility = img.src ? '' : 'hidden';
    };
    let answered = false;
    figureCut(suspectId, src => {
      if (img.dataset.sus !== suspectId) return;
      answered = true;
      if (!src) { flat(); return; }
      img.src = src; img.classList.remove('flat'); img.style.visibility = '';
    });
    if (!answered) flat();      // already cached? then no stand-in flashes first
  }

  function fillSide(side, pl, name) {
    const box = $('#rp-' + side);
    const img = $('#rp-' + side + '-img');
    const s = SUSPECTS.find(x => x.id === pl.suspect);
    box.style.setProperty('--tint', s.color);
    box.dataset.tint = '1';
    box.style.visibility = '';
    $('#rp-' + side + '-name').textContent = name;
    img.dataset.sus = pl.suspect;
    setCut(img, pl.suspect);
  }

  function sayBubble(side, text, cls) {
    const b = $('#rp-' + side + '-bubble');
    $('#rp-' + side + '-line').textContent = text || '';
    b.className = 'rp-bubble rp-bubble-' + side + (cls ? ' ' + cls : '');
    void b.offsetWidth;
    b.classList.toggle('on', !!text);
  }

  function openReplyStage(sug) {
    const box = $('#reply');
    if (!box || !game || !SETTINGS.cutscene) return;
    clearTimeout(rp.closer);
    rp.open = true;
    const by = game.players[sug.by];
    $('#rp-bg').style.backgroundImage = ART['r_' + sug.room] ? `url(${ART['r_' + sug.room]})` : 'none';
    $('#rp-cards').innerHTML =
      cardHTML({ cat: 'suspect', id: sug.suspect }) +
      cardHTML({ cat: 'weapon', id: sug.weapon }) +
      cardHTML({ cat: 'room', id: sug.room });
    $('#rp-kicker').textContent = 'من يستطيع دحض الاقتراح؟';
    fillSide('ask', by, nameOf(by));
    sayBubble('ask', 'من يقدر يدحض هذا؟', '');
    // nobody is answering yet
    $('#rp-ans').style.visibility = 'hidden';
    sayBubble('ans', '');
    box.classList.remove('on', 'out'); void box.offsetWidth; box.classList.add('on');
  }

  // `could` is true when this detective is holding one of the three cards.
  function replySays(pl, could) {
    if (!rp.open || !pl) return;
    clearTimeout(rp.closer);
    const name = nameOf(pl);
    fillSide('ans', pl, name);
    $('#rp-ans').classList.toggle('away', !could);
    sayBubble('ans', could ? 'هل أقدر أساعدك؟' : 'لا أستطيع مساعدتك.', could ? 'yes' : 'no');
    AudioFX.click();
  }

  function replyNobody() {
    if (!rp.open) return;
    $('#rp-ans').style.visibility = 'hidden';
    sayBubble('ans', '');
    $('#rp-kicker').textContent = 'لا أحد استطاع الدحض';
    sayBubble('ask', 'لا أحد يقدر يساعدني… إذًا الحقيقة قريبة.', '');
    closeReplyStage(2400);
  }

  function closeReplyStage(after) {
    clearTimeout(rp.closer);
    const shut = () => {
      rp.open = false;
      const box = $('#reply');
      if (!box || !box.classList.contains('on')) return;
      box.classList.add('out');
      setTimeout(() => box.classList.remove('on', 'out'), 320);
    };
    if (after) rp.closer = setTimeout(shut, after * (PACE[SETTINGS.speed] || 1) / 1.25);
    else shut();
  }

  function skipReenactment() { if (reenact.done) { AudioFX.click(); reenact.done(); } }
  $('#re-skip').onclick = skipReenactment;
  const reGo = $('#re-go');
  if (reGo) reGo.onclick = skipReenactment;
  $('#reenact').onclick = e => { if (e.target.id === 'reenact' || e.target.classList.contains('re-vig')) skipReenactment(); };


  function openSugPick(kind, quiet) {
    if (kind === 'room' && sugBar.roomFixed) return;
    if (!quiet) AudioFX.click();
    sugBar.picking = kind;
    const titles = { suspect: 'اختر المشتبه به', weapon: 'اختر الأداة', room: 'اختر الغرفة' };
    $('#sug-pick-title').textContent = titles[kind];
    const grid = $('#sug-pick-grid'); grid.innerHTML = '';
    const items = kind === 'suspect' ? SUSPECTS.map(x => x.id)
      : kind === 'weapon' ? WEAPONS.map(x => x.id)
      : ROOM_IDS;
    for (const id of items) {
      const art = sugArt(kind, id);
      // a card already in your hand can still be named — the note just reminds you
      const mine = game && game.me().hand.some(c => c.cat === kind && c.id === id);
      const b = el('button', 'sug-opt' + (mine ? ' mine' : '') + (sugBar.sel[kind] === id ? ' sel' : ''),
        (art ? `<img src="${art}" alt="">` : `<div class="sug-ph">${sugPlaceholder(kind)}</div>`) +
        `<span>${sugName(kind, id)}</span>` + (mine ? '<span class="sug-mark">في يدك</span>' : ''));
      b.dataset.id = id;
      b.onclick = () => {
        AudioFX.click();
        sugBar.sel[kind] = id;
        renderSugBar();
        // walk on to whatever is still missing. This used to stop after the
        // weapon, which was fine for a suggestion (the room is wherever you are
        // standing) but left a final accusation with no room chosen and no sign
        // that one was needed.
        const next = ['suspect', 'weapon', 'room'].find(k =>
          !sugBar.sel[k] && !(k === 'room' && sugBar.roomFixed));
        openSugPick(next || kind, true);
      };
      grid.appendChild(b);
    }
  }

  for (const kind of ['suspect', 'weapon', 'room']) {
    $('#sug-' + kind).onclick = () => openSugPick(kind);
  }
  $('#sug-cancel').onclick = () => { AudioFX.click(); closeSugBar(); humanButtons(); };
  $('#sug-go').onclick = () => {
    if ($('#sug-go').disabled) return;
    AudioFX.click();
    const sel = { ...sugBar.sel };
    const accusing = sugBar.accusing;
    const go = () => { closeSugBar(); sugBar.onConfirm(sel); };
    if (!accusing) { go(); return; }
    // A final accusation cannot be taken back — get it said out loud first.
    const box = modal(`
      <div class="go-seal">⚖️</div>
      <h3>هذا اتهامك النهائي</h3>
      <p class="go-sub">إن أخطأت خرجتَ من التحقيق ولا يمكنك الاتهام مرة أخرى.</p>
      <div class="reveal-row">
        ${cardHTML({ cat: 'suspect', id: sel.suspect }, true)}
        ${cardHTML({ cat: 'weapon', id: sel.weapon }, true)}
        ${cardHTML({ cat: 'room', id: sel.room }, true)}
      </div>
      <div class="modal-actions">
        <button class="act-btn danger" id="acc-yes">نعم، هذا هو الحل</button>
        <button class="act-btn ghost" id="acc-no">راجع اختياري</button>
      </div>`);
    box.querySelector('#acc-yes').onclick = () => { AudioFX.click(); closeModal(); go(); };
    box.querySelector('#acc-no').onclick = () => { AudioFX.click(); closeModal(); };
  };

  // shown once per device: how to move the view
  function showControlsHint() {
    const KEY = 'qasr.controlsSeen';
    try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, '1'); } catch (e) {}
    const touch = matchMedia('(pointer: coarse)').matches;
    setTimeout(() => toast(touch
      ? '👆 اسحب بإصبع لتحريك اللوح · إصبعان للتقريب والتدوير'
      : '🖱️ اسحب لتحريك اللوح · عجلة للتقريب · زر أيمن أو Shift للتدوير'), 1400);
  }

  // ----- the draw for who opens the case -----
  // Somebody has to go first, and it should not always be you. The wheel picks,
  // in front of everyone, and the turn order starts from whoever it lands on.
  // `forced` names the seat the draw must land on — around a networked table
  // the draw happens once, on the host, and every screen watches the same wheel
  // stop in the same place.
  function spinForFirst(players, onDone, forced) {
    const wheel = $('#spin-wheel'), box = $('#spin'), out = $('#spin-result');
    if (!wheel || !box || Netplay.catchUp) { onDone(forced || 0); return; }
    const winner = forced === undefined || forced === null
      ? Math.floor(Math.random() * players.length) : forced;
    const n = players.length, step = 360 / n;

    wheel.innerHTML = '';
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    const seats = [];
    players.forEach((p, i) => {
      const s = SUSPECTS.find(x => x.id === p.suspect);
      const seat = el('div', 'spin-seat');
      const a = i * step;
      seat.dataset.a = a;
      seat.style.transition = 'none';
      seat.style.transform = `rotate(${a}deg) translateY(-140%) rotate(${-a}deg)`;
      seat.innerHTML = `<img src="${ART['s_' + p.suspect] || ''}" alt="">` +
        `<b style="background:${s.color}">${isMe(p) ? playerLabel() : (p.human ? (p.name || s.short) : s.short)}</b>`;
      wheel.appendChild(seat);
      seats.push(seat);
    });

    out.textContent = ''; out.classList.remove('on');
    $('#spin-hub-txt').textContent = 'القرعة';
    box.classList.add('on');
    AudioFX.dice();

    // land the winner under the needle at the top, after a few full turns
    const turns = 4 + Math.floor(Math.random() * 2);
    const land = turns * 360 - winner * step;
    const EASE = 'transform 4s cubic-bezier(0.12, 0.72, 0.12, 1)';
    requestAnimationFrame(() => {
      wheel.style.transition = EASE;
      wheel.style.transform = `rotate(${land}deg)`;
      // spin the faces back by exactly as much as the wheel turns, so nobody
      // ends up hanging upside down
      for (const seat of seats) {
        const a = +seat.dataset.a;
        seat.style.transition = EASE;
        seat.style.transform = `rotate(${a}deg) translateY(-140%) rotate(${-a - land}deg)`;
      }
    });

    const who = players[winner];
    setTimeout(() => {
      AudioFX.win();
      $('#spin-hub-txt').textContent = '★';
      out.textContent = isMe(who) ? 'تبدأ أنت' : `يبدأ ${nameOf(who)}`;
      out.classList.add('on');
      if (seats[winner]) seats[winner].classList.add('won');
    }, 4100);
    setTimeout(() => { box.classList.remove('on'); onDone(winner); }, 5900);
  }

  // ----- human action buttons per state -----
  function humanButtons() {
    if (!game || game.state === 'GAME_OVER') { closeSugBar(); return; }
    const p = game.player();
    if (!isMe(p) || p.eliminated) { closeSugBar(); setButtons([]); return; }
    if (sugBar.open) return;
    const btns = [];
    const accuseBtn = { label: '⚖️ اتهام نهائي', cls: 'danger', fn: () => openSugBar({
      roomFixed: false, accusing: true, confirmLabel: 'وجّه الاتهام النهائي',
      help: 'الاتهام النهائي: سمِّ القاتل والأداة والغرفة الثلاثة. إن أخطأت خرجت من التحقيق.',
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
      if (isMe(d.player)) { humanButtons(); }
      else { setButtons([]); hint(`دور ${nameOf(d.player)}...`); }
    },
    diceRolled: d => {
      setButtons([]); hint('');
      rollDiceAnim(d.d1, d.d2, () => {
        $('#dice-res').textContent = `🎲 ${d.d1} + ${d.d2} = ${d.total}`;
        $('#dice-res').classList.add('show');
        setTimeout(() => $('#dice-res').classList.remove('show'), 2600);
        // step one: the whole plan, so the roll can actually be spent
        framePlan();
        showMoveOptions(d.options, !isMe(d.player));
        if (isMe(d.player)) humanButtons();
        else hint(`${nameOf(d.player)} يختار وجهته…`);
      });
    },
    moved: d => {
      clearHighlights();
      const path = d.path.length > 1 ? d.path : [[d.player.pos.x, d.player.pos.y]];
      const tok = tokens[d.player.suspect];
      // frame the START of the walk, from behind, looking the way it sets off
      frameWalk(tok.mesh.position.x, tok.mesh.position.z, pathHeading(path));
      animatePath(d.player.suspect, path, () => {
        if (d.room) { AudioFX.door(); tokenToWorld(tokens[d.player.suspect], d.player.pos.x, d.player.pos.y); }
        if (isMe(d.player)) humanButtons();
      });
    },
    movedToRoom: d => {
      fadeTokenTo(d.player.suspect, d.player.pos.x, d.player.pos.y, () => { if (isMe(d.player)) humanButtons(); });
      frameWalk(worldX(d.player.pos.x), worldZ(d.player.pos.y));
    },
    suspectPulled: d => fadeTokenTo(d.player.suspect, d.player.pos.x, d.player.pos.y),
    suggestionMade: d => {
      AudioFX.suggest();
      clearReplies();
      const s = game.suggestion;
      toast(`🔍 ${game.displayName(game.players[s.by])}: «${suspectName(s.suspect)} بـ${weaponName(s.weapon)} في ${Board.ROOMS[s.room].name}»`);
    },
    cannotDisprove: d => { markReply(d.responder, false); replySays(d.responder, false); },
    chooseCardToShow: d => {
      // only the person actually holding the cards gets to choose one; every
      // other screen just waits for the answer
      if (!isMe(d.responder)) { hint(`${nameOf(d.responder)} يختار كرتًا…`); return; }
      if (!d.responder.human) return;      // they left; the house answers instead
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
      if (document.querySelector('#modal.on #show-pick')) closeModal();
      markReply(d.responder, true);
      replySays(d.responder, true);
      // the card travels with the event so every machine stays in step, but it
      // is only ever SHOWN to the detective who asked
      if (d.card && isMe(d.suggester)) {
        autoMarks[cardKey(d.card)] = d.responder.idx;
        // catching up: the stand-in asked these questions while we were away.
        // Note the answers down, but do not make them click through a stack of
        // cards before they can see the board again.
        if (Netplay.catchUp) { catchUpLearned++; renderClueSheet(); return; }
        renderClueSheet();
        const show = () => {
          const box = modal(`<h3>${game.displayName(d.responder)} أظهر لك:</h3><div class="reveal-card">${cardHTML(d.card, true)}</div><div class="modal-actions"><button class="act-btn primary" id="ok">تدوين في ورقة التحقيق</button></div>`);
          box.querySelector('#ok').onclick = () => { closeModal(); closeReplyStage(); if (myTurn()) humanButtons(); };
        };
        setTimeout(show, Math.round(1100 * (PACE[SETTINGS.speed] || 1) / 1.25));
      } else {
        closeReplyStage(2200);
        if (myTurn()) humanButtons();
      }
      renderPlayers();
    },
    nobodyDisproved: d => {
      toast('❗ لا أحد استطاع الدحض — دوّن ذلك جيدًا!');
      replyNobody();
      if (myTurn()) humanButtons();
    },
    accusationWrong: d => {
      AudioFX.bad();
      renderPlayers();
      clearHighlights();
      closeReplyStage();
      const who = game.suspectOf(d.player).name;
      if (isMe(d.player)) {
        setButtons([]); hint('تشاهد بقية التحقيق...');
        const box = modal(`
          <div class="go-seal">✖</div>
          <h3>اتهام خاطئ</h3>
          <p class="go-sub">الحل ليس هذا. خرجتَ من التحقيق، لكن يمكنك متابعة ما تبقّى.</p>
          <div class="reveal-row">
            ${cardHTML({ cat: 'suspect', id: d.accusation.suspect }, true)}
            ${cardHTML({ cat: 'weapon', id: d.accusation.weapon }, true)}
            ${cardHTML({ cat: 'room', id: d.accusation.room }, true)}
          </div>
          <div class="modal-actions"><button class="act-btn primary" id="ok">تابع المشاهدة</button></div>`);
        box.querySelector('#ok').onclick = () => closeModal();
      } else {
        toast(`⚖️ ${who} وجّه اتهامًا خاطئًا وخرج من التحقيق`, 'bad');
      }
      tokens[d.player.suspect].mat.color.multiplyScalar(0.35);
    },
    turnEnd: d => { renderPlayers(); },
    gameOver: d => {
      setButtons([]); hint('');
      clearHighlights();
      closeReplyStage();
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
    const win = d.winner && isMe(d.winner);
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
      if (window.MansionMenu) window.MansionMenu.enter();
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
    const won = !!(d.winner && isMe(d.winner));
    st.played++;
    if (won) st.won++; else st.lost++;
    const turns = game.turnCount || 0;
    if (won && (st.bestTurns === null || turns < st.bestTurns)) st.bestTurns = turns;
    st.log.unshift({
      won, turns,
      winner: d.winner ? game.suspectOf(d.winner).name : null,
      me: suspectName(game.me().suspect),
      solution: [suspectName(game.envelope.suspect), weaponName(game.envelope.weapon), Board.ROOMS[game.envelope.room].name],
      bots: game.players.length - 1,
    });
    st.log = st.log.slice(0, 12);
    writeStats(st);
  }

  // the menu layer talks to the game through this
  window.GameApi = {
    pawnStyles: () => PAWN_STYLES.map(x => ({ ...x, available: x.id === 'simple' || figuresAvailable() })),
    pawnStyle: id => pawnStyleOf(id),
    setPawnStyle: (st, id) => (id ? setPawnStyleFor(id, st) : setPawnStyle(st)),
    pawnThumb: (id, variant, cb) => pawnThumb(id, variant, cb),
    settings: () => Object.assign({}, SETTINGS),
    set: (k, v) => setSetting(k, v),
    look: () => boardLook,
    lookAvailable: () => mansionAvailable(),
    stats: () => readStats(),
    clearStats: () => { writeStats({ played: 0, won: 0, lost: 0, bestTurns: null, log: [] }); },
  };

  // expose for tests
  window._dbg = () => game;
  window.__scene = () => ({ scene, THREE, mansion, worldX, worldZ, W, H, tokens });
  window.__standProbe = (x, y) => [standX(x, y), standZ(x, y)];
  window.__anims = () => anims.length;
  window.__cardHTML = (c, big) => cardHTML(c, big);
  window.__camState = () => ({ target: camCtl.tTarget.clone(), dist: camCtl.tDist, phi: camCtl.phi, theta: camCtl.theta, tTheta: camCtl.tTheta, mode: shot.mode });
  window.__panTo = (x, z) => { camCtl.tTarget.set(x, 0, z); camCtl.target.set(x, 0, z); };
  window.__camera = () => camera;
  window.__discs = () => hlGroup.children.length;
  window.__walk = (id, path) => animatePath(id, path);
  window.__setTheta = t => { camCtl.theta = t; camCtl.tTheta = t; };
  window.__reply = (askIdx, ansIdx, could) => {
    openReplyStage({ by: askIdx, suspect: SUSPECTS[1].id, weapon: WEAPONS[0].id, room: 'ballroom' });
    setTimeout(() => replySays(game.players[ansIdx], could !== false), 400);
  };
  window.__replyOpen = () => !!document.getElementById('reply').classList.contains('on');
  window.__cut = id => new Promise(r => figureCut(id, v => r(v ? v.length : 0)));
  window.__humanButtons = () => humanButtons();
  window.__net = () => ({
    code: Room.code, seat: Room.seat, host: Room.host, since: Room.since,
    peers: (Room.peers || []).map(p => `${p.seat}:${p.name}:${p.online ? 'on' : 'off'}${p.host ? ':HOST' : ''}`),
    humans: game ? game.players.map(p => p.human) : null,
    brains: game ? game.brains.map(b => !!b) : null,
    state: game ? game.state : null, turn: game ? game.turn : null,
  });
  // the three framings the camera moves between, as rules rather than as a
  // sample taken mid-swing while somebody else is having their turn
  window.__framings = () => ({
    rest: basePhi(), plan: 0.16, walk: WALK_PHI,
    restDist: (boardLook === 'mansion' ? 34 : 26) * (isPortrait() ? 1.45 : 1),
    planDist: boardFitDist() * 1.1,
    walkDist: WALK_DIST * (isPortrait() ? 1.55 : 1),
  });
  window.__cutInfo = () => ({
    look: boardLook, figures: figuresAvailable(),
    styles: SUSPECTS.map(s => s.id + ':' + pawnStyleOf(s.id)),
    cuts: Object.keys(cutCache).map(k => k + '=' + (cutCache[k] ? 'ok' : 'null')),
    flat: [...document.querySelectorAll('.rp-cut')].map(i => i.className),
  });
  // where did the dice come to rest, which face is up, and is any of it in a wall?
  window.__diceSettled = () => diceSim.settled;
  window.__diceCheck = () => {
    const up = new THREE.Vector3(0, 1, 0);
    const faces = dice.map(m => {
      // which of the six face normals points most nearly upward
      const best = [[1, 3], [-1, 4], [2, 1], [-2, 6], [3, 2], [-3, 5]].map(([axis, val]) => {
        const v = new THREE.Vector3(axis === 1 ? 1 : axis === -1 ? -1 : 0, axis === 2 ? 1 : axis === -2 ? -1 : 0, axis === 3 ? 1 : axis === -3 ? -1 : 0);
        v.applyQuaternion(m.quaternion);
        return { val, d: v.dot(up) };
      }).sort((a, b) => b.d - a.d)[0];
      return best.val;
    });
    const p = game && game.player();
    const arena = diceSim.arena !== undefined ? diceSim.arena : (p && p.pos.room ? p.pos.room : null);
    const r = dieRadius();
    let inWall = 0;
    const tiles = dice.map(m => {
      const tx = Math.round(m.position.x + W / 2 - 0.5), ty = Math.round(m.position.z + H / 2 - 0.5);
      // touching a wall is fine; only count a die that is actually inside one
      const probe = r * 0.9;
      for (const [ox, oz] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]]) {
        if (solidPoint(m.position.x + ox, m.position.z + oz, arena)) { inWall++; break; }
      }
      return tx + ',' + ty;
    });
    return { faces, tiles, inWall, arena: arena || 'corridor',
      me: diceSim.from ? `${diceSim.from.x},${diceSim.from.y}` : (p ? `${p.pos.x},${p.pos.y}` : '?'),
      size: +(DIE * (DIE_SCALE[boardLook] || 1)).toFixed(2) };
  };
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
