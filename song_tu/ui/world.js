import * as THREE from './three.module.js';
import { C, box, cyl } from './engine.js';

// world 配置由城市 terrain 构建：
// { boundary:{x,zNear,zFar}, ground:{tex}, river:{zS,zN,water,bed}, bridge:{x,half,h}, wall:{x,gateZ,both}, ... }

export function groundHeight(x, z, world) {
  var b = world.bridge, r = world.river;
  if (!b || !r) return 0;
  var zStart = r.zS + 3, zEnd = r.zN - 3;
  if (Math.abs(x - b.x) <= b.half && z <= zStart && z >= zEnd) {
    var mid = (zStart + zEnd) / 2, half = (zStart - zEnd) / 2;
    var t = (z - mid) / half;
    return b.h * Math.cos(t * Math.PI / 2);
  }
  return 0;
}

/* ============================================================
   天空（渐变穹顶，跟随玩家）
============================================================ */
export function makeSky(TX) {
  var geo = new THREE.SphereGeometry(430, 24, 14);
  var mat = new THREE.MeshBasicMaterial({ map: TX.skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
  var sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -10;
  return sky;
}

export function makeGround(scene, M, TX, world) {
  var bx = world.boundary.x, zNear = world.boundary.zNear, zFar = world.boundary.zFar;
  var groundTex = TX[(world.ground && world.ground.tex || 'ground') + 'Tex'] || TX.groundTex;
  var shape = new THREE.Shape();
  shape.moveTo(-bx, -zFar); shape.lineTo(bx, -zFar);
  shape.lineTo(bx, -zNear); shape.lineTo(-bx, -zNear); shape.closePath();
  var r = world.river;
  if (r) {
    var hole = new THREE.Path();
    hole.moveTo(-bx, -r.zN); hole.lineTo(bx, -r.zN);
    hole.lineTo(bx, -r.zS); hole.lineTo(-bx, -r.zS); hole.closePath();
    shape.holes.push(hole);
  }
  var g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
  var ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.receiveShadow = true; scene.add(ground);

  if (!r) return { waterGeo: null, waterBase: null, water: null };
  var bed = new THREE.Mesh(new THREE.PlaneGeometry(bx * 2, r.zS - r.zN + 8),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(r.bed || '#4a4438') }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, -0.85, (r.zS + r.zN) / 2); scene.add(bed);

  var waterGeo = new THREE.PlaneGeometry(bx * 2, r.zS - r.zN - 1, 110, 10);
  var water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
    color: new THREE.Color(r.water || '#3a6a72'), specular: 0x88b8b8, shininess: 90, transparent: true, opacity: .93
  }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.45, (r.zS + r.zN) / 2); scene.add(water);
  var waterBase = waterGeo.attributes.position.array.slice();

  for (var zi = 0; zi < 2; zi++) {
    var zz = [r.zS, r.zN][zi];
    var wall = box(bx * 2, 1.0, 1.2, M.stoneDark);
    wall.position.set(0, -0.4, zz + (zz === r.zS ? -0.55 : 0.55)); scene.add(wall);
    var cap = box(bx * 2, 0.14, 1.5, M.stone);
    cap.position.set(0, 0.07, zz + (zz === r.zS ? -0.55 : 0.55)); scene.add(cap);
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

export function makeBridge(scene, M, TX, world) {
  var b = world.bridge, rv = world.river;
  var zStart = rv.zS + 3, zEnd = rv.zN - 3, zLen = zStart - zEnd;
  var mid = (zStart + zEnd) / 2, half = (zStart - zEnd) / 2;
  var gh = function (z) { var t = (z - mid) / half; return b.h * Math.cos(t * Math.PI / 2); };
  var g = new THREE.Group();
  var SEG = 40, W = b.half + 0.1;
  var verts = [], uvs = [], idx = [];
  for (var i = 0; i <= SEG; i++) {
    var z = zStart - (zLen * i / SEG), y = gh(z);
    verts.push(b.x - W, y, z, b.x + W, y, z);
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
    for (var j = 0; j <= SEG; j++) {
      var zz = zStart - (zLen * j / SEG), yy = gh(zz);
      sv.push(b.x + s * W, yy, zz, b.x + s * W, yy - 1.35, zz);
      su.push(0, j / SEG * 10, 1, j / SEG * 10);
      if (j < SEG) { var aa = j * 2; svi.push(aa, aa + 2, aa + 1, aa + 1, aa + 2, aa + 3); }
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
    sg.setIndex(svi); sg.computeVertexNormals();
    var skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: TX.plankTex, side: THREE.DoubleSide }));
    skirt.castShadow = true; g.add(skirt);
  }

  for (var zr = zStart; zr > zEnd; zr -= 2) {
    var z2 = zr - 2, h1 = gh(zr), h2 = gh(z2);
    var len = Math.hypot(2, h2 - h1);
    for (var si2 = 0; si2 < 2; si2++) {
      var side = si2 === 0 ? -3.4 : 3.4;
      var rail = box(0.16, 0.14, len + 0.06, M.woodRed);
      rail.position.set(b.x + side, (h1 + h2) / 2 + 1.0, (zr + z2) / 2);
      rail.rotation.x = Math.atan2(h2 - h1, 2); g.add(rail);
      var post = box(0.16, 1.05, 0.16, M.woodRed);
      post.position.set(b.x + side, h1 + 0.5, zr); g.add(post);
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), M.woodDark);
      cap.position.set(b.x + side, h1 + 1.1, zr); cap.castShadow = true; g.add(cap);
    }
  }

  var pts = [];
  for (var k = 0; k <= 20; k++) {
    var zk = zEnd + (zLen * k / 20);
    pts.push(new THREE.Vector3(b.x, gh(zk) - 1.7, zk));
  }
  var archCurve = new THREE.CatmullRomCurve3(pts);
  for (var oi = 0; oi < 3; oi++) {
    var off = [-2.4, 0, 2.4][oi];
    var arch = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 24, 0.55, 8), M.woodRed);
    arch.position.x = off; arch.castShadow = true; g.add(arch);
  }
  var beamZ = [zEnd + 13, mid, zStart - 13];
  for (var zi3 = 0; zi3 < 3; zi3++) {
    var zc = beamZ[zi3];
    var beam = box(5.4, 0.3, 0.3, M.woodDark);
    beam.position.set(b.x, gh(zc) - 1.7, zc); g.add(beam);
  }
  scene.add(g);
}

