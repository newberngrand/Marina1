// Walk the Docks in 3D: builds a walkable 3D marina from images/marina-slip-map.svg.
// SVG units are mapped to feet (S feet per unit); SVG x -> world X, SVG y -> world Z (north is -Z).
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
// HD = ambient-occlusion post-processing and sharper shadows; on by default on desktops, remembered per browser
var hq = !lowPower;
try { var savedQ = localStorage.getItem('dwQuality'); if (savedQ) hq = savedQ === 'high'; } catch (e) {}

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
// Photo-scanned PBR texture sets (CC0, polyhaven.com) in images/pbr: color, normal and roughness maps.
// UVs here are in feet, so tileFeet is how much ground one copy of the texture covers.
var texLoader = new THREE.TextureLoader();
function pbrMaterial(id, tileFeet, opts) {
  opts = opts || {};
  var maps = {};
  ['diff', 'nor', 'rough'].forEach(function (k) {
    var t = texLoader.load('images/pbr/' + id + '_' + k + '.jpg');
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tileFeet, 1 / tileFeet); t.anisotropy = 8;
    if (opts.rot) t.rotation = opts.rot;
    if (k === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    maps[k] = t;
  });
  var ns = opts.normal || 1;
  return new THREE.MeshStandardMaterial({ map: maps.diff, normalMap: maps.nor, normalScale: new THREE.Vector2(ns, ns), roughnessMap: maps.rough, roughness: opts.rough || 1, color: opts.color || 0xffffff });
}
function canvasTex(w, h, draw) {
  var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
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
  brick:    { kind: 'brick', wall: '#8b4a35', alt: ['#7a3f2c', '#9a5640', '#83442f', '#6f3a2a', '#a35c44'], bayW: 11, floorH: 11, win: 0.4, frame: '#f2eee6', grid: true },
  brick2:   { kind: 'brick', wall: '#a0583b', alt: ['#8f4d33', '#b0654a', '#94513a', '#a9603f'], bayW: 10, floorH: 11, win: 0.38, frame: '#efe9dc', grid: true },
  brick3:   { kind: 'brick', wall: '#6e3b2c', alt: ['#5f3226', '#7c4433', '#663628', '#86503c'], bayW: 10, floorH: 11.5, win: 0.4, frame: '#e9e4d8', grid: true },
  condo:    { kind: 'brick', wall: '#93503a', alt: ['#844630', '#a05b43', '#8a4934'], bayW: 13, floorH: 10.5, win: 0.55, frame: '#ece6da', balcony: true },
  hotel:    { kind: 'brick', wall: '#8a4632', alt: ['#7c3e2c', '#97513b'], bayW: 8, floorH: 10, win: 0.86, frame: '#c98a4a', band: true },
  white:    { kind: 'stucco', wall: '#e9e4d8', alt: ['#dedad0', '#f1ede4', '#d8d2c4'], bayW: 10, floorH: 11, win: 0.42, frame: '#ffffff', grid: true },
  colonial: { kind: 'brick', wall: '#924c36', alt: ['#80412f', '#a15a42'], bayW: 9, floorH: 12, win: 0.36, frame: '#fbf8f2', shutters: true, grid: true },
  siding:   { kind: 'siding', wall: '#f2f0ea', alt: ['#e4e1d9'], bayW: 11, floorH: 10.5, win: 0.36, frame: '#ffffff', shutters: true, grid: true },
  store:    { kind: 'store', wall: '#7a3f2c', alt: ['#6b3727', '#874632'], bayW: 12, floorH: 13 }
};
function facadeTexture(f) { // one tile = 2 bays x 2 floors, so neighbouring windows differ
  var T = 256, C = 128;
  var t = canvasTex(T, T, function (x) {
    var rnd = mulberry32(f.bayW * 131 + f.floorH * 7 + f.wall.length + f.alt.length * 17);
    x.fillStyle = f.wall; x.fillRect(0, 0, T, T);
    if (f.kind === 'brick' || f.kind === 'store') {                     // running-bond brick with mortar joints
      x.fillStyle = 'rgba(205,196,182,.55)'; x.fillRect(0, 0, T, T);
      for (var r = 0; r < T; r += 4) for (var c0 = (r / 4 % 2) * 5 - 5; c0 < T; c0 += 10) {
        x.fillStyle = f.alt[Math.floor(rnd() * f.alt.length)]; x.fillRect(c0, r, 9, 3);
        if (rnd() < 0.05) { x.fillStyle = 'rgba(30,20,15,.25)'; x.fillRect(c0, r, 9, 3); }
      }
    } else if (f.kind === 'siding') {                                     // painted clapboards with shadow lines
      for (var sy = 0; sy < T; sy += 7) { x.fillStyle = f.alt[0]; x.fillRect(0, sy, T, 1); x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(0, sy + 6, T, 1); }
      for (var cb = 0; cb < T; cb += C) { x.fillStyle = '#ffffff'; x.fillRect(cb, 0, 3, T); }
    } else {
      for (var n = 0; n < 2500; n++) { x.fillStyle = f.alt[Math.floor(rnd() * f.alt.length)]; x.fillRect(rnd() * T, rnd() * T, 2, 2); }
    }
    for (var row = 0; row < 2; row++) for (var col = 0; col < 2; col++) {
      var ox = col * C, oy = row * C;
      if (f.kind === 'store') { storefront(x, ox, oy, C, rnd, col); continue; }
      var ww = C * f.win, wx0 = ox + (C - ww) / 2, wy = oy + C * 0.2, wh = C * 0.56;
      if (f.band) { x.fillStyle = '#b8743c'; x.fillRect(ox, oy + C * 0.78, C, C * 0.12); }
      if (f.shutters) {
        x.fillStyle = f.kind === 'siding' ? ['#24303c', '#2f4a37', '#5a2a24'][Math.floor(rnd() * 3)] : '#26303a';
        x.fillRect(wx0 - 11, wy, 8, wh); x.fillRect(wx0 + ww + 3, wy, 8, wh);
        x.fillStyle = 'rgba(0,0,0,.25)'; for (var lv = wy + 3; lv < wy + wh; lv += 4) { x.fillRect(wx0 - 10, lv, 6, 1); x.fillRect(wx0 + ww + 4, lv, 6, 1); }
      }
      if (f.kind === 'brick' && !f.band) { x.fillStyle = '#d8d0c0'; x.fillRect(wx0 - 5, wy - 9, ww + 10, 6); }      // stone lintel
      x.fillStyle = f.frame; x.fillRect(wx0 - 3, wy - 3, ww + 6, wh + 6);
      var g = x.createLinearGradient(0, wy, 0, wy + wh), v = rnd();
      g.addColorStop(0, '#b4c6d3'); g.addColorStop(0.42, '#62788c'); g.addColorStop(1, '#26323e');
      x.fillStyle = g; x.fillRect(wx0, wy, ww, wh);
      if (v < 0.22) { // blinds
        x.fillStyle = 'rgba(232,226,210,.85)'; x.fillRect(wx0, wy, ww, wh * (0.3 + rnd() * 0.5));
        x.fillStyle = 'rgba(0,0,0,.12)'; for (var bl = wy + 2; bl < wy + wh * 0.8; bl += 3) x.fillRect(wx0, bl, ww, 1);
      } else if (v < 0.42) { // curtains
        x.fillStyle = ['#c9b48a', '#9c4a3c', '#e8e0cf', '#6b7c5a'][Math.floor(rnd() * 4)]; x.globalAlpha = 0.8;
        x.fillRect(wx0, wy, ww * 0.25, wh); x.fillRect(wx0 + ww * 0.75, wy, ww * 0.25, wh); x.globalAlpha = 1;
      } else if (v < 0.5) { x.fillStyle = 'rgba(255,214,140,.55)'; x.fillRect(wx0, wy, ww, wh); }   // a lamp on inside
      else if (v < 0.62) { x.fillStyle = 'rgba(10,14,20,.45)'; x.fillRect(wx0, wy, ww, wh); }
      x.fillStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.moveTo(wx0, wy + wh * 0.6); x.lineTo(wx0 + ww * 0.5, wy); x.lineTo(wx0 + ww * 0.7, wy); x.lineTo(wx0, wy + wh * 0.9); x.fill(); // sky glint
      x.fillStyle = f.frame; x.fillRect(wx0, wy + wh * 0.48, ww, 2.5);
      if (f.grid) { for (var gx = 1; gx < 3; gx++) x.fillRect(wx0 + ww * gx / 3 - 0.5, wy, 1.5, wh); x.fillRect(wx0, wy + wh * 0.24, ww, 1.2); x.fillRect(wx0, wy + wh * 0.74, ww, 1.2); }
      else if (ww > 40) { for (var k = 1; k < 3; k++) x.fillRect(wx0 + ww * k / 3, wy, 2, wh); }
      else x.fillRect(wx0 + ww / 2 - 1, wy, 2, wh);
      x.fillStyle = f.kind === 'siding' ? '#ffffff' : '#d9d2c3'; x.fillRect(wx0 - 6, wy + wh + 2, ww + 12, 5);       // sill
      x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(wx0 - 6, wy + wh + 7, ww + 12, 2);
      if (f.balcony) {
        x.fillStyle = '#e8e4dc'; x.fillRect(ox, oy + C * 0.86, C, C * 0.06);
        x.fillStyle = 'rgba(40,45,50,.8)'; for (var b = 2; b < C; b += 6) x.fillRect(ox + b, oy + C * 0.72, 1, C * 0.14); x.fillRect(ox, oy + C * 0.72, C, 2);
      }
      x.fillStyle = 'rgba(30,25,20,.08)'; x.fillRect(wx0 + 4, wy + wh + 9, ww - 8, C * 0.12);                       // grime under the sill
    }
    x.fillStyle = 'rgba(0,0,0,.1)'; x.fillRect(0, C - 2, T, 2); x.fillRect(0, T - 2, T, 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function storefront(x, ox, oy, C, rnd, col) {
  var signs = ['#1f3b2d', '#5b1f24', '#1d2e4a', '#2b2b2b', '#6b4a1e', '#3c2f4d'];
  x.fillStyle = signs[Math.floor(rnd() * signs.length)]; x.fillRect(ox + 4, oy + C * 0.06, C - 8, C * 0.18);   // sign band
  x.fillStyle = 'rgba(240,225,190,.85)'; for (var l = 0; l < 6; l++) x.fillRect(ox + 18 + l * 15 + rnd() * 3, oy + C * 0.12, 9, C * 0.06);
  var aw = ['#2f5d3a', '#7a2a2a', '#1d3c63', '#c9b48a'][Math.floor(rnd() * 4)];                                   // striped awning
  for (var st = 0; st < C - 8; st += 10) { x.fillStyle = (st / 10) % 2 ? aw : '#efe9dc'; x.fillRect(ox + 4 + st, oy + C * 0.26, 10, C * 0.1); }
  x.fillStyle = '#2a2a28'; x.fillRect(ox + 6, oy + C * 0.37, C - 12, C * 0.6);
  var g = x.createLinearGradient(0, oy + C * 0.38, 0, oy + C * 0.95);
  g.addColorStop(0, '#9fb3c1'); g.addColorStop(0.5, '#4f6476'); g.addColorStop(1, '#243240');
  x.fillStyle = g; x.fillRect(ox + 9, oy + C * 0.39, C - 18, C * 0.48);
  x.fillStyle = 'rgba(255,220,160,.25)'; x.fillRect(ox + 9, oy + C * 0.6, C - 18, C * 0.27);
  x.fillStyle = '#2a2a28'; x.fillRect(ox + C / 2 - 1, oy + C * 0.39, 3, C * 0.48);
  if (col === 1) { x.fillStyle = '#3a2a1e'; x.fillRect(ox + C * 0.62, oy + C * 0.45, C * 0.2, C * 0.52); x.fillStyle = '#c8a050'; x.fillRect(ox + C * 0.78, oy + C * 0.7, 3, 3); }
  x.fillStyle = '#6b6560'; x.fillRect(ox + 6, oy + C * 0.88, C - 12, C * 0.09);                                  // kickplate
}
function roofTexture(kind) {
  var t = canvasTex(256, 256, function (x, w, h) {
    var rnd = mulberry32(kind === 'shingle' ? 3 : 8);
    if (kind === 'shingle') {                                            // staggered shingles (light base, tinted per roof)
      x.fillStyle = '#d8d8d8'; x.fillRect(0, 0, w, h);
      for (var r = 0; r < h; r += 16) for (var c = (r / 16 % 2) * 12 - 12; c < w; c += 24) {
        var l = 70 + rnd() * 25; x.fillStyle = 'hsl(0,0%,' + l + '%)'; x.fillRect(c + 1, r, 22, 15);
        x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(c, r + 14, 24, 2); x.fillRect(c, r, 1, 15);
      }
    } else {                                                             // gravel / membrane flat roof with seams
      x.fillStyle = '#d0d0d0'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 6000; i++) { var l2 = 55 + rnd() * 45; x.fillStyle = 'hsl(0,0%,' + l2 + '%)'; x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
      x.fillStyle = 'rgba(0,0,0,.18)'; for (var s = 0; s < w; s += 64) x.fillRect(s, 0, 2, h);
      for (var k = 0; k < 8; k++) { x.fillStyle = 'rgba(40,40,40,' + rnd() * 0.12 + ')'; x.beginPath(); x.ellipse(rnd() * w, rnd() * h, 20 + rnd() * 50, 10 + rnd() * 30, 0, 0, 7); x.fill(); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  var rep = kind === 'shingle' ? 1 / 12 : 1 / 30; t.repeat.set(rep, rep);
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
  var vTop = (top - base) / floorH / 2;
  for (var e = 0; e < n; e++) {
    var a = poly[e], b = poly[(e + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) * S, u1 = Math.max(1, Math.round(L / bayW));
    var A0 = [wx(a[0]), base, wz(a[1])], B0 = [wx(b[0]), base, wz(b[1])], B1 = [wx(b[0]), top, wz(b[1])], A1 = [wx(a[0]), top, wz(a[1])];
    var tA0 = [0, 0], tB0 = [u1 / 2, 0], tB1 = [u1 / 2, vTop], tA1 = [0, vTop];
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
  var A = 0, pos = [], uv = [], n = poly.length;
  for (var i = 0; i < n; i++) { var p = poly[i], q2 = poly[(i + 1) % n]; A += p[0] * q2[1] - q2[0] * p[1]; }
  for (var e = 0; e < n; e++) {
    var a = poly[e], b = poly[(e + 1) % n], ta = topPoly[e], tb = topPoly[(e + 1) % n];
    var A0 = [wx(a[0]), base, wz(a[1])], B0 = [wx(b[0]), base, wz(b[1])], B1 = [wx(tb[0]), base + rise, wz(tb[1])], A1 = [wx(ta[0]), base + rise, wz(ta[1])];
    var Le = Math.hypot(B0[0] - A0[0], B0[2] - A0[2]), dxe = (B0[0] - A0[0]) / (Le || 1), dze = (B0[2] - A0[2]) / (Le || 1);
    var slopeLen = Math.hypot(rise, Math.abs((A1[0] - A0[0]) * dze - (A1[2] - A0[2]) * dxe));
    var uvOf = function (v) { return [(v[0] - A0[0]) * dxe + (v[2] - A0[2]) * dze, (v[1] - base) / (rise || 1) * slopeLen]; };
    var tris = A < 0 ? [A0, B0, B1, A0, B1, A1] : [A0, B1, B0, A0, A1, B1];
    tris.forEach(function (v) { pos.push(v[0], v[1], v[2]); var t2 = uvOf(v); uv.push(t2[0], t2[1]); });
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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
  renderer.toneMappingExposure = 0.6;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb9cfdc, 1200, 5200);
  camera = new THREE.PerspectiveCamera(68, 1, 0.3, 9000);
  camera.rotation.order = 'YXZ';

  // The sky is a real photographed sky (images/sky-dome.jpg, the top of a CC0 panorama from polyhaven.com),
  // and the matching HDR (images/sky-env-1k.hdr) lights and reflects in everything. The sun is placed where it is in the photo.
  var skyRot = Math.atan2(Math.sin(SKY.sunU * 6.2832), Math.cos(SKY.sunU * 6.2832)) - SKY.rotate; // dome turn that puts the photo sun at SKY.rotate
  var th = SKY.sunV * SKY.cover * Math.PI, ph = SKY.sunU * 6.2832 - skyRot;
  sunDir.set(Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)).normalize();

  // procedural sky as a fallback until the photo arrives (or if it can't load)
  var sky = new Sky(); sky.scale.setScalar(8000);
  var u = sky.material.uniforms;
  u.turbidity.value = 2.2; u.rayleigh.value = 2.6; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  var clouds = cloudDome(); scene.add(clouds);

  var pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), sky2 = new Sky();
  sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
  ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'].forEach(function (k) { sky2.material.uniforms[k].value = u[k].value; });
  envScene.add(sky2);
  scene.environment = pm.fromScene(envScene).texture;

  skyDome = photoSky(skyRot, function () { sky.visible = clouds.visible = false; });
  scene.add(skyDome);
  new RGBELoader().load('images/sky-env-1k.hdr', function (t) {
    t.mapping = THREE.EquirectangularReflectionMapping;
    var old = scene.environment;
    scene.environment = pm.fromEquirectangular(t).texture;
    // three's equirect lookup sits half a turn from the dome's UVs; turn it to line up with the photo sun
    scene.environmentRotation.set(0, skyRot + Math.PI, 0);
    scene.environmentIntensity = SKY.envIntensity;
    t.dispose(); if (old) old.dispose();
  });

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b4a, 0.12));
  sun = new THREE.DirectionalLight(0xfff1dc, SKY.sunIntensity);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(hq ? 4096 : 2048, hq ? 4096 : 2048);
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

  if (hq) { // ambient occlusion: soft contact shadows where boards meet pilings, boats meet docks, walls meet the ground
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    var gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 4, distanceExponent: 1.4, thickness: 4, scale: 1, samples: 12, distanceFallOff: 1 });
    gtao.blendIntensity = 0.85;
    var gRender = gtao.render;
    gtao.render = function () { // keep the water (and its mirror render) and the sky dome out of the AO depth pass
      var sv = skyDome && skyDome.visible;
      water.visible = false; if (sv) skyDome.visible = false;
      gRender.apply(gtao, arguments);
      water.visible = true; if (sv) skyDome.visible = true;
    };
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  }
}

// ---------- the photographed sky ----------
var SKY = {
  cover: 0.52,        // sky-dome.jpg is the top 52% of the full panorama (zenith to just below the horizon)
  sunU: 0.5925,       // where the sun sits in the photo (0..1 across, 0..1 down)
  sunV: 0.587,
  rotate: Math.atan2(0.31, -0.95), // which way the sun should be in the marina: low in the west-southwest, afternoon
  sunIntensity: 2.6,
  envIntensity: 0.9
};
var skyDome, composer;
// The photo is shown exactly as shot. Because the renderer tone-maps everything (ACES), the dome's shader runs the
// tone curve backwards first, so after tone mapping the pixels land back on the photo's own colors; that also gives
// the water reflection real sky brightness to work with.
function photoSky(rot, onReady) {
  var g = new THREE.SphereGeometry(7600, 96, 32, 0, Math.PI * 2, 0, Math.PI * SKY.cover);
  g.scale(-1, 1, 1); // seen from inside without mirroring the picture
  var mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, exposure: { value: renderer.toneMappingExposure } },
    vertexShader: 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform sampler2D map; uniform float exposure; varying vec2 vUv;',
      'const mat3 ACESIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));',
      'const mat3 ACESOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));',
      'vec3 invFit(vec3 c) {', // inverse of three.js RRTAndODTFit: solve (0.983729c-1)v^2 + (0.432951c-0.0245786)v + (0.238081c+0.000090537) = 0
      '  vec3 A = 0.983729 * c - 1.0, B = 0.4329510 * c - 0.0245786, C = 0.238081 * c + 0.000090537;',
      '  return (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);',
      '}',
      'void main() {',
      '  vec3 c = texture2D(map, vUv).rgb;', // linear (texture is tagged sRGB)
      '  vec3 x = clamp(inverse(ACESOut) * c, 0.0, 0.985);',
      '  vec3 col = max(inverse(ACESIn) * invFit(x), 0.0) / (exposure / 0.6);',
      '  gl_FragColor = vec4(col, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n'),
    side: THREE.FrontSide, depthWrite: false, fog: false
  });
  var m = new THREE.Mesh(g, mat);
  m.rotation.y = rot; m.renderOrder = -1; m.frustumCulled = false; m.visible = false;
  texLoader.load('images/sky-dome.jpg', function (t) {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    mat.uniforms.map.value = t; m.visible = true; onReady();
  });
  m.onBeforeRender = function () { mat.uniforms.exposure.value = renderer.toneMappingExposure; };
  return m;
}

