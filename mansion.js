// ======================= AUTHENTIC MANSION VIEW =======================
// Loads the real Tudor Mansion geometry (corridor + nine rooms + garden) that
// was exported from the installed game, and drops it into the same scene the
// stylised board uses.
//
// The export keeps the game's own world space, so every part shares ONE
// transform: a 180 degree turn around Y plus a translation. The stylised board
// centres tile (0,0) at (-W/2+0.5, -H/2+0.5), so that shift is folded in here
// and the meshes land tile-for-tile on the grid in board.js.
//
// Lighting is already baked into per-vertex colours, so the meshes render
// unlit — the scene's lights only touch the pawns, dice and case file.
//
// This file ships with the LOCAL build only: the meshes and atlases are the
// game's own assets and stay on disk beside it.
(function (global) {
  const C = global.MANSION_CONFIG || {};
  const MODEL_PATH = C.models || 'models/rooms/';
  const TEX_PATH = C.textures || 'textures/';
  const LAMPS_URL = C.lamps || 'js/lamps.json';
  const TOKEN_PATH = C.tokens || 'models/tokens/';

  // The house itself: the corridor shell plus the nine rooms.
  //
  // 'exterior' is deliberately NOT here. That export is the game's outdoor set —
  // it reaches x[-30,33] z[-30,36] while the board is only 24x25 — and it brings
  // the driveway gate, the fountain, the lamp posts and a stretch of garden wall
  // with it. On the board they read as stray objects floating around the house,
  // so the grounds are drawn as a plain terrace in main.js instead.
  const PARTS = [
    'corridor',
    'kitchen', 'ballroom', 'conservatory', 'diningroom', 'billiardroom',
    'library', 'lounge', 'hall', 'study',
  ];

  const OFFSET_X = 11.334, OFFSET_Z = 13.945;
  const LAMP = { poolRadius: 1.8, poolOpacity: 0.30, glowOpacity: 0.6, glowScale: 0.9 };

  function radialTexture(THREE, inner, mid) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, mid);
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }

  // Swap the lit MTL materials for unlit ones: the baked vertex colours ARE the
  // lighting, so any runtime light would double-expose them.
  function convertMaterials(THREE, obj) {
    obj.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const out = mats.map(mat => {
        if (!mat) return mat;
        const name = mat.name || '';
        if (mat.map) {
          if (THREE.sRGBEncoding !== undefined) mat.map.encoding = THREE.sRGBEncoding;
          mat.map.anisotropy = 4;
        }
        const basic = new THREE.MeshBasicMaterial({
          map: mat.map, side: THREE.DoubleSide, vertexColors: true, name,
        });
        if (/plant|veg/i.test(name)) {           // foliage atlases are cut-outs
          basic.transparent = true;
          basic.alphaTest = 0.45;
          basic.depthWrite = true;
        }
        if (/lamp/i.test(name)) basic.vertexColors = false;   // fixtures stay bright
        return basic;
      });
      child.material = Array.isArray(child.material) ? out : out[0];
    });
  }

  function build(opts) {
    const { THREE, scene, W, H, worldY = 0, onProgress } = opts;
    if (!THREE.OBJLoader || !THREE.MTLLoader) {
      console.warn('[mansion] OBJLoader/MTLLoader missing — mansion view unavailable');
      return null;
    }

    const group = new THREE.Group();
    group.rotation.y = Math.PI;
    group.position.set(OFFSET_X - W / 2 + 0.5, worldY, OFFSET_Z - H / 2 + 0.5);
    group.visible = false;
    scene.add(group);

    const lampGroup = new THREE.Group();
    lampGroup.visible = false;
    scene.add(lampGroup);

    const api = {
      group, lampGroup, parts: {},
      total: PARTS.length, done: 0, failed: 0,
      get ready() { return this.done + this.failed >= this.total; },
      setVisible(v) { group.visible = v; lampGroup.visible = v; },
      setPartVisible(id, v) { if (api.parts[id]) api.parts[id].visible = v; },
    };

    const tick = () => { if (onProgress) onProgress(api.done + api.failed, api.total, api); };

    PARTS.forEach(id => {
      const mtl = new THREE.MTLLoader();
      mtl.setPath(MODEL_PATH);
      mtl.setResourcePath(TEX_PATH);        // map_Kd holds a bare file name
      mtl.load(id + '.mtl', materials => {
        materials.preload();
        const obj = new THREE.OBJLoader();
        obj.setMaterials(materials);
        obj.setPath(MODEL_PATH);
        obj.load(id + '.obj', o => {
          o.name = 'part_' + id;
          convertMaterials(THREE, o);
          api.parts[id] = o;
          group.add(o);
          api.done++; tick();
        }, undefined, err => {
          console.error('[mansion] ' + id + '.obj failed', err);
          api.failed++; tick();
        });
      }, undefined, err => {
        console.error('[mansion] ' + id + '.mtl failed', err);
        api.failed++; tick();
      });
    });

    // warm pools + halos at the game's own lamp meshes
    const poolTex = radialTexture(THREE, 'rgba(255,205,140,0.95)', 'rgba(255,165,85,0.42)');
    const glowTex = radialTexture(THREE, 'rgba(255,235,200,1)', 'rgba(255,180,100,0.55)');
    const addLamps = list => {
      if (!Array.isArray(list)) return;
      const R = LAMP.poolRadius;
      for (const l of list) {
        // the export lists garden lamps too; without the grounds they would be
        // glows hanging in the dark, so keep only the ones over the board
        if (l.x < -0.5 || l.x > W - 0.5 || l.z < -0.5 || l.z > H - 0.5) continue;
        const wx = l.x - W / 2 + 0.5, wz = l.z - H / 2 + 0.5;
        const pool = new THREE.Mesh(
          new THREE.PlaneGeometry(R * 2, R * 2),
          new THREE.MeshBasicMaterial({
            map: poolTex, transparent: true, blending: THREE.AdditiveBlending,
            depthWrite: false, opacity: LAMP.poolOpacity,
          })
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(wx, worldY + 0.035, wz);
        lampGroup.add(pool);

        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, opacity: LAMP.glowOpacity,
        }));
        halo.position.set(wx, worldY + (l.y || 2.1), wz);
        halo.scale.set(LAMP.glowScale, LAMP.glowScale, 1);
        lampGroup.add(halo);
      }
    };
    fetch(LAMPS_URL).then(r => (r.ok ? r.json() : null)).then(addLamps).catch(() => {});

    return api;
  }

  // ---- the game's own detective figures ----
  // Six standing tokens, each with a spare outfit, exported the same way the
  // rooms were. They arrive already at board scale (about 1.9 units tall on a
  // 1-unit tile), so they drop straight onto the grid.
  function loadToken(opts) {
    const { THREE, id, variant, onDone, onFail } = opts;
    const name = id + '_' + variant;
    const mtl = new THREE.MTLLoader();
    mtl.setPath(TOKEN_PATH);
    mtl.setResourcePath(TEX_PATH);
    mtl.load(name + '.mtl', materials => {
      materials.preload();
      const obj = new THREE.OBJLoader();
      obj.setMaterials(materials);
      obj.setPath(TOKEN_PATH);
      obj.load(name + '.obj', o => {
        o.traverse(ch => {
          if (!ch.isMesh) return;
          const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
          const out = mats.map(m => {
            if (m && m.map && THREE.sRGBEncoding !== undefined) m.map.encoding = THREE.sRGBEncoding;
            return new THREE.MeshLambertMaterial({ map: m && m.map, side: THREE.DoubleSide });
          });
          ch.material = Array.isArray(ch.material) ? out : out[0];
          ch.castShadow = false;
          ch.receiveShadow = false;
        });
        onDone && onDone(o);
      }, undefined, err => onFail && onFail(err));
    }, undefined, err => onFail && onFail(err));
  }

  global.Mansion = { build, PARTS, loadToken };
})(typeof window !== 'undefined' ? window : globalThis);
