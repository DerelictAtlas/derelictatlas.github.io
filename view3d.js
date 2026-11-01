import {fitOverviewCamera,collectOverviewBounds,entranceAzimuth} from './view-framing.js';
import {walkingLookRate} from './view-controls.js';
import {createTouchHint} from './touch-hint.js';
import {bindTwoFingerGestures,orbitTouchGesture} from './touch-gestures.js';
import {captureWebGL,captureOverviewWebGL} from './capture-webgl.js';
import {createRouteOverlay3D} from './route-overlay.js';
// 3D view of one derelict: room cells per deck, stair shafts between decks, crates/footlockers at their exact heights.
// World units: 1 = one grid cell (8 layout units = 8 m). three.js is right-handed with Y up, like NMS, so with the camera
// behind the entrance looking along +Z, +X appears on the left, matching the in-game view and the 2D maps.
import * as THREE from "three";
import { OrbitControls } from "./vendor/three/OrbitControls.js";

const FAMILY_COLORS = { cargo: 0xe3a33b, barracks: 0x5b8def, medical: 0x4fbf73, end: 0xd978c6, hangar: 0xe0605a, other: 0x7d8794 };

// Layers with a checkbox in the 3D bar: [key, label]. buildScene(opts.layers) shows a layer unless its key is false
// (DEFAULT_OFF layers: unless it is not true).
export const LAYERS = [["walls", "Walls"], ["floors", "Floors"], ["fixtures", "Fixtures"], ["doors", "Doors"], ["ladders", "Ladders"],
  ["crates", "Crates"], ["footlockers", "Footlockers"], ["briefcases", "Briefcases"], ["tallLockers", "Tall lockers"],
  ["turret", "Turrets"], ["floater", "Floater spawners"], ["fastFloater", "Fast floater spawners"], ["drone", "Drone spawners"],
  ["bugSpawner", "Bug spawners"], ["hangSac", "Hanging sacs"], ["pillarSac", "Pillar sacs"], ["egg", "Fiend eggs"], ["barrel", "Barrels"],
  ["ship", "Hangar ship"], ["hangarDetails", "Hangar details"], ["labels", "Room labels"], ["entrance", "Entrance"]];
export const DEFAULT_OFF = new Set(["barrel"]);
const HAZARD_LAYER = { T: "turret", F: "floater", f: "fastFloater", D: "drone", B: "bugSpawner", S: "hangSac", P: "pillarSac", E: "egg", X: "barrel" };

// Procedural steel panels for the modern interface. Geometry and default legacy colors are unchanged.
const panelTextures = new Map();
function panelTexture(kind) {
  if (panelTextures.has(kind)) return panelTextures.get(kind);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = kind === 'floor' ? '#8596a3' : '#6b7c89'; g.fillRect(0,0,256,256);
  for (let y=0;y<256;y+=64) for (let x=0;x<256;x+=64) {
    const gradient=g.createLinearGradient(x,y,x+64,y+64);
    gradient.addColorStop(0,kind === 'floor' ? '#a9b4bb' : '#80909c');
    gradient.addColorStop(1,kind === 'floor' ? '#778a98' : '#4f636f');
    g.fillStyle=gradient; g.fillRect(x+2,y+2,60,60);
    g.strokeStyle='#263e4d';g.lineWidth=2;g.strokeRect(x+2,y+2,60,60);
    g.strokeStyle='#c1cbd055';g.lineWidth=1;g.strokeRect(x+5,y+5,54,54);
    for (const dx of [8,56]) for (const dy of [8,56]) {g.fillStyle='#314957';g.fillRect(x+dx,y+dy,2,2);}
    if(kind==='wall') {g.fillStyle='#253e4d';for(let k=0;k<5;k++)g.fillRect(x+16,y+19+k*5,32,2);}
    else {g.strokeStyle='#465f7055';for(let k=0;k<4;k++){g.beginPath();g.moveTo(x+20+k*6,y+18);g.lineTo(x+20+k*6,y+46);g.stroke();}}
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  panelTextures.set(kind,texture);return texture;
}

// Object colours, sampled from the game's own textures (never shipped): the dominant colour clusters of each prop's diffuse
// map, found with hgpaktool + texture2ddecoder from the materials the prop scenes reference (see viewer/README.md).
// rgb(r, g, b) are the sampled 8-bit values. The three loot containers all use the game's blue/grey "rover trim" sheet
// (ROVERTRIM.BLUE.DDS: 31% blue 45,122,182, 27% light grey 216,216,211, 22% grey 97,97,94), so they differ by shape and trim.
const rgb = (r, g, b) => (r << 16) | (g << 8) | b;
const PAL = {
  trimBlue: rgb(45, 122, 182), trimLight: rgb(216, 216, 211), trimGrey: rgb(97, 97, 94),         // CRATE1 / ROVERTRIM.BLUE.DDS (crate, footlocker, case, locker)
  amber: rgb(183, 99, 13),                                                                         // PANNINGMAT3_MAT (cratem glow strip)
  button: rgb(167, 46, 62),                                                                        // BUTTONANIM_MAT (foot locker / case latch)
  caseGrey: rgb(131, 126, 118), caseBlack: rgb(13, 14, 13),                                        // DECAL1 / INTERIORFREIGHTERTRIM, PIPE1_MAT1 (interactive_case)
  lockerDark: rgb(60, 61, 62), screen: rgb(0, 156, 255),                                           // INTERIORFREIGHTERTRIM, UIMISCPARTS_MAT (locker)
  turretGrey: rgb(97, 96, 97), turretLight: rgb(211, 212, 214), turretOrange: rgb(188, 108, 44),  // turret BITS4_PASTED__CRATE1, TILINGTEXTURE
  sacHang: rgb(117, 100, 90), sacHangDecal: rgb(122, 65, 64), sacDrip: rgb(94, 69, 42),           // mediumhangslime PLANESLIMEMAT, SLIMEDECALMAT1, DETAILSLIMEMAT
  sacPillar: rgb(106, 86, 55), sacPillarBulge: rgb(118, 100, 66), sacPillarDrip: rgb(76, 45, 30), // largepillarslime PILLARSLIMEMAT, GLOWSLIME, DETAILSLIMEMAT
  bug: rgb(126, 135, 84), bugDark: rgb(88, 93, 60),                                                // FIEND_MAT (the bug creature the spawners release)
  egg: rgb(134, 88, 97), eggDark: rgb(98, 55, 83),                                                 // fiendegg EGGSHELL_MAT
  droneBody: rgb(89, 76, 70),                                                                      // DRONE_MAT (sentinel drone; the mini drone has no readable model)
  barrel: rgb(188, 108, 44), barrelBand: rgb(54, 54, 54), barrelCap: rgb(119, 119, 119),          // explodingbarrel crate1, DARKMETAL_MAT39, SHINYMETAL_MAT21
  // no model in the game files (the spawners are empty locator nodes; the floater creature was not found): marker colours
  floater: rgb(167, 123, 255), fastFloater: rgb(212, 188, 255), droneCore: rgb(232, 111, 176),
};

// Low-poly object models, in cells (1 cell = 8 m). Each is a list of parts {geo, color, at, rot, scale, glow}; the parts are
// merged into one body geometry and one glow geometry (unlit) with the colours baked in, so every object type is two instanced meshes.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 8) => new THREE.CylinderGeometry(rt, rb, h, n);
const ball = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const MODELS = {
  // salvage crate (cratem, ~1 m cube): blue body, light lid band, amber glow strip
  crate: [{ geo: box(0.13, 0.13, 0.13), color: PAL.trimBlue, at: [0, 0.065, 0] }, { geo: box(0.138, 0.03, 0.138), color: PAL.trimLight, at: [0, 0.115, 0] },
    { geo: box(0.14, 0.012, 0.14), color: PAL.amber, at: [0, 0.045, 0], glow: true }],
  // crew footlocker (foot_locker, ~1.4 x 0.6 m, low and long): grey base, blue lid, red clasps
  footlocker: [{ geo: box(0.18, 0.045, 0.085), color: PAL.trimGrey, at: [0, 0.0225, 0] }, { geo: box(0.184, 0.03, 0.089), color: PAL.trimBlue, at: [0, 0.06, 0] },
    { geo: box(0.02, 0.02, 0.092), color: PAL.button, at: [0.05, 0.045, 0], glow: true }, { geo: box(0.02, 0.02, 0.092), color: PAL.button, at: [-0.05, 0.045, 0], glow: true }],
  // briefcase (interactive_case): flat slab, black handle, red latches
  briefcase: [{ geo: box(0.1, 0.03, 0.07), color: PAL.caseGrey, at: [0, 0.015, 0] }, { geo: box(0.045, 0.012, 0.012), color: PAL.caseBlack, at: [0, 0.036, 0] },
    { geo: box(0.012, 0.012, 0.074), color: PAL.button, at: [0.03, 0.022, 0], glow: true }, { geo: box(0.012, 0.012, 0.074), color: PAL.button, at: [-0.03, 0.022, 0], glow: true }],
  // tall locker (locker, 3 m upright cabinet): dark body, blue doors, cyan screen band
  tallLocker: [{ geo: box(0.085, 0.36, 0.085), color: PAL.lockerDark, at: [0, 0.18, 0] }, { geo: box(0.07, 0.26, 0.092), color: PAL.trimBlue, at: [0, 0.17, 0] },
    { geo: box(0.09, 0.022, 0.09), color: PAL.screen, at: [0, 0.335, 0], glow: true }],
  // ceiling turret: mount plate, neck, head with a forward barrel and an orange glow strip; hangs down from its origin
  turret: [{ geo: cyl(0.07, 0.07, 0.015, 10), color: PAL.turretLight, at: [0, -0.0075, 0] }, { geo: cyl(0.025, 0.025, 0.04, 6), color: PAL.lockerDark, at: [0, -0.035, 0] },
    { geo: box(0.09, 0.05, 0.07), color: PAL.turretGrey, at: [0, -0.08, 0] }, { geo: cyl(0.012, 0.012, 0.11, 6), color: PAL.lockerDark, at: [0, -0.08, 0.07], rot: [Math.PI / 2, 0, 0] },
    { geo: box(0.094, 0.012, 0.074), color: PAL.turretOrange, at: [0, -0.098, 0], glow: true }],
  floater: [{ geo: ball(0.055, 10, 8), color: PAL.floater, at: [0, 0, 0] }, { geo: ball(0.02, 6, 4), color: 0xf0e6ff, at: [0, 0.01, 0.05], glow: true }],
  fastFloater: [{ geo: ball(0.035, 8, 6), color: PAL.fastFloater, at: [0, 0, 0] }, { geo: ball(0.014, 6, 4), color: 0xffffff, at: [0, 0.006, 0.032], glow: true }],
  drone: [{ geo: new THREE.OctahedronGeometry(0.065), color: PAL.droneBody, at: [0, 0, 0] }, { geo: new THREE.OctahedronGeometry(0.03), color: PAL.droneCore, at: [0, 0, 0], glow: true }],
  bugSpawner: [{ geo: ball(0.04, 7, 5), color: PAL.bug, at: [0, 0, 0] }, { geo: ball(0.03, 7, 5), color: PAL.bugDark, at: [0.045, -0.02, 0.01] },
    { geo: ball(0.028, 7, 5), color: PAL.bug, at: [-0.035, -0.025, -0.03] }],
  egg: [{ geo: ball(0.04, 8, 6), color: PAL.egg, at: [0, 0, 0], scale: [1, 1.3, 1] }, { geo: ball(0.014, 5, 4), color: PAL.eggDark, at: [0.03, 0.01, 0.02] },
    { geo: ball(0.012, 5, 4), color: PAL.eggDark, at: [-0.025, -0.02, 0.03] }],
  // hanging sac: teardrop with a reddish cap and a dark drip
  hangSac: [{ geo: ball(0.06, 9, 7), color: PAL.sacHang, at: [0, 0, 0], scale: [1, 1.35, 1] }, { geo: ball(0.035, 6, 5), color: PAL.sacHangDecal, at: [0, 0.07, 0] },
    { geo: new THREE.ConeGeometry(0.02, 0.07, 6), color: PAL.sacDrip, at: [0, -0.1, 0], rot: [Math.PI, 0, 0] }],
  // pillar sac: tall organic column with bulges
  pillarSac: [{ geo: cyl(0.045, 0.05, 0.34, 8), color: PAL.sacPillar, at: [0, 0, 0] }, { geo: ball(0.06, 7, 5), color: PAL.sacPillarBulge, at: [0.02, 0.08, 0] },
    { geo: ball(0.05, 7, 5), color: PAL.sacPillarBulge, at: [-0.02, -0.06, 0.02] }, { geo: new THREE.ConeGeometry(0.03, 0.08, 6), color: PAL.sacPillarDrip, at: [0, -0.2, 0], rot: [Math.PI, 0, 0] }],
  barrel: [{ geo: cyl(0.045, 0.045, 0.1, 10), color: PAL.barrel, at: [0, 0, 0] }, { geo: cyl(0.048, 0.048, 0.014, 10), color: PAL.barrelBand, at: [0, 0.025, 0] },
    { geo: cyl(0.048, 0.048, 0.014, 10), color: PAL.barrelBand, at: [0, -0.025, 0] }, { geo: cyl(0.03, 0.03, 0.008, 8), color: PAL.barrelCap, at: [0, 0.052, 0] }],
};
// distance from an object's origin to the floor-side of its model (hazards are centred on their node, containers stand on it)
const MODEL_LIFT = { pillarSac: 0.17, hangSac: 0, barrel: 0.05 };

// Loot containers as the game has them: each prop scene's COLLISION box (metres, prop-local: x across, y up from the node,
// +z = the front; props/cratem, foot_locker, interactive_case inside its 0.900122-scaled SmallCase locator, locker).
// The container models are fitted to these boxes and turned by the container's orientation, so a container fills the
// game's volume where the game puts it (rows of lockers stand flush, a fallen locker lies on the floor). Walking collides
// with the same boxes.
const CONTAINER_BOX = {
  crate: { c: [0, 0.45489, 0], s: [1.259718, 0.909784, 1.066261] },
  footlocker: { c: [0, 0.42778, 0.002663], s: [1.54511, 0.90556, 0.94555] },
  briefcase: { c: [0.00074, 0.139804, -0.000852], s: [0.90507, 0.254545, 0.578272] },
  tallLocker: { c: [0, 1.465278, 0.045414], s: [1.001328, 2.930556, 1.03772] },
};
// container kind -> [model / CONTAINER_BOX key, 3D layer key]
const CONTAINER_KINDS = { salvage_crate: ["crate", "crates"], crew_footlocker: ["footlocker", "footlockers"], briefcase: ["briefcase", "briefcases"],
  tall_locker: ["tallLocker", "tallLockers"] };
const DEG = Math.PI / 180;
// [RotX, RotY, RotZ] degrees (the game's order R = Ry * Rx * Rz = three.js "YXZ"); null = upright, facing +z
const orientQ = (q, rot) => (rot ? q.setFromEuler(_tmpE.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, "YXZ")) : q.identity());
// a matrix that maps the geometries' bounding box onto box (metres), in cells (1/8)
function fitMatrix(geometries, box) {
  const bb = new THREE.Box3();
  for (const g of geometries) if (g) { g.computeBoundingBox(); bb.union(g.boundingBox); }
  const size = bb.getSize(new THREE.Vector3()), mid = bb.getCenter(new THREE.Vector3());
  const s = box.s.map((v, k) => v / 8 / Math.max(1e-6, size.getComponent(k)));
  return new THREE.Matrix4().makeScale(...s).setPosition(...box.c.map((v, k) => v / 8 - mid.getComponent(k) * s[k]));
}
// Walking footprint of a container (grid units on its deck): the box turned by its orientation, as a rectangle in the frame of
// its most horizontal side axis. null when the box is not at body height (a briefcase on the floor can be stepped over).
function containerFootprint(c, box) {
  const q = orientQ(new THREE.Quaternion(), c.rot), m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  const ax = Math.hypot(m[0], m[2]) > 0.3 ? Math.atan2(-m[2], m[0]) : Math.atan2(m[8], m[10]);  // yaw of local x, else of local z
  const cs = Math.cos(ax), sn = Math.sin(ax), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], p = new THREE.Vector3();
  for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
    p.set(box.c[0] + dx * box.s[0], box.c[1] + dy * box.s[1], box.c[2] + dz * box.s[2]).multiplyScalar(1 / 8).applyQuaternion(q);
    const l = [p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs];  // into the yaw frame (inverse of a turn by ax about y)
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], l[k]); hi[k] = Math.max(hi[k], l[k]); }
  }
  if (c.h + hi[1] < 0.35 / 8 || c.h + lo[1] > 1.8 / 8) return null;
  return { ox: c.u - 6.5, oz: c.v - 6.5, c: cs, s: sn, x0: lo[0], x1: hi[0], z0: lo[2], z1: hi[2], soft: true };
}

