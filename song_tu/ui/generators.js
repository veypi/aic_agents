import * as THREE from './three.module.js';
import { C, box, cyl } from './engine.js';
import {
  addRoof, makeBuilding, makeStall, makeUmbrella, makeBoat,
  makeWillow, makeTree, makeBamboo, makeField,
} from './world.js';

export function buildMaterials(TX) {
  return {
    wood: new THREE.MeshLambertMaterial({ color: C.wood }),
    woodDark: new THREE.MeshLambertMaterial({ color: C.woodDark }),
    woodRed: new THREE.MeshLambertMaterial({ color: C.woodRed }),
    plaster: new THREE.MeshLambertMaterial({ map: TX.plasterTex }),
    plaster2: new THREE.MeshLambertMaterial({ map: TX.plasterTex, color: 0xd8ccb0 }),
    roof: new THREE.MeshLambertMaterial({ map: TX.roofTex, color: 0xf5f7fa }),
    ridge: new THREE.MeshLambertMaterial({ color: 0x464c54 }),
    stone: new THREE.MeshLambertMaterial({ color: C.stone }),
    stoneDark: new THREE.MeshLambertMaterial({ color: C.stoneDark }),
    brick: new THREE.MeshLambertMaterial({ map: TX.brickTex }),
    brickDark: new THREE.MeshLambertMaterial({ color: C.brickDark }),
    door: new THREE.MeshLambertMaterial({ map: TX.doorTex }),
    deck: new THREE.MeshLambertMaterial({ map: TX.deckTex }),
    slab: new THREE.MeshLambertMaterial({ map: TX.slabTex }),
    dirt: new THREE.MeshLambertMaterial({ map: TX.dirtTex }),
    awning: new THREE.MeshLambertMaterial({ map: TX.awningTex, side: THREE.DoubleSide }),
    lattice: new THREE.MeshLambertMaterial({ map: TX.latticeTex }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x5f7d42 }),
    leafDark: new THREE.MeshLambertMaterial({ color: 0x48663a }),
    thatch: new THREE.MeshLambertMaterial({ color: 0xa08a58 }),
    grassBlade: new THREE.MeshLambertMaterial({ map: TX.grassBladeTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }),
    flower: new THREE.MeshLambertMaterial({ map: TX.flowerTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }),
    reed: new THREE.MeshLambertMaterial({ color: 0x7a8a4a }),
    rock: new THREE.MeshLambertMaterial({ color: 0x8a867c }),
    bush: new THREE.MeshLambertMaterial({ color: 0x55703e }),
    bamboo: new THREE.MeshLambertMaterial({ color: 0x6a9a52 }),
    lotus: new THREE.MeshLambertMaterial({ color: 0x4a7a4a, side: THREE.DoubleSide }),
    tilled: new THREE.MeshLambertMaterial({ map: TX.tilledTex }),
    crop: new THREE.MeshLambertMaterial({ color: 0x6a9a4a, side: THREE.DoubleSide }),
    lantern: new THREE.MeshLambertMaterial({ color: C.lantern, emissive: 0x7a1408, emissiveIntensity: 0.55 }),
    willow: new THREE.MeshLambertMaterial({ map: TX.willowTex, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide }),
  };
}

function colorOf(c, fallback) {
  if (c == null) return fallback;
  if (typeof c === 'number') return c;
  return new THREE.Color(c).getHex();
}

// 摊上货物
function bunsFn(g, M) {
  for (var i = 0; i < 8; i++) {
    var b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshLambertMaterial({ color: 0xf0e6d0 }));
    b.position.set(-0.8 + (i % 4) * 0.32, 1, -0.3 + Math.floor(i / 4) * 0.4); g.add(b);
  }
  var st = box(0.9, 0.5, 0.9, M.woodDark); st.position.set(0.7, 1.15, 0); g.add(st);
}
function fabricsFn(g) {
  var cs = [0xa8463a, 0x4a5d7e, 0x5d6b5a, 0xb08a3e];
  cs.forEach(function (c, i) { var f = box(0.5, 0.16, 1, new THREE.MeshLambertMaterial({ color: c })); f.position.set(-0.9 + i * 0.6, 1, 0); g.add(f); });
}
function fruitsFn(g) {
  var cs = [0xc56a2a, 0xb13b2e, 0x8aa03e];
  for (var i = 0; i < 9; i++) {
    var f = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshLambertMaterial({ color: cs[i % 3] }));
    f.position.set(-0.7 + (i % 3) * 0.4, 1, -0.3 + Math.floor(i / 3) * 0.35); g.add(f);
  }
}
function potsFn(g, M) {
  for (var i = 0; i < 5; i++) { var p = cyl(0.14, 0.2, 0.4, M.stoneDark, 8); p.position.set(-0.8 + i * 0.4, 1.1, (i % 2) * 0.4 - 0.2); g.add(p); }
}
var GOODS = { buns: bunsFn, fabrics: fabricsFn, fruits: fruitsFn, pots: potsFn };

