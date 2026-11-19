// Orsem w Khammen — tiny realtime server.
// Serves the game page and relays "presence" between players in the same room.
// Each player's presence is one small JSON object (max 4 KB); the server keeps the
// latest one per player and forwards changes to everyone else in that room.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const MAX_PRESENCE = 4096;      // bytes of JSON per player
const MAX_PER_ROOM = 16;        // players per room
const MAX_MSGS_PER_SEC = 45;    // per connection
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const ID_RE = /^[a-z0-9]{8,24}$/;

const PUB = path.join(__dirname, "public");

function buildPage() {
  const game = fs.readFileSync(path.join(PUB, "game.html"), "utf8");
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
    'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>' +
    '<script src="/room-shim.js"></script></head><body>' + game + "</body></html>";
}
let page = buildPage();
if (process.env.NODE_ENV !== "production") {
  fs.watch(path.join(PUB, "game.html"), () => { try { page = buildPage(); } catch (_) {} });
}
const shim = fs.readFileSync(path.join(PUB, "room-shim.js"), "utf8");

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  const sec = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { ...sec, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(page);
  }
  if (url === "/room-shim.js") {
    res.writeHead(200, { ...sec, "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(shim);
  }
  if (url === "/healthz") { res.writeHead(200, sec); return res.end("ok"); }
  res.writeHead(404, { ...sec, "Content-Type": "text/plain" });
  res.end("Not found");
});

/** rooms: name -> Map(peerId -> { ws, presence, raw }) */
const rooms = new Map();

function send(ws, obj) { if (ws.readyState === 1) ws.send(typeof obj === "string" ? obj : JSON.stringify(obj)); }
function broadcast(room, obj, exceptPeer) {
  const r = rooms.get(room); if (!r) return;
  const msg = JSON.stringify(obj);
  for (const [id, m] of r) if (id !== exceptPeer) send(m.ws, msg);
}
function leave(ws) {
  if (!ws.room) return;
  const r = rooms.get(ws.room);
  if (r && r.get(ws.peer) && r.get(ws.peer).ws === ws) {
    r.delete(ws.peer);
    broadcast(ws.room, { t: "left", peer: ws.peer });
    if (!r.size) rooms.delete(ws.room);
  }
  ws.room = null;
}

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
wss.on("connection", (ws) => {
  ws.alive = true; ws.room = null; ws.peer = null; ws.win = Date.now(); ws.count = 0;
  ws.on("pong", () => { ws.alive = true; });
  ws.on("message", (buf) => {
    const now = Date.now();
    if (now - ws.win > 1000) { ws.win = now; ws.count = 0; }
    if (++ws.count > MAX_MSGS_PER_SEC) return;            // drop floods
    let m; try { m = JSON.parse(buf.toString()); } catch (_) { return; }
    if (!m || typeof m !== "object") return;

    if (m.t === "join") {
      if (typeof m.room !== "string" || !ROOM_RE.test(m.room) || typeof m.id !== "string" || !ID_RE.test(m.id)) {
        return send(ws, { t: "error", code: "invalid_argument" });
      }
      leave(ws);
      let r = rooms.get(m.room);
      if (!r) { r = new Map(); rooms.set(m.room, r); }
      const old = r.get(m.id);
      if (!old && r.size >= MAX_PER_ROOM) return send(ws, { t: "error", code: "limit_reached" });
      if (old && old.ws !== ws) { old.ws.room = null; try { old.ws.close(4000, "replaced"); } catch (_) {} }
      ws.room = m.room; ws.peer = m.id;
      const entry = { ws, presence: old ? old.presence : {}, raw: old ? old.raw : "{}" };
      r.set(m.id, entry);
      const peers = [];
      for (const [id, e] of r) peers.push({ peer: id, presence: e.presence });
      send(ws, { t: "joined", room: m.room, peer: m.id, peers });
      broadcast(m.room, { t: "p", peer: m.id, presence: entry.presence }, m.id);
      return;
    }
    if (m.t === "presence") {
      if (!ws.room) return;
      const p = m.p;
      if (!p || typeof p !== "object" || Array.isArray(p)) return;
      const raw = JSON.stringify(p);
      if (Buffer.byteLength(raw) > MAX_PRESENCE) return send(ws, { t: "error", code: "invalid_argument" });
      const r = rooms.get(ws.room); const e = r && r.get(ws.peer);
      if (!e || e.ws !== ws || e.raw === raw) return;
      e.presence = p; e.raw = raw;
      broadcast(ws.room, { t: "p", peer: ws.peer, presence: p }, ws.peer);
      return;
    }
    if (m.t === "leave") { leave(ws); return; }
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => {});
});

// Drop dead connections every 20 s.
const beat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; try { ws.ping(); } catch (_) {}
  }
}, 20000);
wss.on("close", () => clearInterval(beat));

server.listen(PORT, () => console.log(`Orsem w Khammen running on http://localhost:${PORT}`));
