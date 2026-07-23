import * as THREE from './three.module.js';
import { C, box, cyl } from './engine.js';
import { WORLD, groundHeight } from './world.js';

var ROBES = [0x6b7f8a, 0x8a6f55, 0x4a5d7e, 0xcfc4a8, 0x5d6b5a, 0x9a6b4f, 0x7e6a8a, 0xa8845c];
var DRESSES = [0xd8b4b8, 0xa8c4c0, 0xe0d0a0, 0xb8a8c8];

export function makePerson(opt, skinColor) {
  var robe = opt.robe || 0x6b7f8a, hat = opt.hat || 'futou', female = opt.female, scale = opt.scale || 1;
  var g = new THREE.Group();
  var robeMat = new THREE.MeshLambertMaterial({ color: robe });
  var skirt = cyl(0.21, 0.34, 1.08, robeMat, 10); skirt.position.y = 0.56; g.add(skirt);
  var torso = cyl(0.24, 0.21, 0.5, robeMat, 10); torso.position.y = 1.34; g.add(torso);
  var belt = cyl(0.235, 0.235, 0.09, new THREE.MeshLambertMaterial({ color: 0x3a3028 }), 10); belt.position.y = 1.1; g.add(belt);
  var armL = new THREE.Group(), armR = new THREE.Group();
  for (var ai = 0; ai < 2; ai++) { var arm = ai === 0 ? armL : armR; var ss = ai === 0 ? -1 : 1; var a = box(0.1, 0.52, 0.12, robeMat); a.position.y = -0.24; arm.add(a); arm.position.set(ss * 0.3, 1.5, 0); g.add(arm); }
  var headMat = new THREE.MeshLambertMaterial({ color: skinColor });
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 10), headMat); head.position.y = 1.78; head.castShadow = true; g.add(head);
  var black = new THREE.MeshLambertMaterial({ color: 0x1e1c1a });
  if (hat === 'futou') { var cap = cyl(0.17, 0.18, 0.14, black, 10); cap.position.y = 1.92; g.add(cap); for (var ss = -1; ss <= 1; ss += 2) { var wing = box(0.22, 0.03, 0.05, black); wing.position.set(ss * 0.24, 1.94, 0); g.add(wing); } }
  else if (hat === 'douli') { var cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.18, 12), new THREE.MeshLambertMaterial({ color: 0xb09a5e })); cone.position.y = 1.95; cone.castShadow = true; g.add(cone); }
  else if (hat === 'bun') { var bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), black); bun.position.y = 1.95; g.add(bun); var hair = cyl(0.168, 0.17, 0.1, black, 10); hair.position.y = 1.88; g.add(hair); }
  else if (hat === 'scarf') { var sc = cyl(0.175, 0.18, 0.12, new THREE.MeshLambertMaterial({ color: 0x5a6a72 }), 10); sc.position.y = 1.9; g.add(sc); }
  if (female) { skirt.material = new THREE.MeshLambertMaterial({ color: robe }); torso.material = new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }); }
  g.scale.setScalar(scale);
  g.userData = { armL: armL, armR: armR, skirt: skirt, phase: Math.random() * 6.28 };
  return g;
}
var REGIONS = {
  street: { x1: -175, x2: 175, z1: 2.5, z2: 12 },
  market: { x1: -30, x2: 70, z1: 24, z2: 44 },
  north: { x1: -150, x2: 150, z1: -80, z2: -68 },
  riverside: { x1: -170, x2: 170, z1: -16, z2: -13 },
};