// ---------- build from the SVG ----------
function build(svgText) {
  var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  var q = function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); };
  // silvered gray deck boards laid across the docks (one texture = 4.9 ft square), lifted a little: the scan is dark
  var woodMat = pbrMaterial('wood_planks_grey', 4.92, { rot: Math.PI / 2, normal: 1.4, color: new THREE.Color(1.3, 1.27, 1.22) });
  var vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  var boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  var woodParts = [], partsVC = [], boatParts = [], grassParts = [], pavedParts = [], roadParts = [], wallParts = {};
  var grassMat = pbrMaterial('leafy_grass', 6.56, { color: 0xa8c47e });     // lawn (tinted greener: the scan is late-summer brown)
  var pavedMat = pbrMaterial('brushed_concrete', 8.2, { color: new THREE.Color(1.4, 1.38, 1.34) }); // riverwalk
  var roadMat = pbrMaterial('asphalt_02', 9.84);
  var bulkMat = new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0x8d877c });
  var wallMats = {}; Object.keys(FACADES).forEach(function (k) { wallMats[k] = new THREE.MeshStandardMaterial({ map: facadeTexture(FACADES[k]), roughness: 0.85, vertexColors: true }); wallParts[k] = []; });
  var flatRoofMat = new THREE.MeshStandardMaterial({ map: roofTexture('flat'), vertexColors: true, roughness: 0.95 });
  var shingleMat = new THREE.MeshStandardMaterial({ map: roofTexture('shingle'), vertexColors: true, roughness: 0.9 });
  var flatRoofParts = [], shingleParts = [], tintRnd = mulberry32(21);
  function tint() { var l = 0.82 + tintRnd() * 0.18, w = tintRnd() * 0.06; return new THREE.Color(l, l - w * 0.5, l - w).getHexString(); }
  var m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), v3 = new THREE.Vector3();
  var treeSpots = [], allB = [];

  // A building: textured walls, a flat or hip roof, and a parapet / rooftop units on flat roofs
  function building(poly, floors, style, roof, opts) {
    opts = opts || {};
    var f = FACADES[style], base = LAND_H, tc = '#' + (opts.tint || tint());
    if (opts.store && floors > 1) {                       // shop fronts on the ground floor downtown
      wallParts.store.push(paint(walls(poly, base, base + FACADES.store.floorH, FACADES.store.bayW, FACADES.store.floorH), '#' + tint()));
      base += FACADES.store.floorH; floors -= 1;
    }
    var top = base + floors * f.floorH;
    wallParts[style].push(paint(walls(poly, base, top, f.bayW, f.floorH), tc));
    if (opts.hip) {
      var hr = hipRoof(poly, top, opts.hip, opts.k || 0.6);
      shingleParts.push(paint(hr[0], roof), paint(hr[1], roof));
    } else {
      flatRoofParts.push(paint(flat(poly, top), roof));
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
  var town = mulberry32(5), styles = ['brick', 'brick', 'brick2', 'brick3', 'white', 'brick2', 'brick3', 'white'], roofs = ['#5d5f63', '#9e9a92', '#3c3e42', '#8b8f94'];
  var houseCols = ['#ffffff', '#f3e6b8', '#cfe0ea', '#d8e2c8', '#ffffff', '#efe2d2'], shingleCols = ['#4a4d52', '#5a4a40', '#3d4247', '#6b6f73', '#7a3b2e'];
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
        var lot = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1]];
        if (downtown < 0.35 && town() < 0.6) {          // historic clapboard houses with shingled hip roofs
          building(lot, town() < 0.7 ? 2 : 3, 'siding', shingleCols[Math.floor(town() * shingleCols.length)],
            { hip: 8 + town() * 6, k: 0.35 + town() * 0.3, tint: new THREE.Color(houseCols[Math.floor(town() * houseCols.length)]).getHexString(), block: ly1 > -120 });
        } else {
          building(lot, floors, styles[Math.floor(town() * styles.length)], roofs[Math.floor(town() * roofs.length)],
            { units: 1, block: ly1 > -120, store: downtown > 0.3 && front && town() < 0.75 });
        }
        if (town() < 0.6) treeSpots.push({ x: (lx0 + lx1) / 2 + (town() - 0.5) * 20, y: front ? y0 + 8 : y1 - 8, r: 8 + town() * 7 });
        lx0 = lx1 + 4 + town() * 10;
      }
    }
  }
  for (var tt2 = 0; tt2 < 700; tt2++) treeSpots.push({ x: -500 + town() * 3100, y: -1500 + town() * 1560, r: 8 + town() * 9 }); // downtown tree canopy
  roadParts.push(flat([[640, -1520], [725, -1520], [725, 90], [640, 90]], LAND_H + 0.05), flat([[1325, -1520], [1395, -1520], [1395, 90], [1325, 90]], LAND_H + 0.05));
  [[905, -380, 70], [1235, -720, 85], [505, -860, 64], [1585, -330, 60]].forEach(function (c, i) { // church steeples
    var bs = 26, t0 = LAND_H, poly = [[c[0] - bs / 2, c[1] - bs / 2], [c[0] + bs / 2, c[1] - bs / 2], [c[0] + bs / 2, c[1] + bs / 2], [c[0] - bs / 2, c[1] + bs / 2]];
    wallParts[i % 2 ? 'white' : 'brick'].push(paint(walls(poly, t0, t0 + c[2], 10, 11), '#ffffff'));
    var belfry = new THREE.BoxGeometry(bs * S * 0.8, 14, bs * S * 0.8); belfry.translate(wx(c[0]), t0 + c[2] + 7, wz(c[1])); partsVC.push(paint(belfry, '#f4f1ea'));
    var spire = new THREE.ConeGeometry(bs * S * 0.5, 46, 8); spire.translate(wx(c[0]), t0 + c[2] + 14 + 23, wz(c[1])); partsVC.push(paint(spire, i % 2 ? '#f4f1ea' : '#4a4d52'));
    var nave = [[c[0] - 30, c[1] + bs / 2], [c[0] + 30, c[1] + bs / 2], [c[0] + 30, c[1] + 120], [c[0] - 30, c[1] + 120]];
    wallParts[i % 2 ? 'white' : 'brick'].push(paint(walls(nave, t0, t0 + 34, 12, 34 / 2), '#ffffff'));
    var hr = hipRoof(nave, t0 + 34, 16, 0.25); shingleParts.push(paint(hr[0], '#6b6f74'), paint(hr[1], '#6b6f74'));
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
      crowns.setColorAt(i * 2 + k, tc.setHSL(0.26 + trr() * 0.06, 0.45 + trr() * 0.15, 0.08 + trr() * 0.06));
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
    occupied.push(s.poly);
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
  [[grassParts, grassMat], [pavedParts, pavedMat], [roadParts, roadMat], [flatRoofParts, flatRoofMat], [shingleParts, shingleMat]].forEach(function (p) { if (p[0].length) { var mm = merged(p[0], p[1]); mm.castShadow = false; scene.add(mm); } });
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
      // touch: the thumb points where you look (right = look right, up = look up);
      // mouse: grab-and-drag the view, as before
      var touch = e.pointerType === 'touch', sens = touch ? 0.006 : 0.0045, dir = touch ? -1 : 1;
      player.yaw += (e.clientX - look.x) * sens * dir;
      player.pitch = Math.max(-1.35, Math.min(1.1, player.pitch + (e.clientY - look.y) * sens * dir));
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
    this.innerHTML = player.fly ? '&#9660;<span class="dw-lbl"> Land</span>' : '&#9650;<span class="dw-lbl"> Fly up</span>';
    if (player.fly) player.pitch = -0.75;
    else { var spot = findStand(player.x, player.y); if (spot) { player.x = spot[0]; player.y = spot[1]; } player.pitch = -0.05; }
  });
  $('dwFull').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
    else flash('Full screen isn’t available in this browser.');
  });
  var hqb = $('dwHQ');
  hqb.classList.toggle('on', hq);
  hqb.addEventListener('click', function (e) { // switching the post-processing on/off is simplest with a fresh page
    e.stopPropagation();
    try { localStorage.setItem('dwQuality', hq ? 'low' : 'high'); } catch (er) {}
    location.reload();
  });
  var touched = function () { userTouched = true; if (AU.on) audioStart(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { wrap.addEventListener(ev, touched, { passive: true }); });
  addEventListener('keydown', function (e) { if (wrapActive()) touched(); });
  var sb = $('dwSound');
  var paintSound = function () { sb.innerHTML = AU.on ? '&#128266;<span class="dw-lbl"> Sound</span>' : '&#128263;<span class="dw-lbl"> Muted</span>'; sb.classList.toggle('on', AU.on); };
  paintSound();
  sb.addEventListener('click', function (e) {
    e.stopPropagation(); AU.on = !AU.on; userTouched = true;
    try { localStorage.setItem('dwSound', AU.on ? 'on' : 'off'); } catch (er) {}
    if (AU.on) audioStart();
    if (AU.master) AU.master.gain.setTargetAtTime(AU.on ? 0.9 : 0, AU.ctx.currentTime, 0.05);
    paintSound();
  });
  $('dwHelp').innerHTML = touchUI
    ? 'Left thumb: walk &middot; right thumb: look around &middot; tap the mini map to jump'
    : 'W A S D or arrow keys to walk &middot; drag to look &middot; Shift to jog &middot; click the mini map to jump';
}
var lastActive = 0, userTouched = false;
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
  player.fly = false; $('dwFly').classList.remove('on'); $('dwFly').innerHTML = '&#9650;<span class="dw-lbl"> Fly up</span>';
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
// ============ Life: freight train, gulls, mullet and 3D sound ============
var RAIL_A = 97.5, RAIL_M = (382.5 - 97.5) / 1410, RAIL_K = Math.hypot(1, RAIL_M);  // track centreline x = A + M (y - 90)
var TRESTLE_H = 17, C_SOUND = 1125;                                                  // speed of sound, ft/s
function railX(y) { return RAIL_A + RAIL_M * (y - 90); }
function railH(y) { return y < -350 ? LAND_H + 1.4 : y < 90 ? LAND_H + 1.4 + (TRESTLE_H - LAND_H - 1.4) * (y + 350) / 440 : TRESTLE_H; }
var train = null, gulls = [], fishes = [], drops = null, rings = [], occupied = [], lifeT = 0;

