// Walk the Docks in 3D: builds a walkable 3D marina from images/marina-slip-map.svg.
// SVG units are mapped to feet (S feet per unit); SVG x -> world X, SVG y -> world Z (north is -Z).
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

var S = 0.8;                 // feet per SVG unit (a 30' slip is ~37 units long)
var CX = 1000, CY = 800;     // SVG point placed at the world origin
var DOCK_H = 1.8;            // dock deck height above the water, feet
var LAND_H = 5;              // riverwalk / bulkhead height, feet
var EYE = 5.4;               // eye height above whatever you stand on
var FLY_H = 140;             // bird's-eye height
var WALK = 7, JOG = 16;      // feet per second

var $ = function (id) { return document.getElementById(id); };
var wrap = $('dwWrap'), canvas = $('dwCanvas');
var touchUI = matchMedia('(pointer: coarse)').matches;
var lowPower = touchUI || Math.min(screen.width, screen.height) < 700;

function wx(x) { return (x - CX) * S; }
function wz(y) { return (y - CY) * S; }

// ---------- 2D geometry helpers (SVG coordinates) ----------
function pts(str) {
  return str.trim().split(/\s+/).map(function (p) { var a = p.split(','); return [+a[0], +a[1]]; });
}
function inPoly(x, y, poly) {
  var c = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  var qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
function polyDist(x, y, poly) {
  if (inPoly(x, y, poly)) return 0;
  var d = Infinity;
  for (var i = 0; i < poly.length; i++) { var a = poly[i], b = poly[(i + 1) % poly.length]; d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1])); }
  return d;
}
function centroid(poly) {
  var x = 0, y = 0; poly.forEach(function (p) { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length];
}
function bbox(poly) {
  var b = [Infinity, Infinity, -Infinity, -Infinity];
  poly.forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
  return b;
}
function rectPoly(x1, y1, x2, y2, w) { // a strip of width w along the segment
  var dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
}
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---------- 3D helpers ----------
function shapeOf(poly) {
  var s = new THREE.Shape();
  poly.forEach(function (p, i) { var x = wx(p[0]), y = -wz(p[1]); if (i) s.lineTo(x, y); else s.moveTo(x, y); });
  return s;
}
function extrude(poly, base, top) { // vertical prism from base to top (feet)
  var g = new THREE.ExtrudeGeometry(shapeOf(poly), { depth: top - base, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, base, 0);
  return g;
}
function flat(poly, h) {
  var g = new THREE.ShapeGeometry(shapeOf(poly)); g.rotateX(-Math.PI / 2); g.translate(0, h, 0); return g;
}
function paint(g, hex) { // vertex colors so many parts can share one mesh
  g = g.index ? g.toNonIndexed() : g;
  var c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function paintBy(g, topHex, sideHex) { // one color on upward faces, another on the sides
  g = g.index ? g.toNonIndexed() : g;
  var t = new THREE.Color(topHex), s = new THREE.Color(sideHex), nr = g.attributes.normal, n = nr.count, a = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) { var c = nr.getY(i) > 0.6 ? t : s; a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function strip(g) { // keep only the attributes every merged part has
  Object.keys(g.attributes).forEach(function (k) { if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k); });
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
function merged(list, mat) {
  var m = new THREE.Mesh(mergeGeometries(list.map(strip), false), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function canvasTex(w, h, draw) {
  var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function plankTexture() {
  var t = canvasTex(256, 256, function (x, w, h) {
    var rnd = mulberry32(7);
    for (var i = 0; i < 16; i++) {
      var l = 62 + rnd() * 14;
      x.fillStyle = 'hsl(34,' + (10 + rnd() * 8) + '%,' + l + '%)';
      x.fillRect(0, i * 16, w, 15);
      x.fillStyle = 'rgba(80,50,25,.10)';
      for (var k = 0; k < 6; k++) x.fillRect(rnd() * w, i * 16 + rnd() * 15, 20 + rnd() * 60, 1);
      x.fillStyle = 'rgba(60,40,20,.55)'; x.fillRect(0, i * 16 + 15, w, 1);
      x.fillStyle = 'rgba(60,40,20,.35)'; x.fillRect(rnd() * w, i * 16, 2, 15);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.18, 0.18);
  return t;
}
function waterNormals() { // tileable ripple normal map, generated so nothing extra has to download
  var N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  var x = c.getContext('2d'), img = x.createImageData(N, N), d = img.data, rnd = mulberry32(3), waves = [];
  while (waves.length < 18) { var kx = Math.round((rnd() * 2 - 1) * 12), ky = Math.round((rnd() * 2 - 1) * 12), km = Math.hypot(kx, ky); if (km >= 3 && km <= 13) waves.push([kx, ky, 0.5 + rnd(), rnd() * 6.283]); }
  for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
    var gx = 0, gy = 0;
    waves.forEach(function (w) { var ph = 6.283 * (w[0] * i + w[1] * j) / N + w[3], c2 = Math.cos(ph) * w[2] / (1 + Math.hypot(w[0], w[1]) * 0.15); gx += c2 * w[0]; gy += c2 * w[1]; });
    var nx = -gx * 0.018, ny = -gy * 0.018, nz = 1, l = Math.hypot(nx, ny, nz), o = (j * N + i) * 4;
    d[o] = (nx / l * 0.5 + 0.5) * 255; d[o + 1] = (ny / l * 0.5 + 0.5) * 255; d[o + 2] = (nz / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function labelSprite(text, bg, fg, wFeet, opts) {
  opts = opts || {};
  var W = opts.round ? 128 : 160, H = opts.round ? 128 : 80;
  var tex = canvasTex(W, H, function (x) {
    x.fillStyle = bg; x.strokeStyle = '#fff'; x.lineWidth = 6;
    x.beginPath();
    if (opts.round) x.arc(W / 2, H / 2, W / 2 - 5, 0, 7);
    else if (x.roundRect) x.roundRect(4, 4, W - 8, H - 8, 22); else x.rect(4, 4, W - 8, H - 8);
    x.fill(); x.stroke();
    if (opts.ring) { x.strokeStyle = opts.ring; x.lineWidth = 7; x.beginPath(); x.arc(W / 2, H / 2, W / 2 - 13, 0, 7); x.stroke(); }
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold ' + (opts.round ? 72 : (text.length > 3 ? 44 : 52)) + 'px Arial, Helvetica, sans-serif';
    x.fillText(text, W / 2, H / 2 + 3);
  });
  var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(wFeet, wFeet * H / W, 1);
  return sp;
}

// ---------- photo-real textures (drawn in code, so nothing extra to download) ----------
function speckleTexture(base, tones, n, sizeMax, tileFeet, extra) {
  var t = canvasTex(256, 256, function (x, w, h) {
    var rnd = mulberry32(base.length * 97 + n);
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (var i = 0; i < n; i++) {
      x.fillStyle = tones[Math.floor(rnd() * tones.length)];
      x.globalAlpha = 0.25 + rnd() * 0.5;
      var s = 1 + rnd() * sizeMax; x.fillRect(rnd() * w, rnd() * h, s, s * (0.6 + rnd()));
    }
    x.globalAlpha = 1;
    if (extra) extra(x, w, h, rnd);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tileFeet, 1 / tileFeet);
  return t;
}
var FACADES = {
  brick:    { wall: '#8b4a35', alt: ['#7a3f2c', '#9a5640', '#83442f', '#6f3a2a'], bayW: 11, floorH: 11, win: 0.42, frame: '#f2eee6' },
  brick2:   { wall: '#a0583b', alt: ['#8f4d33', '#b0654a', '#94513a'], bayW: 10, floorH: 11, win: 0.4, frame: '#efe9dc' },
  condo:    { wall: '#93503a', alt: ['#844630', '#a05b43', '#8a4934'], bayW: 13, floorH: 10.5, win: 0.55, frame: '#ece6da', balcony: true },
  hotel:    { wall: '#8a4632', alt: ['#7c3e2c', '#97513b'], bayW: 8, floorH: 10, win: 0.86, frame: '#c98a4a', band: true },
  white:    { wall: '#e9e4d8', alt: ['#dedad0', '#f1ede4', '#d8d2c4'], bayW: 10, floorH: 11, win: 0.42, frame: '#ffffff' },
  colonial: { wall: '#924c36', alt: ['#80412f', '#a15a42'], bayW: 9, floorH: 12, win: 0.36, frame: '#fbf8f2', shutters: true }
};
function facadeTexture(f) {
  var t = canvasTex(128, 128, function (x, W, H) {
    var rnd = mulberry32(f.bayW * 131 + f.floorH * 7);
    x.fillStyle = f.wall; x.fillRect(0, 0, W, H);
    for (var r = 0; r < H; r += 4) for (var c = (r / 4 % 2) * 4; c < W; c += 9) { // brick / stucco texture
      x.fillStyle = f.alt[Math.floor(rnd() * f.alt.length)]; x.fillRect(c, r, 8, 3);
    }
    if (f.wall !== '#e9e4d8') { x.fillStyle = 'rgba(225,215,200,.25)'; for (var m = 3; m < H; m += 4) x.fillRect(0, m, W, 1); }
    var ww = W * f.win, wx0 = (W - ww) / 2, wy = H * 0.2, wh = H * 0.56;
    if (f.band) { x.fillStyle = '#b8743c'; x.fillRect(0, H * 0.78, W, H * 0.12); }
    if (f.shutters) { x.fillStyle = '#26303a'; x.fillRect(wx0 - 9, wy, 7, wh); x.fillRect(wx0 + ww + 2, wy, 7, wh); }
    x.fillStyle = f.frame; x.fillRect(wx0 - 3, wy - 3, ww + 6, wh + 6);
    var g = x.createLinearGradient(0, wy, 0, wy + wh);
    g.addColorStop(0, '#a9bccb'); g.addColorStop(0.45, '#5f7488'); g.addColorStop(1, '#2c3a48');
    x.fillStyle = g; x.fillRect(wx0, wy, ww, wh);
    x.fillStyle = f.frame;
    x.fillRect(wx0, wy + wh * 0.48, ww, 2);
    if (ww > 40) for (var k = 1; k < 3; k++) x.fillRect(wx0 + ww * k / 3, wy, 2, wh); else x.fillRect(wx0 + ww / 2 - 1, wy, 2, wh);
    if (f.balcony) { x.fillStyle = '#e8e4dc'; x.fillRect(0, H * 0.86, W, H * 0.06); x.fillStyle = 'rgba(40,45,50,.8)'; for (var b = 2; b < W; b += 6) x.fillRect(b, H * 0.72, 1, H * 0.14); x.fillRect(0, H * 0.72, W, 2); }
    x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, H - 2, W, 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function cloudDome() {
  var W = 512, H = 160, c = document.createElement('canvas'); c.width = W; c.height = H;
  var x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data, rnd = mulberry32(42);
  var G = 64, lat = []; for (var i = 0; i < G * G; i++) lat.push(rnd());
  function vn(px, py, per) { // periodic value noise
    var x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var X0 = ((x0 % per) + per) % per, X1 = (X0 + 1) % per, Y0 = ((y0 % G) + G) % G, Y1 = (Y0 + 1) % G;
    var a = lat[Y0 * G + X0], b = lat[Y0 * G + X1], cc = lat[Y1 * G + X0], dd = lat[Y1 * G + X1];
    return a + (b - a) * fx + (cc - a) * fy + (a - b - cc + dd) * fx * fy;
  }
  for (var j = 0; j < H; j++) for (var i2 = 0; i2 < W; i2++) {
    var v = 0, amp = 0.55, fr = 1;
    for (var o = 0; o < 5; o++) { var per = 8 * fr; v += vn(i2 / W * per, j / H * 3 * fr + o * 3.7, per) * amp; amp *= 0.5; fr *= 2; }
    var t = j / H, band = Math.sin(Math.min(1, t * 1.15) * Math.PI) * (0.55 + t * 0.6);
    var a2 = Math.max(0, Math.min(1, (v - 0.54) * 5)) * band, k = (j * W + i2) * 4, sh = 250 - Math.max(0, v - 0.62) * 140;
    d[k] = sh * 0.97; d[k + 1] = sh * 0.98; d[k + 2] = sh; d[k + 3] = a2 * 240;
  }
  x.putImageData(img, 0, 0);
  var tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  var m = new THREE.Mesh(new THREE.SphereGeometry(7000, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  m.renderOrder = 1;
  return m;
}
function walls(poly, base, top, bayW, floorH) { // building walls with UVs measured in window bays / floors
  var A = 0, pos = [], uv = [], n = poly.length;
  for (var i = 0; i < n; i++) { var p = poly[i], q2 = poly[(i + 1) % n]; A += p[0] * q2[1] - q2[0] * p[1]; }
  var vTop = (top - base) / floorH;
  for (var e = 0; e < n; e++) {
    var a = poly[e], b = poly[(e + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) * S, u1 = Math.max(1, Math.round(L / bayW));
    var A0 = [wx(a[0]), base, wz(a[1])], B0 = [wx(b[0]), base, wz(b[1])], B1 = [wx(b[0]), top, wz(b[1])], A1 = [wx(a[0]), top, wz(a[1])];
    var tA0 = [0, 0], tB0 = [u1, 0], tB1 = [u1, vTop], tA1 = [0, vTop];
    var tris = A < 0 ? [[A0, tA0], [B0, tB0], [B1, tB1], [A0, tA0], [B1, tB1], [A1, tA1]] : [[A0, tA0], [B1, tB1], [B0, tB0], [A0, tA0], [A1, tA1], [B1, tB1]];
    tris.forEach(function (v) { pos.push(v[0][0], v[0][1], v[0][2]); uv.push(v[1][0], v[1][1]); });
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function hipRoof(poly, base, rise, k) { // sloped roof: the outline shrunk toward its middle as it rises
  var c = centroid(poly), topPoly = poly.map(function (p) { return [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]; });
  var A = 0, pos = [], n = poly.length;
  for (var i = 0; i < n; i++) { var p = poly[i], q2 = poly[(i + 1) % n]; A += p[0] * q2[1] - q2[0] * p[1]; }
  for (var e = 0; e < n; e++) {
    var a = poly[e], b = poly[(e + 1) % n], ta = topPoly[e], tb = topPoly[(e + 1) % n];
    var A0 = [wx(a[0]), base, wz(a[1])], B0 = [wx(b[0]), base, wz(b[1])], B1 = [wx(tb[0]), base + rise, wz(tb[1])], A1 = [wx(ta[0]), base + rise, wz(ta[1])];
    var tris = A < 0 ? [A0, B0, B1, A0, B1, A1] : [A0, B1, B0, A0, A1, B1];
    tris.forEach(function (v) { pos.push(v[0], v[1], v[2]); });
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return [g, flat(topPoly, base + rise)];
}

// ---------- scene ----------
var renderer, scene, camera, water, sun, sunDir = new THREE.Vector3();
var walk = [], blocked = [], gangways = [], slips = [], slipByKey = {}, labels = [], marker;
var shore = [], land = [];
var player = { x: 0, y: 0, h: LAND_H, yaw: Math.PI, pitch: -0.05, fly: false, flyT: 0 };

function setup() {
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb9cfdc, 1200, 5200);
  camera = new THREE.PerspectiveCamera(68, 1, 0.3, 9000);
  camera.rotation.order = 'YXZ';

  var sky = new Sky(); sky.scale.setScalar(8000);
  var u = sky.material.uniforms;
  u.turbidity.value = 2.2; u.rayleigh.value = 2.6; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.8;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 42), THREE.MathUtils.degToRad(200));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  var pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), sky2 = new Sky();
  sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
  ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'].forEach(function (k) { sky2.material.uniforms[k].value = u[k].value; });
  envScene.add(sky2);
  scene.environment = pm.fromScene(envScene).texture;

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b4a, 0.3));
  sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  var sc = sun.shadow.camera; sc.left = sc.bottom = -170; sc.right = sc.top = 170; sc.near = 10; sc.far = 900;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  water = new Water(new THREE.PlaneGeometry(12000, 12000), {
    textureWidth: lowPower ? 512 : 1024, textureHeight: lowPower ? 512 : 1024,
    waterNormals: waterNormals(), sunDirection: sunDir.clone(), sunColor: 0x9a917f,
    waterColor: 0x0d2136, distortionScale: 0.9, fog: true
  });
  water.material.uniforms.size.value = 3.5;
  // Real river water is dark and only mirror-like at low angles: lower the base reflectance and the milky haze
  water.material.fragmentShader = water.material.fragmentShader
    .replace('float rf0 = 0.3;', 'float rf0 = 0.035;')
    .replace('sunColor * diffuseLight * 0.3 + scatter', 'sunColor * diffuseLight * 0.06 + scatter')
    .replace('vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight', 'reflectionSample * vec3( 0.5, 0.64, 0.84 ) + reflectionSample * specularLight');
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  scene.add(cloudDome());
}

// ---------- build from the SVG ----------
function build(svgText) {
  var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  var q = function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); };
  var plank = plankTexture();
  var woodMat = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.85, color: 0xffffff });
  var vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  var boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  var woodParts = [], partsVC = [], boatParts = [], grassParts = [], pavedParts = [], roadParts = [], wallParts = {};
  var grassMat = new THREE.MeshStandardMaterial({ roughness: 1, map: speckleTexture('#5f7440', ['#526636', '#6c8148', '#77894f', '#4a5c31', '#7d7a55', '#665f45'], 3200, 3, 22) });
  var pavedMat = new THREE.MeshStandardMaterial({ roughness: 0.95, map: speckleTexture('#cfc9bd', ['#bdb6a8', '#dcd6cb', '#b3ab9c'], 1800, 2, 12, function (x, w, h) {
    x.fillStyle = 'rgba(110,100,90,.45)'; x.fillRect(0, 0, w, 2); x.fillRect(0, 0, 2, h); x.fillRect(0, h / 2, w, 1); x.fillRect(w / 2, 0, 1, h);
  }) });
  var roadMat = new THREE.MeshStandardMaterial({ roughness: 0.9, map: speckleTexture('#4f5256', ['#45484c', '#5c5f63', '#3e4145', '#66696d'], 3000, 2, 16) });
  var bulkMat = new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0x8d877c });
  var wallMats = {}; Object.keys(FACADES).forEach(function (k) { wallMats[k] = new THREE.MeshStandardMaterial({ map: facadeTexture(FACADES[k]), roughness: 0.85 }); wallParts[k] = []; });
  var m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), v3 = new THREE.Vector3();
  var treeSpots = [], allB = [];

  // A building: textured walls, a flat or hip roof, and a parapet / rooftop units on flat roofs
  function building(poly, floors, style, roof, opts) {
    opts = opts || {};
    var f = FACADES[style], top = LAND_H + floors * f.floorH;
    wallParts[style].push(walls(poly, LAND_H, top, f.bayW, f.floorH));
    if (opts.hip) {
      var hr = hipRoof(poly, top, opts.hip, opts.k || 0.6);
      partsVC.push(paint(hr[0], roof), paint(hr[1], roof));
    } else {
      partsVC.push(paint(flat(poly, top), roof));
      partsVC.push(paint(walls(poly, top, top + 2.2, 50, 2.2), '#d9d3c7'));
      var bb = bbox(poly), rr = mulberry32(Math.round(bb[0] * 7 + bb[1]));
      for (var u = 0; u < (opts.units || 2); u++) {
        var ux = bb[0] + (bb[2] - bb[0]) * (0.25 + rr() * 0.5), uy = bb[1] + (bb[3] - bb[1]) * (0.25 + rr() * 0.5);
        if (!inPoly(ux, uy, poly)) continue;
        var bx = new THREE.BoxGeometry(6 + rr() * 8, 3 + rr() * 2, 5 + rr() * 6); bx.translate(wx(ux), top + 2, wz(uy)); partsVC.push(paint(bx, '#b7b4ad'));
      }
    }
    if (opts.block !== false) blocked.push(poly);
    allB.push(poly);
    return top;
  }

  // Shoreline and land (stretched beyond the map edges so the world doesn't end in a cliff)
  shore = pts(q('polyline')[0].getAttribute('points'));
  var ext = [[-2600, shore[0][1] - 40]].concat(shore, [[4600, shore[shore.length - 1][1] - 30]]);
  land = ext.concat([[4600, -2600], [-2600, -2600]]);
  var landG = extrude(land, -3, LAND_H);
  var landMesh = new THREE.Mesh(landG, [grassMat, bulkMat]); landMesh.receiveShadow = true; scene.add(landMesh);
  // concrete riverwalk along the bulkhead
  for (var i = 0; i < ext.length - 1; i++) {
    var a = ext[i], b = ext[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = dy / l * 26, ny = -dx / l * 26;
    pavedParts.push(flat([[a[0], a[1]], [b[0], b[1]], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], LAND_H + 0.05));
    for (var lt = 30; lt < l; lt += 70) { // riverwalk lamp posts
      var lx = a[0] + dx * lt / l + nx * 0.85, ly = a[1] + dy * lt / l + ny * 0.85;
      if (lx > -400 && lx < 2500) treeSpots.push({ lamp: true, x: lx, y: ly });
    }
  }
  q('polygon').forEach(function (p) {
    var f = p.getAttribute('fill'), poly = pts(p.getAttribute('points'));
    if (f === '#cfcac2') roadParts.push(flat(poly, LAND_H + 0.06));
    else if (f === 'url(#roof)') { // DoubleTree-style brick hotel with a band of windows on each floor
      building(poly, 5, 'hotel', '#7d7a74', { units: 9 });
    } else if (f === 'url(#roof2)') { // the brick colonial office building with a gray slate roof
      building(poly, 3, 'colonial', '#5b6168', { hip: 14, k: 0.78 });
    } else if (f === '#f4ecdc') { // gazebo
      partsVC.push(paint(extrude(poly, LAND_H, LAND_H + 1), '#f4ecdc'));
      var gc = centroid(poly), roof = new THREE.ConeGeometry(18 * S, 8, 6); roof.translate(wx(gc[0]), LAND_H + 12, wz(gc[1]));
      partsVC.push(paint(roof, '#7a5a3a'));
      for (var k = 0; k < 6; k += 2) { var cg = new THREE.CylinderGeometry(0.3, 0.3, 8, 6); cg.translate(wx(poly[k][0]), LAND_H + 5, wz(poly[k][1])); partsVC.push(paint(cg, '#f4ecdc')); }
      blocked.push(poly);
    } else if (f === 'url(#ties)') { // railroad trestle over the water, carried across the river
      var rp = poly.map(function (pt) { return pt.slice(); });
      var sx = (rp[2][0] - rp[1][0]) / (rp[2][1] - rp[1][1]);
      rp[2] = [rp[1][0] + sx * (3600 - rp[1][1]), 3600]; rp[3] = [rp[0][0] + sx * (3600 - rp[0][1]), 3600];
      partsVC.push(paintBy(extrude(rp, 14, 17), '#6b625a', '#4a443c'));
      for (var t = 0; t < 1; t += 0.012) {
        var mx = rp[0][0] + (rp[3][0] - rp[0][0]) * t, my = rp[0][1] + (rp[3][1] - rp[0][1]) * t, w2 = (rp[1][0] - rp[0][0]);
        if (inPoly(mx, my, land)) continue;
        for (var e = 0.2; e < 1; e += 0.6) { var pg = new THREE.CylinderGeometry(0.9, 0.9, 20, 8); pg.translate(wx(mx + w2 * e), 5, wz(my)); partsVC.push(paint(pg, '#57504a')); }
      }
      blocked.push(poly);
    }
  });
  q('ellipse').forEach(function (el) {
    var cx = +el.getAttribute('cx'), cy = +el.getAttribute('cy'), rx = +el.getAttribute('rx'), ry = +el.getAttribute('ry'), poly = [];
    for (var a2 = 0; a2 < 24; a2++) poly.push([cx + rx * Math.cos(a2 / 24 * 6.283), cy + ry * Math.sin(a2 / 24 * 6.283)]);
    partsVC.push(paintBy(extrude(poly, LAND_H, LAND_H + 1.2), '#4fb6d6', '#f2efe8'));
    blocked.push(poly);
  });

  // Riverwalk condos on the west end (red brick, five floors, balconies), as in the aerial photos
  building([[340, 270], [440, 270], [440, 330], [425, 330], [425, 390], [340, 390]], 5, 'condo', '#a19d95', { units: 5 });
  building([[470, 330], [600, 330], [600, 470], [540, 470], [540, 410], [470, 410]], 5, 'condo', '#a19d95', { units: 6 });
  building([[455, 250], [590, 250], [590, 300], [455, 300]], 4, 'brick2', '#8f8b84', { units: 3 });
  // green-roofed convention center by the Cunningham Bridge
  building([[2000, 95], [2260, 95], [2260, 200], [2000, 200]], 2, 'white', '#3f8c78', { hip: 18, k: 0.55 });
  building([[1850, 60], [1960, 60], [1960, 120], [1850, 120]], 3, 'brick', '#5b6168', { hip: 9, k: 0.7 });

  // Parking lots behind the hotel, with cars
  var lots = [[[760, 95], [1300, 95], [1300, 150], [760, 150]], [[1215, 175], [1310, 175], [1310, 285], [1215, 285]]];
  var cars = [], carRnd = mulberry32(99), carCols = ['#f2f2f0', '#1e1f22', '#8d9196', '#2b4a7a', '#8a1f1f', '#c9c3b5', '#3b3f45', '#e6e6e3'];
  lots.forEach(function (lp) {
    roadParts.push(flat(lp, LAND_H + 0.07));
    var bb = bbox(lp), horiz = bb[2] - bb[0] > bb[3] - bb[1];
    for (var cx2 = bb[0] + 8; cx2 < bb[2] - 6; cx2 += horiz ? 11.5 : 26) for (var cy2 = bb[1] + 8; cy2 < bb[3] - 6; cy2 += horiz ? 26 : 11.5) {
      if (carRnd() < 0.3) continue;
      cars.push([cx2, cy2, horiz ? Math.PI / 2 : 0, carCols[Math.floor(carRnd() * carCols.length)]]);
    }
  });
  cars.forEach(function (c) {
    var body = new THREE.BoxGeometry(6, 2.6, 14.5), cab = new THREE.BoxGeometry(5.4, 1.9, 7.5), glass = new THREE.BoxGeometry(5.5, 1.3, 7.2);
    body.translate(0, 1.7, 0); cab.translate(0, 3.6, -0.6); glass.translate(0, 3.55, -0.6);
    [paint(body, c[3]), paint(cab, c[3]), paint(glass, '#25303a')].forEach(function (g) { g.rotateY(c[2]); g.translate(wx(c[0]), LAND_H, wz(c[1])); partsVC.push(g); });
  });

  // Downtown New Bern behind the waterfront: brick blocks, white storefronts, church steeples and lots of trees
  var town = mulberry32(5), styles = ['brick', 'brick', 'brick2', 'brick', 'white', 'brick2', 'white'], roofs = ['#5d5f63', '#9e9a92', '#3c3e42', '#8b8f94'];
  var railX = function (y) { return 70 + (y - 90) * 0.2 + 27; };
  for (var by = -1500; by < 60; by += 140) {
    roadParts.push(flat([[-1200, by - 22], [3000, by - 22], [3000, by], [-1200, by]], LAND_H + 0.04));
    for (var bx0 = -500; bx0 < 2700; bx0 += 170) {
      var x0 = bx0, x1 = bx0 + 145, y0 = by, y1 = Math.min(by + 118, 70);
      if (by === -1500) roadParts.push(flat([[bx0 + 145, -1520], [bx0 + 170, -1520], [bx0 + 170, 72], [bx0 + 145, 72]], LAND_H + 0.04));
      if ((x0 < 735 && x1 > 630) || (x0 < 1405 && x1 > 1315)) continue;           // Middle St and Craven St
      if (Math.abs((x0 + x1) / 2 - railX((y0 + y1) / 2)) < 140) continue;          // the railroad line
      var downtown = Math.max(0, 1 - Math.hypot((x0 + x1) / 2 - 1050, (y0 + y1) / 2 + 300) / 1100);
      if (town() < 0.13) { for (var tk = 0; tk < 7; tk++) treeSpots.push({ x: x0 + town() * 145, y: y0 + town() * (y1 - y0), r: 9 + town() * 7 }); continue; }
      var lx0 = x0;
      while (lx0 < x1 - 20) {
        var w = 28 + town() * 50, lx1 = Math.min(x1, lx0 + w), depth = (y1 - y0) * (0.45 + town() * 0.55);
        var front = town() < 0.5, ly0 = front ? y1 - depth : y0, ly1 = front ? y1 : y0 + depth;
        var floors = Math.max(1, Math.round(1.5 + town() * 2 + downtown * 3 * town()));
        building([[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]], floors, styles[Math.floor(town() * styles.length)],
          roofs[Math.floor(town() * roofs.length)], { units: 1, block: ly1 > -120 });
        if (town() < 0.6) treeSpots.push({ x: (lx0 + lx1) / 2 + (town() - 0.5) * 20, y: front ? y0 + 8 : y1 - 8, r: 8 + town() * 7 });
        lx0 = lx1 + 4 + town() * 10;
      }
    }
  }
  for (var tt2 = 0; tt2 < 700; tt2++) treeSpots.push({ x: -500 + town() * 3100, y: -1500 + town() * 1560, r: 8 + town() * 9 }); // downtown tree canopy
  roadParts.push(flat([[640, -1520], [725, -1520], [725, 90], [640, 90]], LAND_H + 0.05), flat([[1325, -1520], [1395, -1520], [1395, 90], [1325, 90]], LAND_H + 0.05));
  [[905, -380, 70], [1235, -720, 85], [505, -860, 64], [1585, -330, 60]].forEach(function (c, i) { // church steeples
    var bs = 26, t0 = LAND_H, poly = [[c[0] - bs / 2, c[1] - bs / 2], [c[0] + bs / 2, c[1] - bs / 2], [c[0] + bs / 2, c[1] + bs / 2], [c[0] - bs / 2, c[1] + bs / 2]];
    wallParts[i % 2 ? 'white' : 'brick'].push(walls(poly, t0, t0 + c[2], 10, 11));
    var belfry = new THREE.BoxGeometry(bs * S * 0.8, 14, bs * S * 0.8); belfry.translate(wx(c[0]), t0 + c[2] + 7, wz(c[1])); partsVC.push(paint(belfry, '#f4f1ea'));
    var spire = new THREE.ConeGeometry(bs * S * 0.5, 46, 8); spire.translate(wx(c[0]), t0 + c[2] + 14 + 23, wz(c[1])); partsVC.push(paint(spire, i % 2 ? '#f4f1ea' : '#4a4d52'));
    var nave = [[c[0] - 30, c[1] + bs / 2], [c[0] + 30, c[1] + bs / 2], [c[0] + 30, c[1] + 120], [c[0] - 30, c[1] + 120]];
    wallParts[i % 2 ? 'white' : 'brick'].push(walls(nave, t0, t0 + 34, 12, 34 / 2));
    var hr = hipRoof(nave, t0 + 34, 16, 0.25); partsVC.push(paint(hr[0], '#4a4d52'), paint(hr[1], '#4a4d52'));
  });

  // Alfred A. Cunningham Bridge, heading across the Trent from the east end of downtown
  (function () {
    var a = [2330, 240], b = [3050, 2120], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = 26;
    var deckH = function (t) { return LAND_H + Math.min(1, t / 160) * 13; };
    for (var t = 0; t < L; t += 40) {
      var t2 = Math.min(L, t + 40), p0 = [a[0] + ux * t, a[1] + uy * t], p1 = [a[0] + ux * t2, a[1] + uy * t2];
      var seg = [[p0[0] + nx * hw, p0[1] + ny * hw], [p1[0] + nx * hw, p1[1] + ny * hw], [p1[0] - nx * hw, p1[1] - ny * hw], [p0[0] - nx * hw, p0[1] - ny * hw]];
      var h0 = deckH(t2);
      partsVC.push(paintBy(extrude(seg, h0 - 3, h0), '#9a9893', '#b9b6ae'));
      [1, -1].forEach(function (sd) { var wl = rectPoly(p0[0] + nx * hw * sd, p0[1] + ny * hw * sd, p1[0] + nx * hw * sd, p1[1] + ny * hw * sd, 2); partsVC.push(paint(extrude(wl, h0, h0 + 3.2), '#c9c6be')); });
      if (t > 120 && !inPoly(p0[0], p0[1], land)) [0.7, -0.7].forEach(function (sd) {
        var pc = new THREE.CylinderGeometry(1.6, 1.8, h0 + 6, 10); pc.translate(wx(p0[0] + nx * hw * sd), (h0 - 3 - 6) / 2, wz(p0[1] + ny * hw * sd)); partsVC.push(paint(pc, '#a8a59e'));
      });
      if (t % 160 === 0 && t > 0) { var sl = new THREE.CylinderGeometry(0.25, 0.3, 22, 6); sl.translate(wx(p0[0] + nx * hw), h0 + 11, wz(p0[1] + ny * hw)); partsVC.push(paint(sl, '#6d7378')); }
    }
    var mid = [a[0] + ux * 700, a[1] + uy * 700], hs = deckH(700), house = new THREE.BoxGeometry(14, 11, 14); // bridge tender's house
    house.translate(wx(mid[0] + nx * (hw + 12)), hs + 5.5, wz(mid[1] + ny * (hw + 12))); partsVC.push(paint(house, '#e8e3d6'));
    var hroof = new THREE.ConeGeometry(11, 6, 4); hroof.rotateY(Math.PI / 4); hroof.translate(wx(mid[0] + nx * (hw + 12)), hs + 14, wz(mid[1] + ny * (hw + 12))); partsVC.push(paint(hroof, '#8e3b2b'));
  })();

  // Trees: the ones on the slip map plus downtown street trees, skipping any that land inside a building
  q('circle').forEach(function (c) { if (c.getAttribute('fill') === '#5f8f4e') treeSpots.push({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r') * 1.1 }); });
  var lamps = treeSpots.filter(function (t) { return t.lamp; });
  var trees = treeSpots.filter(function (t) { return !t.lamp && !blocked.concat(allB).some(function (bp) { var b2 = bbox(bp); if (t.x < b2[0] - 30 || t.x > b2[2] + 30 || t.y < b2[1] - 30 || t.y > b2[3] + 30) return false; return polyDist(t.x, t.y, bp) < t.r * 0.6; }); });
  var trunkG = new THREE.CylinderGeometry(0.6, 0.9, 1, 7), crownG = new THREE.IcosahedronGeometry(1, 2);
  var trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x5d4632, roughness: 1 }), trees.length);
  var crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ roughness: 0.95 }), trees.length * 2);
  var tc = new THREE.Color(), trr = mulberry32(17);
  trees.forEach(function (t, i) {
    var x = wx(t.x), z = wz(t.y), r = t.r * S * 1.2;
    m4.compose(v3.set(x, LAND_H + r * 0.9, z), qn.identity(), new THREE.Vector3(1, r * 1.8, 1)); trunks.setMatrixAt(i, m4);
    for (var k = 0; k < 2; k++) {
      var ox = (trr() - 0.5) * r * 0.8, oz = (trr() - 0.5) * r * 0.8, s = r * (k ? 0.75 : 1);
      m4.compose(v3.set(x + ox, LAND_H + r * (2 + k * 0.5), z + oz), qn.setFromEuler(new THREE.Euler(trr(), trr() * 6, 0)), new THREE.Vector3(s, s * 0.85, s));
      crowns.setMatrixAt(i * 2 + k, m4);
      crowns.setColorAt(i * 2 + k, tc.setHSL(0.25 + trr() * 0.06, 0.42 + trr() * 0.15, 0.13 + trr() * 0.08));
    }
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);
  // old-fashioned black lamp posts along the riverwalk
  var lpG = new THREE.CylinderGeometry(0.18, 0.3, 11, 6); lpG.translate(0, 5.5, 0);
  var lnG = new THREE.CylinderGeometry(0.75, 0.45, 1.6, 6); lnG.translate(0, 11.6, 0);
  var lpM = new THREE.InstancedMesh(lpG, new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.5, metalness: 0.3 }), lamps.length);
  var lnM = new THREE.InstancedMesh(lnG, new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe2a0, emissiveIntensity: 0.35 }), lamps.length);
  lamps.forEach(function (t, i) { m4.makeTranslation(wx(t.x), LAND_H, wz(t.y)); lpM.setMatrixAt(i, m4); lnM.setMatrixAt(i, m4); });
  lpM.castShadow = true; scene.add(lpM, lnM);

  // Main docks
  var docks = q('polygon[fill="url(#wood)"]').map(function (p) { return pts(p.getAttribute('points')); });
  docks.forEach(function (poly) { woodParts.push(extrude(poly, DOCK_H - 1.3, DOCK_H)); walk.push(poly); });
  // Gangways from each dock head up to the riverwalk
  docks.forEach(function (poly) {
    var srt = poly.slice().sort(function (a, b) { return a[1] - b[1]; }), top = [(srt[0][0] + srt[1][0]) / 2, (srt[0][1] + srt[1][1]) / 2];
    var ys = shoreY(top[0]); if (ys === null || top[1] - ys > 40) return;
    var y1 = top[1] + 2, y0 = ys - 16, gw = 9, gp = [[top[0] - gw / 2, y0], [top[0] + gw / 2, y0], [top[0] + gw / 2, y1], [top[0] - gw / 2, y1]];
    gangways.push({ x: top[0], y0: y0, y1: y1, ys: ys, poly: gp });
    walk.push(gp);
    var len = (y1 - ys) * S, slope = Math.atan2(LAND_H - DOCK_H, len), bx = new THREE.BoxGeometry(gw * S, 0.4, Math.hypot(len, LAND_H - DOCK_H));
    bx.rotateX(-slope); bx.translate(wx(top[0]), (LAND_H + DOCK_H) / 2 - 0.2, wz((y1 + ys) / 2));
    partsVC.push(paint(bx, '#76787a'));
    [-1, 1].forEach(function (sd) {
      var rl = new THREE.BoxGeometry(0.25, 0.25, Math.hypot(len, LAND_H - DOCK_H)); rl.rotateX(-slope);
      rl.translate(wx(top[0] + sd * gw / 2), (LAND_H + DOCK_H) / 2 + 3, wz((y1 + ys) / 2)); partsVC.push(paint(rl, '#c9ccd0'));
    });
  });

  // Slips and finger piers
  var sizeColors = {};
  q('g.slip').forEach(function (g) {
    var shp = g.firstElementChild, poly;
    if (shp.tagName === 'rect') { var rx = +shp.getAttribute('x'), ry = +shp.getAttribute('y'), rw = +shp.getAttribute('width'), rh = +shp.getAttribute('height'); poly = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]]; }
    else poly = pts(shp.getAttribute('points'));
    var color = shp.getAttribute('stroke') || shp.getAttribute('fill') || '#6f9a7a';
    var dock = g.getAttribute('data-dock'), num = g.getAttribute('data-num'), key = dock + num;
    sizeColors[g.getAttribute('data-size')] = color;
    // the slip edge nearest a main dock is where you step aboard
    var best = 0, bd = Infinity;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      var d = Math.min.apply(null, docks.map(function (dp) { return polyDist(mx, my, dp); }));
      if (d < bd) { bd = d; best = i; }
    }
    var ea = poly[best], eb = poly[(best + 1) % poly.length], edge = [(ea[0] + eb[0]) / 2, (ea[1] + eb[1]) / 2];
    var s = { key: key, dock: dock, num: num, size: g.getAttribute('data-size'), poly: poly, color: color, edge: edge, c: centroid(poly) };
    slips.push(s); slipByKey[key] = s;
    g.querySelectorAll('line.finger').forEach(function (ln) {
      var x1 = +ln.getAttribute('x1'), y1 = +ln.getAttribute('y1'), x2 = +ln.getAttribute('x2'), y2 = +ln.getAttribute('y2');
      var l = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / l, uy = (y2 - y1) / l;
      var fp = rectPoly(x1 - ux * 2, y1 - uy * 2, x2, y2, +ln.getAttribute('stroke-width') || 4);
      woodParts.push(extrude(fp, DOCK_H - 1.1, DOCK_H - 0.02)); walk.push(fp);
      s.fingers = (s.fingers || []).concat([[x2, y2]]);
    });
  });

  // Pilings along the docks and at the end of each finger, plus dock lights
  var pil = [];
  docks.forEach(function (poly) {
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 30) continue;
      for (var t = 0; t <= l; t += 45) pil.push([a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l, 7]);
    }
  });
  slips.forEach(function (s) { (s.fingers || []).forEach(function (f) { pil.push([f[0], f[1], 8]); }); });
  var pilG = new THREE.CylinderGeometry(0.6, 0.65, 1, 10);
  var pilings = new THREE.InstancedMesh(pilG, new THREE.MeshStandardMaterial({ color: 0xe4e1d8, roughness: 0.7 }), pil.length);
  pil.forEach(function (p, i) { var top = DOCK_H + p[2], bot = -6; m4.compose(v3.set(wx(p[0]), (top + bot) / 2, wz(p[1])), qn.identity(), new THREE.Vector3(1, top - bot, 1)); pilings.setMatrixAt(i, m4); });
  pilings.castShadow = true; scene.add(pilings);

  var lights = q('circle').filter(function (c) { return c.getAttribute('fill') === '#fff6c8'; });
  var postG = new THREE.CylinderGeometry(0.22, 0.28, 3.2, 6); postG.translate(0, 1.6, 0);
  var capG = new THREE.SphereGeometry(0.42, 10, 8); capG.translate(0, 3.4, 0);
  var posts = new THREE.InstancedMesh(postG, new THREE.MeshStandardMaterial({ color: 0x2f3b45, roughness: 0.6 }), lights.length);
  var caps = new THREE.InstancedMesh(capG, new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe9a0, emissiveIntensity: 0.6 }), lights.length);
  lights.forEach(function (c, i) { m4.makeTranslation(wx(+c.getAttribute('cx')), DOCK_H, wz(+c.getAttribute('cy'))); posts.setMatrixAt(i, m4); caps.setMatrixAt(i, m4); });
  scene.add(posts, caps);

  // Riverwalk railing, open where the gangways come up
  var rail = [];
  for (var r = 0; r < shore.length - 1; r++) {
    var a3 = shore[r], b3 = shore[r + 1], l3 = Math.hypot(b3[0] - a3[0], b3[1] - a3[1]), step = 9;
    for (var tt = 0; tt < l3; tt += step) {
      var x0 = a3[0] + (b3[0] - a3[0]) * tt / l3, y0 = a3[1] + (b3[1] - a3[1]) * tt / l3;
      var t2 = Math.min(l3, tt + step), x1 = a3[0] + (b3[0] - a3[0]) * t2 / l3, y1 = a3[1] + (b3[1] - a3[1]) * t2 / l3;
      var gap = gangways.some(function (gw) { return Math.abs((x0 + x1) / 2 - gw.x) < 9; });
      if (gap) continue;
      var nx2 = -(y1 - y0), ny2 = x1 - x0, nl = Math.hypot(nx2, ny2); x0 -= nx2 / nl * 2; y0 -= ny2 / nl * 2; x1 -= nx2 / nl * 2; y1 -= ny2 / nl * 2;
      var bar = new THREE.BoxGeometry(Math.hypot(x1 - x0, y1 - y0) * S, 0.18, 0.18);
      bar.rotateY(-Math.atan2(y1 - y0, x1 - x0)); bar.translate(wx((x0 + x1) / 2), LAND_H + 3.4, wz((y0 + y1) / 2)); rail.push(paint(bar, '#2f3b45'));
      var po = new THREE.BoxGeometry(0.2, 3.4, 0.2); po.translate(wx(x0), LAND_H + 1.7, wz(y0)); rail.push(paint(po, '#2f3b45'));
    }
  }
  scene.add(merged(rail, vcMat));

  // Slip number signs and dock letters
  slips.forEach(function (s) {
    var dx = s.c[0] - s.edge[0], dy = s.c[1] - s.edge[1], l = Math.hypot(dx, dy) || 1;
    var sp = labelSprite(s.key, s.color, '#fff', 2.4);
    sp.position.set(wx(s.edge[0] - dx / l * 1.5), DOCK_H + 2.2, wz(s.edge[1] - dy / l * 1.5));
    sp.visible = false; scene.add(sp); labels.push(sp);
  });
  q('text.d').forEach(function (t) {
    var x = +t.getAttribute('x'), y = +t.getAttribute('y') - 7.5, onLand = inPoly(x, y, land);
    var sp = labelSprite(t.textContent, '#0e2a4a', '#fff', 7, { round: true, ring: '#e8b648' });
    var base = onLand ? LAND_H : DOCK_H;
    sp.position.set(wx(x), base + 10, wz(y)); scene.add(sp);
    var pole = new THREE.CylinderGeometry(0.18, 0.18, 7, 6); pole.translate(wx(x), base + 3.5, wz(y)); partsVC.push(paint(pole, '#2f3b45'));
  });

  // Boats (decorative): most slips full, mostly white, lots of sailboats on A-C as in the photos; the same every visit
  var rnd = mulberry32(20261120), hulls = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#f7f6f2', '#f4f1ea', '#ffffff', '#1d3557', '#ffffff', '#e9e4d4'];
  slips.forEach(function (s) {
    if (rnd() > 0.8) return;
    var p = s.poly, e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1]], e2 = [p[2][0] - p[1][0], p[2][1] - p[1][1]];
    var L1 = Math.hypot(e1[0], e1[1]), L2 = Math.hypot(e2[0], e2[1]);
    var u = L1 > L2 ? e1 : e2, Lu = Math.max(L1, L2), Lv = Math.min(L1, L2);
    var ux = u[0] / Lu, uy = u[1] / Lu;
    var toDock = (s.edge[0] - s.c[0]) * ux + (s.edge[1] - s.c[1]) * uy;
    if (toDock < 0) { ux = -ux; uy = -uy; }          // bow points toward the dock...
    if (rnd() < 0.35) { ux = -ux; uy = -uy; }        // ...unless backed in
    var len = Lu * S * (0.72 + rnd() * 0.16), beam = Math.min(Lv * S * 0.72, len * 0.36);
    var sail = rnd() < ('ABCZ'.indexOf(s.dock) >= 0 ? 0.55 : 0.18);
    boatParts.push.apply(boatParts, boat(len, beam, sail, hulls[Math.floor(rnd() * hulls.length)], rnd).map(function (g) {
      g.rotateY(Math.atan2(-uy, ux)); g.translate(wx(s.c[0]), 0, wz(s.c[1])); return g;
    }));
  });

  // Far shore across the Trent
  var farPoly = [[-3000, 2250], [5200, 2050], [5200, 4200], [-3000, 4200]];
  partsVC.push(paintBy(extrude(farPoly, -3, 4), '#5f7f4a', '#6d6152'));
  var farTrees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x3f6237, flatShading: true, roughness: 1 }), 220);
  var fr = mulberry32(11);
  for (var ft = 0; ft < 220; ft++) {
    var fx = -3000 + ft / 220 * 8200 + fr() * 30, fy = 2250 - (fx + 3000) / 8200 * 200 + 20 + fr() * 120, rr = 14 + fr() * 20;
    m4.compose(v3.set(wx(fx), 4 + rr * 0.8, wz(fy)), qn.identity(), new THREE.Vector3(rr, rr * 1.3, rr)); farTrees.setMatrixAt(ft, m4);
  }
  scene.add(farTrees);

  scene.add(merged(woodParts, woodMat), merged(partsVC, vcMat), merged(boatParts, boatMat));
  [[grassParts, grassMat], [pavedParts, pavedMat], [roadParts, roadMat]].forEach(function (p) { if (p[0].length) { var mm = merged(p[0], p[1]); mm.castShadow = false; scene.add(mm); } });
  Object.keys(wallParts).forEach(function (k) { if (wallParts[k].length) scene.add(merged(wallParts[k], wallMats[k])); });

  // Highlight for "Go to slip"
  marker = new THREE.Group();
  var ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.35, 8, 32), new THREE.MeshBasicMaterial({ color: 0xe8b648 }));
  ring.rotation.x = Math.PI / 2; marker.add(ring);
  var pin = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 16), new THREE.MeshBasicMaterial({ color: 0xe8483c }));
  pin.rotation.x = Math.PI; pin.position.y = 9; marker.add(pin);
  marker.visible = false; scene.add(marker);
}

