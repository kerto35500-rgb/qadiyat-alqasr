// ======================= MANSION-STYLE MENU FLOW =======================
// The furnished style gets a full front-end: title -> home -> mode -> crime
// scene -> game type -> lobby, plus a character sheet. It is only a wrapper
// around the SAME game: whatever the player picks here ends up in the exact
// config object the classic setup screen produces, so the rules, the board and
// the bots are identical in both styles.
//
// Options that are not implemented yet are shown but locked, so the menu maps
// onto the real game's shape without pretending to do more than it does.
(function (global) {
  const SUSPECTS = global.GameCore.SUSPECTS;
  const ART = global.ART || {};
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  // ---- engraved line icons -------------------------------------------------
  // Drawn rather than borrowed: one stroke weight, one corner radius, so the
  // menu reads as a set instead of a pile of emoji.
  const P = {
    dice:    '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.2"/><circle cx="8.4" cy="8.4" r="1.35" fill="currentColor" stroke="none"/><circle cx="15.6" cy="15.6" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/>',
    file:    '<path d="M6 3.4h7.4L18 8v12.6H6z"/><path d="M13.2 3.6V8H18"/><path d="M8.8 12.6h6.4M8.8 16h4.2"/>',
    shop:    '<path d="M4.4 8.2h15.2l-1.1 11.2a1.6 1.6 0 0 1-1.6 1.4H7.1a1.6 1.6 0 0 1-1.6-1.4z"/><path d="M8.9 10.4V7.3a3.1 3.1 0 0 1 6.2 0v3.1"/>',
    gear:    '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.9l1.3 2.3 2.6-.5.5 2.6 2.3 1.3-1.3 2.3 1.3 2.3-2.3 1.3-.5 2.6-2.6-.5L12 21.1l-1.3-2.3-2.6.5-.5-2.6-2.3-1.3L6.6 13 5.3 10.7l2.3-1.3.5-2.6 2.6.5z"/>',
    power:   '<path d="M12 3.4v8.2"/><path d="M7.4 6.6a7 7 0 1 0 9.2 0"/>',
    pencil:  '<path d="M4.6 19.4h3.1L18.4 8.7a2.2 2.2 0 0 0-3.1-3.1L4.6 16.3z"/><path d="M14.4 6.6l3.1 3.1"/>',
    badge:   '<path d="M12 3.2l2.5 1.9 3.1-.2.6 3 2.4 2-1.6 2.7 1.6 2.7-2.4 2-.6 3-3.1-.2L12 21.2l-2.5-1.9-3.1.2-.6-3-2.4-2L5 11.8 3.4 9.1l2.4-2 .6-3 3.1.2z"/><path d="M9.4 12.1l1.9 1.9 3.4-3.6"/>',
    chevron: '<path d="M14.5 6.5L8.7 12l5.8 5.5"/>',
    sound:   '<path d="M5 9.4h3.1L12.4 6v12l-4.3-3.4H5z"/><path d="M15.6 9.6a3.6 3.6 0 0 1 0 4.9M18 7.2a7 7 0 0 1 0 9.7"/>',
    mute:    '<path d="M5 9.4h3.1L12.4 6v12l-4.3-3.4H5z"/><path d="M16 9.8l4.4 4.4M20.4 9.8L16 14.2"/>',
    house:   '<path d="M4 10.6L12 4l8 6.6"/><path d="M6.3 12.2v8.2h11.4v-8.2"/><path d="M10.2 20.4v-5h3.6v5"/>',
    grid:    '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2.4"/><path d="M3.6 9.2h16.8M3.6 14.8h16.8M9.2 3.6v16.8M14.8 3.6v16.8"/>',
    label:   '<path d="M3.6 12l7.2-7.2h8.4a1.2 1.2 0 0 1 1.2 1.2v8.4L13.2 21.6a1.7 1.7 0 0 1-2.4 0l-7.2-7.2a1.7 1.7 0 0 1 0-2.4z"/><circle cx="16.4" cy="7.6" r="1.2"/>',
    camera:  '<rect x="3.2" y="6.8" width="17.6" height="12.4" rx="2.6"/><circle cx="12" cy="13" r="3.4"/><path d="M8.6 6.8l1.4-2.4h4l1.4 2.4"/>',
    film:    '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2"/><path d="M7.6 5.2v13.6M16.4 5.2v13.6M3.2 12h17.6"/>',
    text:    '<path d="M5 6.4h14M5 12h14M5 17.6h8.4"/>',
    trash:   '<path d="M4.8 6.8h14.4"/><path d="M9.2 6.8V4.6h5.6v2.2"/><path d="M6.6 6.8l.9 12.4a1.4 1.4 0 0 0 1.4 1.3h6.2a1.4 1.4 0 0 0 1.4-1.3l.9-12.4"/>',
    palette: '<path d="M12 3.4a8.6 8.6 0 1 0 0 17.2c1.3 0 1.9-.9 1.9-1.8 0-1.4-1.2-1.6-1.2-2.7 0-.8.7-1.4 1.6-1.4h1.6a4.7 4.7 0 0 0 4.7-4.7c0-3.7-3.7-6.6-8.6-6.6z"/><circle cx="8.2" cy="10.2" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="7.8" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.8" cy="9.6" r="1.15" fill="currentColor" stroke="none"/>',
    lock:    '<rect x="4.8" y="10.4" width="14.4" height="10" rx="2.2"/><path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8"/>',
    check:   '<path d="M5 12.6l4.6 4.6L19 6.8"/>',
    trophy:  '<path d="M7.4 4.4h9.2v5.2a4.6 4.6 0 0 1-9.2 0z"/><path d="M7.4 6h-2.6a2.6 2.6 0 0 0 2.6 2.6M16.6 6h2.6a2.6 2.6 0 0 1-2.6 2.6"/><path d="M12 14.2v3.2M8.8 20.2h6.4l-.8-2.8H9.6z"/>',
  };
  function icon(name, cls) {
    const d = P[name];
    if (!d) return '';
    return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  }
  // any element carrying data-ico gets its glyph injected once
  function paintIcons(root) {
    for (const n of (root || document).querySelectorAll('[data-ico]')) {
      if (n.dataset.icoDone) continue;
      n.dataset.icoDone = '1';
      n.insertAdjacentHTML('afterbegin', icon(n.dataset.ico));
    }
  }

  const MODES = [
    { id: 'single', ico: 'badge', name: 'لاعب واحد', desc: 'العب دون اتصال ضد ٥ محققين آليين.' },
    { id: 'online', ico: 'grid', name: 'أونلاين', desc: 'العب ضد خصوم عشوائيين عبر الإنترنت.', lock: 'يحتاج خادمًا — غير مفعّل بعد' },
    { id: 'friends', ico: 'house', name: 'مع الأصدقاء', desc: 'العب مع أصدقائك برمز غرفة خاص.', lock: 'يحتاج خادمًا — غير مفعّل بعد' },
  ];

  const SCENES = [
    { id: 'tudor', name: 'قصر تيودور', art: 'bg', note: 'القصر الأصلي بغرفه التسع.' },
    // each locked scene gets its own duotone so they read as four different
    // places rather than three dim photographs of the same house
    { id: 'noir', name: 'القصر الأسود', art: 'r_study', lock: true, note: 'قريبًا', tint: '#6b1f2a' },
    { id: 'polar', name: 'محطة القطب', art: 'r_conservatory', lock: true, note: 'قريبًا', tint: '#1c5570' },
    { id: 'pines', name: 'منتجع الصنوبر', art: 'r_lounge', lock: true, note: 'قريبًا', tint: '#2c5a34' },
  ];

  const TYPES = [
    { id: 'standard', name: 'الطريقة القياسية', desc: 'قوانين اللعبة المعتادة.', tint: 1 },
    { id: 'retro', name: 'القوانين الأصلية', desc: 'قوانين النسخة القديمة.', tint: 2, lock: true },
    { id: 'cards', name: 'بطاقات الأدلة', desc: 'جولات أسرع ببطاقات إضافية.', tint: 3, lock: true },
    { id: 'ultimate', name: 'المحقق الأعظم', desc: 'تحدٍّ أصعب وأعمق للمحترفين.', tint: 4, lock: true },
  ];

  const DIFFS = [
    { id: 'easy', label: 'مبتدئ' },
    { id: 'normal', label: 'محقق محترف' },
  ];

  // "skins" are just the tints the pawn and card frame take — the portraits are
  // the same painting, so this stays honest about what it actually changes.
  const SKINS = [
    { id: 'classic', name: 'كلاسيكي', shade: 1 },
    { id: 'noir', name: 'أسود وأبيض', shade: 2 },
    { id: 'warm', name: 'دافئ', shade: 3 },
  ];

  const state = {
    mode: 'single',
    scene: 'tudor',
    type: 'standard',
    diff: 1,                       // index into DIFFS
    me: SUSPECTS[0].id,
    skin: 'classic',
    seats: SUSPECTS.slice(1).map(s => ({ id: s.id, on: true })),
    editing: null,                 // which seat the character sheet is editing
    charsFrom: '#m-home',          // where the character sheet was opened from
  };

  let onStart = null, onLeave = null, toast = null;

  const suspect = id => SUSPECTS.find(s => s.id === id);
  const portrait = id => ART['s_' + id] || '';
  const usedIds = () => new Set([state.me, ...state.seats.filter(s => s.on).map(s => s.id)]);

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('on');
    if (id) $(id).classList.add('on');
  }

  // ---------------------------------------------------------------- title
  function buildTitle() {
    if (ART.menu_hero) {
      const bg = $('#m-title-bg');
      if (bg) bg.style.backgroundImage = `url(${ART.menu_hero})`;
    }
    // the hero art already contains the figure, so the cut-out layer is only
    // used when that artwork is missing
    const hero = $('#m-hero');
    if (hero) {
      if (ART.menu_hero) hero.remove();
      else hero.src = portrait(state.me);
    }
    $('#m-title-start').onclick = () => { click(); show('#m-home'); };
  }

  // ----------------------------------------------------------------- home
  function buildHome() {
    const bg = $('#m-home-bg');
    if (bg && (ART.menu_bg || ART.r_library)) {
      bg.style.backgroundImage = `url(${ART.menu_bg || ART.r_library})`;
    }
    const av = $('#m-avatar');
    if (av) av.src = portrait(state.me);
    $('#m-play').onclick = () => { click(); show('#m-mode'); };
    $('#m-profile').onclick = () => { click(); openChars(null, '#m-home'); };
    $('#m-settings').onclick = () => { click(); openSettings(); };
    $('#m-cases').onclick = () => { click(); openCases(); };
    $('#m-shop').onclick = () => { click(); openShop(); };
    $('#m-quit').onclick = () => { click(); if (onLeave) onLeave(); };
    refreshHome();
  }

  function refreshHome() {
    const sc = SCENES.find(x => x.id === state.scene);
    const md = MODES.find(x => x.id === state.mode);
    const sub = $('#m-play-sub');
    if (sub) sub.textContent = `${md ? md.name : ''} — ${sc ? sc.name : ''}`;
    const n = $('#m-rank-n');
    if (n) n.textContent = api().stats ? api().stats().won : 0;
  }

  // the game exposes settings and the case record here; the menu never touches
  // localStorage itself, so both styles stay in step
  const NOOP_API = {
    settings: () => ({}), set: () => {}, look: () => 'flat', setLook: () => {},
    lookAvailable: () => false, stats: () => ({ played: 0, won: 0, lost: 0, bestTurns: null, log: [] }), clearStats: () => {},
  };
  const api = () => global.GameApi || NOOP_API;

  // ------------------------------------------------------------- settings
  const SETTING_ROWS = [
    { key: 'sfx', ico: 'sound', name: 'المؤثرات الصوتية', desc: 'أصوات النرد والأبواب والبطاقات.', type: 'toggle' },
    { key: 'look', ico: 'house', name: 'شكل اللوح', desc: 'القصر بأثاثه الكامل، أو اللوح المرسوم الخفيف.', type: 'choice',
      opts: [{ v: 'mansion', label: 'مع أثاث' }, { v: 'flat', label: 'بدون أثاث' }] },
    { key: 'labels', ico: 'label', name: 'أسماء الغرف على اللوح', desc: 'إظهار اسم كل غرفة فوقها.', type: 'toggle' },
    { key: 'follow', ico: 'camera', name: 'تتبّع الكاميرا', desc: 'تتحرك الكاميرا وحدها مع صاحب الدور.', type: 'toggle' },
    { key: 'angle', ico: 'camera', name: 'زاوية الكاميرا', desc: 'كلما ارتفعت الزاوية بانت تفاصيل الغرف أكثر.', type: 'choice',
      opts: [{ v: 'top', label: 'من فوق' }, { v: 'tilt', label: 'مائلة' }, { v: 'low', label: 'منخفضة' }] },
    { key: 'cutscene', ico: 'film', name: 'مشهد إعادة التمثيل', desc: 'يُعرض عند كل اقتراح قبل الردود.', type: 'toggle' },
    { key: 'speed', ico: 'dice', name: 'إيقاع اللعب', desc: 'سرعة القطع ومدة توقّف الخصوم بين حركاتهم.', type: 'choice',
      opts: [{ v: 'slow', label: 'متمهّل' }, { v: 'normal', label: 'عادي' }, { v: 'fast', label: 'سريع' }] },
    { key: 'ui', ico: 'text', name: 'حجم الواجهة', desc: 'كبّر الأزرار والبطاقات على الشاشات الصغيرة.', type: 'choice',
      opts: [{ v: 'small', label: 'صغير' }, { v: 'normal', label: 'عادي' }, { v: 'large', label: 'كبير' }] },
    { key: 'quality', ico: 'grid', name: 'جودة الرسم', desc: 'قلّلها إذا كانت حركة اللوح غير سلسة على جهازك.', type: 'choice',
      opts: [{ v: 'auto', label: 'تلقائي' }, { v: 'high', label: 'عالية' }, { v: 'balanced', label: 'متوازنة' }, { v: 'fast', label: 'سريعة' }] },
  ];

  function openSettings() { renderSettings(); show('#m-settings-screen'); }

  function renderSettings() {
    const box = $('#m-settings-list'); box.innerHTML = '';
    const cur = api().settings();
    for (const row of SETTING_ROWS) {
      const value = row.key === 'look' ? api().look() : cur[row.key];
      const r = el('div', 'm-row');
      r.innerHTML = `<span class="m-row-ico">${icon(row.ico)}</span>
        <span class="m-row-txt"><b>${row.name}</b><i>${row.desc}</i></span>`;
      const ctl = el('div', 'm-row-ctl');
      if (row.type === 'toggle') {
        const t = el('button', 'm-switch' + (value ? ' on' : ''), '<span></span>');
        t.setAttribute('role', 'switch');
        t.setAttribute('aria-checked', value ? 'true' : 'false');
        t.setAttribute('aria-label', row.name);
        t.onclick = () => { click(); api().set(row.key, !value); renderSettings(); };
        ctl.appendChild(t);
      } else {
        for (const o of row.opts) {
          const b = el('button', 'm-seg' + (o.v === value ? ' sel' : ''), o.label);
          if (row.key === 'look' && o.v === 'mansion' && !api().lookAvailable()) {
            b.disabled = true;
            b.title = 'يحتاج ملفات القصر بجانب اللعبة';
          }
          b.onclick = () => {
            click();
            if (row.key === 'look') api().setLook(o.v); else api().set(row.key, o.v);
            renderSettings();
          };
          ctl.appendChild(b);
        }
      }
      r.appendChild(ctl);
      box.appendChild(r);
    }
    const danger = el('div', 'm-row m-row-danger');
    danger.innerHTML = `<span class="m-row-ico">${icon('trash')}</span>
      <span class="m-row-txt"><b>محو السجل</b><i>يمسح ملفات القضايا والإحصائيات من هذا الجهاز.</i></span>`;
    const wipe = el('button', 'm-seg danger', 'محو');
    let armed = false;
    wipe.onclick = () => {
      click();
      if (!armed) { armed = true; wipe.textContent = 'تأكيد المحو؟'; setTimeout(() => { armed = false; wipe.textContent = 'محو'; }, 4000); return; }
      api().clearStats();
      if (toast) toast('مُحي سجل القضايا');
      refreshHome();
      renderSettings();
    };
    danger.appendChild(el('div', 'm-row-ctl')).appendChild(wipe);
    box.appendChild(danger);
    paintIcons(box);
  }

  // ----------------------------------------------------------------- shop
  // Unlocks come from solved cases only — nothing here costs money.
  const SHOP = [
    { id: 'classic', name: 'الطقم الكلاسيكي', desc: 'ألوان اللوحات الأصلية.', need: 0, kind: 'skin' },
    { id: 'noir', name: 'طقم الأبيض والأسود', desc: 'لقطات تحقيق قديمة.', need: 0, kind: 'skin' },
    { id: 'warm', name: 'الطقم الدافئ', desc: 'ضوء مصابيح الغاز.', need: 1, kind: 'skin' },
    { id: 'brass', name: 'قطع نحاسية', desc: 'قطع لامعة على اللوح.', need: 3, kind: 'soon' },
    { id: 'noirboard', name: 'لوح ليلي', desc: 'ألوان داكنة للوح الكلاسيكي.', need: 5, kind: 'soon' },
    { id: 'cases', name: 'ملف قضايا إضافي', desc: 'قضايا جاهزة بحلول مختلفة.', need: 8, kind: 'soon' },
  ];

  function openShop() { renderShop(); show('#m-shop-screen'); }

  function renderShop() {
    const g = $('#m-shop-grid'); g.innerHTML = '';
    const won = api().stats().won;
    for (const it of SHOP) {
      const owned = won >= it.need;
      const active = it.kind === 'skin' && state.skin === it.id;
      const c = el('button', 'm-shop-card' + (owned ? '' : ' locked') + (active ? ' on' : ''));
      const art = it.kind === 'skin' ? portrait(state.me) : (ART.bg || '');
      c.innerHTML = `
        <span class="m-shop-art" style="background-image:url(${art});filter:${it.kind === 'skin' ? skinFilter(it.id) : 'grayscale(0.6) brightness(0.7)'}"></span>
        <span class="m-shop-name">${it.name}</span>
        <span class="m-shop-desc">${it.desc}</span>
        <span class="m-shop-tag">${owned ? (it.kind === 'skin' ? (active ? icon('check') + ' مستخدم' : 'استخدم') : 'قريبًا')
          : icon('lock') + ` ${it.need} قضايا محلولة`}</span>`;
      if (owned && it.kind === 'skin') {
        c.onclick = () => { click(); state.skin = it.id; renderShop(); if (toast) toast('تم اختيار ' + it.name); };
      } else {
        c.disabled = true;
      }
      g.appendChild(c);
    }
  }

  // ---------------------------------------------------------- case files
  function openCases() { renderCases(); show('#m-cases-screen'); }

  function renderCases() {
    const st = api().stats();
    const rate = st.played ? Math.round((st.won / st.played) * 100) : 0;
    const stats = $('#m-stats');
    stats.innerHTML = [
      ['file', st.played, 'قضايا لُعبت'],
      ['trophy', st.won, 'قضايا محلولة'],
      ['badge', rate + '%', 'نسبة الحل'],
      ['dice', st.bestTurns === null ? '—' : st.bestTurns, 'أسرع حل (أدوار)'],
    ].map(([ic, n, l]) => `<div class="m-stat">${icon(ic)}<b>${n}</b><i>${l}</i></div>`).join('');

    const log = $('#m-case-log'); log.innerHTML = '';
    if (!st.log.length) {
      log.appendChild(el('div', 'm-empty', 'لا توجد قضايا بعد — ابدأ تحقيقك الأول.'));
      return;
    }
    for (const c of st.log) {
      const r = el('div', 'm-case' + (c.won ? ' won' : ''));
      r.innerHTML = `
        <span class="m-case-mark">${icon(c.won ? 'trophy' : 'file')}</span>
        <span class="m-case-txt">
          <b>${c.won ? 'قضية محلولة' : (c.winner ? 'حلّها ' + c.winner : 'أُغلقت بلا حل')}</b>
          <i>${c.solution[0]} — ${c.solution[1]} — ${c.solution[2]}</i>
        </span>
        <span class="m-case-turns">${c.turns} دور</span>`;
      log.appendChild(r);
    }
  }

  // ----------------------------------------------------------- mode/scene/type
  function lockedCard(node, why) {
    node.disabled = true;
    node.appendChild(el('span', 'm-lock', icon('lock')));
    node.title = why || 'غير متاح بعد';
  }

  function buildMode() {
    const g = $('#m-mode-grid'); g.innerHTML = '';
    for (const m of MODES) {
      const c = el('button', 'm-card',
        `<span class="m-card-ico">${icon(m.ico)}</span>
         <div class="m-card-name">${m.name}</div>
         <div class="m-card-desc">${m.desc}</div>`);
      if (m.lock) lockedCard(c, m.lock);
      else c.onclick = () => { click(); state.mode = m.id; show('#m-scene'); };
      g.appendChild(c);
    }
  }

  function buildScene() {
    const g = $('#m-scene-grid'); g.innerHTML = '';
    for (const s of SCENES) {
      const c = el('button', 'm-scene' + (s.lock ? ' soon' : ''),
        `<div class="m-scene-art" style="background-image:url(${ART[s.art] || ''})"></div>
         ${s.lock ? `<div class="m-scene-wash" style="background:${s.tint}"></div>
         <div class="m-scene-seal">${icon('lock')}</div>` : ''}
         <div class="m-scene-tape"></div>
         <div class="m-scene-name">${s.name}</div>
         <div class="m-scene-note">${s.note}</div>`);
      if (s.lock) lockedCard(c, 'قريبًا');
      else c.onclick = () => { click(); state.scene = s.id; show('#m-type'); };
      g.appendChild(c);
    }
  }

  function buildType() {
    const g = $('#m-type-grid'); g.innerHTML = '';
    for (const t of TYPES) {
      const c = el('button', 'm-card m-card-tint-' + t.tint,
        `<div class="m-card-name">${t.name}</div>
         <div class="m-card-desc">${t.desc}</div>`);
      if (t.lock) lockedCard(c, 'قريبًا');
      else c.onclick = () => { click(); state.type = t.id; openLobby(); };
      g.appendChild(c);
    }
  }

  // ---------------------------------------------------------------- lobby
  function openLobby() {
    const sc = SCENES.find(s => s.id === state.scene);
    const ty = TYPES.find(t => t.id === state.type);
    $('#m-lobby-scene').textContent = sc ? sc.name : '';
    $('#m-lobby-type').textContent = ty ? ty.name : '';
    renderLobby();
    show('#m-lobby');
  }

  function renderLobby() {
    const g = $('#m-roster'); g.innerHTML = '';

    // your own detective leads the line-up, with a wide Edit under them
    const mine = suspect(state.me);
    const me = el('div', 'm-slot me',
      `<div class="m-slot-top"></div>
       <div class="m-slot-fig" style="--glow:${mine.color}"><img src="${portrait(state.me)}" alt=""></div>
       <div class="m-slot-name">${playerName()}</div>
       <div class="m-slot-bar" style="background:${mine.color}"></div>
       <button class="m-mini wide" title="تغيير الشخصية">تعديل ✎</button>`);
    me.querySelector('.m-mini').onclick = () => { click(); openChars(null, '#m-lobby'); };
    g.appendChild(me);

    // each rival can be dropped from the game with the X above their head
    state.seats.forEach((seat, i) => {
      const s = suspect(seat.id);
      const node = el('div', 'm-slot' + (seat.on ? '' : ' off'),
        `<div class="m-slot-top"><button class="m-mini x" title="${seat.on ? 'استبعاد' : 'إضافة'}">${seat.on ? '✕' : '＋'}</button></div>
         <div class="m-slot-fig" style="--glow:${s.color}"><img src="${portrait(seat.id)}" alt=""></div>
         <div class="m-slot-name">${s.short}</div>
         <div class="m-slot-bar" style="background:${s.color}"></div>
         <button class="m-mini e" title="تغيير الشخصية">✎</button>`);
      node.querySelector('.m-mini.x').onclick = () => {
        click();
        const on = state.seats.filter(x => x.on).length;
        if (seat.on && on <= 2) { if (toast) toast('لازم خصمان على الأقل'); return; }
        if (!seat.on && on >= 5) { if (toast) toast('الحد الأقصى ٥ خصوم'); return; }
        seat.on = !seat.on;
        renderLobby();
      };
      node.querySelector('.m-mini.e').onclick = () => { click(); openChars(i, '#m-lobby'); };
      g.appendChild(node);
    });

    const av = $('#m-lobby-avatar'); if (av) av.src = portrait(state.me);
    const un = $('#m-lobby-user'); if (un) un.textContent = playerName();
    const prof = $('#m-lobby-profile');
    if (prof) prof.onclick = () => { click(); openChars(null, '#m-lobby'); };
    paintIcons(prof);

    // Arabic-Indic digits keep the count from being reordered next to the label
    const n = state.seats.filter(s => s.on).length + 1;
    const ar = String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
    $('#m-diff-label').textContent = `${DIFFS[state.diff].label} — ${ar} لاعبين`;
  }

  function playerName() {
    try { return localStorage.getItem('qasr.name') || 'المحقّق'; } catch (e) { return 'المحقّق'; }
  }

  function stepDiff(d) {
    state.diff = (state.diff + d + DIFFS.length) % DIFFS.length;
    renderLobby();
  }

  // ------------------------------------------------------- character sheet
  // seatIndex === null edits the human, otherwise that opponent slot.
  function openChars(seatIndex, from) {
    state.editing = seatIndex;
    state.charsFrom = from || '#m-home';
    renderChars();
    show('#m-chars');
  }

  function currentEditId() {
    return state.editing === null ? state.me : state.seats[state.editing].id;
  }

  function renderChars() {
    const cur = currentEditId();
    const s = suspect(cur);
    $('#m-chars-name').textContent = s.name;
    const big = $('#m-chars-big');
    big.src = portrait(cur);
    big.style.filter = skinFilter(state.skin);

    const list = $('#m-chars-list'); list.innerHTML = '';

    // playable row
    list.appendChild(el('div', 'm-chars-group', 'قصر تيودور'));
    const row = el('div', 'm-chars-row');
    const taken = usedIds();
    for (const sus of SUSPECTS) {
      const isCur = sus.id === cur;
      const used = taken.has(sus.id) && !isCur;
      // a suspect another seat holds stays clickable — picking it swaps the two
      const c = el('button', 'm-char' + (isCur ? ' sel' : ''),
        `<img src="${portrait(sus.id)}" alt=""><span>${sus.name}${used ? ' ⇄' : ''}</span>`);
      if (used) c.title = 'مأخوذة — سيتم التبديل';
      c.onclick = () => { click(); pickChar(sus.id); };
      row.appendChild(c);
    }
    list.appendChild(row);

    // how the piece itself looks on the board
    list.appendChild(el('div', 'm-chars-group', 'شكل القطعة على اللوح'));
    const styles = api().pawnStyles ? api().pawnStyles() : [];
    const curStyle = api().pawnStyle ? api().pawnStyle() : 'simple';
    const skins = el('div', 'm-skins');
    for (const st of styles) {
      const b = el('button', 'm-pawn' + (st.id === curStyle ? ' sel' : '') + (st.available ? '' : ' off'),
        `<span class="m-pawn-art" data-pawn="${st.id}"></span><span>${st.name}</span>`);
      if (!st.available) {
        b.disabled = true;
        b.title = 'يحتاج ملفات اللعبة الأصلية بجانب الصفحة';
        b.appendChild(el('span', 'm-pawn-lock', icon('lock')));
      } else {
        b.onclick = () => { click(); api().setPawnStyle(st.id); renderChars(); };
      }
      skins.appendChild(b);
    }
    list.appendChild(skins);

    // locked casts from the other crime scenes
    for (const sc of SCENES.filter(x => x.lock)) {
      list.appendChild(el('div', 'm-chars-group locked', sc.name + ' ' + icon('lock')));
      const r = el('div', 'm-chars-row');
      for (const sus of SUSPECTS.slice(0, 6)) {
        const c = el('button', 'm-char', `<img src="${portrait(sus.id)}" alt=""><span>${sus.short}</span>`);
        c.disabled = true;
        r.appendChild(c);
      }
      list.appendChild(r);
    }
  }

  function skinFilter(id) {
    if (id === 'noir') return 'grayscale(1) contrast(1.12)';
    if (id === 'warm') return 'sepia(0.45) saturate(1.25)';
    return 'none';
  }

  function pickChar(id) {
    if (state.editing === null) {
      // if an opponent already holds it, hand them the human's old suspect
      const seat = state.seats.find(s => s.id === id);
      if (seat) seat.id = state.me;
      state.me = id;
    } else {
      if (id === state.me) return;
      const other = state.seats.find(s => s.id === id);
      const mySeat = state.seats[state.editing];
      if (other) other.id = mySeat.id;
      mySeat.id = id;
    }
    renderChars();
  }

  // ---------------------------------------------------------------- wiring
  let click = () => {};

  function init(opts) {
    click = opts.click || (() => {});
    toast = opts.toast;
    onStart = opts.onStart;
    onLeave = opts.onLeave;

    paintIcons(document);
    buildTitle();
    buildHome();
    buildMode();
    buildScene();
    buildType();

    for (const b of document.querySelectorAll('.m-back[data-back]')) {
      b.onclick = () => { click(); show(b.dataset.back); };
    }
    $('#m-chars-back').onclick = () => {
      click();
      if (state.charsFrom === '#m-lobby') renderLobby();
      if (state.charsFrom === '#m-home') { const av = $('#m-avatar'); if (av) av.src = portrait(state.me); }
      show(state.charsFrom);
    };
    $('#m-diff-prev').onclick = () => { click(); stepDiff(-1); };
    $('#m-diff-next').onclick = () => { click(); stepDiff(1); };
    $('#m-lobby-start').onclick = () => {
      click();
      onStart({
        suspect: state.me,
        bots: state.seats.filter(s => s.on).length,
        botSuspects: state.seats.filter(s => s.on).map(s => s.id),
        diff: DIFFS[state.diff].id,
        skin: state.skin,
      });
    };
  }

  function enter() {
    $('#m-lobby').dataset.seen = '';
    refreshHome();
    show('#m-title');
  }

  global.MansionMenu = { init, enter, show, state, skinFilter, icon, paintIcons };
})(typeof window !== 'undefined' ? window : globalThis);
