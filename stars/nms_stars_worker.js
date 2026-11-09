// Module worker for nms_stars.js. Answers { id, op: "view"|"region", gal, x, y, z, radius } with { id, region } messages, then { id, done: true }, or { id, error }.
import { createStarBuilder } from "./nms_stars.js";

const ready = createStarBuilder();
const buffers = (r) => [r.positions.buffer, r.ua.buffer, r.index.buffer, r.color.buffer, r.rgba.buffer];
let chain = Promise.resolve();

self.onmessage = (ev) => {
  const m = ev.data;
  chain = chain.then(async () => {
    try {
      const b = await ready;
      if (m.op === "region") {
        const region = b.buildRegion(m.gal, m.x, m.y, m.z);
        self.postMessage({ id: m.id, region }, buffers(region));
      } else {
        for (const region of b.viewRegions(m.gal, m.x, m.y, m.z, m.radius ?? 1)) self.postMessage({ id: m.id, region }, buffers(region));
      }
      self.postMessage({ id: m.id, done: true });
    } catch (e) {
      self.postMessage({ id: m.id, error: String(e && e.message || e) });
    }
  });
};
