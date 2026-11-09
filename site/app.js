(function () {
  "use strict";
  var SEARCH = "https://duckduckgo.com/?q=";
  var RELAY = String(window.EH_RELAY || "").replace(/\/+$/, "");
  function getTok() { try { return localStorage.getItem("eh_tok") || ""; } catch (e) { return ""; } }
  function setTok(v) { try { if (v) localStorage.setItem("eh_tok", v); else localStorage.removeItem("eh_tok"); } catch (e) {} }
  var tabs = [], cur = null, seq = 0;
  function $(s) { return document.querySelector(s); }
  var strip = $("#strip"), view = $("#view"), addr = $("#addr"), ntp = $("#ntp"), loadBar = $("#load"), pop = $("#pop");

  /* ---------- engine start-up (once) ---------- */
  var engine = null;
  function startEngine() {
    if (engine) return engine;
    engine = (async function () {
      if (!navigator.serviceWorker) throw new Error("This browser can't run the engine (needs https and service workers).");
      var sj = $scramjetLoadController();
      var ctl = new sj.ScramjetController({
        files: { wasm: "/scram/scramjet.wasm.wasm", all: "/scram/scramjet.all.js", sync: "/scram/scramjet.sync.js" }
      });
      await ctl.init();                       // must run BEFORE the service worker starts (it creates the settings database)
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      var conn = new BareMux.BareMuxConnection("/baremux/worker.js");
      var wisp = RELAY.replace(/^http/i, "ws") + "/wisp/" + encodeURIComponent(getTok()) + "/";
      await conn.setTransport("/libcurl/index.mjs", [{ websocket: wisp }]);
      return ctl;
    })();
    engine.catch(function () { engine = null; });
    return engine;
  }

  /* ---------- helpers ---------- */
  function toUrl(v) {
    v = (v || "").trim(); if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (!/\s/.test(v) && /^[^\s\/]+\.[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(v)) return "https://" + v;
    return SEARCH + encodeURIComponent(v);
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function setBg() { window.EH_BG = window.EH_BG || {}; window.EH_BG.skip = (cur && cur.url) ? 4 : 1; }
  function loading(on) { loadBar.classList.toggle("on", !!on); }
  function showError(t, msg) {
    t.title = "Could not start";
    ntp.classList.remove("hidden");
    var e = $("#err"); if (e) e.textContent = msg;
  }

  function paint(t) {
    var h = host(t.url);
    var f = t.el.querySelector(".fav"), ttl = t.el.querySelector(".ttl");
    f.textContent = h ? h.charAt(0).toUpperCase() : "◉";
    f.style.background = h ? "hsl(" + hue(h) + ",60%,42%)" : "transparent";
    ttl.textContent = t.title || h || "New Tab";
    if (t === cur) {
      if (document.activeElement !== addr) addr.value = t.url;
      ntp.classList.toggle("hidden", !!t.url);
      if (t.fr) t.fr.frame.style.display = t.url ? "block" : "none";
    }
  }

  /* ---------- tabs ---------- */
  async function ensureFrame(t) {
    if (t.fr) return t.fr;
    var ctl = await startEngine();
    var fr = ctl.createFrame();
    var f = fr.frame;
    f.setAttribute("allow", "fullscreen; autoplay; clipboard-write; gamepad; picture-in-picture");
    f.addEventListener("load", function () {
      if (t === cur) loading(false);
      try { var ti = f.contentWindow.document.title; if (ti) { t.title = ti; paint(t); } } catch (e) {}
    });
    fr.addEventListener("urlchange", function (ev) {
      var u = ev && ev.url ? String(ev.url) : "";
      if (u && /^https?:/i.test(u)) { t.url = u; paint(t); }
    });
    view.appendChild(f);
    t.fr = fr;
    return fr;
  }
  async function go(t, url) {
    t.url = url; t.title = ""; paint(t); setBg();
    if (t === cur) loading(true);
    try {
      var fr = await ensureFrame(t);
      fr.frame.style.display = t === cur ? "block" : "none";
      fr.go(url);
    } catch (err) {
      loading(false);
      t.url = ""; paint(t);
      showError(t, String(err && err.message || err));
    }
  }
  function activate(t) {
    cur = t;
    tabs.forEach(function (x) {
      x.el.classList.toggle("on", x === t);
      if (x.fr) x.fr.frame.style.display = (x === t && x.url) ? "block" : "none";
    });
    addr.value = t.url;
    ntp.classList.toggle("hidden", !!t.url);
    loading(false); setBg();
    if (!t.url) setTimeout(function () { $("#nq").focus(); }, 0);
  }
  function newTab(url) {
    var t = { id: ++seq, url: "", title: "", fr: null, el: document.createElement("div") };
    t.el.className = "tab";
    t.el.innerHTML = '<span class="fav"></span><span class="ttl"></span><button class="x" title="Close tab">×</button>';
    t.el.addEventListener("click", function (e) {
      if (e.target.classList && e.target.classList.contains("x")) { closeTab(t); return; }
      activate(t);
    });
    strip.appendChild(t.el); tabs.push(t);
    activate(t); paint(t);
    if (url) go(t, url);
    t.el.scrollIntoView({ inline: "nearest", block: "nearest" });
    return t;
  }
  function closeTab(t) {
    var i = tabs.indexOf(t); if (i < 0) return;
    tabs.splice(i, 1); t.el.remove(); if (t.fr) t.fr.frame.remove();
    if (!tabs.length) { newTab(); return; }
    if (cur === t) activate(tabs[Math.min(i, tabs.length - 1)]);
  }
  function submit(v) {
    var u = toUrl(v); if (!u) return;
    var e = $("#err"); if (e) e.textContent = "";
    if (!cur) newTab(u); else go(cur, u);
    addr.blur();
  }

  /* ---------- wiring ---------- */
  addr.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submit(addr.value); }
    if (e.key === "Escape") { addr.value = cur ? cur.url : ""; addr.blur(); }
  });
  addr.addEventListener("focus", function () { setTimeout(function () { addr.select(); }, 0); });
  $("#nf").addEventListener("submit", function (e) { e.preventDefault(); submit($("#nq").value); $("#nq").value = ""; });
  Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function (a) {
    a.addEventListener("click", function () { submit(a.getAttribute("data-go")); });
  });
  $("#plus").addEventListener("click", function () { newTab(); });
  $("#back").addEventListener("click", function () { if (cur && cur.fr) try { cur.fr.back(); } catch (e) {} });
  $("#fwd").addEventListener("click", function () { if (cur && cur.fr) try { cur.fr.forward(); } catch (e) {} });
  $("#rel").addEventListener("click", function () { if (cur && cur.fr && cur.url) { loading(true); try { cur.fr.reload(); } catch (e) {} } });
  $("#home").addEventListener("click", function () {
    var t = cur; if (!t) return;
    t.url = ""; t.title = "";
    if (t.fr) { t.fr.frame.remove(); t.fr = null; }
    loading(false); paint(t); activate(t);
  });
  $("#menu").addEventListener("click", function (e) { e.stopPropagation(); pop.classList.toggle("hidden"); });
  document.addEventListener("click", function () { pop.classList.add("hidden"); });
  $("#pNew").addEventListener("click", function () { newTab(); });
  $("#pFs").addEventListener("click", function () {
    var d = document, el = d.documentElement;
    if (d.fullscreenElement) d.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
  });


  /* ---------- Horizen AI (the Gemini key stays on the relay server; this page only sends your question) ---------- */
  var aiBox = $("#ai"), aiMsgs = $("#aim"), aiQ = $("#aiq"), aiGo = $("#aigo"), aiHist = [], aiBusy = false;
  try { aiHist = JSON.parse(localStorage.getItem("eh_ai") || "[]").filter(function (m) { return m && typeof m.text === "string"; }).slice(-20); } catch (e) { aiHist = []; }
  function aiSave() { try { localStorage.setItem("eh_ai", JSON.stringify(aiHist.slice(-20))); } catch (e) {} }
  function fmt(el, text) {                      // tiny safe formatter: ```code```, `code`, **bold**  (built from text nodes only)
    el.textContent = "";
    text.split(/```/).forEach(function (part, i) {
      if (i % 2) { var pre = document.createElement("pre"), code = document.createElement("code"); code.textContent = part.replace(/^[a-zA-Z0-9+#-]*\n/, "").replace(/\n$/, ""); pre.appendChild(code); el.appendChild(pre); return; }
      part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).forEach(function (seg) {
        if (/^`[^`\n]+`$/.test(seg)) { var c = document.createElement("code"); c.textContent = seg.slice(1, -1); el.appendChild(c); }
        else if (/^\*\*[^*\n]+\*\*$/.test(seg)) { var b = document.createElement("b"); b.textContent = seg.slice(2, -2); el.appendChild(b); }
        else el.appendChild(document.createTextNode(seg));
      });
    });
  }
  function addMsg(cls, text) { var d = document.createElement("div"); d.className = "am " + cls; if (cls === "m") fmt(d, text); else d.textContent = text; aiMsgs.appendChild(d); aiMsgs.scrollTop = aiMsgs.scrollHeight; return d; }
  function aiRender() {
    aiMsgs.textContent = "";
    if (!aiHist.length) { var h = document.createElement("div"); h.className = "aihint"; h.textContent = "Hi, I'm Horizen AI. Ask me anything."; aiMsgs.appendChild(h); }
    aiHist.forEach(function (m) { addMsg(m.role === "model" ? "m" : "u", m.text); });
  }
  function aiToggle(on) {
    var show = on === undefined ? aiBox.classList.contains("hidden") : on;
    aiBox.classList.toggle("hidden", !show);
    if (show) { aiRender(); setTimeout(function () { aiQ.focus(); }, 0); }
  }
  async function aiSend(text) {
    if (aiBusy || !text.trim()) return;
    aiBusy = true; aiGo.disabled = true;
    var hint = aiMsgs.querySelector(".aihint"); if (hint) hint.remove();
    aiHist.push({ role: "user", text: text }); addMsg("u", text);
    var wait = addMsg("m", ""); wait.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    var slow = setTimeout(function () { if (wait.isConnected) { wait.innerHTML = '<span class="dots"><i></i><i></i><i></i></span> <small style="opacity:.7">waking the server, this can take up to a minute the first time</small>'; } }, 8000);
    try {
      var r = await fetch(RELAY + "/api/ai", { method: "POST", signal: AbortSignal.timeout(80000), headers: { "content-type": "application/json", authorization: "Bearer " + getTok() }, body: JSON.stringify({ messages: aiHist.slice(-20) }) });
      var j = await r.json().catch(function () { return {}; });
      wait.remove();
      if (r.ok && j.text) { aiHist.push({ role: "model", text: j.text }); addMsg("m", j.text); }
      else { aiHist.pop(); addMsg("e", j.error || "Something went wrong. Try again."); if (r.status === 401) { setTok(""); } }
    } catch (e) { wait.remove(); aiHist.pop(); addMsg("e", e && e.name === "TimeoutError" ? "No answer after 80 seconds. The server may be asleep or stuck: open your Render address + /healthz, wait for \"ok\", then try again." : "Could not reach the server. It may be waking up: try again in a moment."); }
    clearTimeout(slow); aiSave(); aiBusy = false; aiGo.disabled = false; aiQ.focus();
  }
  function wake() { if (RELAY) { try { fetch(RELAY + "/healthz", { mode: "no-cors", cache: "no-store" }).catch(function () {}); } catch (e) {} } }
  setInterval(function () { if (!document.hidden) wake(); }, 8 * 60 * 1000);   // free Render sleeps after 15 idle minutes; this keeps it awake while this tab is open
  document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); });
  $("#aib").addEventListener("click", function (e) { e.stopPropagation(); wake(); aiToggle(); });
  $("#aix").addEventListener("click", function () { aiToggle(false); });
  $("#aiclr").addEventListener("click", function () { aiHist = []; aiSave(); aiRender(); });
  $("#aif").addEventListener("submit", function (e) { e.preventDefault(); var v = aiQ.value; aiQ.value = ""; aiQ.style.height = "auto"; aiSend(v); });
  aiQ.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#aif").requestSubmit(); } });
  aiQ.addEventListener("input", function () { aiQ.style.height = "auto"; aiQ.style.height = Math.min(aiQ.scrollHeight, 120) + "px"; });
  $("#pOut").addEventListener("click", function () { setTok(""); try { localStorage.removeItem("eh_ai"); } catch (e) {} location.reload(); });

  /* ---------- password gate (checked by the relay server, never stored in the page) ---------- */
  var gate = $("#gate"), gmsg = $("#gmsg");
  function begin() { gate.classList.add("hidden"); newTab(); startEngine().catch(function () {}); }
  function ask(msg) { gate.classList.remove("hidden"); gmsg.textContent = msg || ""; $("#gpw").focus(); }
  if (!/^https?:\/\//.test(RELAY) || /PASTE-YOUR/.test(RELAY)) {
    ask("Setup needed: edit site/config.js and put your Render address in it.");
    $("#gf").addEventListener("submit", function (e) { e.preventDefault(); });
  } else {
    $("#gf").addEventListener("submit", async function (e) {
      e.preventDefault(); gmsg.textContent = "Checking... (a sleeping server can take up to a minute to wake)";
      try {
        var r = await fetch(RELAY + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pw: $("#gpw").value }) });
        var j = await r.json().catch(function () { return {}; });
        if (r.ok && j.token) { setTok(j.token); begin(); } else gmsg.textContent = j.error || "Could not sign in.";
      } catch (err) { gmsg.textContent = "Could not reach the relay server. Check config.js and that Render is running."; }
    });
    (async function () {
      var t = getTok();
      if (!t) return ask("");
      try {
        var r = await fetch(RELAY + "/api/check?k=" + encodeURIComponent(t));
        if (r.ok) return begin();
        setTok(""); ask("Please sign in again.");
      } catch (e) { begin(); }   // server asleep or offline: let the page open, the engine will retry
    })();
  }
})();
