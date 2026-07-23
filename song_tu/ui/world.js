import * as THREE from './three.module.js';
import { C, box, cyl } from './engine.js';

export var WORLD = { x:240, zNear:100, zFar:-110, riverS:-18, riverN:-62, bridgeX:20, bridgeHalf:3.6 };

export function groundHeight(x, z) {
  if (Math.abs(x - WORLD.bridgeX) <= WORLD.bridgeHalf && z <= -15 && z >= -65) {
    var t = (z + 40) / 25; return 4.6 * Math.cos(t * Math.PI / 2);
  }
  return 0;
}

export function makeGround(scene, M, TX) {
  var shape = new THREE.Shape();
  shape.moveTo(-WORLD.x, -WORLD.zFar); shape.lineTo(WORLD.x, -WORLD.zFar);
  shape.lineTo(WORLD.x, -WORLD.zNear); shape.lineTo(-WORLD.x, -WORLD.zNear); shape.closePath();
  var hole = new THREE.Path();
  hole.moveTo(-WORLD.x, -WORLD.riverN); hole.lineTo(WORLD.x, -WORLD.riverN);
  hole.lineTo(WORLD.x, -WORLD.riverS); hole.lineTo(-WORLD.x, -WORLD.riverS); hole.closePath();
  shape.holes.push(hole);
  var g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
  var ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: TX.groundTex }));
  ground.receiveShadow = true; scene.add(ground);

  var bed = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.x * 2, WORLD.riverS - WORLD.riverN + 8),
    new THREE.MeshLambertMaterial({ color: 0x4a4438 }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, -0.85, (WORLD.riverS + WORLD.riverN) / 2); scene.add(bed);

  var waterGeo = new THREE.PlaneGeometry(WORLD.x * 2, WORLD.riverS - WORLD.riverN - 1, 110, 10);
  var water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
    color: 0x3a6a72, specular: 0x88b8b8, shininess: 90, transparent: true, opacity: .93
  }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.45, (WORLD.riverS + WORLD.riverN) / 2); scene.add(water);
  var waterBase = waterGeo.attributes.position.array.slice();

  for (var zi = 0; zi < 2; zi++) {
    var zz = [WORLD.riverS, WORLD.riverN][zi];
    var wall = box(WORLD.x * 2, 1.0, 1.2, M.stoneDark);
    wall.position.set(0, -0.4, zz + (zz === WORLD.riverS ? -0.55 : 0.55)); scene.add(wall);
    var cap = box(WORLD.x * 2, 0.14, 1.5, M.stone);
    cap.position.set(0, 0.07, zz + (zz === WORLD.riverS ? -0.55 : 0.55)); scene.add(cap);
  }
  return { waterGeo: waterGeo, waterBase: waterBase, water: water };
}