const _tmpM = new THREE.Matrix4(), _tmpQ = new THREE.Quaternion(), _tmpE = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1);
const _modelCache = new Map();
// parts -> { body, glow } BufferGeometry (position + colour, non-indexed; the materials use flat shading), glow is null without glow parts
function mergeParts(name) {
  if (_modelCache.has(name)) return _modelCache.get(name);
  const out = {};
  for (const glow of [false, true]) {
    const pos = [], col = [], c = new THREE.Color();
    for (const p of MODELS[name].filter((q) => Boolean(q.glow) === glow)) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      _tmpQ.setFromEuler(_tmpE.set(...(p.rot || [0, 0, 0])));
      g.applyMatrix4(_tmpM.compose(new THREE.Vector3(...p.at), _tmpQ, p.scale ? new THREE.Vector3(...p.scale) : _one));
      const a = g.getAttribute("position");
      c.setHex(p.color);
      for (let k = 0; k < a.count; k++) { pos.push(a.getX(k), a.getY(k), a.getZ(k)); col.push(c.r, c.g, c.b); }
      g.dispose();
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.computeBoundingSphere();
      out[glow ? "glow" : "body"] = g;
    } else out[glow ? "glow" : "body"] = null;
  }
  _modelCache.set(name, out);
  return out;
}

// The supplied ultralow GLBs are small (one mesh each). Read their standard GLB accessors directly so the viewer can
// instance the geometry without pulling in a separate loader dependency.
const GLB_COMPONENTS = { 5121: [Uint8Array, 1], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const GLB_WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function glbAccessor(doc, bin, index, asFloat = false) {
  const a = doc.accessors[index], v = doc.bufferViews[a.bufferView], [Type, bytes] = GLB_COMPONENTS[a.componentType];
  if (!Type || !GLB_WIDTHS[a.type]) throw new Error("unsupported ultralow GLB accessor");
  const width = GLB_WIDTHS[a.type], count = a.count, stride = v.byteStride || width * bytes;
  const offset = (v.byteOffset || 0) + (a.byteOffset || 0);
  if (stride === width * bytes && !a.normalized && (!asFloat || Type === Float32Array))
    return { array: new Type(bin, offset, count * width), width };
  const values = new Float32Array(count * width), view = new DataView(bin);
  const read = Type === Float32Array ? (p) => view.getFloat32(p, true) :
    Type === Uint16Array ? (p) => view.getUint16(p, true) : Type === Uint32Array ? (p) => view.getUint32(p, true) :
      Type === Uint8Array ? (p) => view.getUint8(p) : null;
  for (let i = 0; i < count; i++) for (let j = 0; j < width; j++) {
    let x = read(offset + i * stride + j * bytes);
    if (a.normalized) x /= Type === Uint8Array ? 255 : Type === Uint16Array ? 65535 : 4294967295;
    values[i * width + j] = x;
  }
  return { array: values, width };
}
function parseContainerGLB(buffer, texture) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error("invalid ultralow GLB");
  let offset = 12, doc = null, bin = null;
  while (offset < buffer.byteLength) {
    const n = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), start = offset + 8;
    if (type === 0x4e4f534a) doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, n)).trim());
    else if (type === 0x004e4942) bin = buffer.slice(start, start + n);
    offset = start + n;
  }
  if (!doc || !bin || doc.meshes?.length !== 1 || doc.meshes[0].primitives?.length !== 1) throw new Error("unexpected ultralow GLB structure");
  const primitive = doc.meshes[0].primitives[0], geometry = new THREE.BufferGeometry();
  for (const [source, target] of [["POSITION", "position"], ["NORMAL", "normal"], ["TEXCOORD_0", "uv"]]) {
    if (primitive.attributes[source] === undefined) continue;
    const { array, width } = glbAccessor(doc, bin, primitive.attributes[source], true);
    geometry.setAttribute(target, new THREE.BufferAttribute(array, width));
  }
  if (primitive.indices !== undefined) geometry.setIndex(new THREE.BufferAttribute(glbAccessor(doc, bin, primitive.indices).array, 1));
  const node = doc.nodes?.[0];
  if (node?.matrix) geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix));
  else if (node && (node.translation || node.rotation || node.scale)) {
    const pos = new THREE.Vector3(...(node.translation || [0, 0, 0]));
    const rot = new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1]));
    const scale = new THREE.Vector3(...(node.scale || [1, 1, 1]));
    geometry.applyMatrix4(new THREE.Matrix4().compose(pos, rot, scale));
  }
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  return { geometry, material };
}
async function loadUltralowContainers() {
  const root = new URL("./models/containers-ultralow/", import.meta.url);
  const texture = await new THREE.TextureLoader().loadAsync(new URL("containers-atlas.png", root).href);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;  // glTF texture coordinates use the image origin at the top left
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  const files = { crate: "salvage_crate", footlocker: "crew_footlocker", tallLocker: "crew_locker", briefcase: "secure_briefcase" };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => {
    const response = await fetch(new URL(`${file}.glb`, root));
    if (!response.ok) throw new Error(`could not load ${file}.glb (${response.status})`);
    return [key, parseContainerGLB(await response.arrayBuffer(), texture)];
  })));
}