/* ============================================================
   屋顶：卷棚曲线 + 起翘
============================================================ */
export function makeRoofGeo(w, d, h) {
  var over = 0.9;
  var shape = new THREE.Shape();
  shape.moveTo(-(w / 2 + over), 0);
  var N = 10;
  for (var i = 1; i <= N; i++) { var t = i / N; shape.lineTo(-(w / 2 + over) * (1 - t), h * Math.pow(t, 1.7)); }
  for (var j = N - 1; j >= 0; j--) { var t2 = j / N; shape.lineTo((w / 2 + over) * (1 - t2), h * Math.pow(t2, 1.7)); }
  shape.closePath();
  var geo = new THREE.ExtrudeGeometry(shape, { depth: d + 2 * over, bevelEnabled: false });
  geo.translate(0, 0, -(d + 2 * over) / 2);
  var pos = geo.attributes.position;
  var wx = w / 2, wz = d / 2;
  for (var p = 0; p < pos.count; p++) {
    var x = pos.getX(p), z = pos.getZ(p);
    var ox = Math.max(0, (Math.abs(x) - wx) / over);
    var oz = Math.max(0, (Math.abs(z) - wz) / over);
    pos.setY(p, pos.getY(p) + 0.7 * Math.pow(Math.min(1, ox) * Math.min(1, oz), 1.35));
  }
  geo.computeVertexNormals();
  return geo;
}