export function road(scene, x, z, w, d, baseTex, tile, y) {
  tile = tile || 8; y = y || 0.02;
  var tex = baseTex.clone(); tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, w / tile), Math.max(1, d / tile));
  var r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
  r.rotation.x = -Math.PI / 2; r.position.set(x, y, z); r.receiveShadow = true; scene.add(r);
}
export function makeBridge(scene, M, TX) {
  var g = new THREE.Group();
  var SEG = 40, W = 3.7;
  var verts = [], uvs = [], idx = [];
  for (var i = 0; i <= SEG; i++) {
    var z = -15 - (50 * i / SEG), y = groundHeight(WORLD.bridgeX, z);
    verts.push(WORLD.bridgeX - W, y, z, WORLD.bridgeX + W, y, z);
    uvs.push(0, i / SEG, 1, i / SEG);
    if (i < SEG) { var a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  var deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  deckGeo.setIndex(idx); deckGeo.computeVertexNormals();
  var deck = new THREE.Mesh(deckGeo, M.deck);
  deck.receiveShadow = true; deck.castShadow = true; g.add(deck);

  for (var si = 0; si < 2; si++) {
    var s = si === 0 ? -1 : 1;
    var sv = [], svi = [], su = [];
    for (var i = 0; i <= SEG; i++) {
      var z = -15 - (50 * i / SEG), y = groundHeight(WORLD.bridgeX, z);
      sv.push(WORLD.bridgeX + s * W, y, z, WORLD.bridgeX + s * W, y - 1.35, z);
      su.push(0, i / SEG * 10, 1, i / SEG * 10);
      if (i < SEG) { var a = i * 2; svi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
    sg.setIndex(svi); sg.computeVertexNormals();
    var skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: TX.plankTex, side: THREE.DoubleSide }));
    skirt.castShadow = true; g.add(skirt);
  }

  for (var z = -15; z > -65; z -= 2) {
    var z2 = z - 2, h1 = groundHeight(WORLD.bridgeX, z), h2 = groundHeight(WORLD.bridgeX, z2);
    var len = Math.hypot(2, h2 - h1);
    for (var si2 = 0; si2 < 2; si2++) {
      var side = si2 === 0 ? -3.4 : 3.4;
      var rail = box(0.16, 0.14, len + 0.06, M.woodRed);
      rail.position.set(WORLD.bridgeX + side, (h1 + h2) / 2 + 1.0, (z + z2) / 2);
      rail.rotation.x = Math.atan2(h2 - h1, 2); g.add(rail);
      var post = box(0.16, 1.05, 0.16, M.woodRed);
      post.position.set(WORLD.bridgeX + side, h1 + 0.5, z); g.add(post);
      var cap = box(0.22, 0.1, 0.22, M.woodDark);
      cap.position.set(WORLD.bridgeX + side, h1 + 1.06, z); g.add(cap);
    }
  }

  var pts = [];
  for (var i = 0; i <= 20; i++) {
    var z = -65 + (50 * i / 20), t = (z + 40) / 25;
    pts.push(new THREE.Vector3(WORLD.bridgeX, 4.6 * Math.cos(t * Math.PI / 2) - 1.7, z));
  }
  var archCurve = new THREE.CatmullRomCurve3(pts);
  for (var oi = 0; oi < 3; oi++) {
    var off = [-2.4, 0, 2.4][oi];
    var arch = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 24, 0.55, 8), M.woodRed);
    arch.position.x = off; arch.castShadow = true; g.add(arch);
  }
  for (var zi3 = 0; zi3 < 3; zi3++) {
    var zc = [-52, -40, -28][zi3];
    var tt = (zc + 40) / 25, yy = 4.6 * Math.cos(tt * Math.PI / 2) - 1.7;
    var beam = box(5.4, 0.3, 0.3, M.woodDark);
    beam.position.set(WORLD.bridgeX, yy, zc); g.add(beam);
  }
  scene.add(g);
}
export function makeRoofGeo(w, d, h) {
  var over = 0.85;
  var shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + over), 0);
  var N = 10;
  for (var i = 1; i <= N; i++) { var t = i / N; shape.lineTo(-(w / 2 + over) * (1 - t), h * Math.pow(t, 1.75)); }
  for (var i = N - 1; i >= 0; i--) { var t = i / N; shape.lineTo((w / 2 + over) * (1 - t), h * Math.pow(t, 1.75)); }
  shape.closePath();
  var geo = new THREE.ExtrudeGeometry(shape, { depth: d + 2 * over, bevelEnabled: false });
  geo.translate(0, 0, -(d + 2 * over) / 2);
  var pos = geo.attributes.position;
  var wx = w / 2, wz = d / 2;
  for (var i = 0; i < pos.count; i++) {
    var x = pos.getX(i), z = pos.getZ(i);
    var ox = Math.max(0, (Math.abs(x) - wx) / over);
    var oz = Math.max(0, (Math.abs(z) - wz) / over);
    pos.setY(i, pos.getY(i) + 0.55 * Math.pow(Math.min(1, ox) * Math.min(1, oz), 1.4));
  }
  geo.computeVertexNormals();
  return geo;
}

