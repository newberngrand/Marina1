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
      x.fillStyle = 'hsl(30,' + (34 + rnd() * 10) + '%,' + l + '%)';
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
  for (var k = 0; k < 14; k++) waves.push([Math.round((rnd() * 2 - 1) * 9), Math.round((rnd() * 2 - 1) * 9), 0.6 + rnd(), rnd() * 6.283]);
  for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
    var gx = 0, gy = 0;
    waves.forEach(function (w) { var ph = 6.283 * (w[0] * i + w[1] * j) / N + w[3], c2 = Math.cos(ph) * w[2] / (1 + Math.hypot(w[0], w[1]) * 0.15); gx += c2 * w[0]; gy += c2 * w[1]; });
    var nx = -gx * 0.05, ny = -gy * 0.05, nz = 1, l = Math.hypot(nx, ny, nz), o = (j * N + i) * 4;
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

// ---------- scene ----------
var renderer, scene, camera, water, sun, sunDir = new THREE.Vector3();
var walk = [], blocked = [], gangways = [], slips = [], slipByKey = {}, labels = [], marker;
var shore = [], land = [];
var player = { x: 0, y: 0, h: LAND_H, yaw: Math.PI, pitch: -0.05, fly: false, flyT: 0 };

function setup() {
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowPower ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc8dbe4, 900, 4200);
  camera = new THREE.PerspectiveCamera(68, 1, 0.3, 9000);
  camera.rotation.order = 'YXZ';

  var sky = new Sky(); sky.scale.setScalar(8000);
  var u = sky.material.uniforms;
  u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(205));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  var pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), sky2 = new Sky();
  sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
  ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'].forEach(function (k) { sky2.material.uniforms[k].value = u[k].value; });
  envScene.add(sky2);
  scene.environment = pm.fromScene(envScene).texture;

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6b4a, 0.55));
  sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  var sc = sun.shadow.camera; sc.left = sc.bottom = -170; sc.right = sc.top = 170; sc.near = 10; sc.far = 900;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  water = new Water(new THREE.PlaneGeometry(12000, 12000), {
    textureWidth: lowPower ? 512 : 1024, textureHeight: lowPower ? 512 : 1024,
    waterNormals: waterNormals(), sunDirection: sunDir.clone(), sunColor: 0xfff4e0,
    waterColor: 0x2a4c52, distortionScale: 2.2, fog: true
  });
  water.material.uniforms.size.value = 1.4;
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
}