// model: { rooms: [{room_index, info:{fam,label}, cells:[{x,y,z}], cellSet:Set("x,y,z")}],
//          containers: [{kind, u, v, level, h, room}], extras: [{kind: "briefcase"|"tall_locker", u, v, level, h, room}],
//          hazards: [{code, kind, group: "enemy"|"turret"|"barrel", mount, room, u, v, level, h}] (code letters as in model.js HAZARD_KINDS),
//          all hoverable (userData.markers, one entry per instance),
//          links: [{room, upper, lower, cells:[{x,z}]}], entrance: [ex, ey, ez],
//          instances: [{scene, axes:[[3]x3], t:[3], room, level}],
//          doors: [{level, a:{x,z}, b:{x,z}, nx, nz, kind:"path"|"branch", slime}]  (edge between cells a and b),
//          fixtures: [{room, level, u0, u1, v0, v1, h0, h1, prop?}] (grid units; h = height above the deck floor in cells; `prop` set = it is a
//          container/hazard prop drawn as its own marker, so it is not drawn as a fixture block but still blocks walking),
//          walls: [{room, level, u0, u1, v0, v1}] (real wall footprint; when present it replaces the cell-edge walls) }
// opts.layers: { [layer key of LAYERS]: boolean }, a layer is shown unless false (DEFAULT_OFF layers: unless not true).
// opts.meshes: Map(scene -> BufferGeometry, piece-local layout units) enables opts.geometry (simple piece meshes);
// opts.cut: in geometry mode, everything higher than `cut` cells above its deck floor is clipped away (ceilings).
export function buildScene(model, opts = {}, ultralow = null) {
  const spread = opts.spread ?? 1.6;  // vertical distance between decks, in cells
  const visible = opts.visibleLevels;  // Set of levels to show, or undefined for all
  const group = new THREE.Group();
  const pickables = [];
  const show = (y) => !visible || visible.has(y);
  const layer = (k) => (DEFAULT_OFF.has(k) ? opts.layers?.[k] === true : opts.layers?.[k] !== false);
  const X = (u) => u - 6.5, Z = (v) => v - 6.5, Y = (level) => level * spread;
  const geometryMode = Boolean(opts.geometry && opts.meshes && opts.meshes.size && model.instances);
  const roomFam = new Map(model.rooms.map((r) => [r.room_index, r.info.fam]));

  if (geometryMode && (layer("walls") || layer("floors"))) {
    // piece p (layout units) -> layout p*A + t (row vectors) -> grid/8, shifted so deck L sits at L*spread
    const [ex, ey, ez] = model.entrance;
    const cut = opts.cut ?? 0.6;
    const groups = new Map();
    for (const inst of model.instances) {
      if (!show(inst.level) || !opts.meshes.has(inst.scene)) continue;
      const key = inst.scene + "|" + inst.level;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(inst);
    }
    const levelMats = new Map();
    const levelMat = (level) => {
      if (!levelMats.has(level)) {
        levelMats.set(level, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0.05, flatShading: true,
          side: THREE.DoubleSide, clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), Y(level) + cut)] }));
      }
      return levelMats.get(level);
    };
    const m = new THREE.Matrix4(), place = new THREE.Matrix4(), color = new THREE.Color();
    for (const insts of groups.values()) {
      const level = insts[0].level;
      const mesh = new THREE.InstancedMesh(opts.meshes.get(insts[0].scene), levelMat(level), insts.length);
      mesh.userData = { shared: true, rooms: insts.map((i) => i.room) };
      place.makeTranslation(ex - 6, ey + (spread - 1) * level, ez - 6).multiply(new THREE.Matrix4().makeScale(1 / 8, 1 / 8, 1 / 8));
      insts.forEach((inst, k) => {
        const A = inst.axes, t = inst.t;
        m.set(A[0][0], A[1][0], A[2][0], t[0], A[0][1], A[1][1], A[2][1], t[1], A[0][2], A[1][2], A[2][2], t[2], 0, 0, 0, 1);
        mesh.setMatrixAt(k, new THREE.Matrix4().multiplyMatrices(place, m));
        mesh.setColorAt(k, color.setHex(FAMILY_COLORS[roomFam.get(inst.room)] ?? FAMILY_COLORS.other));
      });
      group.add(mesh);
      pickables.push(mesh);
    }
  }

  // Clean rooms: floor tiles in a light tint of the room colour, walls in a dark tint, 0.5 cell (4 units) high, which
  // is the room height in the game meshes (their ceilings sit 4 units above the floor; decks are 8 apart).
  const wallH = 0.5, wallT = 0.07;
  const floorGeo = new THREE.BoxGeometry(1.0, 0.05, 1.0);
  const wallGeoX = new THREE.BoxGeometry(1.0, wallH, wallT), wallGeoZ = new THREE.BoxGeometry(wallT, wallH, 1.0);
  const postGeo = new THREE.CylinderGeometry(wallT * 0.75, wallT * 0.75, wallH, 12);
  const tint = (fam, toward, amount) => new THREE.Color(FAMILY_COLORS[fam] ?? FAMILY_COLORS.other).lerp(new THREE.Color(toward), fam === 'end' && opts.materialStyle === 'metal' ? amount * 0.35 : amount);
  const mats = {};
  const mat = (key, color) => {
    if (mats[key]) return mats[key];
    const metal = opts.materialStyle === 'metal' && /^[fw]/.test(key);
    const floor = key.startsWith('f'), endRoom = key === 'fend' || key === 'wend';
    return mats[key] = new THREE.MeshStandardMaterial({
      color: metal ? new THREE.Color(color).lerp(new THREE.Color(floor ? 0xb3c1cc : 0x607789), endRoom ? (floor ? 0.16 : 0.12) : (floor ? 0.78 : 0.65)) : color,
      roughness: metal ? 0.7 : 0.9, metalness: metal ? 0.24 : 0,
      ...(metal ? {map: panelTexture(floor ? 'floor' : 'wall')} : {})
    });
  };
  const doorEdges = new Set();
  for (const dr of model.doors || []) {
    doorEdges.add(`${dr.a.x},${dr.level},${dr.a.z},${dr.nx},${dr.nz}`);
    doorEdges.add(`${dr.b.x},${dr.level},${dr.b.z},${-dr.nx},${-dr.nz}`);
  }
  const holes = new Map();  // "x,y,z" of a stairwell cell on its upper deck -> link
  for (const link of model.links) for (const c of link.cells) holes.set(`${c.x},${link.upper},${c.z}`, link);
  const footprint = !geometryMode && model.walls && model.walls.length > 0;
  if (footprint && layer("walls")) {
    const byFam = new Map();
    for (const w of model.walls) {
      if (!show(w.level)) continue;
      const fam = model.rooms.find((r) => r.room_index === w.room)?.info.fam ?? "other";
      if (!byFam.has(fam)) byFam.set(fam, []);
      byFam.get(fam).push(w);
    }
    const unit = new THREE.BoxGeometry(1, 1, 1), mm = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const [fam, ws] of byFam) {
      const im = new THREE.InstancedMesh(unit, mat("w" + fam, tint(fam, 0x10141a, 0.55)), ws.length);
      ws.forEach((w, k) => {
        mm.compose(new THREE.Vector3(X((w.u0 + w.u1) / 2), Y(w.level) + wallH / 2, Z((w.v0 + w.v1) / 2)), q,
          new THREE.Vector3(w.u1 - w.u0, wallH, w.v1 - w.v0));
        im.setMatrixAt(k, mm);
      });
      im.userData = { rooms: ws.map((w) => w.room) };
      group.add(im);
      pickables.push(im);
    }
  }
  for (const r of model.rooms) {
    if (geometryMode) break;
    const fam = r.info.fam;
    const floorMat = mat("f" + fam, tint(fam, 0xffffff, 0.35)), wallMat = mat("w" + fam, tint(fam, 0x10141a, 0.55));
    for (const c of r.cells) {
      if (!show(c.y)) continue;
      if (layer("floors") && !holes.has(`${c.x},${c.y},${c.z}`)) {  // stairwell cells are open holes on the upper deck
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.set(X(c.x + 0.5), Y(c.y) - 0.025, Z(c.z + 0.5));
        floor.userData = { room: r.room_index };
        group.add(floor);
        pickables.push(floor);
      }
      if (footprint || !layer("walls")) continue;  // real wall footprint drawn above
      const has = (dx, dz) => r.cellSet.has(`${c.x + dx},${c.y},${c.z + dz}`);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (has(dx, dz) || doorEdges.has(`${c.x},${c.y},${c.z},${dx},${dz}`)) continue;
        const w = new THREE.Mesh(dx ? wallGeoZ : wallGeoX, wallMat);
        w.position.set(X(c.x + 0.5 + dx * (0.5 - wallT / 2)), Y(c.y) + wallH / 2, Z(c.z + 0.5 + dz * (0.5 - wallT / 2)));
        w.userData = { room: r.room_index };
        group.add(w);
        pickables.push(w);
      }
      // round posts where walls meet, so corners read as smooth joints instead of gaps or spikes
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (has(dx, 0) && has(0, dz)) continue;
        if (!has(dx, 0) || !has(0, dz) || !has(dx, dz)) {
          const p = new THREE.Mesh(postGeo, wallMat);
          p.position.set(X(c.x + 0.5 + dx * (0.5 - wallT / 2)), Y(c.y) + wallH / 2, Z(c.z + 0.5 + dz * (0.5 - wallT / 2)));
          group.add(p);
        }
      }
    }
  }

  // stairwells: the game uses a ladder (STAIRS_UP/DOWN -> ROOM_LADDER) from the lower deck floor up through the hole.
  // It stands against the far side of the shaft (+d); you step in from the room on the upper deck (-d side) and
  // arrive in the room on the lower deck (first side that fits both).
  const ladderMat = new THREE.MeshStandardMaterial({ color: 0xc9d3dc, metalness: 0.4, roughness: 0.45 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x3fd0c9, emissive: 0x0f3f3c, roughness: 0.5 });
  const roomOf = new Map(model.rooms.map((r) => [r.room_index, r]));
  for (const link of layer("ladders") ? model.links : []) {
    if (!show(link.upper) && !show(link.lower)) continue;
    const r = roomOf.get(link.room);
    const inRoom = (x, y, z) => r.cellSet.has(`${x},${y},${z}`);
    for (const c of link.cells) {
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      const d = dirs.find(([dx, dz]) => inRoom(c.x - dx, link.upper, c.z - dz) && inRoom(c.x + dx, link.lower, c.z + dz))
        || dirs.find(([dx, dz]) => inRoom(c.x + dx, link.lower, c.z + dz)) || dirs[0];
      const bottom = Y(link.lower), top = Y(link.upper) + 0.15, h = top - bottom;
      const side = [d[1], d[0]];  // across the ladder (perpendicular to d)
      const cx = c.x + 0.5 + d[0] * 0.38, cz = c.z + 0.5 + d[1] * 0.38;
      for (const s of [-1, 1]) {  // rails
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, h, 0.035), ladderMat);
        rail.position.set(X(cx + side[0] * s * 0.17), bottom + h / 2, Z(cz + side[1] * s * 0.17));
        rail.userData = { room: link.room, link };
        group.add(rail);
        pickables.push(rail);
      }
      const rungs = Math.max(6, Math.round(h / 0.11));
      for (let k = 1; k < rungs; k++) {  // rungs
        const rung = new THREE.Mesh(new THREE.BoxGeometry(side[0] ? 0.34 : 0.025, 0.025, side[1] ? 0.34 : 0.025), ladderMat);
        rung.position.set(X(cx), bottom + (k * h) / rungs, Z(cz));
        group.add(rung);
      }
      if (show(link.upper)) {  // railing around the hole, open on the entry side
        for (const [dx, dz] of dirs) {
          if (dx === -d[0] && dz === -d[1]) continue;
          const rail = new THREE.Mesh(new THREE.BoxGeometry(dx ? 0.03 : 1, 0.12, dz ? 0.03 : 1), railMat);
          rail.position.set(X(c.x + 0.5 + dx * 0.47), Y(link.upper) + 0.12, Z(c.z + 0.5 + dz * 0.47));
          group.add(rail);
        }
      }
    }
  }

  // doors: an opening with a frame on the shared edge; colour by kind
  const doorColors = { path: 0x3fd0c9, branch: 0xffb347, slime: 0x7bd36b };
  for (const dr of layer("doors") ? model.doors || [] : []) {
    if (!show(dr.level) || geometryMode) continue;
    const m = new THREE.MeshStandardMaterial({ color: doorColors[dr.slime ? "slime" : dr.kind], emissive: 0x111111, roughness: 0.5 });
    const ex = (dr.a.x + dr.b.x) / 2 + 0.5, ez = (dr.a.z + dr.b.z) / 2 + 0.5;  // edge midpoint
    const along = dr.nx ? [0, 1] : [1, 0];
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, wallH, 0.08), m);
      post.position.set(X(ex + along[0] * side * 0.32), Y(dr.level) + wallH / 2, Z(ez + along[1] * side * 0.32));
      group.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(along[0] ? 0.72 : 0.08, 0.07, along[1] ? 0.72 : 0.08), m);
    lintel.position.set(X(ex), Y(dr.level) + wallH - 0.035, Z(ez));
    lintel.userData = { door: dr };
    group.add(lintel);
    pickables.push(lintel);
    // walls either side of the 0.56-wide opening (only with cell-edge walls; the footprint has its own)
    for (const side of footprint || !layer("walls") ? [] : [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(along[0] ? 0.18 : wallT, wallH, along[1] ? 0.18 : wallT), mat("door-wall", 0x3a414c));
      w.position.set(X(ex + along[0] * side * 0.41), Y(dr.level) + wallH / 2, Z(ez + along[1] * side * 0.41));
      group.add(w);
    }
  }

  // fixtures: floor-standing props (worktops, shelving, machinery) as dark blocks you cannot walk through. Props that are drawn
  // as a container or hazard marker (tall lockers, barrels) are left out so nothing is drawn twice.
  if (!geometryMode && layer("fixtures")) {
    const fixMat = new THREE.MeshStandardMaterial({ color: 0x2b313a, roughness: 0.9 });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const fx = (model.fixtures || []).filter((f) => show(f.level) && !f.prop && !(f.detail && layer("hangarDetails")));
    if (fx.length) {
      const im = new THREE.InstancedMesh(unit, fixMat, fx.length);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion();
      fx.forEach((f, k) => {
        const h1 = Math.min(f.h1, wallH), h0 = Math.max(0, f.h0);
        mm.compose(new THREE.Vector3(X((f.u0 + f.u1) / 2), Y(f.level) + (h0 + h1) / 2, Z((f.v0 + f.v1) / 2)), q,
          new THREE.Vector3(Math.max(0.03, f.u1 - f.u0), Math.max(0.03, h1 - h0), Math.max(0.03, f.v1 - f.v0)));
        im.setMatrixAt(k, mm);
      });
      im.userData = { rooms: fx.map((f) => f.room), fixture: true };
      group.add(im);
      pickables.push(im);
    }
  }

  // hangar (HG1): the game's fixed ship hull of every R_WEXT_HANG1 piece, and the hangar's decoration props, each with its
  // placed piece's own matrix (layout = local * axes + t, as the walls/doors/containers) -> grid/8 -> deck spacing.
  // Ship model: the game's own mesh when the local viewer has built it (local only, never published), else a hand-made
  // simplified ship of the same size and shape outline (the website). In geometry mode the piece mesh already shows the hull.
  const pieceMatrix = (s) => {
    const [ex, ey, ez] = model.entrance, A = s.axes, t = s.t;
    return new THREE.Matrix4().makeTranslation(ex - 6, ey + (spread - 1) * s.level, ez - 6).multiply(new THREE.Matrix4().makeScale(1 / 8, 1 / 8, 1 / 8))
      .multiply(new THREE.Matrix4().set(A[0][0], A[1][0], A[2][0], t[0], A[0][1], A[1][1], A[2][1], t[1], A[0][2], A[1][2], A[2][2], t[2], 0, 0, 0, 1));
  };
  if (!geometryMode && layer("ship")) {
    const shipGeo = opts.meshes && (opts.meshes.get(SHIP_DETAIL_KEY) || opts.meshes.get(SHIP_SCENE));
    for (const s of model.ships || []) {
      if (!show(s.level)) continue;
      const ship = shipGeo ? new THREE.Mesh(shipGeo, shipMeshMaterial()) : hangarShip();
      ship.matrixAutoUpdate = false;
      ship.matrix.copy(pieceMatrix(s));
      ship.userData = { room: s.room, ship: true, shared: true };  // cached geometry: not disposed on rebuild
      group.add(ship);
      if (shipGeo) pickables.push(ship);
    }
  }
  if (!geometryMode && layer("hangarDetails")) {
    for (const s of model.details || []) {
      if (!show(s.level)) continue;
      const node = new THREE.Matrix4().compose(new THREE.Vector3(...s.pos), orientQ(new THREE.Quaternion(), s.rot), _one);
      const prop = hangarDetail(s.code, s.box);
      prop.matrixAutoUpdate = false;
      prop.matrix.copy(pieceMatrix(s).multiply(node));
      prop.userData = { room: s.room };
      group.add(prop);
    }
  }

  // Loot containers, enemies, turrets and sacs: one instanced mesh pair (body + unlit glow) per object type, positioned at
  // their exact generated places; h = height above the deck floor in cells. Each mesh keeps a `markers` list (one hover
  // description per instance). Spawner nodes sit 2 m above their deck, ceiling turrets 4 m.
  const markerMats = {
    body: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0.1, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
  };
  // box (a CONTAINER_BOX entry): the model is fitted to it and turned by each item's `rot` (containers)
  const putModels = (name, list, lift, info, rotate, box) => {
    const items = list.filter((c) => show(c.level));
    if (!items.length) return;
    const meshAsset = ultralow && ultralow[name];
    if (meshAsset) {
      const im = new THREE.InstancedMesh(meshAsset.geometry, meshAsset.material, items.length);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), fit = box ? fitMatrix([meshAsset.geometry], box) : null;
      items.forEach((c, k) => {
        if (fit) mm.compose(p.set(X(c.u), Y(c.level) + 0.03 + c.h + lift, Z(c.v)), orientQ(q, c.rot), _one).multiply(fit);
        else {
          q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotate && rotate(c) ? Math.PI : 0);
          mm.compose(p.set(X(c.u), Y(c.level) + 0.03 + c.h + lift, Z(c.v)), q, new THREE.Vector3(0.125, 0.125, 0.125));
        }
        im.setMatrixAt(k, mm);
      });
      im.userData = { shared: true, markers: items.map((c) => info(c)) };
      group.add(im);
      pickables.push(im);
      return;
    }
    const parts = mergeParts(name), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const fit = box ? fitMatrix([parts.body, parts.glow], box) : null;
    for (const kind of ["body", "glow"]) {
      if (!parts[kind]) continue;
      const im = new THREE.InstancedMesh(parts[kind], markerMats[kind], items.length);
      items.forEach((c, k) => {
        if (fit) orientQ(q, c.rot);
        else q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotate && rotate(c) ? Math.PI : 0);
        mm.compose(p.set(X(c.u), Y(c.level) + 0.03 + c.h + lift, Z(c.v)), q, one);
        if (fit) mm.multiply(fit);
        im.setMatrixAt(k, mm);
      });
      im.userData = { shared: true, markers: items.map((c) => info(c)) };
      group.add(im);
      pickables.push(im);
    }
  };
  const byKind = (list, kind) => list.filter((c) => c.kind === kind);
  if (layer("crates")) putModels("crate", byKind(model.containers, "salvage_crate"), 0, (c) => ({ container: "salvage_crate", room: c.room }), null, CONTAINER_BOX.crate);
  if (layer("footlockers")) putModels("footlocker", byKind(model.containers, "crew_footlocker"), 0, (c) => ({ container: "crew_footlocker", room: c.room }), null, CONTAINER_BOX.footlocker);
  const moduleMarks = (model.containers || []).filter((c) => c.module || c.modulePossible)
    .filter((c) => layer("modules") && show(c.level) && layer(c.kind === "salvage_crate" ? "crates" : "footlockers"));
  if (moduleMarks.length) {
    const definiteMat = new THREE.MeshBasicMaterial({ color: 0xffd34e, depthTest: true });
    const possibleMat = new THREE.MeshBasicMaterial({ color: 0xff9b42, depthTest: true });
    const geometry = new THREE.TorusGeometry(0.25, 0.055, 6, 16);
    for (const c of moduleMarks) {
      const ring = new THREE.Mesh(geometry, c.module ? definiteMat : possibleMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(X(c.u), Y(c.level) + 0.3 + c.h, Z(c.v));
      ring.renderOrder = 10;
      group.add(ring);
    }
  }
  if (layer("briefcases")) putModels("briefcase", byKind(model.extras || [], "briefcase"), 0, (c) => ({ extra: c.kind, room: c.room }), null, CONTAINER_BOX.briefcase);
  if (layer("tallLockers")) putModels("tallLocker", byKind(model.extras || [], "tall_locker"), 0, (c) => ({ extra: c.kind, room: c.room }), null, CONTAINER_BOX.tallLocker);
  const hazardModel = { T: "turret", F: "floater", f: "fastFloater", D: "drone", B: "bugSpawner", S: "hangSac", P: "pillarSac", E: "egg", X: "barrel" };
  for (const [code, name] of Object.entries(hazardModel)) {
    if (!layer(HAZARD_LAYER[code])) continue;
    putModels(name, (model.hazards || []).filter((c) => c.code === code), MODEL_LIFT[name] ?? 0, (c) => ({ hazard: c, room: c.room }),
      code === "T" ? (c) => c.mount !== "c" : null);  // the turret model hangs from its origin (ceiling mount); other mounts stand
  }

  // entrance marker
  const [ex, ey, ez] = model.entrance;
  if (layer("entrance") && show(ey)) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), new THREE.MeshStandardMaterial({ color: 0x3fd0c9, emissive: 0x124a47 }));
    cone.position.set(X(ex + 0.5), Y(ey) + 0.35, Z(ez + 0.5));
    cone.rotation.x = Math.PI;
    cone.userData = { hideInFirstPerson: true };
    if(opts.entranceFocus){cone.material.depthTest=false;cone.material.depthWrite=false;cone.renderOrder=100;}
    group.add(cone);
    if(opts.entranceFocus){const label=labelSprite('ENTRANCE');label.position.set(X(ex+.5),Y(ey)+.95,Z(ez+.5));group.add(label);}
  }
  return { group, pickables };
}