function boat(len, beam, sail, hullHex, rnd) {
  var out = [], fb = Math.max(2, len * 0.09), half = beam / 2;
  var sh = new THREE.Shape();
  sh.moveTo(-len / 2, -half * 0.86);
  sh.quadraticCurveTo(-len / 2 - 0.4, 0, -len / 2, half * 0.86);
  sh.lineTo(len * 0.05, half);
  sh.quadraticCurveTo(len * 0.38, half * 0.9, len / 2, 0);
  sh.quadraticCurveTo(len * 0.38, -half * 0.9, len * 0.05, -half);
  sh.closePath();
  var hull = new THREE.ExtrudeGeometry(sh, { depth: fb, bevelEnabled: false, curveSegments: 8 });
  hull.rotateX(-Math.PI / 2); hull.translate(0, -0.7, 0);
  out.push(paintBy(hull, '#d9cbb0', hullHex));
  // waterline boot stripe
  var boot = new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: false, curveSegments: 8 });
  boot.rotateX(-Math.PI / 2); boot.scale(1.01, 1, 1.01); boot.translate(0, -0.55, 0);
  out.push(paint(boot, hullHex === '#ffffff' || hullHex === '#f4f1ea' || hullHex === '#e9e4d4' ? '#1d3557' : '#f4f1ea'));
  var deckY = fb - 0.7;
  // stainless rub rail along the deck edge
  var rub = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: false, curveSegments: 8 });
  rub.rotateX(-Math.PI / 2); rub.scale(1.015, 1, 1.03); rub.translate(0, deckY - 0.3, 0); out.push(paint(rub, '#b9bec4'));
  // a cabin with a raked windshield: side profile extruded across the boat
  function cabin(x0, length, height, width, y0, rake, body, glass) {
    var p = new THREE.Shape();
    p.moveTo(x0 - length / 2, 0); p.lineTo(x0 - length / 2, height); p.lineTo(x0 + length / 2 - rake, height); p.lineTo(x0 + length / 2, 0); p.closePath();
    var g = new THREE.ExtrudeGeometry(p, { depth: width, bevelEnabled: false }); g.translate(0, y0, -width / 2); out.push(paint(g, body));
    var w = new THREE.Shape(), lo = height * 0.42, hi = height * 0.86;
    w.moveTo(x0 - length / 2 + 0.6, lo); w.lineTo(x0 - length / 2 + 0.6, hi);
    w.lineTo(x0 + length / 2 - rake * hi / height - 0.05, hi); w.lineTo(x0 + length / 2 - rake * lo / height - 0.05, lo); w.closePath();
    var wg = new THREE.ExtrudeGeometry(w, { depth: width + 0.08, bevelEnabled: false }); wg.translate(0.04, y0, -(width + 0.08) / 2); out.push(paint(wg, glass));
  }
  function line(a, b, r, col) { // a thin rod between two points (rigging, stays)
    var d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), g = new THREE.CylinderGeometry(r, r, L, 4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); out.push(paint(g, col));
  }
  if (sail) {
    cabin(-len * 0.04, len * 0.34, 1.7, beam * 0.56, deckY, 1.2, '#f4f1ea', '#1f2a35');
    var mx = len * 0.08, mh = len * 1.3, mtop = deckY + mh;
    var mast = new THREE.CylinderGeometry(0.14, 0.2, mh, 6); mast.translate(mx, deckY + mh / 2, 0); out.push(paint(mast, '#d5d8dc'));
    var boom = new THREE.CylinderGeometry(0.12, 0.12, len * 0.42, 6); boom.rotateZ(Math.PI / 2); boom.translate(mx - len * 0.21, deckY + 3.4, 0); out.push(paint(boom, '#d5d8dc'));
    var cover = new THREE.CylinderGeometry(0.5, 0.42, len * 0.4, 8); cover.rotateZ(Math.PI / 2); cover.translate(mx - len * 0.21, deckY + 3.9, 0); out.push(paint(cover, rnd() < 0.6 ? '#1d4f7a' : (rnd() < 0.5 ? '#6b6f73' : '#7a2a2a')));
    line([mx, mtop, 0], [len * 0.49, deckY + 0.2, 0], 0.07, '#e8e6e0');           // forestay with furled jib
    line([mx, mtop * 0.92, 0], [len * 0.47, deckY + 0.6, 0], 0.14, rnd() < 0.4 ? '#2a5379' : '#e8e6e0');
    line([mx, mtop, 0], [-len * 0.5, deckY + 0.3, 0], 0.04, '#9aa0a6');           // backstay
    [1, -1].forEach(function (sd) { line([mx, mtop * 0.8, 0], [mx - 0.5, deckY, sd * half * 0.95], 0.035, '#9aa0a6'); }); // shrouds
  } else {
    var ch = 2.4 + len * 0.035, cl = len * (0.38 + rnd() * 0.1);
    cabin(-len * 0.06, cl, ch, beam * 0.78, deckY, ch * 0.9, '#f7f5ef', '#1c2630');
    if (len > 32) {
      cabin(-len * 0.1, cl * 0.6, ch * 0.75, beam * 0.66, deckY + ch, ch * 0.5, '#f7f5ef', '#1c2630');   // flybridge
      var top = new THREE.BoxGeometry(cl * 0.5, 0.25, beam * 0.7); top.translate(-len * 0.12, deckY + ch * 2.4, 0); out.push(paint(top, rnd() < 0.7 ? '#24384f' : '#e9e6df'));
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (c) { line([-len * 0.12 + c[0] * cl * 0.22, deckY + ch * 1.75, c[1] * beam * 0.3], [-len * 0.12 + c[0] * cl * 0.22, deckY + ch * 2.4, c[1] * beam * 0.3], 0.05, '#c9ccd0'); });
      if (len > 45) { var radar = new THREE.CylinderGeometry(0.9, 0.9, 0.4, 12); radar.translate(-len * 0.08, deckY + ch * 2.6, 0); out.push(paint(radar, '#f1f1ee')); }
    } else {
      var bim = new THREE.BoxGeometry(cl * 0.45, 0.2, beam * 0.72); bim.translate(-len * 0.24, deckY + ch + 2.6, 0); out.push(paint(bim, '#24384f'));
    }
  }
  return out;
}