export function addRoof(g, w, d, y, h, M, detail, roofMat) {
  if (detail === undefined) detail = true;
  var roof = new THREE.Mesh(makeRoofGeo(w, d, h), roofMat || M.roof);
  roof.position.y = y; roof.castShadow = roof.receiveShadow = true; g.add(roof);
  var ridge = box(0.34, 0.3, d + 2.1, M.ridge); ridge.position.y = y + h + 0.12; g.add(ridge);
  for (var s = -1; s <= 1; s += 2) {
    var owl = box(0.46, 0.62, 0.34, M.ridge);
    owl.position.set(0, y + h + 0.34, s * (d / 2 + 0.9)); g.add(owl);
  }
  if (!detail) return;
  var eave = box(w + 1.9, 0.16, 0.12, M.woodDark);
  eave.position.set(0, y + 0.02, d / 2 + 0.92); g.add(eave);
  var n = Math.max(2, Math.round(w / 1.6));
  for (var i = 0; i <= n; i++) {
    var x = -w / 2 + (w / n) * i;
    var bk = box(0.26, 0.24, 0.26, M.woodDark);
    bk.position.set(x, y - 0.12, d / 2 - 0.05); g.add(bk);
  }
}
export function makeBuilding(opt, M, TX) {
  var w = opt.w || 6, d = opt.d || 5, floors = opt.floors || 1;
  var plain = opt.plain, banner = opt.banner, awning = opt.awning, thatched = opt.thatched;
  var g = new THREE.Group();
  var baseH = 0.5, wallH = 2.8;
  var base = box(w + 1.0, baseH, d + 1.0, M.stone); base.position.y = baseH / 2; g.add(base);
  var y = baseH;
  for (var f = 0; f < floors; f++) {
    var fw = w * (f ? 0.86 : 1), fd = d * (f ? 0.86 : 1);
    var wall = box(fw - 0.35, wallH, fd - 0.35, f ? M.plaster2 : M.plaster);
    wall.position.y = y + wallH / 2; g.add(wall);
    var n = Math.max(2, Math.round(fw / 2.2));
    for (var i = 0; i <= n; i++) {
      var x = -fw / 2 + (fw / n) * i;
      for (var zs = -1; zs <= 1; zs += 2) {
        var col = cyl(0.12, 0.13, wallH, M.woodRed);
        col.position.set(x, y + wallH / 2, zs * (fd / 2 - 0.08)); g.add(col);
      }
    }
    if (f === 0) {
      var skirt = box(fw - 0.3, 0.55, fd - 0.3, M.stoneDark); skirt.position.y = y + 0.28; g.add(skirt);
      var frame = box(1.5, 2.3, 0.1, M.woodRed); frame.position.set(0, y + 1.15, d / 2 - 0.02); g.add(frame);
      var door = box(1.25, 2.1, 0.14, M.woodDark); door.position.set(0, y + 1.05, d / 2 + 0.04); g.add(door);
      if (!plain) {
        var sill = box(1.5, 0.1, 0.2, M.wood); sill.position.set(0, y + 0.05, d / 2 + 0.1); g.add(sill);
        var step = box(1.9, 0.22, 0.8, M.stone); step.position.set(0, 0.36, d / 2 + 0.55); g.add(step);
        for (var ss = -1; ss <= 1; ss += 2) {
          var cp = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1.5),
            new THREE.MeshLambertMaterial({ map: TX.coupletTex(ss < 0 ? '迎祥纳福' : '招财进宝') }));
          cp.position.set(ss * 1.05, y + 1.45, d / 2 + 0.03); g.add(cp);
        }
      }
      for (var ss = -1; ss <= 1; ss += 2) {
        var win = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.08), M.lattice);
        win.position.set(ss * w * 0.27, y + 1.6, d / 2 + 0.02); win.castShadow = true; g.add(win);
      }
    }
    y += wallH;
    if (f < floors - 1) {
      var band = box(fw + 0.5, 0.24, fd + 0.5, M.woodDark); band.position.y = y + 0.12; g.add(band); y += 0.24;
    }
  }
  addRoof(g, w, d, y, 1.35 + 0.25 * floors, M, !plain, thatched ? M.thatch : null);
  if (banner) {
    var pole = cyl(0.05, 0.05, 3.6, M.woodDark); pole.position.set(w / 2 + 0.7, 1.8, d / 2 + 0.3); g.add(pole);
    var arm = box(1.1, 0.08, 0.08, M.woodDark); arm.position.set(w / 2 + 0.35, 3.4, d / 2 + 0.3); g.add(arm);
    var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 2.1),
      new THREE.MeshLambertMaterial({ map: TX.bannerTex(banner), side: THREE.DoubleSide }));
    flag.position.set(w / 2 + 0.7 - 0.42, 2.3, d / 2 + 0.3); flag.castShadow = true; g.add(flag);
    for (var ss = -1; ss <= 1; ss += 2) {
      var lan = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), M.lantern);
      lan.scale.y = 0.8; lan.position.set(ss * (w / 2 - 0.5), baseH + 2.55, d / 2 + 0.45); g.add(lan);
      var cord = cyl(0.015, 0.015, 0.3, M.woodDark, 4);
      cord.position.set(ss * (w / 2 - 0.5), baseH + 2.85, d / 2 + 0.45); g.add(cord);
    }
  }
  if (awning) {
    var aw = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 1.6), M.awning);
    aw.position.set(0, baseH + wallH - 0.25, d / 2 + 0.8);
    aw.rotation.x = -0.5; aw.castShadow = true; g.add(aw);
  }
  return g;
}
export function makeStall(scene, M, colliders, props, x, z, rot, name, goodsFn, lines) {
  var g = new THREE.Group();
  for (var pi = 0; pi < 4; pi++) {
    var px = pi < 2 ? (pi === 0 ? -1.4 : 1.4) : (pi === 2 ? -1.4 : 1.4);
    var pz = pi % 2 === 0 ? -1 : 1;
    var p = cyl(0.06, 0.07, 2.3, M.woodDark);
    p.position.set(px, 1.15, pz); g.add(p);
  }
  var top = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6), M.awning);
  top.rotation.x = -Math.PI / 2 + 0.22; top.position.y = 2.35; top.castShadow = true; g.add(top);
  var table = box(2.6, 0.12, 1.4, M.wood); table.position.y = 0.85; g.add(table);
  for (var s = -1; s <= 1; s += 2) { var leg = box(0.12, 0.85, 1.2, M.woodDark); leg.position.set(s * 1.1, 0.43, 0); g.add(leg); }
  goodsFn(g);
  g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
  colliders.push({ x: x, z: z, hw: 1.5, hd: 1.2 });
  props.push({ x: x, z: z, r: 3.2, name: name, lines: lines, idx: 0 });
  return g;
}
export function makeUmbrella(scene, M, colliders, x, z, color) {
  var g = new THREE.Group();
  var pole = cyl(0.05, 0.06, 2.6, M.woodDark); pole.position.y = 1.3; g.add(pole);
  var canopy = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.6, 12, 1, true),
    new THREE.MeshLambertMaterial({ color: color, side: THREE.DoubleSide }));
  canopy.position.y = 2.55; canopy.castShadow = true; g.add(canopy);
  var knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.woodDark); knob.position.y = 2.92; g.add(knob);
  var table = box(2.0, 0.1, 1.0, M.wood); table.position.y = 0.75; g.add(table);
  for (var s = -1; s <= 1; s += 2) { var leg = box(0.1, 0.75, 0.8, M.woodDark); leg.position.set(s * 0.85, 0.37, 0); g.add(leg); }
  var colors = [0xc56a2a, 0xb13b2e, 0x8aa03e];
  for (var i = 0; i < 6; i++) { var item = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshLambertMaterial({ color: colors[i % 3] })); item.position.set(-0.6 + (i % 3) * 0.5, 0.88, -0.2 + Math.floor(i / 3) * 0.4); g.add(item); }
  g.position.set(x, 0, z); scene.add(g);
  colliders.push({ x: x, z: z, hw: 1.1, hd: 0.8 });
  return g;
}