export function parseRow(row) {
  return {
    id: row.id, name: row.name, role: row.role || '', user_id: row.user_id || '',
    hat: row.hat || 'futou', female: !!row.female,
    persona: row.persona || '', region: row.region || 'street',
    fixed: !!row.fixed, loc: row.loc || '',
    portrait: typeof row.portrait === 'string' ? JSON.parse(row.portrait) : (row.portrait || {}),
  };
}
export function spawnNPC(scene, M, npcs, row, opts) {
  opts = opts || {};
  var d = parseRow(row);
  var robe = d.female ? DRESSES[Math.random() * DRESSES.length | 0] : ROBES[Math.random() * ROBES.length | 0];
  var scale = d.role === '孩童' ? 0.62 : 0.92 + Math.random() * 0.14;
  var g = makePerson({ robe: robe, hat: d.hat, female: d.female, scale: scale }, C.skin);
  var r = REGIONS[d.region];
  var x, z;
  if (d.loc) { var p = d.loc.split(',').map(Number); x = p[0]; z = p[1]; }
  else {
    x = opts.x != null ? opts.x : (r.x1 + Math.random() * (r.x2 - r.x1));
    z = opts.z != null ? opts.z : (r.z1 + Math.random() * (r.z2 - r.z1));
    if (!opts.route) for (var t = 0; t < 20; t++) { var ok = true;
      for (var oi = 0; oi < npcs.length; oi++) if (Math.hypot(npcs[oi].g.position.x - x, npcs[oi].g.position.z - z) < 1.6) { ok = false; break; }
      if (ok) break; x = r.x1 + Math.random() * (r.x2 - r.x1); z = r.z1 + Math.random() * (r.z2 - r.z1);
    }
  }
  g.position.set(x, 0, z); g.rotation.y = Math.random() * 6.28;
  if (d.name) {
    var label = makeNameLabel(d.name);
    label.position.y = scale * 2.4;
    g.add(label);
  }
  scene.add(g);
  var npc = {
    id: d.id, name: d.name, role: d.role, g: g, region: d.region, user_id: d.user_id,
    speed: d.role === '孩童' ? 2.3 : d.role === '老者' ? 0.8 : 1.1 + Math.random() * 0.5,
    tx: x, tz: z, idle: Math.random() * 3, walkPhase: Math.random() * 6.28,
    route: opts.route || null, routeIdx: 0, routeDir: 1,
    lane: Math.random() > 0.5 ? 1.3 : -1.3, stuck: 0, prevD: 1e9,
    persona: d.persona, portrait: d.portrait,
    fixed: d.fixed, talking: false,
  };
  npcs.push(npc); return npc;
}