// 自由零件解释器
export function buildCustom(parts, M) {
  var g = new THREE.Group();
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var mat = p.mat && M[p.mat] ? M[p.mat] : new THREE.MeshLambertMaterial({ color: colorOf(p.color, 0x8a867c) });
    var mesh = null;
    if (p.type === 'box') mesh = new THREE.Mesh(new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]), mat);
    else if (p.type === 'cyl') mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.rt, p.rb, p.h, p.seg || 8), mat);
    else if (p.type === 'cone') mesh = new THREE.Mesh(new THREE.ConeGeometry(p.r, p.h, p.seg || 8), mat);
    else if (p.type === 'sphere') mesh = new THREE.Mesh(new THREE.SphereGeometry(p.r, p.seg || 10, p.seg2 || 8), mat);
    else if (p.type === 'plane') mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.size[0], p.size[1]), mat);
    if (!mesh) continue;
    if (p.pos) mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (p.rot) mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    if (p.scale != null) { if (Array.isArray(p.scale)) mesh.scale.set(p.scale[0], p.scale[1], p.scale[2]); else mesh.scale.setScalar(p.scale); }
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

function place(g, b) { g.position.set(b.x, 0, b.z); g.rotation.y = b.rot || 0; if (b.scale && b.scale !== 1) g.scale.setScalar(b.scale); return g; }