function buildLife() {
  var vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  // --- track: ballast embankment on land, then ties and rails all the way across the river ---
  var parts = [], ties = [];
  for (var y = -2600; y < 90; y += 20) {
    var h = railH(y + 10), half = 9;
    var seg = [[railX(y) - half, y], [railX(y) + half, y], [railX(y + 20) + half, y + 20], [railX(y + 20) - half, y + 20]];
    parts.push(paintBy(extrude(seg, LAND_H - 0.5, h - 0.6), '#857d72', '#6f685f'));
  }
  blocked.push([[railX(-2600) - 22, -2600], [railX(-2600) + 22, -2600], [railX(175) + 22, 175], [railX(175) - 22, 175]]);
  for (var y2 = -2600; y2 < 3600; y2 += 40) {
    [-1, 1].forEach(function (sd) {
      var hA = railH(y2), hB = railH(y2 + 40), xa = railX(y2) + sd * 2.95 / S, xb = railX(y2 + 40) + sd * 2.95 / S;
      var len = Math.hypot((xb - xa) * S, 40 * S, hB - hA), g = new THREE.BoxGeometry(0.3, 0.55, len);
      g.rotateX(-Math.atan2(hB - hA, Math.hypot((xb - xa) * S, 40 * S)));
      g.rotateY(Math.atan2((xb - xa) * S, 40 * S));
      g.translate(wx((xa + xb) / 2), (hA + hB) / 2 + 0.28, wz(y2 + 20)); parts.push(paint(g, '#5e5650'));
    });
  }
  scene.add(merged(parts, vc));
  for (var y3 = -2600; y3 < 3600; y3 += 2.6) ties.push(y3);
  var tieM = new THREE.InstancedMesh(new THREE.BoxGeometry(8.5, 0.5, 0.75), new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 1 }), ties.length);
  var m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(RAIL_M, 1), 0)), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  ties.forEach(function (ty, i) { m4.compose(v.set(wx(railX(ty)), railH(ty) - 0.25, wz(ty)), q, one); tieM.setMatrixAt(i, m4); });
  tieM.receiveShadow = true; scene.add(tieM);

  // --- the train: a black six-axle road diesel and up to 15 loaded open-top gravel hoppers ---
  var trainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  var gravelMat = new THREE.MeshStandardMaterial({ roughness: 1, map: speckleTexture('#6f6a63', ['#5a5650', '#8c867c', '#4c4945', '#9a948a', '#625d56', '#7d6f62'], 9000, 2, 2.5) });
  var loco = new THREE.Mesh(locoGeometry(), trainMat); loco.castShadow = true;
  var cols = ['#5b4636', '#6e5a48', '#4d4f52', '#7a4a2f', '#3e3f42'], hopperGeos = cols.map(function (c) { return hopperGeometry(c); });
  var heap = new THREE.ConeGeometry(1, 1, 4, 1); heap.rotateY(Math.PI / 4); heap.scale(17.6 * 1.414, 2.2, 4.75 * 1.414); heap.translate(0, 1.1, 0); // ridged pile of stone
  var fill = new THREE.BoxGeometry(35.6, 0.6, 9.5); fill.translate(0, 0, 0);
  var loadGeo = mergeGeometries([heap.toNonIndexed(), fill.toNonIndexed()], false);
  var cars = [];
  for (var i = 0; i < 15; i++) {
    var g = new THREE.Group(), body = new THREE.Mesh(hopperGeos[i % cols.length], trainMat), load = new THREE.Mesh(loadGeo, gravelMat);
    load.position.y = 11.3; body.castShadow = true; g.add(body, load); g.rotation.order = 'YZX'; g.visible = false; scene.add(g); cars.push(g);
  }
  loco.rotation.order = 'YZX'; loco.visible = false; scene.add(loco);
  train = { loco: loco, cars: cars, n: 12, y: -99999, active: false, next: 9, speed: 44, horns: [], axlesPrev: null };

  // --- gulls circling over the harbour ---
  var gullBody = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.8 }), gullWing = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  for (var k = 0; k < 8; k++) {
    var gg = new THREE.Group(), b = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), gullBody); b.scale.set(0.95, 0.32, 0.3); gg.add(b);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), gullBody); head.position.set(0.85, 0.12, 0); gg.add(head);
    var beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 5), new THREE.MeshStandardMaterial({ color: 0xe8b830 })); beak.rotation.z = -Math.PI / 2; beak.position.set(1.15, 0.1, 0); gg.add(beak);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.35), gullBody); tail.position.set(-0.95, 0.02, 0); gg.add(tail);
    [1, -1].forEach(function (sd) {
      var piv = new THREE.Group(), wg = paint(new THREE.BoxGeometry(0.55, 0.05, 1.3), '#b9bec4'); wg.translate(0, 0, sd * 0.65);
      var tip = paint(new THREE.BoxGeometry(0.42, 0.04, 0.95), '#c4c8cc'); tip.translate(-0.08, 0, sd * 1.75);
      var tipB = paint(new THREE.BoxGeometry(0.36, 0.045, 0.32), '#1e1f22'); tipB.translate(-0.12, 0, sd * 2.1);
      piv.add(new THREE.Mesh(mergeGeometries([strip(wg), strip(tip), strip(tipB)], false), gullWing)); piv.userData.sd = sd; gg.add(piv); gg.userData['w' + sd] = piv;
    });
    var r0 = 60 + Math.random() * 160;
    gg.userData = Object.assign(gg.userData, { cx: player.x + (Math.random() - 0.5) * 400, cy: player.y + (Math.random() - 0.5) * 400, r: r0, a: Math.random() * 6.28,
      w: (18 + Math.random() * 14) / (r0 * S) * (Math.random() < 0.5 ? 1 : -1), alt: 30 + Math.random() * 80, ph: Math.random() * 6, prev: new THREE.Vector3() });
    scene.add(gg); gulls.push(gg);
  }

  // --- mullet, splash rings and droplets ---
  var fishGeo = new THREE.SphereGeometry(1, 12, 8); fishGeo.scale(0.62, 0.15, 0.17);
  var tailGeo = new THREE.ConeGeometry(0.14, 0.3, 4); tailGeo.rotateZ(Math.PI / 2); tailGeo.scale(1, 1, 0.25); tailGeo.translate(-0.7, 0, 0);
  var fishG = mergeGeometries([strip(paintBy(fishGeo, '#4b5560', '#c9d0d6')), strip(paint(tailGeo, '#6b747c'))], false);
  var fishMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.3 });
  for (var f = 0; f < 3; f++) { var fm = new THREE.Mesh(fishG, fishMat); fm.visible = false; fm.rotation.order = 'YZX'; scene.add(fm); fishes.push({ mesh: fm, busy: false }); }
  drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 5, 4), new THREE.MeshBasicMaterial({ color: 0xe6eef2 }), 90);
  drops.userData.list = []; for (var d = 0; d < 90; d++) { drops.userData.list.push({ t: 9, p: new THREE.Vector3(), v: new THREE.Vector3() }); drops.setMatrixAt(d, m4.makeScale(0, 0, 0)); }
  scene.add(drops);
  for (var r = 0; r < 8; r++) {
    var rm = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0xdfe9ee, transparent: true, opacity: 0, depthWrite: false }));
    rm.rotation.x = -Math.PI / 2; rm.visible = false; scene.add(rm); rings.push({ mesh: rm, t: 9 });
  }
}