function shoreY(x) {
  for (var i = 0; i < shore.length - 1; i++) {
    var a = shore[i], b = shore[i + 1];
    if (x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0] || 1);
  }
  return null;
}

// ---------- where can you stand, and how high ----------
function surface(x, y) { // height of the walkable surface at an SVG point, or null for water/buildings
  for (var i = 0; i < gangways.length; i++) {
    var g = gangways[i];
    if (inPoly(x, y, g.poly)) { var t = (y - g.ys) / (g.y1 - g.ys); return t <= 0 ? LAND_H : LAND_H + (DOCK_H - LAND_H) * Math.min(1, t); }
  }
  for (var j = 0; j < walk.length; j++) if (inPoly(x, y, walk[j])) return DOCK_H;
  if (inPoly(x, y, land)) {
    for (var k = 0; k < blocked.length; k++) if (inPoly(x, y, blocked[k])) return null;
    var ys = shoreY(x); if (ys !== null && y > ys - 2.5) return null; // stay behind the railing
    if (x < -300 || x > 2300 || y < -100) return null;
    return LAND_H;
  }
  return null;
}
function nearestSlip(x, y, max) {
  var best = null, bd = max;
  slips.forEach(function (s) { var d = Math.hypot(s.edge[0] - x, s.edge[1] - y); if (d < bd) { bd = d; best = s; } });
  return best;
}
function currentDock(x, y) {
  var s = nearestSlip(x, y, 60);
  if (!s) return inPoly(x, y, land) ? 'On the riverwalk' : '';
  return (surface(x, y) === LAND_H ? 'Riverwalk near ' : s.dock + ' Dock · near ') + s.key;
}