export function makeBoat(scene, M, x, z, len, withMast, boats, yaw) {
  if (yaw === undefined) yaw = Math.PI / 2;
  var g = new THREE.Group(); var body = new THREE.Group(); g.add(body);
  var hull = box(2.6, 1.0, len, M.woodDark); hull.position.y = 0.2; body.add(hull);
  var deck = box(2.3, 0.15, len - 0.6, M.wood); deck.position.y = 0.75; body.add(deck);
  for (var s = -1; s <= 1; s += 2) { var end = box(2.2, 0.9, 1.4, M.woodDark); end.position.set(0, 0.9, s * (len / 2 - 0.6)); end.rotation.x = s * 0.35; body.add(end); }
  var canopy = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, len * 0.5, 10, 1, true, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x6a5636, side: THREE.DoubleSide }));
  canopy.rotation.z = Math.PI / 2; canopy.rotation.x = Math.PI / 2; canopy.position.y = 0.85; body.add(canopy);
  for (var i = 0; i < 3; i++) { var sack = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshLambertMaterial({ color: 0xb09a6a })); sack.scale.y = 0.7; sack.position.set((i % 2) * 0.8 - 0.4, 1.0, len / 4 - i * 0.9); body.add(sack); }
  var mast = null;
  if (withMast) { mast = new THREE.Group(); var mpole = cyl(0.07, 0.09, 6.5, M.woodDark); mpole.position.y = 3.2; mast.add(mpole); var yard = box(3.4, 0.08, 0.08, M.woodDark); yard.position.y = 5.6; mast.add(yard); var sail = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.6), new THREE.MeshLambertMaterial({ color: 0xd8c8a0, side: THREE.DoubleSide })); sail.position.y = 4.2; mast.add(sail); mast.position.set(0, 0.75, -len * 0.32); body.add(mast); }
  body.rotation.y = yaw; g.position.set(x, -0.35, z); scene.add(g);
  var boat = { g: g, mast: mast, mastDown: 0, speed: withMast ? 1.1 : 0, phase: Math.random() * 6.28 };
  boats.push(boat); return boat;
}
export function makeScenery(scene, M, TX, colliders, roadRects) {
  function isFree(x, z, m) { m = m || 1;
    if (z > -64 && z < -16) return false;
    for (var ri = 0; ri < roadRects.length; ri++) { var rc = roadRects[ri]; if (Math.abs(x - rc[0]) < rc[2] / 2 + m && Math.abs(z - rc[1]) < rc[3] / 2 + m) return false; }
    for (var ci = 0; ci < colliders.length; ci++) { var c = colliders[ci]; if (Math.abs(x - c.x) < c.hw + m && Math.abs(z - c.z) < c.hd + m) return false; }
    return true;
  }
  var _dummy = new THREE.Object3D();
  function scatter(mesh, count, place) { var n = 0, guard = 0;
    while (n < count && guard++ < count * 40) { var r = place(n); if (!r) continue; _dummy.position.set(r[0], r[1], r[2]); _dummy.rotation.set(0, Math.random() * 6.28, 0); _dummy.scale.setScalar(r[3] || 1); _dummy.updateMatrix(); mesh.setMatrixAt(n, _dummy.matrix); n++; }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; scene.add(mesh);
  }
  var grassGeo = new THREE.PlaneGeometry(0.9, 0.6); grassGeo.translate(0, 0.3, 0);
  var grassIM = new THREE.InstancedMesh(grassGeo, M.grassBlade, 900); grassIM.castShadow = false; grassIM.receiveShadow = true;
  scatter(grassIM, 900, function() { var x = Math.random() * 440 - 220, z = Math.random() * 185 - 100; return isFree(x, z, 0.3) ? [x, 0, z, 0.7 + Math.random() * 0.9] : null; });
  var flowerGeo = new THREE.PlaneGeometry(0.6, 0.6); flowerGeo.translate(0, 0.3, 0);
  var flowerIM = new THREE.InstancedMesh(flowerGeo, M.flower, 220); flowerIM.castShadow = false;
  scatter(flowerIM, 220, function() { var x = Math.random() * 440 - 220, z = Math.random() * 185 - 100; return isFree(x, z, 0.3) ? [x, 0, z, 0.7 + Math.random() * 0.7] : null; });
  var bushGeo = new THREE.SphereGeometry(0.8, 8, 6); bushGeo.scale(1, 0.6, 1);
  var bushIM = new THREE.InstancedMesh(bushGeo, M.bush, 130); bushIM.castShadow = true; bushIM.receiveShadow = true;
  scatter(bushIM, 130, function() { var x = Math.random() * 440 - 220, z = Math.random() * 185 - 100; return isFree(x, z, 0.2) ? [x, 0.25, z, 0.5 + Math.random() * 1.1] : null; });
  var reedGeo = new THREE.ConeGeometry(0.06, 1.6, 5); reedGeo.translate(0, 0.8, 0);
  var reedIM = new THREE.InstancedMesh(reedGeo, M.reed, 320); reedIM.castShadow = false;
  scatter(reedIM, 320, function() { var south = Math.random() > 0.5; var z = south ? -18.6 - Math.random() * 1.6 : -61.4 + Math.random() * 1.6; var x = Math.random() * 460 - 230; if (Math.abs(x - WORLD.bridgeX) < 7) return null; return [x, -0.55, z, 0.7 + Math.random() * 0.8]; });
  var leafGeo = new THREE.CircleGeometry(0.45, 10);
  var lotusIM = new THREE.InstancedMesh(leafGeo, M.lotus, 60); lotusIM.castShadow = false; var ln = 0, lg = 0;
  while (ln < 60 && lg++ < 2000) { var x = Math.random() * 440 - 220; var z = Math.random() > 0.5 ? -20 - Math.random() * 4 : -60 + Math.random() * 4; if (Math.abs(x - WORLD.bridgeX) < 8) continue; _dummy.position.set(x, -0.42, z); _dummy.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28); _dummy.scale.setScalar(0.6 + Math.random() * 0.8); _dummy.updateMatrix(); lotusIM.setMatrixAt(ln, _dummy.matrix); ln++; }
  lotusIM.count = ln; lotusIM.instanceMatrix.needsUpdate = true; scene.add(lotusIM);
  for (var i = 0; i < 10; i++) { var f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0xe8a0b4 })); var x = Math.random() * 400 - 200; f.position.set(x, -0.3, Math.random() > 0.5 ? -21 - Math.random() * 3 : -59 + Math.random() * 3); scene.add(f); }
  var rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
  var rockIM = new THREE.InstancedMesh(rockGeo, M.rock, 90); rockIM.castShadow = true; rockIM.receiveShadow = true;
  scatter(rockIM, 90, function() { if (Math.random() > 0.4) { var south = Math.random() > 0.5; var z = south ? -15.6 - Math.random() * 1.2 : -64.4 + Math.random() * 1.2; var x = Math.random() * 440 - 220; if (Math.abs(x - WORLD.bridgeX) < 8) return null; return [x, 0.1, z, 0.3 + Math.random() * 0.9]; } var x = Math.random() * 440 - 220, z = Math.random() * 185 - 100; return isFree(x, z, 0.2) ? [x, 0.08, z, 0.25 + Math.random() * 0.7] : null; });
  return { isFree: isFree, _dummy: _dummy, scatter: scatter };
}