export function addRoof(g, w, d, y, h, M, detail, roofMat) {
  if (detail === undefined) detail = true;
  var roof = new THREE.Mesh(makeRoofGeo(w, d, h), roofMat || M.roof);
  roof.position.y = y; roof.castShadow = roof.receiveShadow = true; g.add(roof);
  var ridge = box(0.34, 0.3, d + 2.2, M.ridge); ridge.position.y = y + h + 0.12; g.add(ridge);
  for (var s = -1; s <= 1; s += 2) {
    // 鸱吻
    var owl = box(0.4, 0.7, 0.3, M.ridge);
    owl.position.set(0, y + h + 0.42, s * (d / 2 + 0.95)); owl.rotation.x = s * 0.25; g.add(owl);
    var owlTip = box(0.2, 0.4, 0.16, M.ridge);
    owlTip.position.set(0, y + h + 0.85, s * (d / 2 + 1.05)); owlTip.rotation.x = s * 0.5; g.add(owlTip);
  }
  if (!detail) return;
  // 檐口封板（前后）
  for (var s2 = -1; s2 <= 1; s2 += 2) {
    var eave = box(w + 2.0, 0.16, 0.12, M.woodDark);
    eave.position.set(0, y + 0.02, s2 * (d / 2 + 0.95)); g.add(eave);
  }
}