// ---------- input ----------
var keys = {}, look = null, stick = null, moveVec = { x: 0, y: 0 };
function bindInput() {
  addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q', 'e'].indexOf(k) >= 0) {
      if (wrapActive()) e.preventDefault();
      keys[k] = true;
    }
  });
  addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  addEventListener('blur', function () { keys = {}; });

  canvas.addEventListener('pointerdown', function (e) {
    canvas.focus && canvas.focus({ preventScroll: true });
    lastActive = performance.now();
    var r = canvas.getBoundingClientRect(), lx = e.clientX - r.left;
    if (e.pointerType === 'touch' && lx < r.width * 0.42 && !stick) {
      stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      var st = $('dwStick'); st.hidden = false; st.style.left = lx + 'px'; st.style.top = (e.clientY - r.top) + 'px';
    } else if (!look) {
      look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (stick && e.pointerId === stick.id) {
      var dx = e.clientX - stick.x0, dy = e.clientY - stick.y0, l = Math.hypot(dx, dy), m = 45;
      if (l > m) { dx *= m / l; dy *= m / l; }
      moveVec.x = dx / m; moveVec.y = -dy / m;
      $('dwKnob').style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    } else if (look && e.pointerId === look.id) {
      var sens = e.pointerType === 'touch' ? 0.006 : 0.0045;
      player.yaw += (e.clientX - look.x) * sens;
      player.pitch = Math.max(-1.35, Math.min(1.1, player.pitch + (e.clientY - look.y) * sens));
      look.x = e.clientX; look.y = e.clientY;
    }
  });
  function end(e) {
    if (stick && e.pointerId === stick.id) { stick = null; moveVec.x = moveVec.y = 0; $('dwStick').hidden = true; $('dwKnob').style.transform = ''; }
    if (look && e.pointerId === look.id) { look = null; canvas.style.cursor = ''; }
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.tabIndex = 0;

  $('dwMini').addEventListener('click', function (e) {
    var r = this.getBoundingClientRect(), x = 40 + (e.clientX - r.left) / r.width * 1920, y = 90 + (e.clientY - r.top) / r.height * 1410;
    var spot = findStand(x, y);
    if (spot) { player.x = spot[0]; player.y = spot[1]; marker.visible = false; }
    else flash('That spot is in the water. Tap a dock or the riverwalk.');
  });
  $('dwGo').addEventListener('submit', function (e) { e.preventDefault(); goToSlip($('dwSlip').value); $('dwSlip').blur(); });
  $('dwFly').addEventListener('click', function () {
    player.fly = !player.fly; this.classList.toggle('on', player.fly);
    this.innerHTML = player.fly ? '&#9660; Land' : '&#9650; Fly up';
    if (player.fly) player.pitch = -0.75;
    else { var spot = findStand(player.x, player.y); if (spot) { player.x = spot[0]; player.y = spot[1]; } player.pitch = -0.05; }
  });
  $('dwFull').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
    else flash('Full screen isn’t available in this browser.');
  });
  $('dwHelp').innerHTML = touchUI
    ? 'Left thumb: walk &middot; right thumb: look around &middot; tap the mini map to jump'
    : 'W A S D or arrow keys to walk &middot; drag to look &middot; Shift to jog &middot; click the mini map to jump';
}
var lastActive = 0;
function wrapActive() { var r = wrap.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && performance.now() - lastActive < 600000; }