export function makeWillow(scene, M, x, z, s, colliders) { s = s || 1;
  var g = new THREE.Group(); var trunk = cyl(0.14 * s, 0.22 * s, 2.6 * s, M.woodDark); trunk.position.y = 1.3 * s; trunk.rotation.z = 0.08; g.add(trunk);
  var crown = new THREE.Group(); crown.position.y = 2.7 * s;
  for (var i = 0; i < 7; i++) { var p = new THREE.Mesh(new THREE.PlaneGeometry(2.6 * s, 3.2 * s), M.willow); var a = (i / 7) * Math.PI * 2; p.position.set(Math.cos(a) * 0.8 * s, -0.6 * s, Math.sin(a) * 0.8 * s); p.rotation.y = a + Math.PI / 2; crown.add(p); }
  g.add(crown); g.position.set(x, 0, z); g.rotation.y = Math.random() * 6.28; scene.add(g);
  colliders.push({ x: x, z: z, hw: 0.35, hd: 0.35 });
}

export function makeTree(scene, M, x, z, s, dark, colliders) { s = s || 1;
  var g = new THREE.Group(); var trunk = cyl(0.12 * s, 0.2 * s, 2.0 * s, M.woodDark); trunk.position.y = 1.0 * s; g.add(trunk);
  var mat = dark ? M.leafDark : M.leaf;
  var c1 = new THREE.Mesh(new THREE.ConeGeometry(1.5 * s, 2.2 * s, 8), mat); c1.position.y = 2.8 * s; c1.castShadow = true; g.add(c1);
  var c2 = new THREE.Mesh(new THREE.ConeGeometry(1.1 * s, 1.8 * s, 8), mat); c2.position.y = 4.0 * s; c2.castShadow = true; g.add(c2);
  g.position.set(x, 0, z); scene.add(g); colliders.push({ x: x, z: z, hw: 0.35, hd: 0.35 });
}

