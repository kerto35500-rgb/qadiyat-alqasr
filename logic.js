// ======================= GAME LOGIC =======================
(function (global) {
  const Board = global.Board;

  const SUSPECTS = [
    { id: 'crimson', name: 'الليدي قرمزية',   short: 'قرمزية', color: '#c0392b', hex: 0xc0392b },
    { id: 'saffron', name: 'العقيد زعفران',   short: 'زعفران', color: '#d4a017', hex: 0xd4a017 },
    { id: 'emerald', name: 'العمدة زمرّد',     short: 'زمرّد',  color: '#1e8449', hex: 0x1e8449 },
    { id: 'violet',  name: 'البروفيسور بنفسج', short: 'بنفسج',  color: '#7d3c98', hex: 0x7d3c98 },
    { id: 'azure',   name: 'الكابتن لازورد',   short: 'لازورد', color: '#2471a3', hex: 0x2471a3 },
    { id: 'pearl',   name: 'الدكتورة لؤلؤة',   short: 'لؤلؤة',  color: '#d5d8dc', hex: 0xd5d8dc },
  ];
  const WEAPONS = [
    { id: 'candlestick', name: 'الشمعدان',       icon: '🕯️' },
    { id: 'dagger',      name: 'الخنجر',          icon: '🗡️' },
    { id: 'pipe',        name: 'أنبوب الرصاص',    icon: '🔩' },
    { id: 'revolver',    name: 'المسدس القديم',   icon: '🔫' },
    { id: 'rope',        name: 'الحبل',           icon: '🪢' },
    { id: 'wrench',      name: 'مفتاح الربط',     icon: '🔧' },
  ];
  const ROOM_IDS = Object.keys(Board.ROOMS);

  const ALL_CARDS = [
    ...SUSPECTS.map(s => ({ cat: 'suspect', id: s.id })),
    ...WEAPONS.map(w => ({ cat: 'weapon', id: w.id })),
    ...ROOM_IDS.map(r => ({ cat: 'room', id: r })),
  ];
  const cardKey = c => c.cat + ':' + c.id;
  const cardName = c => c.cat === 'suspect' ? SUSPECTS.find(s => s.id === c.id).name
    : c.cat === 'weapon' ? WEAPONS.find(w => w.id === c.id).name
    : Board.ROOMS[c.id].name;

  function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ---------------- Bot knowledge ----------------
  // possible[playerIdx or 'env'][cardKey] = true/false-ish tracking
  class BotBrain {
    constructor(game, meIdx, sloppy) {
      this.game = game; this.me = meIdx; this.sloppy = sloppy;
      // holder[cardKey]: -2 unknown, -1 envelope, >=0 player index
      this.holder = {};
      // cannotHave[playerIdx] = Set(cardKey)
      this.cannotHave = game.players.map(() => new Set());
      for (const c of ALL_CARDS) this.holder[cardKey(c)] = -2;
      for (const c of game.players[meIdx].hand) this.learn(cardKey(c), meIdx);
      for (const c of game.publicCards) this.learn(cardKey(c), -3); // -3 public
    }
    learn(key, holder) {
      if (this.holder[key] === -2) this.holder[key] = holder;
      if (holder >= 0 || holder === -3) {
        // that card can't be anywhere else — fine, holder map covers it
      }
      this.deduce();
    }
    noteCannot(playerIdx, keys) { for (const k of keys) this.cannotHave[playerIdx].add(k); this.deduce(); }
    deduce() {
      // If for some category, all but one card is held by players/public => remaining is in envelope
      for (const cat of ['suspect', 'weapon', 'room']) {
        const cards = ALL_CARDS.filter(c => c.cat === cat);
        const unknown = cards.filter(c => this.holder[cardKey(c)] === -2 || this.holder[cardKey(c)] === -1);
        const known = cards.filter(c => this.holder[cardKey(c)] >= 0 || this.holder[cardKey(c)] === -3);
        if (known.length === cards.length - 1 && unknown.length === 1) this.holder[cardKey(unknown[0])] = -1;
      }
      // A card no player can have => envelope
      for (const c of ALL_CARDS) {
        const k = cardKey(c);
        if (this.holder[k] !== -2) continue;
        let possible = 0;
        for (let p = 0; p < this.game.players.length; p++) {
          if (p === this.me) continue;
          if (!this.cannotHave[p].has(k)) possible++;
        }
        if (possible === 0) this.holder[k] = -1;
      }
    }
    envelopeGuess() {
      const out = {};
      for (const cat of ['suspect', 'weapon', 'room']) {
        const known = ALL_CARDS.filter(c => c.cat === cat && this.holder[cardKey(c)] === -1);
        if (known.length === 1) out[cat] = known[0].id;
      }
      return out;
    }
    unknownIn(cat) {
      return ALL_CARDS.filter(c => c.cat === cat && this.holder[cardKey(c)] === -2).map(c => c.id);
    }
    maybeForget(rng) {
      if (!this.sloppy) return;
      if (rng() < 0.12) {
        const knowns = Object.entries(this.holder).filter(([k, v]) => v >= 0 && !this.game.players[this.me].hand.some(c => cardKey(c) === k));
        if (knowns.length) { const [k] = knowns[Math.floor(rng() * knowns.length)]; this.holder[k] = -2; }
      }
    }
  }

  // ---------------- Game ----------------
  // States mirror the studied flow: ROLL_DICE → MOVE → SUGGEST → RESPOND → REVIEW → TURN_END / ACCUSE
  class Game {
    constructor(opts) {
      this.rng = opts.rng || Math.random;
      this.emit = opts.emit || (() => {});
      const count = opts.playerCount;                 // 3..6
      const humanSuspect = opts.humanSuspect;         // suspect id
      this.difficulty = opts.difficulty || 'normal';
      // pick suspects: human's + next ones in order
      const order = [...SUSPECTS];
      const humanIdx = order.findIndex(s => s.id === humanSuspect);
      const chosen = [order[humanIdx]];
      // an explicit line-up (the mansion lobby lets you pick who the bots are)
      for (const id of (opts.suspects || [])) {
        if (chosen.length >= count) break;
        if (chosen.some(c => c.id === id)) continue;
        const s = order.find(x => x.id === id);
        if (s) chosen.push(s);
      }
      // fill any remaining seats with the next suspects in turn order
      for (let i = 1; chosen.length < count; i++) {
        const s = order[(humanIdx + i) % order.length];
        if (!chosen.some(c => c.id === s.id)) chosen.push(s);
      }
      this.players = chosen.map((s, i) => ({
        idx: i, suspect: s.id, human: i === 0, name: i === 0 ? (opts.playerName || 'أنت') : s.name,
        hand: [], eliminated: false,
        pos: { x: Board.STARTS[SUSPECTS.findIndex(x => x.id === s.id)][0], y: Board.STARTS[SUSPECTS.findIndex(x => x.id === s.id)][1] },
      }));
      // envelope
      const sus = shuffle(SUSPECTS.map(s => s.id), this.rng)[0];
      const wep = shuffle(WEAPONS.map(w => w.id), this.rng)[0];
      const room = shuffle([...ROOM_IDS], this.rng)[0];
      this.envelope = { suspect: sus, weapon: wep, room };
      const deck = shuffle(ALL_CARDS.filter(c => !(c.cat === 'suspect' && c.id === sus) && !(c.cat === 'weapon' && c.id === wep) && !(c.cat === 'room' && c.id === room)), this.rng);
      const per = Math.floor(deck.length / count);
      this.publicCards = deck.slice(per * count);
      for (let i = 0; i < count; i++) this.players[i].hand = deck.slice(i * per, (i + 1) * per);
      this.brains = this.players.map((p, i) => p.human ? null : new BotBrain(this, i, this.difficulty === 'easy'));
      this.turn = 0; this.state = 'IDLE';
      this.lastRoll = null; this.movedThisTurn = false; this.suggestion = null;
      this.leftRoomThisTurn = null;
      this.log = [];
      this.winner = null;
      this.turnCount = 0;
    }
    player() { return this.players[this.turn]; }
    suspectOf(p) { return SUSPECTS.find(s => s.id === p.suspect); }
    occupiedCorridors(exceptIdx) {
      const s = new Set();
      for (const p of this.players) if (p.idx !== exceptIdx && !p.pos.room) s.add(p.pos.x + ',' + p.pos.y);
      return s;
    }
    addLog(msg, cls) { this.log.push({ msg, cls }); this.emit('log', { msg, cls }); }

    // Every pause a bot takes runs through here, so one setting slows the whole
    // table down rather than only the walking animation.
    wait(ms, fn) { return setTimeout(fn, Math.round(ms * (this.pace || 1))); }

    startTurn() {
      if (this.winner !== null) return;
      const p = this.player();
      if (p.eliminated) { this.nextTurn(); return; }
      this.turnCount++;
      this.state = 'ROLL_DICE';
      this.movedThisTurn = false;
      this.leftRoomThisTurn = null;
      this.emit('turnStart', { player: p });
      const home = p.pulledFrom;
      p.pulledFrom = null;
      if (home && !this.samePlace(home, p.pos)) { this.returnHome(p, home, () => this.beginTurn(p)); return; }
      this.beginTurn(p);
    }

    beginTurn(p) {
      if (!p.human) this.wait(600, () => this.botTurn());
    }

    samePlace(a, b) {
      if (a.room || b.room) return a.room === b.room;
      return a.x === b.x && a.y === b.y;
    }

    // Walks a pawn back to where it stood before someone named it. The view can
    // hook onReturnHome to animate the walk; the turn waits until it is done.
    returnHome(p, home, done) {
      const blocked = this.occupiedCorridors(p.idx);
      let target = home;
      if (!home.room && blocked.has(home.x + ',' + home.y)) {
        target = Board.nearestFree(home.x, home.y, blocked) || home;
      }
      const path = Board.pathTo(
        p.pos.room ? { room: p.pos.room } : p.pos,
        target.room ? { room: target.room } : target,
        blocked);
      const wasRoom = p.pos.room;
      if (target.room) this.placeInRoom(p, target.room);
      else p.pos = { x: target.x, y: target.y };
      const where = target.room ? Board.ROOMS[target.room].name : 'مكانه في الممر';
      this.addLog(p.human
        ? `عدتَ إلى ${target.room ? Board.ROOMS[target.room].name : 'مكانك في الممر'} بعد أن جرّك الاقتراح`
        : `${this.displayName(p)} عاد إلى ${where}`, 'return');
      this.emit('returningHome', { player: p, path, from: wasRoom, to: target });
      if (this.onReturnHome) this.onReturnHome({ player: p, path }, done); else done();
    }
    nextTurn() {
      this.turn = (this.turn + 1) % this.players.length;
      if (this.players.every(pl => pl.eliminated)) { this.state = 'GAME_OVER'; this.emit('gameOver', { winner: null, envelope: this.envelope }); return; }
      this.startTurn();
    }

    canUsePassage() {
      const p = this.player();
      if (!p.pos.room) return null;
      for (const [a, b] of Board.PASSAGES) {
        if (a === p.pos.room) return b;
        if (b === p.pos.room) return a;
      }
      return null;
    }

    rollDice() {
      const d1 = 1 + Math.floor(this.rng() * 6), d2 = 1 + Math.floor(this.rng() * 6);
      this.lastRoll = { d1, d2, total: d1 + d2 };
      this.state = 'MOVE';
      const p = this.player();
      if (p.pos.room) this.leftRoomThisTurn = p.pos.room;
      const blocked = this.occupiedCorridors(p.idx);
      this.moveOptions = Board.reachable(p.pos.room ? { room: p.pos.room } : p.pos, this.lastRoll.total, blocked, this.leftRoomThisTurn);
      this.emit('diceRolled', { ...this.lastRoll, player: p, options: this.moveOptions });
      return this.lastRoll;
    }

    usePassage() {
      const dest = this.canUsePassage();
      if (!dest) return false;
      const p = this.player();
      const from = p.pos.room;
      this.placeInRoom(p, dest);
      p.pulledFrom = null;
      this.movedThisTurn = true;
      this.state = 'SUGGEST';
      this.addLog(p.human ? `استخدمتَ الممر السري من ${Board.ROOMS[from].name} إلى ${Board.ROOMS[dest].name}` : `${this.displayName(p)} استخدم الممر السري من ${Board.ROOMS[from].name} إلى ${Board.ROOMS[dest].name}`);
      this.emit('movedToRoom', { player: p, room: dest, viaPassage: true });
      return true;
    }

    placeInRoom(p, roomId) {
      const taken = new Set();
      for (const q of this.players) if (q.idx !== p.idx && q.pos.room === roomId) taken.add(q.pos.x + ',' + q.pos.y);
      const spot = Board.roomSpot(roomId, taken);
      p.pos = { room: roomId, x: spot.x, y: spot.y };
    }

    moveTo(target) { // target: {room} or {x,y}, must be in moveOptions
      const p = this.player();
      let path = null;
      if (target.room) {
        path = this.moveOptions.rooms[target.room];
        if (!path) return false;
        this.placeInRoom(p, target.room);
        p.pulledFrom = null;                 // moved by choice: this is home now
        this.movedThisTurn = true;
        this.state = 'SUGGEST';
        this.addLog(p.human ? `دخلتَ ${Board.ROOMS[target.room].name}` : `${this.displayName(p)} دخل ${Board.ROOMS[target.room].name}`);
        this.emit('moved', { player: p, path, room: target.room });
      } else {
        const opt = this.moveOptions.corridors.find(c => c.x === target.x && c.y === target.y);
        if (!opt) return false;
        p.pos = { x: target.x, y: target.y };
        p.pulledFrom = null;
        this.movedThisTurn = true;
        this.state = 'TURN_END';
        this.emit('moved', { player: p, path: opt.path, room: null });
      }
      return true;
    }

    displayName(p) { return p.human ? p.name : this.suspectOf(p).name; }

    makeSuggestion(suspectId, weaponId) {
      const p = this.player();
      const room = p.pos.room;
      if (!room || this.state !== 'SUGGEST') return false;
      this.suggestion = { by: p.idx, suspect: suspectId, weapon: weaponId, room, responses: [] };
      // pull suggested suspect into the room
      const victim = this.players.find(q => q.suspect === suspectId);
      if (victim && victim.pos.room !== room) {
        // Being named drags your pawn across the board. Remember where it was
        // standing so the pawn can walk back at the start of its own turn —
        // otherwise a player returns to find themselves somewhere they never
        // chose to be. If they get named twice, the first spot is still home.
        if (!victim.pulledFrom) victim.pulledFrom = { ...victim.pos };
        this.placeInRoom(victim, room);
        this.emit('suspectPulled', { player: victim, room });
      }
      this.addLog((p.human ? 'اقترحتَ: ' : `${this.displayName(p)} يقترح: `) + `${SUSPECTS.find(s => s.id === suspectId).name} بـ${WEAPONS.find(w => w.id === weaponId).name} في ${Board.ROOMS[room].name}`, 'suggest');
      this.emit('suggestionMade', { ...this.suggestion });
      this.state = 'RESPOND';
      this.respondIdx = (p.idx + 1) % this.players.length;
      // the view may want to play a re-enactment cutscene before anyone answers
      const go = () => this.processResponse();
      if (this.onReenact) this.onReenact({ ...this.suggestion }, go); else go();
      return true;
    }

    suggestionCards() {
      const s = this.suggestion;
      return [{ cat: 'suspect', id: s.suspect }, { cat: 'weapon', id: s.weapon }, { cat: 'room', id: s.room }];
    }

    processResponse() {
      const s = this.suggestion;
      if (this.respondIdx === s.by) {
        // nobody could disprove
        this.addLog('لا أحد استطاع دحض الاقتراح!', 'nobody');
        for (const brain of this.brains) if (brain) this.onNobodyDisproved(brain, s);
        this.emit('nobodyDisproved', { suggestion: s });
        this.state = 'TURN_END';
        const p = this.player();
        if (!p.human) this.wait(800, () => this.botAfterSuggestion(true));
        return;
      }
      const responder = this.players[this.respondIdx];
      const matching = responder.hand.filter(c => this.suggestionCards().some(sc => sc.cat === c.cat && sc.id === c.id));
      if (matching.length === 0) {
        this.addLog(responder.human ? 'لا تملك أي كرت مطابق' : `${this.displayName(responder)} لا يملك أي كرت مطابق`);
        for (const brain of this.brains) if (brain) brain.noteCannot(responder.idx, this.suggestionCards().map(cardKey));
        this.emit('cannotDisprove', { responder });
        this.respondIdx = (this.respondIdx + 1) % this.players.length;
        this.wait(700, () => this.processResponse());
        return;
      }
      // responder must show one card
      if (responder.human) {
        this.emit('chooseCardToShow', { responder, matching, suggestion: s });
      } else {
        const card = this.botPickCardToShow(responder, matching);
        this.wait(900, () => this.showCard(responder, card));
      }
    }

    botPickCardToShow(responder, matching) {
      // prefer showing a card already shown to this suggester before (least info leak)
      responder.shownTo = responder.shownTo || {};
      const by = this.suggestion.by;
      const prev = matching.find(c => (responder.shownTo[by] || []).includes(cardKey(c)));
      return prev || matching[Math.floor(this.rng() * matching.length)];
    }

    showCard(responder, card) {
      const s = this.suggestion;
      responder.shownTo = responder.shownTo || {};
      (responder.shownTo[s.by] = responder.shownTo[s.by] || []).push(cardKey(card));
      const suggester = this.players[s.by];
      // knowledge updates
      for (const brain of this.brains) {
        if (!brain) continue;
        if (brain.me === s.by) brain.learn(cardKey(card), responder.idx);
        else if (brain.me !== responder.idx) {
          // observed: responder has one of the three
          brain.observed = brain.observed || [];
          brain.observed.push({ holder: responder.idx, keys: this.suggestionCards().map(cardKey) });
          this.reprocessObservations(brain);
        }
      }
      this.addLog(responder.human ? `أظهرتَ كرتًا لـ${this.displayName(suggester)}` : (suggester.human ? `${this.displayName(responder)} أظهر لك كرتًا` : `${this.displayName(responder)} أظهر كرتًا لـ${this.displayName(suggester)}`));
      this.emit('cardShown', { responder, suggester, card: suggester.human ? card : null, hidden: !suggester.human });
      this.state = 'TURN_END';
      if (!suggester.human) this.wait(800, () => this.botAfterSuggestion(false));
    }

    reprocessObservations(brain) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const obs of (brain.observed || [])) {
          const unknown = obs.keys.filter(k => brain.holder[k] === -2 && !brain.cannotHave[obs.holder].has(k));
          const already = obs.keys.some(k => brain.holder[k] === obs.holder);
          if (already) continue;
          if (unknown.length === 1) { brain.learn(unknown[0], obs.holder); changed = true; }
        }
      }
    }

    onNobodyDisproved(brain, s) {
      // every card not held by suggester (that they didn't show) is likely envelope
      for (const sc of this.suggestionCards()) {
        const k = cardKey(sc);
        const suggesterHand = this.players[s.by].hand.map(cardKey);
        if (brain.me === s.by) {
          if (!suggesterHand.includes(k)) brain.learn(k, -1);
        } else {
          // others: cards the suggester might hold themselves — mark all other players cannot have
          for (let p = 0; p < this.players.length; p++) if (p !== s.by) brain.cannotHave[p].add(k);
          brain.deduce();
        }
      }
    }

    endTurn() {
      if (this.state !== 'TURN_END' && this.state !== 'MOVE' && this.state !== 'SUGGEST') return;
      this.suggestion = null;
      this.state = 'IDLE';
      this.emit('turnEnd', { player: this.player() });
      this.nextTurn();
    }

    makeAccusation(suspectId, weaponId, roomId) {
      // A final accusation is the biggest moment in the game, so it gets played
      // out in the room first, exactly like a suggestion does.
      if (this.onReenact && !this._accusing) {
        this._accusing = true;
        const go = () => { this._accusing = false; this.makeAccusation(suspectId, weaponId, roomId); };
        this.onReenact({ by: this.turn, suspect: suspectId, weapon: weaponId, room: roomId, accusing: true }, go);
        return;
      }
      const p = this.player();
      const e = this.envelope;
      const correct = e.suspect === suspectId && e.weapon === weaponId && e.room === roomId;
      this.addLog((p.human ? 'وجهتَ اتهامًا نهائيًا: ' : `${this.displayName(p)} يوجه اتهامًا نهائيًا: `) + `${SUSPECTS.find(s => s.id === suspectId).name} بـ${WEAPONS.find(w => w.id === weaponId).name} في ${Board.ROOMS[roomId].name}`, 'accuse');
      if (correct) {
        this.winner = p.idx; this.state = 'GAME_OVER';
        this.emit('gameOver', { winner: p, envelope: e, accusation: { suspect: suspectId, weapon: weaponId, room: roomId } });
      } else {
        p.eliminated = true;
        this.addLog(p.human ? 'الاتهام خاطئ! خرجتَ من التحقيق' : `الاتهام خاطئ! ${this.displayName(p)} خرج من التحقيق`, 'wrong');
        this.emit('accusationWrong', { player: p, accusation: { suspect: suspectId, weapon: weaponId, room: roomId } });
        const alive = this.players.filter(q => !q.eliminated);
        if (alive.length === 1) {
          this.winner = alive[0].idx; this.state = 'GAME_OVER';
          this.emit('gameOver', { winner: alive[0], envelope: e, lastStanding: true });
        } else if (alive.length === 0) {
          this.state = 'GAME_OVER';
          this.emit('gameOver', { winner: null, envelope: e });
        } else this.nextTurn();
      }
    }

    // ---------------- BOT TURN ----------------
    botTurn() {
      const p = this.player(); const brain = this.brains[p.idx];
      // a bot routine can only ever run for a bot — never stall the game on it
      if (!brain) { if (!p.human) this.endTurn(); return; }
      brain.maybeForget(this.rng);
      // accuse if certain
      const guess = brain.envelopeGuess();
      if (guess.suspect && guess.weapon && guess.room) {
        this.wait(900, () => this.makeAccusation(guess.suspect, guess.weapon, guess.room));
        return;
      }
      // choose target room: unknown rooms first, by distance
      const unknownRooms = brain.unknownIn('room');
      const dists = Board.roomDistances(p.pos.room ? { room: p.pos.room } : p.pos, this.occupiedCorridors(p.idx));
      let targets = (unknownRooms.length ? unknownRooms : ROOM_IDS).filter(r => r !== this.leftRoomThisTurn);
      targets.sort((a, b) => (dists[a] ?? 99) - (dists[b] ?? 99));
      this.botTargetRoom = targets[0];
      // secret passage shortcut
      const passageDest = this.canUsePassage();
      if (passageDest && (unknownRooms.includes(passageDest) || (unknownRooms.length === 0 && passageDest === this.botTargetRoom))) {
        this.wait(800, () => { this.usePassage(); this.wait(900, () => this.botSuggest()); });
        return;
      }
      this.wait(700, () => {
        this.rollDice();
        this.wait(1100, () => this.botMove());
      });
    }
    botMove() {
      const p = this.player(); const brain = this.brains[p.idx];
      if (!brain) { if (!p.human) this.endTurn(); return; }
      const opts = this.moveOptions;
      // enter target room if reachable, else any unknown room, else move closer
      const roomKeys = Object.keys(opts.rooms);
      let pick = roomKeys.includes(this.botTargetRoom) ? this.botTargetRoom : roomKeys.find(r => brain.unknownIn('room').includes(r));
      if (!pick && roomKeys.length && brain.unknownIn('room').length === 0) pick = roomKeys[0];
      if (pick) {
        this.moveTo({ room: pick });
        this.wait(1000, () => this.botSuggest());
        return;
      }
      // move to corridor tile minimizing distance to target room
      let best = null, bestD = Infinity;
      for (const c of opts.corridors) {
        const d = Board.roomDistances({ x: c.x, y: c.y }, null)[this.botTargetRoom] ?? 99;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) this.moveTo({ x: best.x, y: best.y });
      this.wait(1200, () => this.endTurn());
    }
    botSuggest() {
      const p = this.player(); const brain = this.brains[p.idx];
      if (!brain) { if (!p.human) this.endTurn(); return; }
      const room = p.pos.room;
      const unkS = brain.unknownIn('suspect'), unkW = brain.unknownIn('weapon');
      // suggest unknowns to gain info; if none unknown use a known-own card to bluff
      const susp = unkS.length ? unkS[Math.floor(this.rng() * unkS.length)]
        : (brain.envelopeGuess().suspect || SUSPECTS[Math.floor(this.rng() * 6)].id);
      const weap = unkW.length ? unkW[Math.floor(this.rng() * unkW.length)]
        : (brain.envelopeGuess().weapon || WEAPONS[Math.floor(this.rng() * 6)].id);
      this.makeSuggestion(susp, weap);
    }
    botAfterSuggestion() {
      const p = this.player(); const brain = this.brains[p.idx];
      if (!brain) { if (!p.human) this.endTurn(); return; }
      const guess = brain.envelopeGuess();
      if (guess.suspect && guess.weapon && guess.room) {
        this.wait(900, () => this.makeAccusation(guess.suspect, guess.weapon, guess.room));
      } else this.wait(700, () => this.endTurn());
    }
  }

  global.GameCore = { Game, SUSPECTS, WEAPONS, ROOM_IDS, ALL_CARDS, cardKey, cardName };
})(typeof window !== 'undefined' ? window : globalThis);