function findStand(x, y) { // nearest walkable point to an SVG point
  if (surface(x, y) !== null) return [x, y];
  for (var r = 2; r < 60; r += 2) for (var a = 0; a < 16; a++) {
    var px = x + r * Math.cos(a / 16 * 6.283), py = y + r * Math.sin(a / 16 * 6.283);
    if (surface(px, py) !== null) return [px, py];
  }
  return null;
}
function goToSlip(text) {
  var k = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  var m = k.match(/^([A-GZ])0*([0-9]+[A-Z]?)$/), s = slipByKey[k] || (m && (slipByKey[m[1] + m[2]] || slipByKey[m[1] + '0' + m[2]]));
  if (!s) { flash('No slip "' + (text || '') + '" on the map. Try something like B23 or E0A.'); return false; }
  var dx = s.c[0] - s.edge[0], dy = s.c[1] - s.edge[1], l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  var spot = null;
  // stand back across the dock and off to one side, so you see the slip at an angle
  var ea = s.poly.reduce(function (b, p) { var t = Math.abs((p[0] - s.edge[0]) * dy - (p[1] - s.edge[1]) * dx); return Math.max(b, t); }, 0);
  var side = Math.min(40, ea + 6);
  [[10, side], [10, -side], [8, side / 2], [8, -side / 2], [6, 4], [4, 0], [1, 0]].some(function (o) {
    var px = s.edge[0] - dx * o[0] - dy * o[1], py = s.edge[1] - dy * o[0] + dx * o[1];
    if (surface(px, py) !== null) { spot = [px, py]; return true; } return false;
  });
  spot = spot || findStand(s.edge[0], s.edge[1]);
  if (!spot) return false;
  player.fly = false; $('dwFly').classList.remove('on'); $('dwFly').innerHTML = '&#9650; Fly up';
  player.x = spot[0]; player.y = spot[1];
  var lx = s.c[0] - spot[0], ly = s.c[1] - spot[1];
  player.yaw = Math.atan2(-lx, -ly); player.pitch = -0.25;
  marker.position.set(wx(s.c[0]), 0.4, wz(s.c[1])); marker.visible = true;
  flash('Slip ' + s.key + (s.size ? ' · ' + s.size + '′' : ''), 2200);
  return true;
}
var flashT;
function flash(text, ms) {
  var m = $('dwMsg'); m.textContent = text; m.hidden = false;
  clearTimeout(flashT); flashT = setTimeout(function () { m.hidden = true; }, ms || 3200);
}