// HG1 hangar ship. The game's hangar ship is fixed geometry of the R_WEXT_HANG1 piece (SALVAGESHIP node of
// dungeon/hangar/room_wallexterior_4_1): one fighter hull, piece-local box x -2.34..2.34, y 0..3.17, z 8.23..18.63 (metres),
// nose toward local -z. The local viewer draws the game's own mesh (tools/build_hangar_ship_mesh_705.py writes it into the
// local mesh cache; never published); without it, hangarShip() is a hand-made simplified ship with the same size and outline
// (sections measured from the hull, plan/HANGAR_SHIPS.md), in the same piece-local frame.
export const SHIP_SCENE = "MODELS/SPACE/POI/DUNGEON/HANGAR/ROOM_WALLEXTERIOR_4_1.SCENE.MBIN";
const SHIP_DETAIL_KEY = "HG1:SHIP";                                // opts.meshes key of the detailed local ship mesh
const SHIP_MESH_FILE = "485057b959746717b3cb0c5b5416c72279deb1b2";  // meshcache/pieces/<this>.bin (sha1 of "HG1 hangar ship SALVAGESHIP LOD2")
const _hangarMats = {};
const hangarMat = (key, color, extra = {}) => (_hangarMats[key] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, flatShading: true, side: THREE.DoubleSide, ...extra }));
function shipMeshMaterial() {
  return hangarMat("shipMesh", 0xd5dae0, { vertexColors: true, side: THREE.DoubleSide, metalness: 0.25 });
}
// a closed hull section from z0 to z1: rectangles [x centre, half width, y bottom, y top] at both ends (flat shaded)
function loft(z0, a, z1, b) {
  const v = (s, z) => [[s[0] - s[1], s[2], z], [s[0] + s[1], s[2], z], [s[0] + s[1], s[3], z], [s[0] - s[1], s[3], z]];
  const p = [...v(a, z0), ...v(b, z1)];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const pos = [];
  for (const [i, j, k, l] of quads) for (const n of [i, j, k, i, k, l]) pos.push(...p[n]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
let _shipParts = null;
// The simplified website ship: hull sections, canopy, two side engine pods with glow, landing gear (piece-local metres).
function hangarShip() {
  if (!_shipParts) {
    const hull = hangarMat("shipHull", 0xc9ced4), trim = hangarMat("shipTrim", 0x59626c), glass = hangarMat("shipGlass", 0x3fd0c9, { emissive: 0x0a3534 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff9a3c });
    const S = [[8.25, [0, 0.05, 0.9, 0.95]], [9.0, [0, 0.45, 0.88, 1.42]], [10.5, [0, 0.62, 0.88, 1.68]], [12.5, [0, 0.75, 0.82, 1.78]],
      [13.5, [0, 0.88, 0.55, 1.95]], [14.5, [0, 1.0, 0.5, 2.3]], [16.0, [0, 1.15, 0.5, 2.85]], [17.5, [0, 1.15, 0.7, 3.0]], [18.62, [0, 0.85, 2.0, 3.15]]];
    _shipParts = [];
    for (let k = 1; k < S.length; k++) _shipParts.push([loft(S[k - 1][0], S[k - 1][1], S[k][0], S[k][1]), hull]);
    _shipParts.push([loft(12.6, [0, 0.42, 1.74, 1.82], 13.6, [0, 0.74, 1.9, 2.32]), glass], [loft(13.6, [0, 0.74, 1.9, 2.32], 14.4, [0, 0.8, 2.25, 2.48]), glass]);
    for (const sx of [-1.75, 1.75]) {
      _shipParts.push([loft(15.0, [sx, 0.42, 1.55, 2.4], 15.6, [sx, 0.56, 0.95, 2.41]), trim], [loft(15.6, [sx, 0.56, 0.95, 2.41], 17.95, [sx, 0.56, 1.0, 2.4]), hull]);
      _shipParts.push([loft(17.95, [sx, 0.38, 1.25, 2.15], 18.0, [sx, 0.38, 1.25, 2.15]), glow]);
      _shipParts.push([loft(15.2, [sx * 0.4, 0.07, 0.0, 0.6], 16.2, [sx * 0.4, 0.07, 0.0, 0.6]), trim]);   // rear legs
    }
    _shipParts.push([loft(12.75, [0, 0.07, 0.0, 0.85], 13.15, [0, 0.07, 0.0, 0.85]), trim]);               // nose leg
  }
  const g = new THREE.Group();
  for (const [geo, m] of _shipParts) { const o = new THREE.Mesh(geo, m); o.userData.shared = true; g.add(o); }
  g.userData = { ship: true };
  return g;
}

// HG1 hangar detail props (piece_props.json "d"): a simple shape per prop type, fitted to the prop's own-frame box
// b = [x0, y0, z0, x1, y1, z1] (metres); placed by the caller with piece matrix x node transform.
const DETAIL_COLORS = { crate: 0x8a8f96, bigcrate: 0x7d858d, looted: 0x8a8f96, lid: 0x8a8f96, pallet: 0x6b5a46, barrel: 0x9a7b4f, shelf: 0x5d6670,
  cabinet: 0x6f7780, desk: 0x5d6670, walldesk: 0x5d6670, monitor: 0x2f3a45, helmet: 0xd9d4c7, light: 0x5d6670, debris: 0x7d858d };
const _detailGeo = new Map();
function hangarDetail(code, b) {
  const key = code + b.join(",");
  if (!_detailGeo.has(key)) {
    const [x0, y0, z0, x1, y1, z1] = b, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const box = (bw, bh, bd, x, y, z) => new THREE.BoxGeometry(bw, bh, bd).translate(x, y, z);
    const parts = [];  // [geometry, darker?]
    if (code === "barrel") parts.push([new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, h, 12).translate(cx, y0 + h / 2, cz), false]);
    else if (code === "helmet") parts.push([new THREE.SphereGeometry(0.5, 10, 8).scale(w, h, d).translate(cx, y0 + h / 2, cz), false]);
    else if (code === "light") parts.push([box(w * 0.15, h * 0.8, d * 0.15, cx, y0 + h * 0.4, cz), true], [box(w, h * 0.2, d, cx, y0 + h * 0.9, cz), false]);
    else if (code === "shelf") {
      for (const zz of [z0 + 0.03, z1 - 0.03]) parts.push([box(w, h, 0.06, cx, y0 + h / 2, zz), true]);
      for (const f of [0.05, 0.38, 0.7, 0.98]) parts.push([box(w, 0.05, d, cx, y0 + h * f, cz), false]);
    } else if (code === "crate" || code === "bigcrate" || code === "looted") {
      parts.push([box(w, h * 0.85, d, cx, y0 + h * 0.425, cz), false], [box(w * 1.02, h * 0.15, d * 1.02, cx, y0 + h * 0.925, cz), true]);
    } else if (code === "desk" || code === "walldesk") parts.push([box(w, h * 0.08, d, cx, y0 + h * 0.46, cz), false], [box(w * 0.9, h * 0.42, d * 0.5, cx, y0 + h * 0.21, cz), true]);
    else parts.push([box(w, h, d, cx, y0 + h / 2, cz), false]);
    _detailGeo.set(key, parts);
  }
  const g = new THREE.Group();
  const c = DETAIL_COLORS[code] ?? 0x7d858d;
  for (const [geo, dark] of _detailGeo.get(key)) {
    const o = new THREE.Mesh(geo, hangarMat("detail" + code + dark, dark ? new THREE.Color(c).multiplyScalar(0.6).getHex() : c,
      code === "monitor" ? { emissive: 0x0b2a33 } : {}));
    o.userData.shared = true;  // cached geometry: not disposed on rebuild
    g.add(o);
  }
  return g;
}

function labelSprite(text) {
  const c = document.createElement("canvas");
  const entrance=text==="ENTRANCE";c.width = entrance?256:64; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(14,17,22,0.75)";
  if(entrance)g.fillRect(4,8,248,50);else{g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();}
  g.fillStyle = "#e6edf3"; g.font = "bold 30px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, entrance?128:32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(entrance?1.8:.55, entrance?.45:.55, 1);
  s.renderOrder = 10;
  s.userData = { hideInFirstPerson: true };
  return s;
}

// First-person walking (cells; 1 cell = 8 m): eye height 1.7 m, body radius 0.4 m, walking 3.5 m/s, running 8 m/s.
const FP = { eye: 1.7 / 8, radius: 0.25 / 8, walk: 3.5 / 8, run: 8 / 8, lookSpeed: 0.0022, keyLook: 1.8, climbTime: 0.7, fov: 75 };
export const FP_HELP = "WASD: walk · mouse or arrow keys: look · Shift: run · in a stairwell: Space or E climbs up, Q or C down · Esc: leave";

// Mounts an interactive view into `el`. onHover(info|null, event) drives the page tooltip; onFirstPerson(active) is called when
// first-person mode starts or ends (also when the browser ends it, e.g. Esc releasing the pointer). Returns a control object.
export function mount(el, model, { onHover, onFirstPerson, twoFingerTouch=false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0b0e12);
  renderer.localClippingEnabled = true;
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const routeOverlay=createRouteOverlay3D(THREE,labelSprite);scene.add(routeOverlay.group);let route=null,routeStep=0;
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242c, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-6, 12, -8);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  let opts = { spread: 1.6, visibleLevels: undefined, framing:twoFingerTouch?'photo':null,lookSensitivity:1,touchMode:'pan',entranceFocus:twoFingerTouch };
  const touchHint=twoFingerTouch?createTouchHint(el,{message:()=>opts.touchMode==='orbit'?'Use two fingers: drag up/down to tilt, sideways to orbit':'Use two fingers: drag to pan, pinch to zoom, twist to rotate · Tilt button for above/below'}):null;
  let autoFrame=twoFingerTouch;
  const touchControls=twoFingerTouch?bindTwoFingerGestures(renderer.domElement,{axisLock:()=>opts.touchMode==='orbit',enabled:()=>controls.enabled,onSingleStart:()=>touchHint.show(),onSingleMove:()=>touchHint.show(),onStart:()=>{autoFrame=false;touchHint.hide();},onGesture:g=>orbitTouchGesture(camera,controls,renderer.domElement,g)}):null;
  let built = null, overviewBounds = null;
  let ultralow = null, disposed = false;
  const frameCamera=(targetCamera=camera,target=controls.target)=>{
    if(!built||!opts.framing)return false;
    const bounds=overviewBounds;if(!bounds||bounds.isEmpty())return false;
    fitOverviewCamera(targetCamera,target,bounds,opts.framing);return true;
  };
  const home=()=>{autoFrame=twoFingerTouch;if(!frameCamera()){camera.position.set(0,13,-15);controls.target.set(0,2,0);}controls.update();};
  home();
  controls.addEventListener('start',()=>{autoFrame=false;});
  const hideForFp = () => { if (built) built.group.traverse((o) => { if (o.userData.hideInFirstPerson) o.visible = !fp.active; }); };
  const rebuild = () => {
    if (built) {
      scene.remove(built.group);
      built.group.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    }
    built = buildScene(model, opts, ultralow);
    if (opts.layers?.labels !== false) {
      for (const r of model.rooms) {  // one number per room per visible deck, above its first cell there
        const seen = new Set();
        for (const c of r.cells) {
          if (seen.has(c.y) || (opts.visibleLevels && !opts.visibleLevels.has(c.y))) continue;
          seen.add(c.y);
          const s = labelSprite(String(r.room_index));
          s.position.set(c.x + 0.5 - 6.5, c.y * opts.spread + 0.75, c.z + 0.5 - 6.5);
          built.group.add(s);
        }
      }
    }
    hideForFp();
    scene.add(built.group);
    routeOverlay.set(route,routeStep,opts.spread);
    if(twoFingerTouch){overviewBounds=collectOverviewBounds(built.group);overviewBounds.entranceAzimuth=entranceAzimuth(model);}
    if(autoFrame&&!fp.active){frameCamera();controls.update();}
    render();
  };

  const resize = () => {
    const full = document.fullscreenElement === el || el.classList.contains("fp-fullscreen-fallback");  // walking fullscreen: fill the element, not 60% of its width
    const w = Math.max(1, el.clientWidth), h = (full || el.classList.contains("viewport3d")) && el.clientHeight > 0 ? el.clientHeight : Math.max(320, Math.round(w * 0.6));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if(autoFrame&&!fp.active){frameCamera();controls.update();}
    render();
  };
  function render() { renderer.render(scene, camera); }
  controls.addEventListener("change", render);
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const onMove = (ev) => {
    if (fp.active || (twoFingerTouch && ev.pointerType === "touch")) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(built.pickables, false)[0];
    let info = hit ? hit.object.userData : null;
    if (hit && hit.object.userData.markers) info = { marker: hit.object.userData.markers[hit.instanceId] };
    else if (hit && hit.object.isInstancedMesh) info = { room: hit.object.userData.rooms[hit.instanceId], fixture: hit.object.userData.fixture };
    if (onHover) onHover(info, ev);
  };
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerleave", () => onHover && onHover(null));

  // ---- first person: walk through the derelict at eye height. Walls (the real footprint rectangles; cell edges without
  // piece data) and the room cells always limit where you can stand; doorways are open in the footprint. Fixtures, loot
  // containers (their turned game boxes) and barrels block only while their 3D layer is shown, so hiding a layer (also
  // while walking) lets you through and showing it again blocks again.
  const X = (u) => u - 6.5, Z = (v) => v - 6.5;
  const fp = { active: false, locked: false, hadLock: false, x: 0, z: 0, level: 0, y: 0, yaw: Math.PI, pitch: 0, climb: null, drag: false,
    keys: new Set(), raf: 0, last: 0, saved: null, hint: "", touchFwd: 0, touchSide: 0, lookSX: 0, lookSY: 0,
    ownsFullscreen: false, fallbackFullscreen: false, oldBodyOverflow: "", lookPointer: null, stickPointer: null, lookStickPointer: null };
  const overlay = document.createElement("div");
  overlay.className = "fp-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div class="fp-help"></div><button class="fp-exit" type="button" aria-label="Leave first-person view">Leave</button><div class="fp-look-zone" aria-label="Drag here to look"></div><div class="fp-stick" aria-label="Move joystick"><div class="fp-stick-knob"></div></div><div class="fp-stick fp-look-stick" aria-label="Look joystick"><div class="fp-stick-knob"></div></div><button class="fp-rotate" type="button" hidden>Rotate</button><div class="fp-mobile-climb"><button type="button" data-climb="1">Up</button><button type="button" data-climb="-1">Down</button></div><div class="fp-hint"></div><div class="fp-cross"></div>`;
  el.appendChild(overlay);
  const helpEl = overlay.querySelector(".fp-help"), hintEl = overlay.querySelector(".fp-hint");
  helpEl.textContent = matchMedia("(pointer: coarse)").matches ? "Left stick: walk · right stick or drag: look · Up/Down: climb · Leave to exit" : FP_HELP;

  const layerOn = (k) => (DEFAULT_OFF.has(k) ? opts.layers?.[k] === true : opts.layers?.[k] !== false);  // as in buildScene()
  // per deck: { rects: [{x0, x1, z0, z1, soft}] in world coordinates, or turned ones {ox, oz, c, s, x0..z1} (a container box
  // in its own frame around ox, oz), cells: Set("x,z") }; dropped on every setOptions() (layer change) and rebuilt
  let walkCache = null;
  const walkData = (level) => {
    if (!walkCache) {
      walkCache = new Map();
      const get = (l) => { if (!walkCache.has(l)) walkCache.set(l, { rects: [], cells: new Set() }); return walkCache.get(l); };
      for (const r of model.rooms) for (const c of r.cells) get(c.y).cells.add(`${c.x},${c.z}`);
      if (model.walls && model.walls.length) {
        for (const w of model.walls) get(w.level).rects.push({ x0: X(w.u0), x1: X(w.u1), z0: Z(w.v0), z1: Z(w.v1) });
      } else {  // no piece data: wall segments on the room cell edges, doors left open (as drawn)
        const doorEdges = new Set();
        for (const dr of model.doors || []) {
          doorEdges.add(`${dr.a.x},${dr.level},${dr.a.z},${dr.nx},${dr.nz}`);
          doorEdges.add(`${dr.b.x},${dr.level},${dr.b.z},${-dr.nx},${-dr.nz}`);
        }
        const t = 0.035;
        for (const r of model.rooms) for (const c of r.cells) {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (r.cellSet.has(`${c.x + dx},${c.y},${c.z + dz}`) || doorEdges.has(`${c.x},${c.y},${c.z},${dx},${dz}`)) continue;
            const x = dx > 0 ? c.x + 1 : c.x, z = dz > 0 ? c.z + 1 : c.z;
            get(c.y).rects.push(dx ? { x0: X(x) - t, x1: X(x) + t, z0: Z(c.z), z1: Z(c.z + 1) } : { x0: X(c.x), x1: X(c.x + 1), z0: Z(z) - t, z1: Z(z) + t });
          }
        }
      }
      // props are box approximations: a slimmer body (soft) slips between two of them. The fixture box of a tall locker or
      // briefcase ("t", "b") is replaced by the container's own turned box below; a barrel's ("X") follows the Barrels layer.
      for (const f of model.fixtures || []) {
        if (f.prop === "t" || f.prop === "b" || !layerOn(f.prop === "X" ? "barrel" : "fixtures")) continue;
        get(f.level).rects.push({ x0: X(f.u0), x1: X(f.u1), z0: Z(f.v0), z1: Z(f.v1), soft: true });
      }
      // Fixed hull footprints use the same placed-piece matrix as the visible ship.
      for(const ship of layerOn('ship')?model.ships||[]:[])get(ship.level).rects.push(hangarFootprint(ship,model.entrance));
      for (const c of [...(model.containers || []), ...(model.extras || [])]) {
        const kind = CONTAINER_KINDS[c.kind];
        if (!kind || !layerOn(kind[1])) continue;
        const r = containerFootprint(c, CONTAINER_BOX[kind[0]]);
        if (r) get(c.level).rects.push(r);
      }
    }
    return walkCache.get(level) || { rects: [], cells: new Set() };
  };
  const blocked = (d, x, z) => {
    if (!d.cells.has(`${Math.floor(x + 6.5)},${Math.floor(z + 6.5)}`)) return true;
    for (const r of d.rects) {
      let px = x, pz = z;
      if (r.ox !== undefined) { const ox = x - r.ox, oz = z - r.oz; px = ox * r.c - oz * r.s; pz = ox * r.s + oz * r.c; }  // into the box frame
      const dx = px - Math.max(r.x0, Math.min(px, r.x1)), dz = pz - Math.max(r.z0, Math.min(pz, r.z1));
      const rr = r.soft ? FP.radius * 0.5 : FP.radius;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  };
  // moves by (dx, dz) in small steps, sliding along walls; a player who already stands in something (a start inside a fixture) may walk out
  const moveBy = (dx, dz) => {
    const d = walkData(fp.level), n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.015));
    for (let k = 0; k < n; k++) {
      const stuck = blocked(d, fp.x, fp.z);
      if (!blocked(d, fp.x + dx / n, fp.z + dz / n) || stuck) fp.x += dx / n;
      if (!blocked(d, fp.x, fp.z + dz / n) || stuck) fp.z += dz / n;
    }
  };
  const linkHere = (dir) => {  // dir +1: a ladder up from this deck at the player's cell, -1: down
    const cx = Math.floor(fp.x + 6.5), cz = Math.floor(fp.z + 6.5);
    return model.links.find((l) => l.cells.some((c) => c.x === cx && c.z === cz) && (dir > 0 ? l.lower === fp.level : l.upper === fp.level));
  };
  const deckY = (level) => level * opts.spread;
  const climb = (dir) => {
    const link = linkHere(dir);
    if (!link || fp.climb) return;
    fp.climb = { from: fp.y, to: deckY(dir > 0 ? link.upper : link.lower) + FP.eye, t: 0, level: dir > 0 ? link.upper : link.lower };
  };
  const fpFrame = (now) => {
    if (!fp.active) return;
    const dt = Math.min(0.05, Math.max(0, (now - fp.last) / 1000));
    fp.last = now;
    stepFirstPerson(dt);
    fp.raf = requestAnimationFrame(fpFrame);
  };
  function stepFirstPerson(dt) {
    const k = fp.keys;
    fp.yaw += ((k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0)) * FP.keyLook * dt;
    fp.pitch = Math.max(-1.5, Math.min(1.5, fp.pitch + ((k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0)) * FP.keyLook * dt));
    if (fp.lookSX || fp.lookSY) {  // look joystick: turn rate grows with the deflection
      fp.yaw -= walkingLookRate(fp.lookSX,opts.lookSensitivity) * dt;
      fp.pitch = Math.max(-1.5, Math.min(1.5, fp.pitch - walkingLookRate(fp.lookSY,opts.lookSensitivity) * dt));
    }
    if (fp.climb) {
      fp.climb.t += dt / FP.climbTime;
      const t = Math.min(1, fp.climb.t), s = t * t * (3 - 2 * t);
      fp.y = fp.climb.from + (fp.climb.to - fp.climb.from) * s;
      if (t >= 1) { fp.level = fp.climb.level; fp.climb = null; if (blocked(walkData(fp.level), fp.x, fp.z)) { fp.x = Math.floor(fp.x + 6.5) + 0.5 - 6.5; fp.z = Math.floor(fp.z + 6.5) + 0.5 - 6.5; } }
    } else {
      const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0) + fp.touchFwd, side = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + fp.touchSide;
      if (fwd || side) {
        const length = Math.hypot(fwd, side), speed = (k.has("ShiftLeft") || k.has("ShiftRight") ? FP.run : FP.walk) * dt / Math.max(1, length);
        moveBy((-Math.sin(fp.yaw) * fwd + Math.cos(fp.yaw) * side) * speed, (-Math.cos(fp.yaw) * fwd - Math.sin(fp.yaw) * side) * speed);
      }
      fp.y = deckY(fp.level) + FP.eye;
    }
    camera.position.set(fp.x, fp.y, fp.z);
    camera.rotation.set(fp.pitch, fp.yaw, 0, "YXZ");
    const touchUi = matchMedia("(pointer: coarse)").matches;
    const hint = !fp.climb && linkHere(1) ? (touchUi ? "Stairwell: tap Up" + (linkHere(-1) ? " or Down" : "") : "Stairwell: Space or E climbs up" + (linkHere(-1) ? ", Q or C down" : ""))
      : !fp.climb && linkHere(-1) ? (touchUi ? "Stairwell: tap Down" : "Stairwell: Q or C climbs down") : "";
    if (hint !== fp.hint) { fp.hint = hint; hintEl.textContent = hint; }
    render();
  }
  const onKeyDown = (ev) => {
    if (!fp.active) return;
    if (ev.code === "Escape") { exitFirstPerson(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space", "KeyE", "KeyQ", "KeyC"].includes(ev.code)) ev.preventDefault();
    if (ev.repeat) return;
    fp.keys.add(ev.code);
    if (ev.code === "Space" || ev.code === "KeyE") climb(1);
    else if (ev.code === "KeyQ" || ev.code === "KeyC") climb(-1);
  };
  const onKeyUp = (ev) => { fp.keys.delete(ev.code); };
  const onMouseMove = (ev) => {
    if (!fp.active || !(fp.locked || fp.drag)) return;
    fp.yaw -= ev.movementX * FP.lookSpeed;
    fp.pitch = Math.max(-1.5, Math.min(1.5, fp.pitch - ev.movementY * FP.lookSpeed));
  };
  const onLockChange = () => {
    fp.locked = document.pointerLockElement === renderer.domElement;
    if (fp.locked) fp.hadLock = true;
    else if (fp.active && fp.hadLock) exitFirstPerson();  // Esc (or the browser) released the pointer
  };
  const lookZone = overlay.querySelector(".fp-look-zone"), stick = overlay.querySelector(".fp-stick"), lookStick = overlay.querySelector(".fp-look-stick"), stickKnob = overlay.querySelector(".fp-stick-knob");
  const onTouchLookDown = (ev) => { if (!fp.active || ev.pointerType === "mouse") return; if (fp.lookPointer != null) return; ev.preventDefault(); fp.lookPointer = ev.pointerId; lookZone.setPointerCapture?.(ev.pointerId); fp.lookX = ev.clientX; fp.lookY = ev.clientY; };
  const onTouchLookMove = (ev) => { if (!fp.active || fp.lookPointer !== ev.pointerId) return; ev.preventDefault(); fp.yaw -= (ev.clientX - fp.lookX) * FP.lookSpeed; fp.pitch = Math.max(-1.5, Math.min(1.5, fp.pitch - (ev.clientY - fp.lookY) * FP.lookSpeed)); fp.lookX = ev.clientX; fp.lookY = ev.clientY; };
  const onTouchLookUp = (ev) => { if (fp.lookPointer === ev.pointerId) fp.lookPointer = null; };
  const stickKnobLook = lookStick.querySelector(".fp-stick-knob");
  // a joystick tracked by its own pointerId (so both thumbs work at once); set(x, y) gets the deflection in -1..1, y down
  const makeStick = (st, knob, key, set) => {
    const move = (ev) => { if (!fp.active || fp[key] !== ev.pointerId) return; ev.preventDefault(); const r = st.getBoundingClientRect(), max = r.width * .34; let x = ev.clientX - (r.left + r.width / 2), y = ev.clientY - (r.top + r.height / 2); const len = Math.hypot(x, y); if (len > max) { x *= max / len; y *= max / len; } set(x / max, y / max); knob.style.transform = `translate(${x}px, ${y}px)`; };
    const up = (ev) => { if (fp[key] !== ev.pointerId) return; fp[key] = null; set(0, 0); knob.style.transform = ""; };
    st.addEventListener("pointerdown", (ev) => { if (!fp.active || fp[key] != null) return; ev.preventDefault(); fp[key] = ev.pointerId; st.setPointerCapture?.(ev.pointerId); move(ev); });
    st.addEventListener("pointermove", move); st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
  };
  makeStick(stick, stickKnob, "stickPointer", (x, y) => { fp.touchSide = x; fp.touchFwd = -y; });
  makeStick(lookStick, stickKnobLook, "lookStickPointer", (x, y) => { fp.lookSX = x; fp.lookSY = y; });
  const onDown = (ev) => { if (fp.active && !fp.locked && ev.button === 0 && ev.pointerType === "mouse") { fp.drag = true; renderer.domElement.setPointerCapture?.(ev.pointerId); } };
  const onUp = () => { fp.drag = false; };
  lookZone.addEventListener("pointerdown", onTouchLookDown); lookZone.addEventListener("pointermove", onTouchLookMove); lookZone.addEventListener("pointerup", onTouchLookUp); lookZone.addEventListener("pointercancel", onTouchLookUp);
  const rotateBtn = overlay.querySelector(".fp-rotate"), orient = screen.orientation;
  rotateBtn.addEventListener("click", () => {  // the click is a user gesture: fullscreen first (most browsers require it), then lock; a refusal is ignored
    const lock = () => { try { const p = orient.lock("landscape"); p?.catch?.(() => {}); } catch { /* refused */ } };
    if (document.fullscreenElement) lock();
    else { try { const p = el.requestFullscreen?.(); if (p?.then) p.then(lock, lock); else lock(); } catch { lock(); } }
  });
  const onOrient = () => { resize(); setTimeout(resize, 250); };  // sizes settle a moment after the turn
  window.addEventListener("resize", resize); window.addEventListener("orientationchange", onOrient);
  overlay.querySelector(".fp-exit").addEventListener("click", exitFirstPerson);
  overlay.querySelectorAll("[data-climb]").forEach((b) => b.addEventListener("click", () => climb(Number(b.dataset.climb))));
  const resetSticks = () => { fp.touchFwd = fp.touchSide = fp.lookSX = fp.lookSY = 0; fp.stickPointer = fp.lookPointer = fp.lookStickPointer = null; stickKnob.style.transform = stickKnobLook.style.transform = ""; };
  const onBlur = () => { fp.keys.clear(); resetSticks(); };
  const onFullscreenChange = () => { if (fp.active && fp.ownsFullscreen && document.fullscreenElement !== el) exitFirstPerson(); };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  window.addEventListener("blur", onBlur);

  function enterFirstPerson() {
    if (fp.active) return;
    fp.saved = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near };
    const [ex, ey, ez] = model.entrance;
    Object.assign(fp, { active: true, hadLock: false, x: X(ex + 0.5), z: Z(ez + 0.5), level: ey, y: deckY(ey) + FP.eye, yaw: Math.PI, pitch: 0, climb: null, drag: false, hint: "", touchFwd: 0, touchSide: 0, lookSX: 0, lookSY: 0, ownsFullscreen: false, fallbackFullscreen: false });
    fp.keys.clear();
    touchHint?.hide();
    resetSticks();
    rotateBtn.hidden = !(orient && orient.lock && matchMedia("(pointer: coarse)").matches);  // iOS Safari has no orientation lock: no button
    controls.enabled = false;
    camera.fov = FP.fov; camera.near = 0.01; camera.updateProjectionMatrix();
    if (onHover) onHover(null);
    hideForFp();
    overlay.hidden = false;
    hintEl.textContent = "";
    const fallbackFullscreen = () => { if (!fp.active || fp.fallbackFullscreen) return; fp.oldBodyOverflow = document.body.style.overflow; el.classList.add("fp-fullscreen-fallback"); document.body.style.overflow = "hidden"; fp.fallbackFullscreen = true; };
    if (document.fullscreenElement === el) fp.ownsFullscreen = true;
    else if (!document.fullscreenElement && el.requestFullscreen) {
      try { const p = el.requestFullscreen(); if (p && p.then) p.then(() => { if (document.fullscreenElement !== el) return; if (fp.active) fp.ownsFullscreen = true; else { const q = document.exitFullscreen?.(); q?.catch?.(() => {}); } }).catch(fallbackFullscreen); }
      catch { fallbackFullscreen(); }
    } else fallbackFullscreen();
    try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* no pointer lock: drag the mouse to look */ }
    fp.last = performance.now();
    fp.raf = requestAnimationFrame(fpFrame);
    if (onFirstPerson) onFirstPerson(true);
  }
  function exitFirstPerson() {
    if (!fp.active) return;
    fp.active = false;
    cancelAnimationFrame(fp.raf);
    fp.keys.clear();
    resetSticks();
    const leaveFullscreen = fp.ownsFullscreen && document.fullscreenElement === el;
    fp.ownsFullscreen = false;
    try { screen.orientation?.unlock?.(); } catch { /* nothing locked */ }
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    if (leaveFullscreen && document.exitFullscreen) { try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } catch { /* already leaving fullscreen */ } }
    if (fp.fallbackFullscreen) { el.classList.remove("fp-fullscreen-fallback"); document.body.style.overflow = fp.oldBodyOverflow; fp.fallbackFullscreen = false; }
    fp.locked = false;
    overlay.hidden = true;
    camera.position.copy(fp.saved.pos); controls.target.copy(fp.saved.target);
    camera.rotation.set(0, 0, 0); camera.fov = fp.saved.fov; camera.near = fp.saved.near; camera.updateProjectionMatrix();
    controls.enabled = true;
    controls.update();
    hideForFp();
    render();
    if (onFirstPerson) onFirstPerson(false);
  }

  rebuild();
  resize();
  loadUltralowContainers().then((assets) => {
    if (disposed) {
      for (const asset of Object.values(assets)) { asset.geometry.dispose(); asset.material.dispose(); }
      Object.values(assets)[0]?.material.map?.dispose();
      return;
    }
    ultralow = assets;
    rebuild();
  }).catch((error) => console.warn("ultralow container models unavailable; using built-in markers", error));
  return {
    setRoute(value,step=0){route=value;routeStep=step;routeOverlay.set(route,routeStep,opts.spread);render();},
    showTouchHint(duration){touchHint?.show(duration);},
    captureDefault(width=1200,height=820) {
      const bounds=overviewBounds||collectOverviewBounds(built.group);
      routeOverlay.group.visible=false;
      try{return captureOverviewWebGL(renderer,scene,camera,controls.target,bounds,opts.framing,width,height);}finally{routeOverlay.group.visible=true;render();}
    },
    capture(width=1200,height=820) { return captureWebGL(renderer,scene,camera,width,height); },
    setOptions(next) { opts = { ...opts, ...next };if(next.framing)autoFrame=true;if(Object.keys(next).every(k=>k==='framing'||k==='lookSensitivity'||k==='touchMode')){if(next.framing){home();render();}return;}walkCache = null; rebuild(); },
    resetView() { exitFirstPerson(); home(); render(); },
    enterFirstPerson, exitFirstPerson,
    // position and look direction while walking (also used by the automated checks): grid coordinates u, v and the deck level
    // puts the walker at grid position (u, v) on a deck, looking along yaw (used by the automated checks)
    placeFirstPerson(u, v, level, yaw = fp.yaw) { Object.assign(fp, { x: X(u), z: Z(v), level, yaw, climb: null, y: deckY(level) + FP.eye }); },
    // does the walker's body at grid position (u, v) on a deck touch something solid (walls, cells, shown layers)? (automated checks)
    collides: (u, v, level) => blocked(walkData(level), X(u), Z(v)),
    firstPerson: () => ({ active: fp.active, locked: fp.locked, level: fp.level, u: fp.x + 6.5, v: fp.z + 6.5, yaw: fp.yaw, pitch: fp.pitch, climbing: Boolean(fp.climb), hint: fp.hint }),
    dispose() {
      disposed = true;
      exitFirstPerson();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize); window.removeEventListener("orientationchange", onOrient);
      ro.disconnect();
      touchHint?.dispose();
      touchControls?.dispose();
      controls.dispose();
      renderer.domElement.removeEventListener("pointermove", onMove);
      if (built) built.group.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
      if (ultralow) {
        for (const asset of Object.values(ultralow)) { asset.geometry.dispose(); asset.material.dispose(); }
        Object.values(ultralow)[0]?.material.map?.dispose();
      }
      if (opts.meshes) for (const g of opts.meshes.values()) g.dispose();
      routeOverlay.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}