/* ============================================================
   建筑：木构架 + 斗拱 + 匾额 + 朱门
============================================================ */
export function makeBuilding(opt, M, TX) {
  var w = opt.w || 6, d = opt.d || 5, floors = opt.floors || 1;
  var plain = opt.plain, banner = opt.banner, awning = opt.awning, thatched = opt.thatched;
  var g = new THREE.Group();
  var baseH = 0.55, wallH = 2.85;
  // 砖台基
  var base = box(w + 1.2, baseH, d + 1.2, M.brick); base.position.y = baseH / 2; g.add(base);
  var y = baseH;
  for (var f = 0; f < floors; f++) {
    var fw = w * (f ? 0.86 : 1), fd = d * (f ? 0.86 : 1);
    // 墙身（灰泥）
    var wall = box(fw - 0.4, wallH, fd - 0.4, f ? M.plaster2 : M.plaster);
    wall.position.y = y + wallH / 2; g.add(wall);
    // 木柱（前后檐柱 + 角柱）
    var n = Math.max(2, Math.round(fw / 2.2));
    var colXs = [];
    for (var i = 0; i <= n; i++) colXs.push(-fw / 2 + (fw / n) * i);
    for (var ci = 0; ci < colXs.length; ci++) {
      var cx = colXs[ci];
      for (var zs = -1; zs <= 1; zs += 2) {
        var col = cyl(0.11, 0.13, wallH, M.woodRed);
        col.position.set(cx, y + wallH / 2, zs * (fd / 2 - 0.09)); g.add(col);
      }
    }
    for (var xs = -1; xs <= 1; xs += 2) {
      var ccol = cyl(0.12, 0.14, wallH, M.woodRed);
      ccol.position.set(xs * (fw / 2 - 0.09), y + wallH / 2, 0); g.add(ccol);
    }
    // 额枋（柱顶横木，前后）
    for (var zs2 = -1; zs2 <= 1; zs2 += 2) {
      var beamF = box(fw + 0.1, 0.2, 0.16, M.woodDark);
      beamF.position.set(0, y + wallH - 0.32, zs2 * (fd / 2 - 0.02)); g.add(beamF);
    }
    if (f === 0) {
      // 门：门框 + 双扇朱门 + 门槛 + 台阶
      var frame = box(1.6, 2.35, 0.12, M.woodDark); frame.position.set(0, y + 1.17, d / 2 - 0.02); g.add(frame);
      for (var ds = -1; ds <= 1; ds += 2) {
        var leaf = new THREE.Mesh(new THREE.BoxGeometry(0.62, 2.1, 0.08), M.door);
        leaf.position.set(ds * 0.33, y + 1.06, d / 2 + 0.05); leaf.castShadow = true; g.add(leaf);
      }
      var sill = box(1.7, 0.1, 0.22, M.wood); sill.position.set(0, y + 0.05, d / 2 + 0.1); g.add(sill);
      var step1 = box(2.0, 0.2, 0.7, M.stone); step1.position.set(0, 0.32, d / 2 + 0.5); g.add(step1);
      var step2 = box(2.4, 0.18, 1.1, M.stone); step2.position.set(0, 0.14, d / 2 + 0.75); g.add(step2);
      if (!plain) {
        for (var ss = -1; ss <= 1; ss += 2) {
          var cp = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1.5),
            new THREE.MeshLambertMaterial({ map: TX.coupletTex(ss < 0 ? '迎祥纳福' : '招财进宝') }));
          cp.position.set(ss * 1.12, y + 1.45, d / 2 + 0.03); g.add(cp);
        }
      }
      // 窗（棂格 + 木框）
      for (var ss2 = -1; ss2 <= 1; ss2 += 2) {
        var winF = box(1.7, 1.3, 0.07, M.woodDark);
        winF.position.set(ss2 * w * 0.27, y + 1.62, d / 2 + 0.01); g.add(winF);
        var win = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.08), M.lattice);
        win.position.set(ss2 * w * 0.27, y + 1.62, d / 2 + 0.03); win.castShadow = true; g.add(win);
      }
    } else {
      // 上层：槛窗带 + 寻杖栏杆意象
      for (var wf = -1; wf <= 1; wf++) {
        var win2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.08), M.lattice);
        win2.position.set(wf * fw * 0.26, y + 1.5, fd / 2 + 0.03); win2.castShadow = true; g.add(win2);
      }
      var rail = box(fw + 0.3, 0.09, 0.09, M.woodRed);
      rail.position.set(0, y + 0.75, fd / 2 + 0.35); g.add(rail);
      for (var rp = 0; rp <= n; rp++) {
        var rpost = box(0.08, 0.75, 0.08, M.woodRed);
        rpost.position.set(-fw / 2 + (fw / n) * rp, y + 0.37, fd / 2 + 0.35); g.add(rpost);
      }
    }
    y += wallH;
    if (f < floors - 1) {
      var band = box(fw + 0.5, 0.24, fd + 0.5, M.woodDark); band.position.y = y + 0.12; g.add(band); y += 0.24;
    }
  }
  // 斗拱（檐下栱垫，实例化一次成型）
  if (!plain) {
    var dgGeo = new THREE.BoxGeometry(0.36, 0.22, 0.36);
    var dgCount = colXs.length * 2;
    var dg = new THREE.InstancedMesh(dgGeo, M.woodDark, dgCount);
    var dummy = new THREE.Object3D(); var di = 0;
    for (var dgi = 0; dgi < colXs.length; dgi++) {
      for (var dzs = -1; dzs <= 1; dzs += 2) {
        dummy.position.set(colXs[dgi], y - 0.08, dzs * (d / 2 - 0.09));
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
        dg.setMatrixAt(di++, dummy.matrix);
      }
    }
    dg.count = di; dg.instanceMatrix.needsUpdate = true; dg.castShadow = true; g.add(dg);
  }
  addRoof(g, w, d, y, 1.45 + 0.25 * floors, M, !plain, thatched ? M.thatch : null);
  if (banner) {
    var pole = cyl(0.05, 0.05, 3.6, M.woodDark); pole.position.set(w / 2 + 0.7, 1.8, d / 2 + 0.3); g.add(pole);
    var arm = box(1.1, 0.08, 0.08, M.woodDark); arm.position.set(w / 2 + 0.35, 3.4, d / 2 + 0.3); g.add(arm);
    var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 2.1),
      new THREE.MeshLambertMaterial({ map: TX.bannerTex(banner), side: THREE.DoubleSide }));
    flag.position.set(w / 2 + 0.7 - 0.42, 2.3, d / 2 + 0.3); flag.castShadow = true; g.add(flag);
    // 门楣匾额
    var plaque = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 0.08),
      new THREE.MeshLambertMaterial({ map: TX.signTex(String(banner)) }));
    plaque.position.set(0, baseH + 2.62, d / 2 + 0.1); plaque.castShadow = true; g.add(plaque);
    for (var ss3 = -1; ss3 <= 1; ss3 += 2) {
      var lan = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), M.lantern);
      lan.scale.y = 0.8; lan.position.set(ss3 * (w / 2 - 0.5), baseH + 2.55, d / 2 + 0.45); g.add(lan);
      var cord = cyl(0.015, 0.015, 0.3, M.woodDark, 4);
      cord.position.set(ss3 * (w / 2 - 0.5), baseH + 2.85, d / 2 + 0.45); g.add(cord);
    }
  }
  if (awning) {
    var aw = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 1.6), M.awning);
    aw.position.set(0, baseH + wallH - 0.25, d / 2 + 0.8);
    aw.rotation.x = -0.5; aw.castShadow = true; g.add(aw);
  }
  return g;
}