export function npcPickTarget(n) {
  var r = REGIONS[n.region];
  n.tx = r.x1 + Math.random() * (r.x2 - r.x1);
  n.tz = r.z1 + Math.random() * (r.z2 - r.z1);
}
export function updateNPC(n, dt, playerPos, npcs) {
  var p = n.g.position;
  if (n._jumpVy != null || n._jump > 0) {
    if (n._jumpVy == null) { n._jumpVy = 8; n._jumpCount = n._jump; n._jump = 0; console.log('NPC开始跳跃, 次数=' + n._jumpCount); }
    n._jumpVy -= 20 * dt;
    p.y += n._jumpVy * dt;
    var groundY = groundHeight(p.x, p.z);
    if (p.y <= groundY) {
      p.y = groundY;
      n._jumpCount--;
      if (n._jumpCount > 0) { n._jumpVy = 8; console.log('NPC落地再跳, 剩余=' + n._jumpCount); }
      else { n._jumpVy = null; n._jumpCount = 0; console.log('NPC跳跃结束'); }
    }
  }
  if (n.talking) { var tRot = Math.atan2(playerPos.x - p.x, playerPos.z - p.z); var dr = tRot - n.g.rotation.y; while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2; n.g.rotation.y += dr * Math.min(1, dt * 6); idlePose(n); return; }
  if (n.idle > 0) { n.idle -= dt; idlePose(n); return; }
  if (n.fixed) { idlePose(n); return; }
  var tx, tz;
  if (n.route) { tx = n.route[n.routeIdx][0]; tz = n.route[n.routeIdx][1]; if (tz <= -14 || p.z < -14) tx = WORLD.bridgeX + n.lane; }
  else { if (Math.hypot(n.tx - p.x, n.tz - p.z) < 0.5) npcPickTarget(n); tx = n.tx; tz = n.tz; }
  var dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
  if (dist < 0.4) { n.stuck = 0; if (n.route) { n.routeIdx += n.routeDir; if (n.routeIdx >= n.route.length || n.routeIdx < 0) { n.routeDir *= -1; n.routeIdx += n.routeDir * 2; } n.idle = 1 + Math.random() * 3; } else n.idle = 1.5 + Math.random() * 3.5; return; }
  if (dist > n.prevD - n.speed * dt * 0.25) n.stuck += dt; else n.stuck = Math.max(0, n.stuck - dt * 2);
  n.prevD = dist;
  if (n.stuck > 3.5) { n.stuck = 0; if (n.route) n.routeDir *= -1; else { npcPickTarget(n); n.idle = 0.4 + Math.random(); } return; }
  var vx = dx / dist * n.speed, vz = dz / dist * n.speed;
  p.x += vx * dt; p.z += vz * dt;
  for (var oi = 0; oi < npcs.length; oi++) { var o = npcs[oi]; if (o === n || o.talking) continue; var ox = p.x - o.g.position.x, oz = p.z - o.g.position.z, od = Math.hypot(ox, oz); if (od < 1 && od > 0.001) { var push = (1 - od) * dt * 5; p.x += ox / od * push; p.z += oz / od * push; p.x += -oz / od * push * 0.6; p.z += ox / od * push * 0.6; } }
  if (p.z < WORLD.riverS + 0.3 && p.z > WORLD.riverN - 0.3 && Math.abs(p.x - WORLD.bridgeX) > WORLD.bridgeHalf - 0.3) p.z = p.z > (WORLD.riverS + WORLD.riverN) / 2 ? WORLD.riverS + 0.3 : WORLD.riverN - 0.3;
  if (p.z <= -14 && p.z >= -66 && Math.abs(p.x - WORLD.bridgeX) < WORLD.bridgeHalf + 1) p.x = WORLD.bridgeX + Math.sign(p.x - WORLD.bridgeX || 0.01) * Math.min(Math.abs(p.x - WORLD.bridgeX), WORLD.bridgeHalf - 0.3);
  var targetRot = Math.atan2(vx, vz); dr = targetRot - n.g.rotation.y; while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2; n.g.rotation.y += dr * Math.min(1, dt * 8);
  n.walkPhase += dt * n.speed * 5.2; var sw = Math.sin(n.walkPhase); n.g.userData.armL.rotation.x = sw * 0.55; n.g.userData.armR.rotation.x = -sw * 0.55; n.g.userData.skirt.rotation.z = sw * 0.03;
  if (n._jumpVy == null) p.y = groundHeight(p.x, p.z) + Math.abs(Math.cos(n.walkPhase)) * 0.045;
}