function box(out, w, h, d, x, y, z, col) { var g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); out.push(strip(paint(g, col))); }
function wheelSet(out, x, gauge, r) {
  [1, -1].forEach(function (sd) { var c = new THREE.CylinderGeometry(r, r, 0.45, 14); c.rotateX(Math.PI / 2); c.translate(x, r, sd * gauge / 2); out.push(strip(paint(c, '#2b2826'))); });
}
function locoGeometry() { // generic six-axle road diesel, ~60 ft, short hood forward (+x)
  var o = [], BLK = '#1c1d1f', DK = '#121314';
  [-19, 19].forEach(function (tx) {
    box(o, 13.5, 2.4, 8.4, tx, 2.6, 0, '#2a2a2b');
    [-4.6, 0, 4.6].forEach(function (ax) { wheelSet(o, tx + ax, 4.7, 1.75); });
    box(o, 1.2, 1.2, 9, tx - 6, 2.2, 0, '#333');
  });
  box(o, 18, 3.4, 8.2, 0, 2.9, 0, DK);                                  // fuel tank
  box(o, 61, 1.3, 10, 0, 4.9, 0, BLK);                                  // frame / walkway
  box(o, 61.2, 0.4, 10.15, 0, 4.5, 0, '#d4ae34');                       // safety-yellow stripe
  box(o, 39, 8.6, 7.2, -10.5, 9.85, 0, BLK);                            // long hood
  box(o, 12, 3.2, 7.3, -22, 10.6, 0, '#2b2c2e');                        // radiator grilles
  [-25, -20.5, -16].forEach(function (fx) { var c = new THREE.CylinderGeometry(1.7, 1.7, 0.5, 16); c.translate(fx, 14.4, 0); o.push(strip(paint(c, '#3a3b3d'))); });
  box(o, 1.6, 1.5, 1.2, -4, 14.8, 0, '#2a2a2a');                        // exhaust stack
  box(o, 10, 10.6, 10, 14, 10.9, 0, BLK);                               // cab
  box(o, 10.6, 0.5, 10.4, 14, 16.4, 0, '#232425');
  box(o, 0.2, 2.6, 7.6, 19.05, 13.4, 0, '#1e2a33');                     // windshield
  [1, -1].forEach(function (sd) { box(o, 6, 2.6, 0.12, 14, 13.4, sd * 5.02, '#1e2a33'); });
  box(o, 9, 7, 7.2, 23.5, 9.1, 0, BLK);                                 // short hood / nose
  box(o, 0.3, 1, 3, 28.1, 11.6, 0, '#e8e4d8');                          // number board
  [1, -1].forEach(function (sd) { box(o, 0.3, 0.6, 0.6, 28.15, 10.5, sd * 1.3, '#fff6d5'); });
  box(o, 2.4, 2.2, 9.6, 30, 2.4, 0, '#2e2f31');                         // pilot / plow
  box(o, 2.4, 2.2, 9.6, -30, 2.4, 0, '#2e2f31');
  [1, -1].forEach(function (sd) {                                       // handrails
    box(o, 59, 0.15, 0.15, 0, 8.4, sd * 4.85, '#d4ae34');
    for (var px = -28; px <= 28; px += 7) box(o, 0.15, 3, 0.15, px, 7, sd * 4.85, '#d4ae34');
  });
  return mergeGeometries(o, false);
}
function hopperGeometry(col) { // ~40 ft open-top hopper for crushed stone
  var o = [], dk = '#2c2b2a';
  [-15, 15].forEach(function (tx) { box(o, 8.5, 2, 7.6, tx, 2.3, 0, '#2a2a2b'); wheelSet(o, tx - 2.8, 4.7, 1.4); wheelSet(o, tx + 2.8, 4.7, 1.4); });
  box(o, 41, 1, 2, 0, 3.9, 0, dk);                                      // centre sill
  [1, -1].forEach(function (sd) {
    box(o, 36, 6.2, 0.3, 0, 8.4, sd * 4.95, col);                       // side sheets
    box(o, 36.4, 0.5, 0.6, 0, 11.6, sd * 5, col);                       // top chord
    for (var px = -17; px <= 17; px += 3.4) box(o, 0.3, 6.6, 0.25, px, 8.3, sd * 5.15, col); // side posts
    box(o, 0.15, 7, 0.15, 19.5, 7, sd * 4.2, '#9a8f80'); box(o, 0.15, 7, 0.15, -19.5, 7, sd * 4.2, '#9a8f80');
  });
  [1, -1].forEach(function (e) { var g = new THREE.BoxGeometry(0.3, 7.5, 9.9); g.rotateZ(e * 0.5); g.translate(e * 18.6, 8.6, 0); o.push(strip(paint(g, col))); }); // sloped end sheets
  [-10.5, 0, 10.5].forEach(function (hx) { var c = new THREE.ConeGeometry(5.2, 3.6, 4); c.rotateY(Math.PI / 4); c.rotateX(Math.PI); c.scale(1, 1, 0.95); c.translate(hx, 5.5, 0); o.push(strip(paint(c, col))); });
  box(o, 1.2, 0.5, 9.6, 20.3, 4.2, 0, dk); box(o, 1.2, 0.5, 9.6, -20.3, 4.2, 0, dk);
  box(o, 1.6, 0.8, 0.8, 21.2, 3.4, 0, '#3b3a38'); box(o, 1.6, 0.8, 0.8, -21.2, 3.4, 0, '#3b3a38'); // couplers
  return mergeGeometries(o, false);
}