// 摊位：只构建几何 + 碰撞，道具注册由上层负责
export function makeStall(scene, M, colliders, x, z, rot, goodsFn) {
  var g = new THREE.Group();
  for (var pi = 0; pi < 4; pi++) {
    var px = pi < 2 ? (pi === 0 ? -1.4 : 1.4) : (pi === 2 ? -1.4 : 1.4);
    var pz = pi % 2 === 0 ? -1 : 1;
    var p = cyl(0.06, 0.07, 2.3, M.woodDark);
    p.position.set(px, 1.15, pz); g.add(p);
  }
  // 人字顶棚
  for (var ts = -1; ts <= 1; ts += 2) {
    var top = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6), M.awning);
    top.rotation.x = -Math.PI / 2 + ts * 0.38;
    top.position.set(0, 2.42, ts * 0.68);
    top.castShadow = true; g.add(top);
  }
  var ridgeBar = box(3.5, 0.07, 0.07, M.woodDark); ridgeBar.position.y = 2.62; g.add(ridgeBar);
  var table = box(2.6, 0.12, 1.4, M.wood); table.position.y = 0.85; g.add(table);
  for (var s = -1; s <= 1; s += 2) { var leg = box(0.12, 0.85, 1.2, M.woodDark); leg.position.set(s * 1.1, 0.43, 0); g.add(leg); }
  if (goodsFn) goodsFn(g, M);
  g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
  colliders.push({ x: x, z: z, hw: 1.5, hd: 1.2 });
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
  var boat = { g: g, mast: mast, mastDown: 0, speed: withMast ? 1.1 : 0, phase: Math.random() * 6.28, baseX: x };
  boats.push(boat); return boat;
}

export function makeWillow(scene, M, x, z, s, colliders) {
  s = s || 1;
  var g = new THREE.Group(); var trunk = cyl(0.13 * s, 0.24 * s, 2.8 * s, M.woodDark); trunk.position.y = 1.4 * s; trunk.rotation.z = 0.09; g.add(trunk);
  var crown = new THREE.Group(); crown.position.y = 2.9 * s;
  for (var i = 0; i < 9; i++) { var p = new THREE.Mesh(new THREE.PlaneGeometry(2.8 * s, 3.4 * s), M.willow); var a = (i / 9) * Math.PI * 2; p.position.set(Math.cos(a) * 0.85 * s, -0.65 * s, Math.sin(a) * 0.85 * s); p.rotation.y = a + Math.PI / 2; crown.add(p); }
  var heart = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05 * s, 0), M.leafDark);
  heart.scale.y = 0.75; heart.position.y = 0.4 * s; heart.castShadow = true; crown.add(heart);
  g.add(crown); g.position.set(x, 0, z); g.rotation.y = Math.random() * 6.28; scene.add(g);
  if (colliders) colliders.push({ x: x, z: z, hw: 0.35, hd: 0.35 });
  return g;
}

