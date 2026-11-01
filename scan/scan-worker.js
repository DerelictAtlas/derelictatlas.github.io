/* scan-worker.js (SITE integration, user 2026-10-31): one fresh worker = one system. Loads the W29 scanner
 * (w29_scan.js + scan_w29.wasm, RE_FULL W29b) next to this file, scans the address with the scanner's default call
 * and posts the result back. The page terminates the worker afterwards, so its ~30 MB are freed at once.
 * Progress (user 2026-10-31): {type: "progress", step: download|start|scan, loaded, total} before the result. */
const V = new URL(self.location.href).searchParams.get("v") || "";
const q = V ? "?v=" + encodeURIComponent(V) : "";
importScripts("w29_scan.js" + q);
self.onmessage = async (event) => {
  const address = String(event.data && event.data.address || "");
  let step = "download";
  try {
    const response = await fetch("scan_w29.wasm" + q, { cache: event.data && event.data.retry ? "reload" : "default" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const total = Number(event.data && event.data.wasmBytes) || 0;
    let bytes;
    if (response.body && response.body.getReader) {
      const reader = response.body.getReader(), parts = [];
      let loaded = 0, sent = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); loaded += value.length;
        if (loaded - sent >= 32768) { sent = loaded; self.postMessage({ type: "progress", step: "download", loaded, total }); }
      }
      bytes = new Uint8Array(loaded);
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.length; }
      bytes = bytes.buffer;
      self.postMessage({ type: "progress", step: "download", loaded, total: loaded });
    } else bytes = await response.arrayBuffer();
    step = "start";
    self.postMessage({ type: "progress", step: "start" });
    const sc = await W29Scan.create(bytes);
    step = "scan";
    self.postMessage({ type: "progress", step: "scan" });
    const r = sc.scan(address, (event.data && event.data.options) || {});   // map draw: items/spook off; loot scan: no map
    self.postMessage({ ok: true, address, row: r.row, extras: r.extras, derelict: r.derelict || null, loot: r.loot || null, status: r.status, ms: r.ms, version: sc.version() });
  } catch (error) {
    const msg = String(error && error.message || error);
    self.postMessage({ ok: false, address, step, error: step === "download" ? "downloading the scanner (scan_w29.wasm): " + msg : msg });
  }
};
