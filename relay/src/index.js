// eventhorizen relay: the small always-on server the browser engine sends its traffic through (Wisp protocol).
// It has no pages. It only (1) checks your password and hands back a token, (2) accepts Wisp WebSockets that carry that token.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const PASSWORD = process.env.PASSWORD || "";
const PORT = parseInt(process.env.PORT || "8080", 10);
const ORIGIN = process.env.ALLOWED_ORIGIN || "*";   // optional: your Firebase address, e.g. https://yourapp.web.app
const TOKEN = PASSWORD ? createHmac("sha256", PASSWORD).update("eventhorizen-relay-v1").digest("hex") : "";
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const h = (v) => createHmac("sha256", "eh-login").update(String(v)).digest("hex");

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
  allow_udp_streams: false,
  allow_private_ips: process.env.ALLOW_PRIVATE === "1",   // keep OFF in real use
  allow_loopback_ips: process.env.ALLOW_PRIVATE === "1",
  dns_servers: ["1.1.1.1", "8.8.8.8"],
});

const fails = new Map();
const ipOf = (req) => (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" };
const readBody = (req, limit = 2048) => new Promise((ok, no) => { let n = 0; const c = [];
  req.on("data", (d) => { n += d.length; if (n > limit) { no(new Error("big")); req.destroy(); } else c.push(d); });
  req.on("end", () => ok(Buffer.concat(c).toString())); req.on("error", no); });
const json = (res, code, obj) => { res.writeHead(code, { ...cors, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };

const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, "http://x").pathname;
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (p === "/healthz" || p === "/") { res.writeHead(200, { ...cors, "content-type": "text/plain" }); return res.end("ok"); }
    if (!PASSWORD) return json(res, 503, { error: "PASSWORD is not set on the server." });
    if (p === "/api/login" && req.method === "POST") {
      const ip = ipOf(req), f = fails.get(ip);
      if (f && f.until > Date.now()) return json(res, 429, { error: "Too many tries. Wait a minute." });
      let pw = ""; try { pw = JSON.parse(await readBody(req)).pw || ""; } catch {}
      if (!safeEq(h(pw), h(PASSWORD))) { const n = (f ? f.n : 0) + 1; fails.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 }); return json(res, 401, { error: "Wrong password." }); }
      fails.delete(ip);
      return json(res, 200, { token: TOKEN });
    }
    if (p === "/api/check") { const k = new URL(req.url, "http://x").searchParams.get("k") || ""; return json(res, safeEq(k, TOKEN) ? 200 : 401, { ok: safeEq(k, TOKEN) }); }
    json(res, 404, { error: "not found" });
  } catch { json(res, 500, { error: "server error" }); }
});

server.on("upgrade", (req, socket, head) => {
  try {
    // address looks like  /wisp/<token>/  (the engine needs the address to end in a slash, so the key lives in the path)
    const m = new URL(req.url, "http://x").pathname.match(/^\/wisp\/([0-9a-f]{64})\/$/);
    if (TOKEN && m && safeEq(m[1], TOKEN)) { req.url = "/wisp/"; return wisp.routeRequest(req, socket, head); }
  } catch {}
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => console.log("relay listening on " + PORT + (PASSWORD ? "" : " (PASSWORD not set: locked)")));
process.on("SIGTERM", () => { server.close(); process.exit(0); });