export function idlePose(n) { var u = n.g.userData; u.armL.rotation.x *= 0.9; u.armR.rotation.x *= 0.9; if (n._jumpVy == null) n.g.position.y = groundHeight(n.g.position.x, n.g.position.z); }
var portraitCache = {};
export function makePortrait(name, st) {
  if (portraitCache[name]) return portraitCache[name];
  var cv = document.createElement('canvas'); cv.width = 160; cv.height = 210;
  var g = cv.getContext('2d');
  g.fillStyle = '#f3ead2'; g.fillRect(0, 0, 160, 210);
  for (var i = 0; i < 5; i++) { var grd = g.createRadialGradient(30 + i * 30, 40 + i * 30, 0, 30 + i * 30, 40 + i * 30, 60); grd.addColorStop(0, 'rgba(160,140,100,.12)'); grd.addColorStop(1, 'rgba(160,140,100,0)'); g.fillStyle = grd; g.beginPath(); g.arc(30 + i * 30, 40 + i * 30, 60, 0, 7); g.fill(); }
  var cy = st.child ? 96 : 84, hr = st.child ? 20 : 24;
  g.fillStyle = st.robe || '#6b7f8a'; g.beginPath();
  g.moveTo(80, cy + hr * 0.8); g.bezierCurveTo(30, cy + 30, 22, 150, 16, 210); g.lineTo(144, 210); g.bezierCurveTo(138, 150, 130, cy + 30, 80, cy + hr * 0.8); g.fill();
  g.strokeStyle = 'rgba(240,230,205,.9)'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(80, cy + hr * 0.75); g.lineTo(64, cy + hr + 26); g.stroke();
  g.beginPath(); g.moveTo(80, cy + hr * 0.75); g.lineTo(96, cy + hr + 26); g.stroke();
  g.fillStyle = '#e8c39a'; g.beginPath(); g.arc(80, cy, hr, 0, 7); g.fill();
  g.strokeStyle = '#3a2e20'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(80 - hr * 0.45, cy - 2); g.lineTo(80 - hr * 0.2, cy - 2); g.stroke();
  g.beginPath(); g.moveTo(80 + hr * 0.2, cy - 2); g.lineTo(80 + hr * 0.45, cy - 2); g.stroke();
  g.beginPath(); g.moveTo(80 - hr * 0.5, cy - hr * 0.35); g.lineTo(80 - hr * 0.15, cy - hr * 0.3); g.stroke();
  g.beginPath(); g.moveTo(80 + hr * 0.15, cy - hr * 0.3); g.lineTo(80 + hr * 0.5, cy - hr * 0.35); g.stroke();
  if (st.beard) { g.fillStyle = 'rgba(200,195,180,.9)'; g.beginPath(); g.moveTo(80 - hr * 0.5, cy + hr * 0.5); g.quadraticCurveTo(80, cy + hr * 2.2, 80 + hr * 0.5, cy + hr * 0.5); g.quadraticCurveTo(80, cy + hr * 1.1, 80 - hr * 0.5, cy + hr * 0.5); g.fill(); }
  if (st.hat === 'futou') { g.fillStyle = '#211e1b'; g.beginPath(); g.arc(80, cy - hr * 0.45, hr * 0.72, Math.PI, 0); g.fill(); g.fillRect(80 - hr * 0.72, cy - hr * 0.5, hr * 1.44, hr * 0.28); g.fillRect(80 - hr * 1.45, cy - hr * 0.42, hr * 0.75, 5); g.fillRect(80 + hr * 0.7, cy - hr * 0.42, hr * 0.75, 5); }
  else if (st.hat === 'douli') { g.fillStyle = '#b09a5e'; g.beginPath(); g.moveTo(80 - hr * 1.5, cy - hr * 0.35); g.lineTo(80, cy - hr * 1.6); g.lineTo(80 + hr * 1.5, cy - hr * 0.35); g.closePath(); g.fill(); }
  else if (st.hat === 'bun') { g.fillStyle = '#211e1b'; g.beginPath(); g.arc(80, cy - hr * 0.42, hr * 0.7, Math.PI, 0); g.fill(); g.beginPath(); g.arc(80, cy - hr * 1.05, hr * 0.3, 0, 7); g.fill(); if (st.female) { g.strokeStyle = '#b13b2e'; g.lineWidth = 2; g.beginPath(); g.moveTo(80 - hr * 0.3, cy - hr * 1.05); g.lineTo(80 + hr * 0.3, cy - hr * 1.05); g.stroke(); } }
  else if (st.hat === 'scarf') { g.fillStyle = '#5a6a72'; g.beginPath(); g.arc(80, cy - hr * 0.42, hr * 0.74, Math.PI * 0.95, Math.PI * 0.05); g.fill(); g.fillRect(80 - hr * 0.74, cy - hr * 0.45, hr * 1.48, hr * 0.2); }
  else if (st.hat === 'monk') { g.fillStyle = '#4a4038'; g.beginPath(); g.arc(80, cy - hr * 0.3, hr * 0.72, Math.PI, 0); g.fill(); g.fillRect(80 - hr * 0.72, cy - hr * 0.35, hr * 1.44, hr * 0.15); }
  g.fillStyle = '#b13b2e'; g.fillRect(118, 178, 30, 24);
  g.fillStyle = '#fff5e0'; g.font = '15px Ma Shan Zheng,STKaiti,cursive'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name[0], 133, 191);
  var url = cv.toDataURL(); portraitCache[name] = url; return url;
}
var nameLabelCache = {};
function makeNameLabel(name) {
  if (nameLabelCache[name]) return nameLabelCache[name].clone();
  var cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  var g = cv.getContext('2d');
  g.font = 'bold 22px "Ma Shan Zheng", "STKaiti", "Noto Serif SC", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(20,16,10,.55)';
  g.fillText(name, 129, 33);
  g.fillStyle = '#fff8ee';
  g.fillText(name, 128, 32);
  var tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  var mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1);
  nameLabelCache[name] = sprite;
  return sprite.clone();
}
// __APPEND__




