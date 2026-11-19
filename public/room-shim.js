// Gives the game the same `claude.use("room")` API it uses on claude.ai,
// backed by this site's own WebSocket server (/ws). Loaded before the game script.
(function () {
  "use strict";
  if (window.claude) return;
  function rid() { var a = "abcdefghijklmnopqrstuvwxyz0123456789", s = ""; for (var i = 0; i < 16; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function getId() {
    try { var v = sessionStorage.getItem("orsem.peer"); if (v && /^[a-z0-9]{16}$/.test(v)) return v; v = rid(); sessionStorage.setItem("orsem.peer", v); return v; }
    catch (_) { return rid(); }
  }
  function newId() { var v = rid(); try { sessionStorage.setItem("orsem.peer", v); } catch (_) {} return v; }

  function makeRoom(name) {
    var myId = getId(), ws = null, joined = false, closed = false, retry = 800;
    var mine = {}, others = new Map(), snap = Object.freeze([]);
    var peerSubs = new Set(), connSubs = new Set(), fireT = null, sendT = null, dirty = false;
    var resolveJoin, rejectJoin, joinP = new Promise(function (res, rej) { resolveJoin = res; rejectJoin = rej; });

    function rebuild() {
      var now = Date.now(), arr = [{ peer: myId, by: null, isMe: true, sameTab: true, kind: "viewer", guest: false, presence: mine, updatedAt: now }];
      others.forEach(function (v, k) { arr.push({ peer: k, by: null, isMe: false, sameTab: false, kind: "viewer", guest: false, presence: v.presence, updatedAt: v.at }); });
      snap = Object.freeze(arr);
    }
    function fire() {
      if (fireT) return;
      fireT = setTimeout(function () { fireT = null; rebuild(); var ch = { peers: snap, joined: [], left: [], updated: [] }; peerSubs.forEach(function (f) { try { f(ch); } catch (e) { console.error(e); } }); }, 0);
    }
    function setConn(v) { if (joined === v) return; joined = v; connSubs.forEach(function (f) { try { f(v); } catch (e) {} }); }
    function flush() { sendT = null; if (dirty && ws && ws.readyState === 1 && joined) { dirty = false; ws.send(JSON.stringify({ t: "presence", p: mine })); } }
    function queue() { dirty = true; if (!sendT) sendT = setTimeout(flush, 33); }

    function connect() {
      if (closed) return;
      var proto = location.protocol === "https:" ? "wss://" : "ws://";
      ws = new WebSocket(proto + location.host + "/ws");
      ws.onopen = function () { retry = 800; ws.send(JSON.stringify({ t: "join", room: name, id: myId })); };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.t === "joined") {
          others.clear();
          (m.peers || []).forEach(function (p) { if (p.peer !== myId) others.set(p.peer, { presence: Object.freeze(p.presence || {}), at: Date.now() }); });
          setConn(true); dirty = true; flush(); fire(); resolveJoin(api);
        } else if (m.t === "p") {
          if (m.peer !== myId) { others.set(m.peer, { presence: Object.freeze(m.presence || {}), at: Date.now() }); fire(); }
        } else if (m.t === "left") {
          if (others.delete(m.peer)) fire();
        } else if (m.t === "error" && !joined) {
          rejectJoin({ code: m.code || "upstream_error", message: "join refused" });
        }
      };
      ws.onclose = function (ev) {
        setConn(false); others.clear(); fire();
        if (closed) return;
        if (ev.code === 4000) myId = newId();   // same id opened in another tab
        setTimeout(connect, retry); retry = Math.min(retry * 2, 6000);
      };
      ws.onerror = function () {};
    }

    var api = Object.freeze({
      name: name,
      emit: function () { return Promise.resolve(); },
      on: function () { return function () {}; },
      presence: function (patch) {
        var next = Object.assign({}, mine);
        for (var k in patch) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }
        if (new TextEncoder().encode(JSON.stringify(next)).length > 4096) return Promise.reject({ code: "invalid_argument", message: "presence over 4 KiB" });
        mine = Object.freeze(next); queue(); fire(); return Promise.resolve();
      },
      peers: function () { return snap; },
      onPeers: function (f, onErr) { peerSubs.add(f); fire(); return function () { peerSubs.delete(f); }; },
      connected: function () { return joined; },
      onConnection: function (f) { connSubs.add(f); setTimeout(function () { f(joined); }, 0); return function () { connSubs.delete(f); }; },
      leave: function () { closed = true; peerSubs.clear(); connSubs.clear(); try { ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "leave" })); ws && ws.close(); } catch (_) {} return Promise.resolve(); }
    });
    connect();
    var to = setTimeout(function () { rejectJoin({ code: "upstream_error", message: "no answer" }); }, 10000);
    return joinP.then(function (r) { clearTimeout(to); return r; }, function (e) { clearTimeout(to); closed = true; try { ws && ws.close(); } catch (_) {} throw e; });
  }

  var room = Object.freeze({ join: makeRoom });
  window.claude = Object.freeze({ use: function (n) { return Promise.resolve(n === "room" ? room : null); } });
})();
