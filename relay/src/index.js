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

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
let GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
let modelPicked = !!process.env.GEMINI_MODEL; // if you set GEMINI_MODEL yourself we never override it
const GEMINI_BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com";
const SYSTEM = "You are Horizen AI, the built-in assistant of the eventhorizen browser. Answer questions about anything clearly and accurately. " +
  "Be concise by default and use short paragraphs or simple lists when they help. If you are not sure about something, say so rather than guessing. " +
  "You cannot browse the web or see the page the user has open.";
const aiHits = new Map(); // token -> recent request times (simple per-minute limit)


// Ask Google which models this key can use and pick a current, stable "flash" one (used when the default name is rejected).
async function pickModel() {
  const r = await fetch(`${GEMINI_BASE}/v1beta/models?pageSize=200`, { headers: { "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return "";
  const j = await r.json().catch(() => ({}));
  const names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n) || /^gemini-flash(-lite)?-latest$/.test(n));
  const ver = (n) => { const m = n.match(/^gemini-([\d.]+)-flash(-lite)?$/); return m ? parseFloat(m[1]) - (m[2] ? 0.01 : 0) : 0; };
  names.sort((a, b) => ver(b) - ver(a));
  return names.find((n) => !/lite/.test(n)) || names[0] || "";
}
let think = process.env.GEMINI_THINKING !== "on"; // by default switch the model's slow "thinking" step off for fast answers
// When one model is overloaded (503) or stalls, try the next. The one that works moves to the front of the line.
const FALLBACKS = (process.env.GEMINI_FALLBACKS || "gemini-flash-lite-latest,gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash").split(",").map((x) => x.trim()).filter(Boolean);
let order = [...new Set([GEMINI_MODEL, ...FALLBACKS])];
const ATTEMPT_MS = 15000;

async function tryModel(model, contents, outer, withThink) {
  const ac = new AbortController();
  const onOuter = () => ac.abort();
  if (outer) { if (outer.aborted) ac.abort(); else outer.addEventListener("abort", onOuter, { once: true }); }
  const tm = setTimeout(() => ac.abort(), ATTEMPT_MS);
  try {
    return await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", signal: ac.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM }] }, contents,
        generationConfig: { maxOutputTokens: 2048, ...(withThink ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
    });
  } finally { clearTimeout(tm); if (outer) outer.removeEventListener("abort", onOuter); }
}

async function callGemini(contents, outer) {
  let last = null, lastErr = null, tried = 0;
  for (const model of [...order]) {
    if (outer && outer.aborted) break;
    if (tried++ >= 4) break;
    try {
      let r = await tryModel(model, contents, outer, think);
      if (r.status === 400 && think) { think = false; console.log("model rejected thinking setting; retrying without it"); r = await tryModel(model, contents, outer, false); }
      if (r.ok) {
        if (order[0] !== model) { order = [model, ...order.filter((m) => m !== model)]; GEMINI_MODEL = model; console.log("using Gemini model", model); }
        return r;
      }
      last = r; lastErr = null;
      console.log("model", model, "gave status", r.status);
      if (r.status === 404) { order = order.filter((m) => m !== model); continue; }   // name doesn't exist for this key
      if (r.status === 429 || r.status >= 500) continue;                              // busy or broken: next model
      return r;                                                                        // 400/403: key problem, retrying won't help
    } catch (e) { lastErr = e; console.log("model", model, "no answer in time:", e && e.name); }
  }
  if (!order.length && !modelPicked) {                                                // every name was unknown: ask Google what exists
    modelPicked = true;
    const m = await pickModel().catch(() => "");
    if (m) { GEMINI_MODEL = m; order = [m]; console.log("using Gemini model", m); return callGemini(contents, outer); }
  }
  if (last) return last;
  throw lastErr || new Error("no model answered");
}

const fails = new Map();
const ipOf = (req) => (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "600" };
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
    if (p === "/api/ai" && req.method === "POST") {
      const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!safeEq(auth, TOKEN)) return json(res, 401, { error: "Please sign in again." });
      if (!GEMINI_KEY) return json(res, 503, { error: "Horizen AI is not set up yet: add GEMINI_API_KEY on the server." });
      const now = Date.now(), hits = (aiHits.get(TOKEN) || []).filter((t) => now - t < 60000);
      if (hits.length >= 15) return json(res, 429, { error: "Slow down a little: try again in a few seconds." });
      hits.push(now); aiHits.set(TOKEN, hits);
      let body; try { body = JSON.parse(await readBody(req, 60000)); } catch { return json(res, 400, { error: "Bad request." }); }
      const msgs = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
      const contents = msgs.filter((m) => m && typeof m.text === "string" && m.text.trim())
        .map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 4000) }] }));
      if (!contents.length || contents[contents.length - 1].role !== "user") return json(res, 400, { error: "Nothing to answer." });
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 55000); const t0 = Date.now();
      console.log("ai: question received, asking model", GEMINI_MODEL);
      try {
        const r = await callGemini(contents, ac.signal);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const m = (j.error && j.error.message) || ("Gemini error " + r.status);
          console.log("gemini error", r.status, m.slice(0, 300));
          if (r.status === 503 || r.status === 500) return json(res, 503, { error: "Google's AI is overloaded right now. Try again in a minute." });
          if (r.status === 429) return json(res, 429, { error: "Horizen AI is busy right now (free quota). Try again in a minute." });
          if (r.status === 400 || r.status === 403) return json(res, 502, { error: "The Gemini key was rejected or the model name is wrong. Check GEMINI_API_KEY and GEMINI_MODEL on the server." });
          if (r.status === 404) return json(res, 502, { error: "No working Gemini model was found for this key. Check the key in AI Studio, or set GEMINI_MODEL on the server." });
          return json(res, 502, { error: "Horizen AI could not answer (" + r.status + ")." });
        }
        console.log("ai: answered by", GEMINI_MODEL, "in", Date.now() - t0, "ms");
        const cand = j.candidates && j.candidates[0];
        const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((x) => x.text || "").join("") : "";
        if (!text) return json(res, 200, { text: j.promptFeedback && j.promptFeedback.blockReason ? "I can't help with that one." : "I don't have an answer for that." });
        return json(res, 200, { text });
      } catch (e) {
        console.log("ai: failed after", Date.now() - t0, "ms:", e && e.name, e && e.message);
        return json(res, 504, { error: e && e.name === "AbortError" ? "Horizen AI took too long. Try again." : "Could not reach Gemini." });
      } finally { clearTimeout(tm); }
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

server.listen(PORT, "0.0.0.0", () => console.log("relay listening on " + PORT + (PASSWORD ? "" : " (PASSWORD not set: locked)") + " | Gemini key " + (GEMINI_KEY ? "set" : "NOT set") + " | model " + GEMINI_MODEL));
process.on("SIGTERM", () => { server.close(); process.exit(0); });