export function makeTree(scene, M, x, z, s, dark, colliders) {
  s = s || 1;
  var g = new THREE.Group();
  var trunk = cyl(0.12 * s, 0.22 * s, 2.2 * s, M.woodDark); trunk.position.y = 1.1 * s; trunk.rotation.z = 0.05; g.add(trunk);
  var branch = cyl(0.07 * s, 0.1 * s, 1.1 * s, M.woodDark); branch.position.set(0.35 * s, 2.2 * s, 0); branch.rotation.z = -0.5; g.add(branch);
  var mat = dark ? M.leafDark : M.leaf, mat2 = dark ? M.leaf : M.leafDark;
  var blobs = [
    [0, 3.1, 0, 1.5, mat], [0.95, 2.5, 0.4, 1.05, mat2], [-0.85, 2.6, -0.35, 1.0, mat2],
    [0.15, 3.9, -0.2, 0.95, mat], [-0.3, 2.2, 0.7, 0.8, mat2],
  ];
  for (var i = 0; i < blobs.length; i++) {
    var b = blobs[i];
    var blob = new THREE.Mesh(new THREE.DodecahedronGeometry(b[3] * s, 0), b[4]);
    blob.position.set(b[0] * s, b[1] * s, b[2] * s);
    blob.scale.y = 0.82; blob.rotation.y = Math.random() * 3;
    blob.castShadow = true; g.add(blob);
  }
  g.position.set(x, 0, z); g.rotation.y = Math.random() * 6.28; scene.add(g);
  if (colliders) colliders.push({ x: x, z: z, hw: 0.35, hd: 0.35 });
  return g;
}

export function makeBamboo(scene, M, x, z, colliders) {
  var g = new THREE.Group(); var n = 8 + Math.random() * 5 | 0;
  for (var i = 0; i < n; i++) { var h = 4.5 + Math.random() * 2.5; var stalk = cyl(0.05, 0.07, h, M.bamboo, 6); stalk.position.set(Math.random() * 3 - 1.5, h / 2, Math.random() * 3 - 1.5); g.add(stalk); var top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6), M.leaf); top.position.copy(stalk.position); top.position.y = h + 0.3; g.add(top); }
  g.position.set(x, 0, z); scene.add(g);
  if (colliders) colliders.push({ x: x, z: z, hw: 1.6, hd: 1.6 });
  return g;
}

export function makeField(scene, M, x, z, w, d, _dummy) {
  var f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.tilled); f.rotation.x = -Math.PI / 2; f.position.set(x, 0.05, z); f.receiveShadow = true; scene.add(f);
  var geo = new THREE.PlaneGeometry(0.4, 0.5); geo.translate(0, 0.25, 0);
  var im = new THREE.InstancedMesh(geo, M.crop, 60); var n = 0;
  for (var ix = 0; ix < Math.floor(w / 1.2); ix++) for (var iz = 0; iz < Math.floor(d / 1.1); iz++) { if (n >= 60) break; _dummy.position.set(x - w / 2 + 0.8 + ix * 1.2, 0, z - d / 2 + 0.7 + iz * 1.1); _dummy.rotation.set(0, Math.random() * 6.28, 0); _dummy.scale.setScalar(0.8 + Math.random() * 0.5); _dummy.updateMatrix(); im.setMatrixAt(n, _dummy.matrix); n++; }
  im.count = n; im.instanceMatrix.needsUpdate = true; scene.add(im);
  return f;
}

