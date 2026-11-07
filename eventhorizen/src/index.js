// eventhorizen server: password gate + static files + Wisp relay (the "pipe" the browser engine sends traffic through).
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, extname, sep } from "node:path";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const PASSWORD = process.env.PASSWORD || "";
const PORT = parseInt(process.env.PORT || "8080", 10);
const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

// Cookie value = HMAC of a fixed label with the password as key (the password itself is never stored in the cookie).
const TOKEN = PASSWORD ? createHmac("sha256", PASSWORD).update("eventhorizen-session-v1").digest("hex") : "";
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const cookieOf = (req, name) => { const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)")); return m ? m[1] : ""; };
const authed = (req) => !!TOKEN && safeEq(cookieOf(req, "eh_auth"), TOKEN);

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
  allow_udp_streams: false,        // web traffic is TCP only
  allow_private_ips: process.env.ALLOW_PRIVATE === "1",   // keep OFF in real use: stops visitors reaching this server's internal network
  allow_loopback_ips: process.env.ALLOW_PRIVATE === "1",  // (only turned on by the local test script)
  dns_servers: ["1.1.1.1", "8.8.8.8"],
});

const MIME = { ".html": "text/html;charset=utf-8", ".js": "text/javascript;charset=utf-8", ".mjs": "text/javascript;charset=utf-8",
  ".css": "text/css;charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".map": "application/json",
  ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".txt": "text/plain;charset=utf-8" };

const MOUNTS = [["/scram/", scramjetPath], ["/libcurl/", libcurlPath], ["/baremux/", baremuxPath], ["/", publicPath]];

async function serveStatic(req, res, pathname) {
  for (const [prefix, root] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) continue; // no ../ escapes
    try {
      const st = await stat(file);
      if (!st.isFile()) continue;
      const body = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "content-type": type, "content-length": body.length,
        "cache-control": pathname === "/sw.js" ? "no-cache" : "public, max-age=300" });
      return res.end(req.method === "HEAD" ? undefined : body);
    } catch { /* try next mount */ }
  }
  res.writeHead(404, { "content-type": "text/plain;charset=utf-8" });
  res.end("Not found");
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function loginPage(res, msg, status = 200) {
  let tpl = await readFile(join(publicPath, "login.html"), "utf8");
  tpl = tpl.replace("{{MSG}}", esc(msg || ""));
  res.writeHead(status, { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
  res.end(tpl);
}
function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => { n += c.length; if (n > limit) { reject(new Error("big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

const fails = new Map(); // ip -> {n, until}  (simple brute-force brake)
const ipOf = (req) => (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();

const server = createServer(async (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("X-Robots-Tag", "noindex");
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    if (!PASSWORD) {
      res.writeHead(503, { "content-type": "text/html;charset=utf-8" });
      return res.end("<!doctype html><meta charset=utf-8><body style='font:16px system-ui;background:#05040d;color:#ecebff;padding:40px'><h2>Setup needed</h2><p>Set an environment variable named <b>PASSWORD</b> on your host, then redeploy. This page stays locked until you do.</p>");
    }
    if (p === "/healthz") { res.writeHead(200); return res.end("ok"); }
    if (p === "/logout") {
      res.writeHead(302, { "set-cookie": "eh_auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax", location: "/" });
      return res.end();
    }
    if (p === "/login" && req.method === "POST") {
      const ip = ipOf(req), f = fails.get(ip);
      if (f && f.until > Date.now()) return loginPage(res, "Too many tries. Wait a minute.", 429);
      const pw = new URLSearchParams(await readBody(req)).get("pw") || "";
      const h = (v) => createHmac("sha256", "eh-login").update(v).digest("hex");
      const ok = safeEq(h(pw), h(PASSWORD));
      if (!ok) {
        const n = (f ? f.n : 0) + 1;
        fails.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        return loginPage(res, "Wrong password.", 401);
      }
      fails.delete(ip);
      res.writeHead(302, { "set-cookie": `eh_auth=${TOKEN}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`, location: "/" });
      return res.end();
    }
    if (p === "/wallpaper.js") return serveStatic(req, res, p); // the login page needs this one file
    if (!authed(req)) return loginPage(res, "", 200);
    return serveStatic(req, res, p);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }); res.end("Server error");
  }
});

server.on("upgrade", (req, socket, head) => {
  if (authed(req) && (req.url || "").split("?")[0].endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
  else socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => console.log("eventhorizen listening on " + PORT + (PASSWORD ? "" : " (PASSWORD not set: locked)")));
process.on("SIGTERM", () => { server.close(); process.exit(0); });
