// ======================= ONLINE TABLES =======================
// Two jobs live here.
//
// `Room` is the wire: it talks to the little relay in server.py, which does
// nothing but keep an ordered list of messages per room and hand them back.
// It knows nothing about Cluedo, so the game's rules stay in one place.
//
// `Netplay` is the rule that makes several machines agree. Every table runs the
// SAME engine, and the engine only ever advances on a message from the relay.
// Because the relay hands the messages back in one order, and every machine
// applies them in that order, the tables cannot drift apart — nobody has to
// trust anybody else's copy of the board.
//
// Two things are decided once rather than rolled again on each machine: the
// deal, and every throw of the dice. They travel inside the messages. That is
// the whole trick; without it two tables diverge within a couple of turns.
//
// Bots: only the HOST runs them, and their moves go out as ordinary messages.
// On every other machine the engine's timers are switched off, so a bot there
// never decides anything on its own.
(function (global) {
  // Where the relay lives depends on how the page is being served, exactly as
  // the mansion's own assets do: from a page at /qasr/index.html the server
  // root is one level up; hosted, the page IS the root.
  const API = /\/qasr\//.test(location.pathname) ? '../api/' : 'api/';

  async function post(path, body) {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch (e) { throw new Error('رد غير مفهوم من الخادم'); }
    if (!r.ok) throw new Error(j && j.error ? j.error : 'تعذّر الاتصال بالخادم');
    return j;
  }

  // ---------------------------------------------------------------- the wire
  const Room = {
    code: null, seat: -1, token: null, host: false,
    since: 0, stop: false, onMessage: null, onError: null, onPeers: null,
    peers: [],

    async create(name) {
      const j = await post('room', { name: name || 'المضيف' });
      Object.assign(this, { code: j.code, seat: j.seat, token: j.token, host: true, since: 0, stop: false });
      this.listen();
      return j;
    },

    async join(code, name) {
      const j = await post('room/join', { code: String(code || '').trim().toUpperCase(), name: name || 'ضيف' });
      Object.assign(this, { code: j.code, seat: j.seat, token: j.token, host: false, since: 0, stop: false });
      this.listen();
      return j;
    },

    send(type, data) {
      if (!this.code) return Promise.resolve();
      return post('room/send', { code: this.code, token: this.token, type, data: data || {} })
        .catch(e => { if (this.onError) this.onError(e); });
    },

    // A long poll rather than a socket: it needs no extra library on the
    // server, survives every proxy, and a board game sends a handful of
    // messages a minute.
    async listen() {
      while (!this.stop && this.code) {
        try {
          const j = await post('room/poll', { code: this.code, token: this.token, since: this.since });
          if (this.stop) return;
          if (j.peers && this.onPeers) { this.peers = j.peers; this.onPeers(j.peers); }
          for (const m of j.messages || []) {
            this.since = m.n;
            if (this.onMessage) this.onMessage(m);
          }
        } catch (e) {
          if (this.stop) return;
          if (this.onError) this.onError(e);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    },

    leave() {
      this.stop = true;
      const code = this.code, token = this.token;
      this.code = null; this.token = null; this.seat = -1; this.host = false; this.peers = [];
      if (code) post('room/leave', { code, token }).catch(() => {});
    },
  };

  // ------------------------------------------------------------ the lockstep
  // Actions are the only way the engine ever moves. On your own they are
  // applied the moment you ask; online they go to the relay first and come back
  // in the same order for everyone.
  const Netplay = {
    online: false,
    game: null,
    onAction: null,          // the view may watch actions go by

    // "the driver" is whoever speaks for the engine's own continuations — the
    // steps nobody owns. On your own that is you; online it is the host.
    isDriver() { return !this.online || Room.host; },

    // May THIS machine announce this action? You always speak for your own
    // seat. The host also speaks for the bots, because it is the only machine
    // running them. Nobody ever speaks for another person.
    canSpeak(name, args) {
      if (!this.online) return true;
      const g = this.game;
      if (name === 'showCard') {
        const r = args[0];
        return !!r && (r.idx === g.mySeat || (Room.host && !r.human));
      }
      const cur = g.player();
      if (!cur) return Room.host;
      if (cur.idx === g.mySeat) return true;
      return Room.host && !cur.human;
    },

    attach(game, online) {
      this.game = game;
      this.online = !!online;
      // Off the driver nothing decides anything by itself: the engine's timers
      // are what make bots move, so they are silenced there.
      if (online && !Room.host) game.wait = () => 0;
      this.wrap(game);
    },

    detach() { this.game = null; this.online = false; },

    // Every engine entry point a player or a bot can reach is replaced by one
    // that ANNOUNCES what it is about to do. The real method is kept as `raw…`
    // and runs only when the announcement comes back in its turn.
    wrap(game) {
      const self = this;
      const w = (name, action, pack) => {
        const raw = game[name].bind(game);
        game['raw' + name] = raw;
        game[name] = function (...args) {
          if (!self.canSpeak(name, args)) return true;   // not ours to announce
          self.act(action, pack(...args));
          return true;
        };
      };
      w('rollDice', 'roll', (d1, d2) => ({
        d1: d1 >= 1 && d1 <= 6 ? d1 : 1 + Math.floor(Math.random() * 6),
        d2: d2 >= 1 && d2 <= 6 ? d2 : 1 + Math.floor(Math.random() * 6),
      }));
      w('moveTo', 'move', t => ({ ...t }));
      w('usePassage', 'passage', () => ({}));
      w('makeSuggestion', 'suggest', (suspect, weapon) => ({ suspect, weapon }));
      w('showCard', 'show', (responder, card) => ({ seat: responder.idx, card: { ...card } }));
      w('endTurn', 'end', () => ({}));

      // The engine asks the next detective to answer by calling this again and
      // again. It is reached from a view callback, so it is always deferred to
      // the next tick — that way it behaves the same whether or not the machine
      // it is running on plays the cutscene.
      const rawResp = game.processResponse.bind(game);
      game.rawprocessResponse = rawResp;
      game.processResponse = function () {
        if (!self.isDriver()) return;
        setTimeout(() => self.act('resp', {}), 0);
      };

      // An accusation calls itself back after its cutscene; only the first half
      // is announced, or the table would hear about it twice.
      const rawAcc = game.makeAccusation.bind(game);
      game.rawmakeAccusation = rawAcc;
      game.makeAccusation = function (s, wp, r, played) {
        if (played) return rawAcc(s, wp, r, played);
        if (!self.canSpeak('makeAccusation', [])) return true;
        self.act('accuse', { suspect: s, weapon: wp, room: r });
        return true;
      };
    },

    // Ask for something to happen. Offline it happens now; online it is sent
    // to the relay and happens when it comes back.
    act(action, data) {
      if (!this.game) return;
      const msg = { type: 'act', data: { action, ...(data || {}) } };
      if (!this.online) { this.apply(msg); return; }
      Room.send('act', msg.data);
    },

    // Carry out an action that has arrived in its turn.
    apply(m) {
      const g = this.game;
      if (!g || m.type !== 'act') return;
      const d = m.data || {};
      switch (d.action) {
        case 'roll':    g.rawrollDice(d.d1, d.d2); break;
        case 'move':    g.rawmoveTo(d.room ? { room: d.room } : { x: d.x, y: d.y }); break;
        case 'passage': g.rawusePassage(); break;
        case 'suggest': g.rawmakeSuggestion(d.suspect, d.weapon); break;
        case 'show':    g.rawshowCard(g.players[d.seat], d.card); break;
        case 'accuse':  g.rawmakeAccusation(d.suspect, d.weapon, d.room); break;
        case 'end':     g.rawendTurn(); break;
        case 'resp':    g.rawprocessResponse(); break;
      }
      if (this.onAction) this.onAction(d);
    },
  };

  global.Room = Room;
  global.Netplay = Netplay;
})(window);