/* ============================================================
   城墙 + 城门（可通行门洞）
   world.wall = { x, gateZ, both, h, t, nameE, nameW }
============================================================ */
export function makeCityWall(scene, M, TX, world, colliders) {
  var cfg = world.wall;
  if (!cfg || !cfg.x) return;
  var H = cfg.h || 8, T = cfg.t || 4;
  var gateZ = cfg.gateZ != null ? cfg.gateZ : 7;
  var gateHalf = cfg.gateHalf || 4.5;         // 门洞半宽
  var sides = cfg.both === false ? [1] : [1, -1];
  var zFar = world.boundary.zFar + 10, zNear = world.boundary.zNear - 10;
  var rv = world.river;

  for (var si = 0; si < sides.length; si++) {
    var sx = sides[si];
    var wx = sx * cfg.x;
    var gateName = sx > 0 ? (cfg.nameE || '东门') : (cfg.nameW || '西门');

    // ---- 墙体分段（避开河道与门洞） ----
    var gaps = [{ z1: gateZ - gateHalf, z2: gateZ + gateHalf }];
    if (rv) gaps.push({ z1: rv.zN, z2: rv.zS });
    gaps.sort(function (a, b) { return a.z1 - b.z1; });
    var segs = [], cur = zFar;
    for (var gi = 0; gi < gaps.length; gi++) {
      if (gaps[gi].z1 > cur) segs.push([cur, gaps[gi].z1]);
      cur = Math.max(cur, gaps[gi].z2);
    }
    if (cur < zNear) segs.push([cur, zNear]);

    for (var wi = 0; wi < segs.length; wi++) {
      var z1 = segs[wi][0], z2 = segs[wi][1], len = z2 - z1, mid = (z1 + z2) / 2;
      if (len < 2) continue;
      var wg = new THREE.Group();
      var bt = TX.brickTex.clone(); bt.needsUpdate = true; bt.repeat.set(Math.max(2, len / 8), 2.4);
      var wallMat = new THREE.MeshLambertMaterial({ map: bt });
      var body = box(T, H, len, wallMat); body.position.set(wx, H / 2, mid); wg.add(body);
      var baseW = box(T + 1.0, 1.4, len, M.brickDark); baseW.position.set(wx, 0.7, mid); wg.add(baseW);
      var top = box(T + 1.2, 0.5, len, M.slab); top.position.set(wx, H + 0.25, mid); wg.add(top);
      // 外侧垛口
      var merGeo = new THREE.BoxGeometry(0.6, 0.9, 1.3);
      var mCount = Math.max(1, Math.floor(len / 2.6));
      var merlons = new THREE.InstancedMesh(merGeo, M.brickDark, mCount);
      var dm = new THREE.Object3D();
      for (var mi = 0; mi < mCount; mi++) {
        dm.position.set(wx + sx * (T / 2 + 0.25), H + 0.95, z1 + 1.2 + mi * 2.6);
        dm.rotation.set(0, 0, 0); dm.scale.setScalar(1); dm.updateMatrix();
        merlons.setMatrixAt(mi, dm.matrix);
      }
      merlons.count = mCount; merlons.instanceMatrix.needsUpdate = true; merlons.castShadow = true; wg.add(merlons);
      // 内侧矮墙
      var par = box(0.4, 0.7, len, M.brickDark); par.position.set(wx - sx * (T / 2 - 0.1), H + 0.85, mid); wg.add(par);
      scene.add(wg);
      colliders.push({ x: wx, z: mid, hw: T / 2 + 0.3, hd: len / 2 });
    }

    // ---- 河岸两端敌楼 ----
    if (rv) {
      for (var bi = 0; bi < 2; bi++) {
        var bz = bi === 0 ? rv.zN : rv.zS;
        var bt2 = new THREE.Group();
        bt2.position.set(wx, 0, bz);
        var tower = box(6.5, H + 2, 6.5, M.brick); tower.position.set(0, (H + 2) / 2, 0); bt2.add(tower);
        var tbase = box(7.3, 1.5, 7.3, M.brickDark); tbase.position.set(0, 0.75, 0); bt2.add(tbase);
        addRoof(bt2, 7.5, 7.5, H + 2, 2.4, M, false);
        scene.add(bt2);
        colliders.push({ x: wx, z: bz, hw: 3.3, hd: 3.3 });
      }
    }

    // ---- 城门（组以门洞中心为原点，避免坐标错位） ----
    var gg = new THREE.Group();
    gg.position.set(wx, 0, gateZ);
    var pierD = 2.6, pierH = H;
    // 门墩（两侧）
    for (var ps = -1; ps <= 1; ps += 2) {
      var pz = ps * (gateHalf + pierD / 2);
      var pier = box(T + 2.4, pierH, pierD, M.brick); pier.position.set(0, pierH / 2, pz); gg.add(pier);
      var pbase = box(T + 3.2, 1.4, pierD + 0.8, M.brickDark); pbase.position.set(0, 0.7, pz); gg.add(pbase);
      colliders.push({ x: wx, z: gateZ + pz, hw: (T + 2.4) / 2, hd: pierD / 2 });
    }
    // 门洞上方墙体（过梁）
    var lintel = box(T + 2.4, 2.2, gateHalf * 2, M.brick);
    lintel.position.set(0, pierH - 1.1, 0); gg.add(lintel);

    // 城楼台基
    var plat = box(T + 3.8, 0.7, gateHalf * 2 + 5.5, M.slab);
    plat.position.set(0, H + 0.35, 0); gg.add(plat);
    // 城楼（重檐）
    var towerW = T + 2.6, towerD = gateHalf * 2 + 3.5, ty = H + 0.7;
    var tbody = box(towerW, 3.0, towerD, M.plaster); tbody.position.set(0, ty + 1.5, 0); gg.add(tbody);
    var tn = Math.max(2, Math.round(towerD / 2.2));
    for (var ti = 0; ti <= tn; ti++) {
      var tz = -towerD / 2 + (towerD / tn) * ti;
      for (var txs = -1; txs <= 1; txs += 2) {
        var tcol = cyl(0.12, 0.13, 3.0, M.woodRed);
        tcol.position.set(txs * (towerW / 2 - 0.08), ty + 1.5, tz); gg.add(tcol);
      }
    }
    // 下檐 + 上檐（重檐）
    addRoof(gg, towerW + 1.2, towerD + 1.2, ty + 0.1, 1.1, M, false);
    addRoof(gg, towerW + 0.4, towerD + 0.4, ty + 3.0, 2.2, M, true);
    // 门额（内外两面，嵌于过梁墙面）
    for (var ns = -1; ns <= 1; ns += 2) {
      var sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 4.2),
        new THREE.MeshLambertMaterial({ map: TX.signTex(gateName) }));
      sp.position.set(ns * (T / 2 + 1.22), pierH - 1.1, 0);
      sp.castShadow = true; gg.add(sp);
      // 门侧灯笼（左右各一）
      for (var ls2 = -1; ls2 <= 1; ls2 += 2) {
        var gl = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), M.lantern);
        gl.scale.y = 0.85; gl.position.set(ns * (T / 2 + 1.3), pierH - 2.3, ls2 * (gateHalf - 0.5));
        gl.castShadow = true; gg.add(gl);
        var gcord = cyl(0.015, 0.015, 0.5, M.woodDark, 4);
        gcord.position.set(ns * (T / 2 + 1.3), pierH - 1.85, ls2 * (gateHalf - 0.5)); gg.add(gcord);
      }
    }
    // 朱漆大门（敞开，贴门洞内壁）
    for (var ds2 = -1; ds2 <= 1; ds2 += 2) {
      var door = new THREE.Mesh(new THREE.BoxGeometry(T + 1.6, 5.2, 0.22), M.door);
      door.position.set(0, 2.6, ds2 * (gateHalf - 0.14));
      door.castShadow = door.receiveShadow = true; gg.add(door);
    }
    // 门前石狮（简化）
    for (var ls = -1; ls <= 1; ls += 2) {
      var lion = new THREE.Group();
      var lb = box(0.9, 0.5, 0.9, M.stone); lb.position.y = 0.25; lion.add(lb);
      var lbd = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), M.stone); lbd.scale.set(0.9, 1.1, 0.8); lbd.position.y = 1.0; lbd.castShadow = true; lion.add(lbd);
      var lhd = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), M.stone); lhd.position.set(0, 1.65, 0.18); lhd.castShadow = true; lion.add(lhd);
      lion.position.set(-sx * (T / 2 + 2.2), 0, ls * (gateHalf + 1.6));
      gg.add(lion);
      colliders.push({ x: wx - sx * (T / 2 + 2.2), z: gateZ + ls * (gateHalf + 1.6), hw: 0.6, hd: 0.6 });
    }
    scene.add(gg);
  }
}