// 生成器：gen(b, ctx)，ctx = {M, TX, scene, colliders, props, boats, world, dummy}
export var GENERATORS = {
  building: function (b, ctx) {
    var m = b.model, g = makeBuilding(m, ctx.M, ctx.TX);
    place(g, b); ctx.scene.add(g);
    var r = Math.abs(Math.sin(b.rot || 0)) > 0.5;
    ctx.colliders.push({ x: b.x, z: b.z, hw: (r ? m.d || 5 : m.w || 6) / 2 + 0.4, hd: (r ? m.w || 6 : m.d || 5) / 2 + 0.4 });
    return g;
  },
  stall: function (b, ctx) {
    return makeStall(ctx.scene, ctx.M, ctx.colliders, b.x, b.z, b.rot || 0, GOODS[b.model.goods] || potsFn);
  },
  umbrella: function (b, ctx) {
    return makeUmbrella(ctx.scene, ctx.M, ctx.colliders, b.x, b.z, colorOf(b.model.color, 0xa8463a));
  },
  tree: function (b, ctx) { return makeTree(ctx.scene, ctx.M, b.x, b.z, b.model.s || b.scale || 1, !!b.model.dark, ctx.colliders); },
  willow: function (b, ctx) { return makeWillow(ctx.scene, ctx.M, b.x, b.z, b.model.s || b.scale || 1, ctx.colliders); },
  bamboo: function (b, ctx) { return makeBamboo(ctx.scene, ctx.M, b.x, b.z, ctx.colliders); },
  field: function (b, ctx) { return makeField(ctx.scene, ctx.M, b.x, b.z, b.model.w || 16, b.model.d || 8, ctx.dummy); },
  boat: function (b, ctx) { return makeBoat(ctx.scene, ctx.M, b.x, b.z, b.model.len || 8, !!b.model.mast, ctx.boats, b.model.yaw).g; },
  hill: function (b, ctx) {
    var h = b.model.h || 20, r = b.model.r || 60;
    var g = new THREE.Group();
    var mat = new THREE.MeshLambertMaterial({ color: 0x93a68d });
    var c1 = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), mat);
    c1.position.set(0, h / 2 - 2, 0); g.add(c1);
    var c2 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, h * 0.72, 11), new THREE.MeshLambertMaterial({ color: 0x8a9d84 }));
    c2.position.set(r * 0.45, h * 0.36 - 2, r * 0.2); g.add(c2);
    var c3 = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, h * 0.6, 10), new THREE.MeshLambertMaterial({ color: 0x9db096 }));
    c3.position.set(-r * 0.42, h * 0.3 - 2, -r * 0.25); g.add(c3);
    g.position.set(b.x, 0, b.z); g.rotation.y = (b.x * 13 + b.z * 7) % 3;
    ctx.scene.add(g); return g;
  },
  pagoda: function (b, ctx) {
    var M = ctx.M, pag = new THREE.Group();
    var ww = 7, yy = 0, tiers = b.model.tiers || 5;
    for (var t = 0; t < tiers; t++) {
      var body = box(ww, 3.2, ww, M.woodDark); body.position.y = yy + 1.6; pag.add(body);
      addRoof(pag, ww + 0.5, ww + 0.5, yy + 3.2, 1.6, M);
      yy += 4.4; ww *= 0.82;
    }
    var spire = cyl(0.06, 0.3, 3.4, M.ridge); spire.position.y = yy + 2.2; pag.add(spire);
    var orb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), M.lantern); orb.position.y = yy + 4; pag.add(orb);
    place(pag, b); ctx.scene.add(pag);
    ctx.colliders.push({ x: b.x, z: b.z, hw: 4.5, hd: 4.5 });
    return pag;
  },
  well: function (b, ctx) {
    var M = ctx.M, g = new THREE.Group();
    var rim = cyl(0.8, 0.9, 0.7, M.stone, 10); rim.position.y = 0.35; g.add(rim);
    for (var s = -1; s <= 1; s += 2) { var wp = box(0.12, 1.6, 0.12, M.woodDark); wp.position.set(s * 0.8, 0.8, 0); g.add(wp); }
    var wbar = cyl(0.06, 0.06, 1.7, M.woodDark); wbar.rotation.z = Math.PI / 2; wbar.position.y = 1.55; g.add(wbar);
    var bucket = box(0.3, 0.3, 0.3, M.wood); bucket.position.set(0.3, 0.15, 0.9); g.add(bucket);
    place(g, b); ctx.scene.add(g);
    ctx.colliders.push({ x: b.x, z: b.z, hw: 1, hd: 1 });
    return g;
  },
  oxcart: function (b, ctx) {
    var M = ctx.M, g = new THREE.Group();
    var obox = box(1.6, 0.18, 3.2, M.wood); obox.position.y = 1; g.add(obox);
    for (var s = -1; s <= 1; s += 2) {
      var rail = box(0.08, 0.5, 3.2, M.woodDark); rail.position.set(s * 0.8, 1.3, 0); g.add(rail);
      var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 14), M.woodDark);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 0.95, 0.75, 0); wheel.castShadow = true; g.add(wheel);
      var hub = cyl(0.14, 0.14, 0.2, M.wood); hub.rotation.z = Math.PI / 2; hub.position.set(s * 0.95, 0.75, 0); g.add(hub);
      var shaft = cyl(0.05, 0.06, 2.6, M.woodDark); shaft.rotation.x = Math.PI / 2 - 0.12; shaft.position.set(s * 0.5, 0.85, 2.6); g.add(shaft);
    }
    for (var i = 0; i < 4; i++) {
      var sack = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshLambertMaterial({ color: 0xb09a6a }));
      sack.scale.set(1, 0.65, 1.15); sack.position.set((i % 2) * 0.6 - 0.3, 1.25, -0.8 + Math.floor(i / 2) * 1.3); g.add(sack);
    }
    place(g, b); ctx.scene.add(g);
    ctx.colliders.push({ x: b.x, z: b.z, hw: 1.6, hd: 2.8 });
    return g;
  },
  sedan: function (b, ctx) {
    var M = ctx.M, g = new THREE.Group();
    var sbody = box(1.4, 1.6, 1.6, new THREE.MeshLambertMaterial({ color: 0x3f5e5a })); sbody.position.y = 1.3; g.add(sbody);
    addRoof(g, 1.6, 1.8, 2.2, 0.5, M);
    for (var s = -1; s <= 1; s += 2) { var sp = cyl(0.05, 0.05, 3.4, M.woodRed); sp.rotation.z = Math.PI / 2; sp.position.set(0, 0.9, s * 0.95); g.add(sp); }
    place(g, b); ctx.scene.add(g);
    ctx.colliders.push({ x: b.x, z: b.z, hw: 1.4, hd: 1.4 });
    return g;
  },
  scarecrow: function (b, ctx) {
    var M = ctx.M, g = new THREE.Group();
    var sp = cyl(0.05, 0.06, 2.2, M.woodDark); sp.position.y = 1.1; g.add(sp);
    var sa = box(1.4, 0.07, 0.07, M.woodDark); sa.position.y = 1.6; g.add(sa);
    var sc = cyl(0.2, 0.45, 1, M.thatch, 8); sc.position.y = 1.1; g.add(sc);
    var sh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshLambertMaterial({ color: 0xd8b880 })); sh.position.y = 1.95; g.add(sh);
    var hat = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.2, 10), new THREE.MeshLambertMaterial({ color: 0xb09a5e })); hat.position.y = 2.1; g.add(hat);
    place(g, b); ctx.scene.add(g);
    return g; // 无碰撞，仅可交互
  },
  lantern: function (b, ctx) {
    var M = ctx.M, g = new THREE.Group();
    var dir = b.model.dir || 1;
    var pole = cyl(0.07, 0.09, 4.2, M.woodDark); pole.position.y = 2.1; g.add(pole);
    var arm = box(1, 0.08, 0.08, M.woodDark); arm.position.set(dir * 0.4, 4, 0); g.add(arm);
    var lan = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), M.lantern); lan.scale.y = 0.85; lan.position.set(dir * 0.85, 3.7, 0); g.add(lan);
    place(g, b); ctx.scene.add(g);
    ctx.colliders.push({ x: b.x, z: b.z, hw: 0.25, hd: 0.25 });
    return g;
  },
  custom: function (b, ctx) {
    var g = buildCustom(b.model.parts || [], ctx.M);
    place(g, b); ctx.scene.add(g);
    if (b.collider) ctx.colliders.push({ x: b.x, z: b.z, hw: b.model.hw || 0.5, hd: b.model.hd || 0.5 });
    return g;
  },
};