// ---------- frame loop ----------
var clock = new THREE.Clock(), lastWhere = '', frame = 0;
function update(dt) {
  var fx = 0, fy = 0;
  if (keys.w || keys.arrowup) fy += 1;
  if (keys.s || keys.arrowdown) fy -= 1;
  if (keys.a) fx -= 1;
  if (keys.d) fx += 1;
  if (keys.arrowleft || keys.q) player.yaw += 1.8 * dt;
  if (keys.arrowright || keys.e) player.yaw -= 1.8 * dt;
  fx += moveVec.x; fy += moveVec.y;
  var mag = Math.hypot(fx, fy);
  if (mag > 1) { fx /= mag; fy /= mag; }
  var speed = (player.fly ? 60 : (keys.shift || Math.hypot(moveVec.x, moveVec.y) > 0.95 ? JOG : WALK)) / S * dt;
  // yaw 0 looks north (-y); positive yaw turns left
  var sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  var dx = (-sy * fy + cy * fx) * speed, dy = (-cy * fy - sy * fx) * speed;
  if (dx || dy) {
    if (player.fly) { player.x = Math.max(-400, Math.min(2400, player.x + dx)); player.y = Math.max(-200, Math.min(1800, player.y + dy)); }
    else if (surface(player.x + dx, player.y + dy) !== null) { player.x += dx; player.y += dy; }
    else if (surface(player.x + dx, player.y) !== null) player.x += dx;   // slide along edges
    else if (surface(player.x, player.y + dy) !== null) player.y += dy;
  }
  var target = player.fly ? FLY_H : (surface(player.x, player.y) || DOCK_H) + EYE;
  player.h += (target - player.h) * Math.min(1, dt * (player.fly ? 2.2 : 10));
  var bob = !player.fly && (dx || dy) ? Math.sin(performance.now() / 160) * 0.06 : 0;
  camera.position.set(wx(player.x), player.h + bob, wz(player.y));
  camera.rotation.set(player.pitch, player.yaw, 0);

  sun.position.set(camera.position.x + sunDir.x * 400, sunDir.y * 400, camera.position.z + sunDir.z * 400);
  sun.target.position.set(camera.position.x, 0, camera.position.z);
  water.material.uniforms.time.value += dt * 0.6;
  if (marker.visible) { marker.children[1].position.y = 9 + Math.sin(performance.now() / 300) * 0.8; marker.rotation.y += dt; }

  if (frame++ % 10 === 0) {
    var cx = camera.position.x, cz = camera.position.z, lim = player.fly ? 0 : 140 * 140;
    labels.forEach(function (sp) { var ddx = sp.position.x - cx, ddz = sp.position.z - cz; sp.visible = ddx * ddx + ddz * ddz < lim; });
    var where = player.fly ? 'Bird’s-eye view' : currentDock(player.x, player.y);
    if (where !== lastWhere) { $('dwWhere').textContent = where || ' '; $('dwWhere').hidden = !where; lastWhere = where; }
    var mi = $('dwMini'), r = mi.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), dot = $('dwDot');
    dot.style.left = (r.left - wr.left + (player.x - 40) / 1920 * r.width) + 'px';
    dot.style.top = (r.top - wr.top + (player.y - 90) / 1410 * r.height) + 'px';
    dot.style.setProperty('--yaw', (-player.yaw * 180 / Math.PI) + 'deg');
  }
}
function resize() {
  var w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function loop() {
  requestAnimationFrame(loop);
  var r = wrap.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || document.hidden) { clock.getDelta(); return; }
  update(Math.min(clock.getDelta(), 0.1));
  renderer.render(scene, camera);
}

function start() {
  try { setup(); } catch (err) {
    $('dwWhere').textContent = 'Your browser can’t show 3D graphics (WebGL is off or unsupported).';
    return;
  }
  fetch('images/marina-slip-map.svg').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (txt) {
    build(txt);
    bindInput();
    resize(); addEventListener('resize', resize); document.addEventListener('fullscreenchange', resize);
    // start on the riverwalk at the head of C Dock, looking down the dock
    var c = gangways.reduce(function (b, g) { return !b || Math.abs(g.x - 890) < Math.abs(b.x - 890) ? g : b; }, null);
    player.x = c ? c.x : 890; player.y = c ? c.ys - 12 : 490; player.yaw = Math.PI; player.h = LAND_H + EYE;
    var want = new URLSearchParams(location.search).get('slip');
    if (want) goToSlip(want);
    $('dwWhere').textContent = '';
    loop();
    window.dockWalk = { player: player, goToSlip: goToSlip, surface: surface, slips: slips, renderer: renderer, scene: scene, camera: camera, update: update };
  }).catch(function () { $('dwWhere').textContent = 'Couldn’t load the marina map. Please refresh to try again.'; });
}
start();