// ---------- build from the SVG ----------
function build(svgText) {
  var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  var q = function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); };
  var plank = plankTexture();
  var woodMat = new THREE.MeshStandardMaterial({ map: plank, roughness: 0.85, color: 0xffffff });
  var vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  var boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  var woodParts = [], partsVC = [], boatParts = [];

  // Shoreline and land (stretched beyond the map edges so the world doesn't end in a cliff)
  shore = pts(q('polyline')[0].getAttribute('points'));
  var ext = [[-2600, shore[0][1] - 40]].concat(shore, [[4600, shore[shore.length - 1][1] - 30]]);
  land = ext.concat([[4600, -2600], [-2600, -2600]]);
  partsVC.push(paintBy(extrude(land, -3, LAND_H), '#e9dfc8', '#7d7466'));
  // riverwalk paving strip along the bulkhead
  for (var i = 0; i < ext.length - 1; i++) {
    var a = ext[i], b = ext[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = dy / l * 26, ny = -dx / l * 26;
    partsVC.push(paint(flat([[a[0], a[1]], [b[0], b[1]], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], LAND_H + 0.04), '#d6ccb9'));
  }
  q('polygon').forEach(function (p) {
    var f = p.getAttribute('fill'), poly = pts(p.getAttribute('points'));
    if (f === '#cfe0b0') partsVC.push(paint(flat(poly, LAND_H + 0.02), '#a9c486'));
    else if (f === '#cfcac2') partsVC.push(paint(flat(poly, LAND_H + 0.06), '#9d978e'));
    else if (f === 'url(#roof)' || f === 'url(#roof2)') {
      var h = f === 'url(#roof)' ? 46 : 34;
      partsVC.push(paintBy(extrude(poly, LAND_H, LAND_H + h), f === 'url(#roof)' ? '#9a4a37' : '#4d5d77', f === 'url(#roof)' ? '#e7dcc8' : '#d9d4ca'));
      blocked.push(poly);
      var c = centroid(poly), sp = labelSprite(f === 'url(#roof)' ? 'HOTEL' : 'THE INN', '#0e2a4a', '#e8b648', 40);
      sp.position.set(wx(c[0]), LAND_H + h + 12, wz(c[1])); scene.add(sp);
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

  // Trees
  var trees = q('circle').filter(function (c) { return c.getAttribute('fill') === '#5f8f4e'; });
  var trunkG = new THREE.CylinderGeometry(0.6, 0.9, 1, 7), crownG = new THREE.IcosahedronGeometry(1, 1);
  var trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x6a4d33, roughness: 1 }), trees.length);
  var crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0x4f7d3e, roughness: 0.95, flatShading: true }), trees.length);
  var m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), v3 = new THREE.Vector3();
  trees.forEach(function (c, i) {
    var x = wx(+c.getAttribute('cx')), z = wz(+c.getAttribute('cy')), r = +c.getAttribute('r') * S * 1.1;
    m4.compose(v3.set(x, LAND_H + r * 0.9, z), qn.identity(), new THREE.Vector3(1, r * 1.8, 1)); trunks.setMatrixAt(i, m4);
    m4.compose(v3.set(x, LAND_H + r * 2.1, z), qn.setFromEuler(new THREE.Euler(0, i, 0)), new THREE.Vector3(r, r * 0.9, r)); crowns.setMatrixAt(i, m4);
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

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
    partsVC.push(paint(bx, '#8c8f93'));
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
      for (var t = 0; t <= l; t += 45) pil.push([a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l, 3.2]);
    }
  });
  slips.forEach(function (s) { (s.fingers || []).forEach(function (f) { pil.push([f[0], f[1], 2.4]); }); });
  var pilG = new THREE.CylinderGeometry(0.55, 0.6, 1, 8);
  var pilings = new THREE.InstancedMesh(pilG, new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.95 }), pil.length);
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

  // Boats (decorative): about 60% of slips, the same every visit
  var rnd = mulberry32(20261120), hulls = ['#ffffff', '#ffffff', '#ffffff', '#f4f1ea', '#1d3557', '#2d5a3d', '#8e2b2b', '#e9e4d4'];
  slips.forEach(function (s) {
    if (rnd() > 0.6) return;
    var p = s.poly, e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1]], e2 = [p[2][0] - p[1][0], p[2][1] - p[1][1]];
    var L1 = Math.hypot(e1[0], e1[1]), L2 = Math.hypot(e2[0], e2[1]);
    var u = L1 > L2 ? e1 : e2, Lu = Math.max(L1, L2), Lv = Math.min(L1, L2);
    var ux = u[0] / Lu, uy = u[1] / Lu;
    var toDock = (s.edge[0] - s.c[0]) * ux + (s.edge[1] - s.c[1]) * uy;
    if (toDock < 0) { ux = -ux; uy = -uy; }          // bow points toward the dock...
    if (rnd() < 0.35) { ux = -ux; uy = -uy; }        // ...unless backed in
    var len = Lu * S * (0.72 + rnd() * 0.16), beam = Math.min(Lv * S * 0.72, len * 0.36);
    var sail = rnd() < 0.3;
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
  if (sail) {
    var cab = new THREE.BoxGeometry(len * 0.32, 1.6, beam * 0.55); cab.translate(-len * 0.06, deckY + 0.8, 0); out.push(paint(cab, '#f4f1ea'));
    var win = new THREE.BoxGeometry(len * 0.26, 0.4, beam * 0.57); win.translate(-len * 0.06, deckY + 1.1, 0); out.push(paint(win, '#24313d'));
    var mh = len * 1.25, mast = new THREE.CylinderGeometry(0.16, 0.2, mh, 6); mast.translate(len * 0.1, deckY + mh / 2, 0); out.push(paint(mast, '#c9ccd0'));
    var boom = new THREE.CylinderGeometry(0.13, 0.13, len * 0.4, 6); boom.rotateZ(Math.PI / 2); boom.translate(len * 0.1 - len * 0.2, deckY + 3.2, 0); out.push(paint(boom, '#c9ccd0'));
    var cover = new THREE.CylinderGeometry(0.45, 0.45, len * 0.38, 8); cover.rotateZ(Math.PI / 2); cover.translate(len * 0.1 - len * 0.2, deckY + 3.6, 0); out.push(paint(cover, rnd() < 0.5 ? '#1d4f7a' : '#7a2a2a'));
  } else {
    var ch = 2.2 + len * 0.03, cl = len * (0.36 + rnd() * 0.12);
    var c1 = new THREE.BoxGeometry(cl, ch, beam * 0.74); c1.translate(-len * 0.08, deckY + ch / 2, 0); out.push(paint(c1, '#f7f5ef'));
    var c2 = new THREE.BoxGeometry(cl * 0.92, ch * 0.42, beam * 0.76); c2.translate(-len * 0.08, deckY + ch * 0.68, 0); out.push(paint(c2, '#23303b'));
    if (len > 34) { var fly = new THREE.BoxGeometry(cl * 0.55, ch * 0.7, beam * 0.62); fly.translate(-len * 0.12, deckY + ch + ch * 0.35, 0); out.push(paint(fly, '#f7f5ef'));
      var bim = new THREE.BoxGeometry(cl * 0.62, 0.3, beam * 0.66); bim.translate(-len * 0.12, deckY + ch * 2.3, 0); out.push(paint(bim, '#2b3e57')); }
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
    window.dockWalk = { player: player, goToSlip: goToSlip, surface: surface, slips: slips, renderer: renderer };
  }).catch(function () { $('dwWhere').textContent = 'Couldn’t load the marina map. Please refresh to try again.'; });
}
start();