export let lastIndex = null;  // the mesh index fetched by the last loadMeshes() call (has per-piece fixtures)

// Loads the simple piece meshes used by `instances` (built by tools/build_piece_meshes_705.py).
// Returns Map(scene -> BufferGeometry); empty when no meshes have been built.
export async function loadMeshes(instances) {
  const index = await fetch("/api/meshes/index").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  lastIndex = index;
  const scenes = [...new Set(instances.map((i) => i.scene))].filter((sc) => index[sc] && index[sc].tris > 0);
  const out = new Map();
  await Promise.all(scenes.map(async (sc) => {
    const res = await fetch(`/api/meshes/${index[sc].mesh}.bin`);
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    const head = new Uint32Array(buf, 0, 2);
    const nv = head[0], ni = head[1];
    const pos = new Float32Array(buf, 8, nv * 3);
    const idx = new Uint32Array(buf, 8 + nv * 12, ni);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    // surface-direction shading: floors/tops light, walls darker, undersides darkest (multiplied by the room colour)
    const n = g.getAttribute("normal"), col = new Float32Array(n.count * 3);
    for (let k = 0; k < n.count; k++) {
      const up = n.getY(k), shade = up > 0.7 ? 1.0 : up < -0.7 ? 0.35 : 0.55;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = shade;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.set(sc, g);
  }));
  return out;
}

export {hangarShip,hangarDetail,shipMeshMaterial};

export function hangarFootprint(ship,entrance){
 const [ex,,ez]=entrance,A=ship.axes,t=ship.t,xs=[],zs=[];
 for(const x of [ship.box[0],ship.box[3]])for(const z of [ship.box[2],ship.box[5]]){xs.push((x*A[0][0]+z*A[2][0]+t[0])/8+ex-6);zs.push((x*A[0][2]+z*A[2][2]+t[2])/8+ez-6);}
 return {x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs),soft:true};
}