// ---------- audio ----------
var AU = { ctx: null, on: true, master: null, noise: null, clicks: [], splash: null, eng: null };
try { AU.on = localStorage.getItem('dwSound') !== 'off'; } catch (e) {}
function audioStart() {
  if (AU.ctx) { if (AU.on && AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  var ctx = AU.ctx = new AC();
  var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
  AU.master = ctx.createGain(); AU.master.gain.value = AU.on ? 0.9 : 0; AU.master.connect(comp);
  var len = ctx.sampleRate * 2, nb = ctx.createBuffer(1, len, ctx.sampleRate), nd = nb.getChannelData(0);
  for (var i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
  AU.noise = nb;
  // wheel-on-rail-joint clicks: a sharp metallic tick over a low thump
  for (var v = 0; v < 4; v++) {
    var cl = ctx.sampleRate * 0.12, cb = ctx.createBuffer(1, cl, ctx.sampleRate), cd = cb.getChannelData(0), last = 0, pitch = 70 + v * 9;
    for (var j = 0; j < cl; j++) { var t = j / ctx.sampleRate, n = Math.random() * 2 - 1, hp = n - last; last = n;
      cd[j] = Math.sin(6.283 * pitch * t) * Math.exp(-t * 38) * 0.9 + hp * Math.exp(-t * 90) * 0.55 + Math.sin(6.283 * (1900 + v * 260) * t) * Math.exp(-t * 70) * 0.12; }
    AU.clicks.push(cb);
  }
  // water lapping against the docks + a little breeze
  var lap = ctx.createBufferSource(); lap.buffer = nb; lap.loop = true;
  var lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 420;
  var lg = ctx.createGain(); lg.gain.value = 0.05;
  var lfo = ctx.createOscillator(); lfo.frequency.value = 0.35; var lfoG = ctx.createGain(); lfoG.gain.value = 0.03; lfo.connect(lfoG); lfoG.connect(lg.gain); lfo.start();
  lap.connect(lf); lf.connect(lg); lg.connect(AU.master); lap.start();
  buildEngineSound();
}
function panner(ref, roll) {
  var p = AU.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
  p.refDistance = ref || 25; p.rolloffFactor = roll || 1.1; p.maxDistance = 20000; p.connect(AU.master);
  return p;
}
function setPos(p, x, y, z) {
  if (p.positionX) { var t = AU.ctx.currentTime; p.positionX.setTargetAtTime(x, t, 0.03); p.positionY.setTargetAtTime(y, t, 0.03); p.positionZ.setTargetAtTime(z, t, 0.03); }
  else p.setPosition(x, y, z);
}
function buildEngineSound() { // diesel prime mover, turbo, rolling rumble and horn, all through 3D panners
  var ctx = AU.ctx, e = AU.eng = {};
  e.pan = panner(45, 1.0); e.wheelPan = panner(35, 1.05); e.clickPan = panner(30, 1.1);
  e.air = ctx.createBiquadFilter(); e.air.type = 'lowpass'; e.air.frequency.value = 1200; e.air.connect(e.pan);  // distance muffles the highs
  e.gain = ctx.createGain(); e.gain.gain.value = 0; e.gain.connect(e.air);
  e.chug = ctx.createGain(); e.chug.gain.value = 0.55; e.chug.connect(e.gain);
  var lfo = ctx.createOscillator(); lfo.frequency.value = 7.5; var lfoG = ctx.createGain(); lfoG.gain.value = 0.3; lfo.connect(lfoG); lfoG.connect(e.chug.gain); lfo.start();
  e.oscs = [];
  [[46, 'sawtooth', 0.5], [92.5, 'square', 0.12], [138, 'sawtooth', 0.1], [23, 'sine', 0.55]].forEach(function (s) {
    var o = ctx.createOscillator(); o.type = s[1]; o.frequency.value = s[0]; var g = ctx.createGain(); g.gain.value = s[2];
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; o.connect(lp); lp.connect(g); g.connect(e.chug); o.start(); e.oscs.push({ o: o, f: s[0] });
  });
  var rum = ctx.createBufferSource(); rum.buffer = AU.noise; rum.loop = true;
  var rb = ctx.createBiquadFilter(); rb.type = 'bandpass'; rb.frequency.value = 110; rb.Q.value = 0.8; var rg = ctx.createGain(); rg.gain.value = 0.9;
  rum.connect(rb); rb.connect(rg); rg.connect(e.chug); rum.start();
  var tur = ctx.createOscillator(); tur.frequency.value = 2150; var tg = ctx.createGain(); tg.gain.value = 0.012; tur.connect(tg); tg.connect(e.gain); tur.start(); e.oscs.push({ o: tur, f: 2150 });
  // steel wheels rolling: low roar plus a hollow boom while on the trestle
  e.wheelGain = ctx.createGain(); e.wheelGain.gain.value = 0; e.wheelGain.connect(e.wheelPan);
  var wn = ctx.createBufferSource(); wn.buffer = AU.noise; wn.loop = true; wn.playbackRate.value = 0.7;
  var wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 340;
  e.boom = ctx.createBiquadFilter(); e.boom.type = 'peaking'; e.boom.frequency.value = 160; e.boom.Q.value = 1.2; e.boom.gain.value = 0;
  wn.connect(wl); wl.connect(e.boom); e.boom.connect(e.wheelGain); wn.start();
  var sq = ctx.createBufferSource(); sq.buffer = AU.noise; sq.loop = true; var sb = ctx.createBiquadFilter(); sb.type = 'bandpass'; sb.frequency.value = 3800; sb.Q.value = 9;
  var sg = ctx.createGain(); sg.gain.value = 0.05; sq.connect(sb); sb.connect(sg); sg.connect(e.wheelGain); sq.start();
  e.clickGain = ctx.createGain(); e.clickGain.gain.value = 1.4; e.clickGain.connect(e.clickPan);
  // horn: five-chime air horn, bent slightly by the Doppler factor
  e.hornGain = ctx.createGain(); e.hornGain.gain.value = 0;
  var hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 3200; e.hornGain.connect(hlp); hlp.connect(e.air);
  e.horn = [311.1, 370, 415.3, 493.9, 622.3].map(function (f) {
    var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; var g = ctx.createGain(); g.gain.value = 0.11; o.connect(g); g.connect(e.hornGain); o.start(); return { o: o, f: f };
  });
}
function hornPattern() { // grade-crossing signal: long, long, short, long
  if (!AU.ctx || !AU.eng) return;
  var g = AU.eng.hornGain.gain, t = AU.ctx.currentTime + 0.05, seq = [1.5, 1.5, 0.6, 2.6];
  g.cancelScheduledValues(t); g.setValueAtTime(0, t);
  seq.forEach(function (d) { g.setTargetAtTime(1, t, 0.03); g.setTargetAtTime(0, t + d, 0.06); t += d + 0.45; });
}
function playClick(x, y, z, vol) {
  var e = AU.eng, s = AU.ctx.createBufferSource(); s.buffer = AU.clicks[Math.floor(Math.random() * AU.clicks.length)];
  s.playbackRate.value = 0.9 + Math.random() * 0.2;
  var g = AU.ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(e.clickGain);
  setPos(e.clickPan, x, y, z); s.start();
}
function oneShot(x, y, z, build, ref) { // a short positioned sound; build(ctx, dest, t0) wires up its own nodes
  if (!AU.ctx || AU.ctx.state !== 'running') return;
  var p = panner(ref || 20, 1.15);
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  var end = build(AU.ctx, p, AU.ctx.currentTime + 0.02);
  setTimeout(function () { try { p.disconnect(); } catch (e) {} }, (end + 0.5) * 1000);
}
function gullCall(x, y, z) { // herring-gull style: a long "kee-ow" or a laughing "ha-ha-ha" run
  oneShot(x, y, z, function (ctx, dest, t0) {
    var laugh = Math.random() < 0.45, notes = laugh ? 4 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 2), t = t0, base = 0.85 + Math.random() * 0.35;
    for (var i = 0; i < notes; i++) {
      var dur = laugh ? 0.11 + Math.random() * 0.04 : 0.38 + Math.random() * 0.2;
      var o = ctx.createOscillator(); o.type = 'sawtooth';
      var f0 = (laugh ? 1550 - i * 40 : 1250) * base, fp = (laugh ? 1850 - i * 45 : 2050) * base, f1 = (laugh ? 1250 : 1000) * base;
      o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(fp, t + dur * 0.18); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      var vib = ctx.createOscillator(); vib.frequency.value = 26 + Math.random() * 10; var vg = ctx.createGain(); vg.gain.value = 40; vib.connect(vg); vg.connect(o.frequency);
      var b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = 1900 * base; b1.Q.value = 2.2;
      var b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = 3300 * base; b2.Q.value = 3;
      var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.02); g.gain.setValueAtTime(0.42, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(b1); o.connect(b2); b1.connect(g); b2.connect(g); g.connect(dest);
      o.start(t); vib.start(t); o.stop(t + dur + 0.02); vib.stop(t + dur + 0.02);
      t += dur + (laugh ? 0.06 + Math.random() * 0.05 : 0.18 + Math.random() * 0.2);
    }
    return t - t0;
  }, 30);
}
function splashSound(x, y, z, big) {
  oneShot(x, y, z, function (ctx, dest, t0) {
    var s = ctx.createBufferSource(); s.buffer = AU.noise; s.playbackRate.value = 1.3;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = big ? 1100 : 1800; bp.Q.value = 0.7;
    var g = ctx.createGain(), L = big ? 0.32 : 0.16; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(big ? 0.9 : 0.45, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t0 + L);
    s.connect(bp); bp.connect(g); g.connect(dest); s.start(t0, Math.random()); s.stop(t0 + L + 0.05);
    var o = ctx.createOscillator(); o.frequency.setValueAtTime(big ? 520 : 760, t0); o.frequency.exponentialRampToValueAtTime(110, t0 + 0.07);
    var og = ctx.createGain(); og.gain.setValueAtTime(big ? 0.5 : 0.25, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    o.connect(og); og.connect(dest); o.start(t0); o.stop(t0 + 0.1);
    return L;
  }, 12);
}
function listener() {
  if (!AU.ctx) return;
  var L = AU.ctx.listener, p = camera.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), t = AU.ctx.currentTime;
  if (L.positionX) {
    L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
    L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
}

// ---------- per-frame life ----------
var gullTimer = 2, fishTimer = 4;
function life(dt) {
  lifeT += dt;
  listener();
  var cam = camera.position, au = AU.ctx && AU.ctx.state === 'running';
  // ---- train ----
  if (train) {
    var T = train;
    if (!T.active && lifeT > T.next) {
      T.active = true; T.n = 10 + Math.floor(Math.random() * 6); T.y = T.first === undefined ? -1500 : -2600; T.first = false; T.horns = [-1250, -560, -170]; T.axlesPrev = null;
      T.cars.forEach(function (c, i) { c.visible = i < T.n; }); T.loco.visible = true;
    }
    if (T.active) {
      var dy = T.speed / RAIL_K * dt; T.y += dy;
      var place = function (obj, yc, half) {
        var yf = yc + half / RAIL_K / S, yb = yc - half / RAIL_K / S, hf = railH(yf), hb = railH(yb);
        obj.position.set(wx(railX(yc)), (hf + hb) / 2 + 0.55, wz(yc));
        obj.rotation.set(0, Math.atan2(-1, RAIL_M), Math.atan2(hf - hb, half * 2));
      };
      var locoLen = 61, carLen = 43, yL = T.y - locoLen / 2 / S / RAIL_K;
      place(T.loco, yL, 19);
      var axles = [-23.6, -19, -14.4, 14.4, 19, 23.6].map(function (a) { return yL + a / S / RAIL_K; });
      var tailY = yL;
      for (var i = 0; i < T.n; i++) {
        var yc = T.y - (locoLen + 1 + carLen / 2 + i * (carLen + 1)) / S / RAIL_K;
        place(T.cars[i], yc, 15); tailY = yc - carLen / 2 / S / RAIL_K;
        [-17.8, -12.2, 12.2, 17.8].forEach(function (a) { axles.push(yc + a / S / RAIL_K); });
      }
      if (T.horns.length && T.y > T.horns[0]) { T.horns.shift(); hornPattern(); }
      if (tailY > 3700) { T.active = false; T.loco.visible = false; T.cars.forEach(function (c) { c.visible = false; }); T.next = lifeT + 70 + Math.random() * 90; }
      if (au && AU.eng) {
        var e = AU.eng, lx = T.loco.position.x, ly = T.loco.position.y + 12, lz = T.loco.position.z;
        var d = Math.hypot(lx - cam.x, ly - cam.y, lz - cam.z);
        setPos(e.pan, lx, ly, lz);
        e.gain.gain.setTargetAtTime(1.1, AU.ctx.currentTime, 0.4);
        e.air.frequency.setTargetAtTime(Math.max(250, 6000 * 60 / (60 + d)), AU.ctx.currentTime, 0.2);
        // Doppler: pitch up while approaching, down after it passes
        var vel = T.speed, dirx = RAIL_M / RAIL_K * vel, dirz = 1 / RAIL_K * vel;
        var vr = ((lx - cam.x) * dirx + (lz - cam.z) * dirz) / Math.max(1, d), dop = C_SOUND / (C_SOUND + vr);
        e.oscs.forEach(function (o) { o.o.frequency.setTargetAtTime(o.f * dop, AU.ctx.currentTime, 0.1); });
        e.horn.forEach(function (o) { o.o.frequency.setTargetAtTime(o.f * dop, AU.ctx.currentTime, 0.1); });
        // where the train is closest to you: wheel roar and rail-joint clicks come from there
        var pw = cam.x / S + CX, pz = cam.z / S + CY;
        var yProj = (pz + RAIL_M * (pw - RAIL_A + RAIL_M * 90)) / (1 + RAIL_M * RAIL_M);
        var yNear = Math.max(tailY, Math.min(T.y, yProj)), hN = railH(yNear);
        setPos(e.wheelPan, wx(railX(yNear)), hN + 2, wz(yNear));
        e.wheelGain.gain.setTargetAtTime(0.9, AU.ctx.currentTime, 0.3);
        e.boom.gain.setTargetAtTime(yNear > 170 ? 9 : 0, AU.ctx.currentTime, 0.3);
        if (T.axlesPrev && T.axlesPrev.length === axles.length) {
          var jx = wx(railX(yProj)), jh = railH(yProj) + 1, jz = wz(yProj), nClicks = 0;
          for (var k = 0; k < axles.length && nClicks < 6; k++) if (T.axlesPrev[k] < yProj && axles[k] >= yProj) { playClick(jx, jh, jz, 0.7 + Math.random() * 0.3); nClicks++; }
        }
      }
      T.axlesPrev = axles;
    } else if (au && AU.eng) { AU.eng.gain.gain.setTargetAtTime(0, AU.ctx.currentTime, 0.5); AU.eng.wheelGain.gain.setTargetAtTime(0, AU.ctx.currentTime, 0.5); }
  }
  // ---- gulls ----
  gulls.forEach(function (g, i) {
    var u = g.userData, far = Math.hypot((u.cx - player.x) * S, (u.cy - player.y) * S);
    if (far > 450) { u.cx += (player.x - u.cx) * dt * 0.05; u.cy += (player.y - u.cy) * dt * 0.05; }
    u.a += u.w * dt; u.ph += dt;
    var alt = u.alt + Math.sin(u.ph * 0.3 + i) * 10, gx = u.cx + Math.cos(u.a) * u.r, gy = u.cy + Math.sin(u.a) * u.r;
    var pos = new THREE.Vector3(wx(gx), alt, wz(gy)), vel = pos.clone().sub(u.prev);
    g.position.copy(pos);
    if (vel.lengthSq() > 1e-6) { g.rotation.order = 'YXZ'; g.rotation.y = Math.atan2(-vel.z, vel.x); g.rotation.x = (u.w > 0 ? -1 : 1) * 0.35; }
    u.prev.copy(pos);
    var flap = Math.sin(u.ph * 1.3 + i) > -0.2 ? Math.sin(u.ph * 9) * 0.55 : 0.08;                 // flap, then glide
    g.userData.w1.rotation.x = -flap; g.userData['w-1'].rotation.x = flap;
  });
  gullTimer -= dt;
  if (gullTimer <= 0) {
    gullTimer = 1.5 + Math.random() * 5.5;
    var gg = gulls[Math.floor(Math.random() * gulls.length)];
    if (gg && au) gullCall(gg.position.x, gg.position.y, gg.position.z);
  }
  // ---- mullet ----
  fishTimer -= dt;
  if (fishTimer <= 0) { fishTimer = 2.5 + Math.random() * 6.5; spawnMullet(); }
  fishes.forEach(function (f) {
    if (!f.busy) return;
    f.t += dt;
    var J = f.jumps[f.k];
    if (!J) { f.busy = false; f.mesh.visible = false; return; }
    var tt = (f.t - J.t0) / J.dur;
    if (tt < 0) { f.mesh.visible = false; return; }
    if (!J.out) { J.out = true; splash(J.x0, J.z0, false); }
    if (tt >= 1) { splash(J.x1, J.z1, true); f.k++; f.mesh.visible = false; return; }
    var x = J.x0 + (J.x1 - J.x0) * tt, z = J.z0 + (J.z1 - J.z0) * tt, h = 4 * J.h * tt * (1 - tt) - 0.1;
    f.mesh.visible = true; f.mesh.position.set(x, h, z);
    f.mesh.rotation.set(0, J.yaw, Math.atan(4 * J.h * (1 - 2 * tt) / (Math.hypot(J.x1 - J.x0, J.z1 - J.z0) || 1)) + Math.sin(f.t * 30) * 0.08);
  });
  // ---- splash rings and droplets ----
  rings.forEach(function (r) {
    if (r.t > 1.6) { r.mesh.visible = false; return; }
    r.t += dt; var s = r.size * (0.3 + r.t * 1.6);
    r.mesh.scale.set(s, s, s); r.mesh.material.opacity = Math.max(0, 0.7 * (1 - r.t / 1.6));
  });
  if (drops) {
    var m4 = new THREE.Matrix4(), any = false;
    drops.userData.list.forEach(function (d, i) {
      if (d.t > 1) return;
      d.t += dt; d.v.y -= 32 * dt; d.p.addScaledVector(d.v, dt); any = true;
      drops.setMatrixAt(i, d.p.y < 0 || d.t > 1 ? m4.makeScale(0, 0, 0) : m4.makeTranslation(d.p.x, d.p.y, d.p.z));
      if (d.p.y < 0) d.t = 9;
    });
    if (any) drops.instanceMatrix.needsUpdate = true;
  }
}
function spawnMullet() {
  var f = fishes.find(function (q) { return !q.busy; }); if (!f) return;
  for (var tries = 0; tries < 25; tries++) {
    var a = Math.random() * 6.283, dist = (25 + Math.random() * 230) / S, x = player.x + Math.cos(a) * dist, y = player.y + Math.sin(a) * dist;
    if (surface(x, y) !== null || inPoly(x, y, land)) continue;
    if (walk.some(function (p) { return polyDist(x, y, p) < 4; })) continue;
    if (occupied.some(function (p) { return polyDist(x, y, p) < 3; })) continue;
    var yaw = Math.random() * 6.283, n = Math.random() < 0.45 ? 1 : (Math.random() < 0.6 ? 2 : 3), t0 = 0, X = wx(x), Z = wz(y), jumps = [];
    for (var j = 0; j < n; j++) {
      var len = 2.5 + Math.random() * 2, dur = 0.42 + Math.random() * 0.2, X1 = X + Math.cos(yaw) * len, Z1 = Z - Math.sin(yaw) * len;
      jumps.push({ t0: t0, dur: dur, x0: X, z0: Z, x1: X1, z1: Z1, h: 1.2 + Math.random() * 1.6, yaw: yaw });
      t0 += dur + 0.35 + Math.random() * 0.5; X = X1 + Math.cos(yaw) * 1.5; Z = Z1 - Math.sin(yaw) * 1.5;
    }
    f.busy = true; f.t = 0; f.k = 0; f.jumps = jumps;
    return;
  }
}
function splash(x, z, big) {
  var r = rings.find(function (q) { return q.t > 1.6; }) || rings[0];
  r.t = 0; r.size = big ? 1.6 : 1; r.mesh.position.set(x, 0.15, z); r.mesh.visible = true;
  var n = big ? 14 : 7;
  drops.userData.list.filter(function (d) { return d.t > 1; }).slice(0, n).forEach(function (d) {
    d.t = 0; d.p.set(x, 0.1, z); var a = Math.random() * 6.283, s = 2 + Math.random() * 4; d.v.set(Math.cos(a) * s, 6 + Math.random() * (big ? 9 : 5), Math.sin(a) * s);
  });
  splashSound(x, 0.5, z, big);
}

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
  if (skyDome) skyDome.position.set(camera.position.x, 0, camera.position.z); // the sky stays at infinity as you walk
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
  life(dt);
}
function resize() {
  var w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}
function loop() {
  requestAnimationFrame(loop);
  var r = wrap.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || document.hidden) { clock.getDelta(); if (AU.ctx && AU.ctx.state === 'running') AU.ctx.suspend(); return; }
  if (AU.ctx && AU.on && AU.ctx.state === 'suspended' && userTouched) AU.ctx.resume();
  update(Math.min(clock.getDelta(), 0.1));
  if (composer) composer.render(); else renderer.render(scene, camera);
}

function start() {
  try { setup(); } catch (err) {
    $('dwWhere').textContent = 'Your browser can’t show 3D graphics (WebGL is off or unsupported).';
    return;
  }
  fetch('images/marina-slip-map.svg').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (txt) {
    build(txt);
    buildLife();
    bindInput();
    resize(); addEventListener('resize', resize); document.addEventListener('fullscreenchange', resize);
    // start on the riverwalk at the head of C Dock, looking down the dock
    var c = gangways.reduce(function (b, g) { return !b || Math.abs(g.x - 890) < Math.abs(b.x - 890) ? g : b; }, null);
    player.x = c ? c.x : 890; player.y = c ? c.ys - 12 : 490; player.yaw = Math.PI; player.h = LAND_H + EYE;
    var want = new URLSearchParams(location.search).get('slip');
    if (want) goToSlip(want);
    $('dwWhere').textContent = '';
    loop();
    window.dockWalk = { train: function () { return train; }, AU: AU, gulls: gulls, fishes: fishes, spawnMullet: spawnMullet, player: player, goToSlip: goToSlip, surface: surface, slips: slips, renderer: renderer, scene: scene, camera: camera, update: update };
  }).catch(function () { $('dwWhere').textContent = 'Couldn’t load the marina map. Please refresh to try again.'; });
}
start();