export function makeBamboo(scene, M, x, z, colliders) {
  var g = new THREE.Group(); var n = 8 + Math.random() * 5 | 0;
  for (var i = 0; i < n; i++) { var h = 4.5 + Math.random() * 2.5; var stalk = cyl(0.05, 0.07, h, M.bamboo, 6); stalk.position.set(Math.random() * 3 - 1.5, h / 2, Math.random() * 3 - 1.5); g.add(stalk); var top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6), M.leaf); top.position.copy(stalk.position); top.position.y = h + 0.3; g.add(top); }
  g.position.set(x, 0, z); scene.add(g); colliders.push({ x: x, z: z, hw: 1.6, hd: 1.6 });
}

export function makeField(scene, M, x, z, w, d, _dummy) {
  var f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.tilled); f.rotation.x = -Math.PI / 2; f.position.set(x, 0.05, z); f.receiveShadow = true; scene.add(f);
  var geo = new THREE.PlaneGeometry(0.4, 0.5); geo.translate(0, 0.25, 0);
  var im = new THREE.InstancedMesh(geo, M.crop, 60); var n = 0;
  for (var ix = 0; ix < Math.floor(w / 1.2); ix++) for (var iz = 0; iz < Math.floor(d / 1.1); iz++) { if (n >= 60) break; _dummy.position.set(x - w / 2 + 0.8 + ix * 1.2, 0, z - d / 2 + 0.7 + iz * 1.1); _dummy.rotation.set(0, Math.random() * 6.28, 0); _dummy.scale.setScalar(0.8 + Math.random() * 0.5); _dummy.updateMatrix(); im.setMatrixAt(n, _dummy.matrix); n++; }
  im.count = n; im.instanceMatrix.needsUpdate = true; scene.add(im);
}
// __APPEND__







