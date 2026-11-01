"use strict";
// On-demand map client for the public site (2026-10-24). Browser global `OnDemand`, also usable from Node (tests).
//
//   OnDemand.available()                         true when DV_CONFIG.ondemandBase is set (one config value, see EXPOSE.md)
//   OnDemand.request(address, { onStatus, signal })
//        1. GET <base>/api/status/<ADDR>    what will happen (preset, rooms, queue, ETA); never starts anything
//        2. GET <base>/api/map/<ADDR>?wait=0 starts the job (200 when the map is cached, else 202)
//        3. GET <base>/api/status/<ADDR> every poll_ms (1-2 s) until status "ready", then GET the map (cached, fast)
//        Resolves to {v:4, t, s:{ADDRESS16:view}, m:{summary}} or rejects with an Error whose .code is one of
//        "offline", "busy", "timeout", "rate", "nosystem", "unsupported", "bad", "aborted" and .retryAfter (seconds).
//        onStatus(st) gets every server status plus {state, t_recv, client_elapsed_s}; state is one of
//        "connecting" | "idle" | "queued" | "generating" | "ready".
//        All endpoints are GET + JSON and keep nothing per client except the address (= job id), so a plain
//        pass-through proxy (Raspberry Pi relay) can forward them unchanged.
//   OnDemand.view(run, nowMs)                    pure: what to show right now (title, kind, queue, time text, percent, stage)
//   OnDemand.cached(address)                     body of an earlier request in this page visit, or null
//   OnDemand.unpack(address, body)               -> { d, index } like DerelictModel.unpack(view3, table3); needs compact.js + model.js
//   OnDemand.message(err)                        the text to show for a rejected request
(function (root) {
  const TOTAL_LIMIT_MS = 180000;    // give up after this ("timeout")
  const mem = new Map();

  const base = () => String((root.DV_CONFIG && root.DV_CONFIG.ondemandBase) || "").replace(/\/+$/, "");
  const available = () => !!base();

  function fail(code, message, retryAfter) {
    const e = new Error(message);
    e.code = code;
    if (retryAfter) e.retryAfter = retryAfter;
    return e;
  }

  // Fallback wording; the normal wording comes from the server (ondemand/eta_config.json "texts") in every status.
  const MESSAGES = {
    offline: "Map server offline, try later.",
    busy: "The map server is busy, try again in {s} s.",
    timeout: "The map took too long. Try again in {s} s.",
    rate: "Too many map requests from this connection, wait {s} s.",
    nosystem: "This system could not be found, so no map can be made.",
    unsupported: "Only galaxy 0 (Euclid) maps can be generated for now.",
    bad: "That address is not valid.",
    aborted: "Cancelled.",
  };
  const message = (err) => {
    const t = (err && MESSAGES[err.code]) || MESSAGES.offline;
    return t.replace("{s}", String(Math.max(5, Math.round((err && err.retryAfter) || 60))));
  };

  const sleep = (ms, signal) => new Promise((res) => {
    const id = setTimeout(res, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(id); res(); }, { once: true });
  });

  async function getJson(url, signal) {
    let r, body;
    try {
      r = await fetch(url, { signal, cache: "no-store" });
      body = await r.json();
    } catch (err) {
      if (err && err.name === "AbortError") throw fail("aborted", MESSAGES.aborted);
      throw fail("offline", MESSAGES.offline);     // network error, tunnel down, HTML error page from a proxy
    }
    return { r, body };
  }

  function httpError(r, body) {
    const retry = Number(r.headers.get("Retry-After")) || (body && body.retry_after) || 0;
    if (r.status === 429) return fail("rate", MESSAGES.rate, retry || 60);
    if (r.status === 503) return fail("busy", MESSAGES.busy, retry || 60);
    if (r.status === 404) return fail("nosystem", MESSAGES.nosystem);
    if (r.status === 400) return body && body.error === "galaxy" ? fail("unsupported", MESSAGES.unsupported) : fail("bad", MESSAGES.bad);
    return fail("offline", MESSAGES.offline);
  }

  async function request(address, opts) {
    const o = opts || {};
    const addr = String(address).toUpperCase();
    if (!available()) throw fail("offline", MESSAGES.offline);
    if (!/^[0-9A-F]{16}$/.test(addr)) throw fail("bad", MESSAGES.bad);
    if (mem.has(addr)) return mem.get(addr);
    const t0 = Date.now();
    const push = (s) => {
      if (!o.onStatus) return;
      try { o.onStatus({ client_elapsed_s: Math.round((Date.now() - t0) / 1000), t0, t_recv: Date.now(), ...s }); } catch (_) { /* UI errors never stop the request */ }
    };
    const mapUrl = (q) => `${base()}/api/map/${addr}${q}`;
    const check = () => {
      if (o.signal && o.signal.aborted) throw fail("aborted", MESSAGES.aborted);
      if (Date.now() - t0 > TOTAL_LIMIT_MS) throw fail("timeout", MESSAGES.timeout, 60);
    };
    const finish = (body) => {
      if (!body || body.v !== 4 || !body.s || !body.s[addr]) throw fail("offline", MESSAGES.offline);
      mem.set(addr, body);
      return body;
    };
    push({ state: "connecting", status: "connecting", position: 0, queue: 0, eta_s: null });
    // 1. what will happen (preset, rooms, queue, ETA): answers in milliseconds, starts nothing
    let { r, body } = await getJson(`${base()}/api/status/${addr}`, o.signal);
    if (r.status !== 200) throw httpError(r, body);
    push({ ...body, state: body.status });
    // 2. start (or join) the job; a cached map comes back right away
    check();
    ({ r, body } = await getJson(mapUrl("?wait=0"), o.signal));
    if (r.status === 200) return finish(body);
    if (r.status !== 202) throw httpError(r, body);
    push({ ...body, state: body.status });
    // 3. cheap status polls until ready
    let idlePolls = 0;
    for (;;) {
      await sleep(Math.max(1000, Math.min(2000, (body && body.poll_ms) || 1500)), o.signal);
      check();
      ({ r, body } = await getJson(`${base()}/api/status/${addr}`, o.signal));
      if (r.status !== 200) throw httpError(r, body);
      if (body.status === "ready") {
        push({ ...body, state: "ready" });
        let m;
        ({ r, body: m } = await getJson(mapUrl("?wait=0"), o.signal));
        if (r.status === 200) return finish(m);
        if (r.status === 202) continue;            // evicted in between: it is queued again
        throw httpError(r, m);
      }
      if (body.status === "failed") {
        const code = body.http === 503 ? "busy" : body.http === 404 ? "nosystem" : "offline";
        throw fail(code, MESSAGES[code], body.retry_after || 60);
      }
      if (body.status === "idle" && ++idlePolls >= 3) throw fail("busy", MESSAGES.busy, 30);   // the job vanished (server restarted / dropped it)
      push({ ...body, state: body.status });
    }
  }

  const cached = (address) => mem.get(String(address).toUpperCase()) || null;

  // ---- what to show, as a pure function of the last status and the clock (so it can be tested without a DOM)
  // run = { st: last status ({...server status, t_recv (ms)}), t0 (ms, request start), pct (previous percent or 0) }
  function view(run, nowMs) {
    const st = (run && run.st) || {};
    const msg = st.msg || {};
    const elapsed = Math.max(0, (nowMs - (run.t0 || nowMs)) / 1000);
    const sinceRecv = Math.max(0, (nowMs - (st.t_recv || nowMs)) / 1000);
    const known = typeof st.eta_s === "number";
    const left = known ? Math.max(0, st.eta_s - sinceRecv) : null;
    const total = known ? (st.t_recv - run.t0) / 1000 + st.eta_s : null;
    const over = !!known && st.status !== "ready" && (left === 0 || !!st.overdue) && st.status !== "idle" && elapsed > 2;
    let pct = 0;
    if (st.status === "ready") pct = 100;
    else if (total && total > 0) pct = Math.min(95, (elapsed / total) * 100);
    pct = Math.max(run.pct || 0, pct);
    if (st.status !== "ready") pct = Math.min(95, pct);
    const fill = (t, s) => String(t || "").replace("{s}", String(s));
    let time = "";
    if (st.status === "ready") time = msg.ready || "";
    else if (over) time = fill(msg.over || "taking longer than usual… still working (elapsed {s} s)", Math.round(elapsed));
    else if (known && st.status !== "connecting") time = fill(msg.left || "about {s} s left", Math.max(1, Math.round(left)));
    return {
      title: msg.title || "Generating map…", kind: msg.kind || "", rooms: msg.rooms || "", queue: msg.queue || "",
      time, busy: msg.busy || "", stages: msg.stages || [], stage: typeof st.stage === "number" ? st.stage : 0,
      pct: Math.round(pct), over, status: st.status || "connecting", slow: !!st.slow,
      // text for screen readers: changes only when something meaningful changes (not every second)
      live: [msg.title, st.status === "queued" ? msg.queue : "", (msg.stages || [])[st.stage] || "", over ? "taking longer than usual" : "", msg.busy].filter(Boolean).join(". "),
    };
  }

  // the response is a one-system bundle in the compact format 4: the existing renderer path (compact.js expand, then
  // model.js unpack/build) draws it exactly like a top-100 map from viewer/static/compact/top100.v4.json.gz
  function unpack(address, body) {
    const C = root.DerelictCompact || (typeof require !== "undefined" ? require("./compact.js") : null);
    const M = root.DerelictModel || (typeof require !== "undefined" ? require("./model.js") : null);
    return M.unpack(C.expand(body.s[address], body.t), C.table3(body.t));
  }

  const api = { available, request, cached, unpack, message, view };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.OnDemand = api;
})(typeof window !== "undefined" ? window : globalThis);
