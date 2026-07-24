import * as THREE from './three.module.js';
import { C, box, cyl } from './engine.js';
import { groundHeight } from './world.js';

var ROBES = [0x6b7f8a, 0x8a6f55, 0x4a5d7e, 0xcfc4a8, 0x5d6b5a, 0x9a6b4f, 0x7e6a8a, 0xa8845c];
var DRESSES = [0xd8b4b8, 0xa8c4c0, 0xe0d0a0, 0xb8a8c8];

/* ============================================================
   骨骼系统:肩→肘→手 / 胯→膝→足 / 脊→胸→颈→头
   每个关节是一个 THREE.Group,网格挂在关节上,
   后续所有动作（走/跳/舞/攻击/作揖）都驱动关节旋转。
============================================================ */
function J(parent, x, y, z) { var j = new THREE.Group(); j.position.set(x, y, z); j.userData.bp = [x, y, z]; parent.add(j); return j; }

export function makeRig(root) {
  var r = {};
  r.hips = J(root, 0, 0.98, 0);
  r.thighL = J(r.hips, -0.11, 0, 0); r.kneeL = J(r.thighL, 0, -0.44, 0); r.footL = J(r.kneeL, 0, -0.44, 0);
  r.thighR = J(r.hips, 0.11, 0, 0); r.kneeR = J(r.thighR, 0, -0.44, 0); r.footR = J(r.kneeR, 0, -0.44, 0);
  r.spine = J(root, 0, 1.14, 0);
  r.chest = J(r.spine, 0, 0.28, 0);
  r.neck = J(r.chest, 0, 0.30, 0);
  r.head = J(r.neck, 0, 0.12, 0);
  r.shoulderL = J(r.chest, -0.31, 0.15, 0); r.elbowL = J(r.shoulderL, 0, -0.42, 0); r.handL = J(r.elbowL, 0, -0.28, 0);
  r.shoulderR = J(r.chest, 0.31, 0.15, 0); r.elbowR = J(r.shoulderR, 0, -0.42, 0); r.handR = J(r.elbowR, 0, -0.28, 0);
  return r;
}

/* ============================================================
   动画剪辑:tracks = { 关节名: [[t01, rx, ry, rz], ...] }
   t01 ∈ [0,1],关键帧之间线性插值。
============================================================ */
export var CLIPS = {
  idle: {
    dur: 3.2, loop: true, tracks: {
      chest: [[0, 0, 0, 0], [0.5, 0.025, 0, 0], [1, 0, 0, 0]],
      head: [[0, 0, 0, 0], [0.5, 0.02, 0.04, 0], [1, 0, 0, 0]],
      shoulderL: [[0, 0, 0, 0.03], [0.5, 0.03, 0, 0.06], [1, 0, 0, 0.03]],
      shoulderR: [[0, 0, 0, -0.03], [0.5, 0.03, 0, -0.06], [1, 0, 0, -0.03]],
    }
  },
  walk: {
    dur: 1, loop: true, tracks: {
      thighL: [[0, 0, 0, 0], [0.25, -0.55, 0, 0], [0.5, 0, 0, 0], [0.75, 0.55, 0, 0], [1, 0, 0, 0]],
      thighR: [[0, 0, 0, 0], [0.25, 0.55, 0, 0], [0.5, 0, 0, 0], [0.75, -0.55, 0, 0], [1, 0, 0, 0]],
      kneeL: [[0, 0.15, 0, 0], [0.25, 0.05, 0, 0], [0.5, 0.15, 0, 0], [0.75, 0.7, 0, 0], [1, 0.15, 0, 0]],
      kneeR: [[0, 0.15, 0, 0], [0.25, 0.7, 0, 0], [0.5, 0.15, 0, 0], [0.75, 0.05, 0, 0], [1, 0.15, 0, 0]],
      footL: [[0, 0, 0, 0], [0.25, 0.15, 0, 0], [0.75, -0.2, 0, 0], [1, 0, 0, 0]],
      footR: [[0, 0, 0, 0], [0.25, -0.2, 0, 0], [0.75, 0.15, 0, 0], [1, 0, 0, 0]],
      shoulderL: [[0, 0, 0, 0], [0.25, 0.5, 0, 0.04], [0.5, 0, 0, 0], [0.75, -0.5, 0, 0.04], [1, 0, 0, 0]],
      shoulderR: [[0, 0, 0, 0], [0.25, -0.5, 0, -0.04], [0.5, 0, 0, 0], [0.75, 0.5, 0, -0.04], [1, 0, 0, 0]],
      elbowL: [[0, -0.2, 0, 0], [0.5, -0.35, 0, 0], [1, -0.2, 0, 0]],
      elbowR: [[0, -0.35, 0, 0], [0.5, -0.2, 0, 0], [1, -0.35, 0, 0]],
      chest: [[0, 0, 0, 0], [0.25, 0, 0.06, 0], [0.5, 0, 0, 0], [0.75, 0, -0.06, 0], [1, 0, 0, 0]],
      hips: [[0, 0, 0, 0], [0.25, 0, -0.05, 0.03], [0.5, 0, 0, 0], [0.75, 0, 0.05, -0.03], [1, 0, 0, 0]],
      skirt: [[0, 0, 0, 0], [0.25, 0, 0, 0.04], [0.5, 0, 0, 0], [0.75, 0, 0, -0.04], [1, 0, 0, 0]],
    }
  },
  jump: {
    dur: 0.5, loop: false, tracks: {
      thighL: [[0, 0, 0, 0], [0.4, -0.55, 0, 0], [1, -0.4, 0, 0]],
      thighR: [[0, 0, 0, 0], [0.4, -0.3, 0, 0], [1, -0.2, 0, 0]],
      kneeL: [[0, 0.1, 0, 0], [0.4, 0.95, 0, 0], [1, 0.75, 0, 0]],
      kneeR: [[0, 0.1, 0, 0], [0.4, 0.6, 0, 0], [1, 0.5, 0, 0]],
      shoulderL: [[0, 0, 0, 0.05], [0.4, -1.1, 0, 0.5], [1, -0.9, 0, 0.45]],
      shoulderR: [[0, 0, 0, -0.05], [0.4, -1.1, 0, -0.5], [1, -0.9, 0, -0.45]],
      chest: [[0, 0, 0, 0], [0.4, 0.12, 0, 0], [1, 0.1, 0, 0]],
    }
  },
  dance: {
    dur: 4.0, loop: true, tracks: {
      'hips@': [[0, 0, 0, 0], [0.125, 0, 0.03, 0], [0.25, 0, 0.07, 0], [0.375, 0, 0.02, 0], [0.5, 0, -0.06, 0], [0.625, 0, -0.05, 0], [0.75, 0, 0.05, 0], [0.875, 0, 0.02, 0], [1, 0, 0, 0]],
      hips: [[0, 0, 0, 0], [0.25, 0, 0.12, 0.05], [0.5, 0, -0.25, -0.07], [0.625, 0, -0.15, 0], [0.75, 0, 0.08, 0.04], [1, 0, 0, 0]],
      spine: [[0, 0.02, 0, 0], [0.25, -0.08, 0.08, 0], [0.5, 0.08, -0.1, 0], [0.75, -0.05, 0.04, 0], [1, 0.02, 0, 0]],
      chest: [[0, 0.03, 0, 0], [0.25, -0.14, 0.22, 0.04], [0.375, -0.05, 0.3, 0], [0.5, 0.1, -0.32, -0.05], [0.625, 0.14, -0.2, 0], [0.75, -0.08, 0.1, 0.03], [1, 0.03, 0, 0]],
      head: [[0, 0.04, 0, 0], [0.25, -0.2, 0.08, 0.1], [0.5, 0.1, -0.12, -0.12], [0.625, 0.12, 0, -0.06], [0.75, -0.1, 0.05, 0.08], [1, 0.04, 0, 0]],
      shoulderL: [[0, -0.3, 0, 0.3], [0.125, -0.8, 0, 1.2], [0.25, -1.5, 0, 2.4], [0.375, -0.9, 0.4, 1.5], [0.5, -0.5, 0, 0.6], [0.625, -2.0, 0.2, 0.7], [0.75, -0.7, 0, 1.8], [0.875, -0.4, 0, 0.9], [1, -0.3, 0, 0.3]],
      shoulderR: [[0, -0.3, 0, -0.3], [0.125, -0.8, 0, -1.2], [0.25, -1.5, 0, -2.4], [0.375, -1.6, -0.3, -1.8], [0.5, -1.0, 0, -0.9], [0.625, -1.8, -0.2, -0.6], [0.75, -0.7, 0, -1.8], [0.875, -0.4, 0, -0.9], [1, -0.3, 0, -0.3]],
      elbowL: [[0, -0.35, 0, 0.2], [0.25, -0.4, 0, 0.7], [0.5, -0.9, 0, 0.3], [0.625, -0.25, 0, 0.4], [0.75, -0.5, 0, 0.6], [1, -0.35, 0, 0.2]],
      elbowR: [[0, -0.35, 0, -0.2], [0.25, -0.4, 0, -0.7], [0.5, -0.6, 0, -0.8], [0.625, -0.3, 0, -0.35], [0.75, -0.5, 0, -0.6], [1, -0.35, 0, -0.2]],
      handL: [[0, 0, 0, 0], [0.25, -0.5, 0, 0.35], [0.5, -0.3, 0, 0.1], [0.625, -0.8, 0, 0], [0.75, 0.25, 0, -0.25], [1, 0, 0, 0]],
      handR: [[0, 0, 0, 0], [0.25, -0.5, 0, -0.35], [0.5, -0.35, 0, -0.2], [0.625, -0.8, 0, 0], [0.75, 0.25, 0, 0.25], [1, 0, 0, 0]],
      thighL: [[0, -0.05, 0, 0.03], [0.25, 0.08, 0, 0.05], [0.5, -0.4, 0, 0.1], [0.625, -0.3, 0, 0.05], [0.75, -0.1, 0, 0.05], [1, -0.05, 0, 0.03]],
      thighR: [[0, -0.05, 0, -0.03], [0.25, -0.12, 0, -0.05], [0.5, -0.35, 0, -0.1], [0.625, -0.25, 0, -0.05], [0.75, -0.15, 0, -0.05], [1, -0.05, 0, -0.03]],
      kneeL: [[0, 0.1, 0, 0], [0.25, 0.1, 0, 0], [0.5, 0.6, 0, 0], [0.625, 0.45, 0, 0], [0.75, 0.2, 0, 0], [1, 0.1, 0, 0]],
      kneeR: [[0, 0.1, 0, 0], [0.25, 0.25, 0, 0], [0.5, 0.55, 0, 0], [0.625, 0.4, 0, 0], [0.75, 0.3, 0, 0], [1, 0.1, 0, 0]],
      footL: [[0, 0, 0, 0], [0.25, -0.2, 0, 0], [0.5, 0.25, 0, 0], [0.75, -0.1, 0, 0], [1, 0, 0, 0]],
      footR: [[0, 0, 0, 0], [0.25, 0.15, 0, 0], [0.5, 0.3, 0, 0], [0.75, -0.05, 0, 0], [1, 0, 0, 0]],
      skirt: [[0, 0, 0, 0], [0.25, 0.05, 0, 0.1], [0.5, -0.06, 0, -0.13], [0.625, -0.03, 0, -0.06], [0.75, 0.04, 0, 0.08], [1, 0, 0, 0]],
    }
  },
  attack: {
    dur: 0.7, loop: false, tracks: {
      chest: [[0, 0, 0, 0], [0.3, 0.05, 0.5, 0], [0.58, 0.1, -0.45, 0], [1, 0, 0, 0]],
      shoulderR: [[0, 0, 0, 0], [0.3, -2.4, 0, -0.3], [0.58, 0.5, 0, -0.1], [1, 0, 0, 0]],
      elbowR: [[0, -0.3, 0, 0], [0.3, -1.3, 0, 0], [0.58, -0.05, 0, 0], [1, -0.3, 0, 0]],
      shoulderL: [[0, 0, 0, 0], [0.3, 0.5, 0, 0.3], [0.58, -0.4, 0, 0.1], [1, 0, 0, 0]],
      hips: [[0, 0, 0, 0], [0.3, 0, 0.3, 0], [0.58, 0, -0.25, 0], [1, 0, 0, 0]],
      thighL: [[0, 0, 0, 0], [0.3, -0.2, 0, 0], [0.58, 0.15, 0, 0], [1, 0, 0, 0]],
      kneeL: [[0, 0.1, 0, 0], [0.3, 0.4, 0, 0], [0.58, 0.2, 0, 0], [1, 0.1, 0, 0]],
    }
  },
  bow: {
    dur: 1.4, loop: false, tracks: {
      spine: [[0, 0, 0, 0], [0.3, 0.55, 0, 0], [0.7, 0.55, 0, 0], [1, 0, 0, 0]],
      head: [[0, 0, 0, 0], [0.3, 0.3, 0, 0], [0.7, 0.3, 0, 0], [1, 0, 0, 0]],
      shoulderL: [[0, 0, 0, 0], [0.3, -0.55, 0, 0.1], [0.7, -0.55, 0, 0.1], [1, 0, 0, 0]],
      shoulderR: [[0, 0, 0, 0], [0.3, -0.55, 0, -0.1], [0.7, -0.55, 0, -0.1], [1, 0, 0, 0]],
      elbowL: [[0, 0, 0, 0], [0.3, -0.4, 0, 0], [0.7, -0.4, 0, 0], [1, 0, 0, 0]],
      elbowR: [[0, 0, 0, 0], [0.3, -0.4, 0, 0], [0.7, -0.4, 0, 0], [1, 0, 0, 0]],
    }
  },
  talk: {
    dur: 2.4, loop: true, tracks: {
      head: [[0, 0, 0, 0], [0.25, 0.08, 0.06, 0], [0.5, 0, 0, 0], [0.75, 0.06, -0.05, 0], [1, 0, 0, 0]],
      shoulderR: [[0, -0.15, 0, -0.06], [0.5, -0.4, 0, -0.12], [1, -0.15, 0, -0.06]],
      elbowR: [[0, -0.3, 0, 0], [0.5, -0.7, 0, 0], [1, -0.3, 0, 0]],
      chest: [[0, 0, 0, 0], [0.5, 0.03, 0.03, 0], [1, 0, 0, 0]],
    }
  },
};

/* ============================================================
   动画器:播放剪辑、循环/单次、手动相位（走路防滑步）、淡入过渡
============================================================ */
export function makeAnimator(joints) {
  var cur = null, curName = '', time = 0, manual = false, t01manual = 0;
  var fadeT = 1, FADE = 0.15, prevPose = null;
  var Z3 = [0, 0, 0];

  function sample(clip, t01) {
    var pose = {};
    for (var j in clip.tracks) {
      var tr = clip.tracks[j], n = tr.length, k = 0;
      while (k < n - 2 && t01 > tr[k + 1][0]) k++;
      var a = tr[k], b = tr[k + 1] || tr[n - 1];
      var span = (b[0] - a[0]) || 1, f = Math.min(1, Math.max(0, (t01 - a[0]) / span));
      pose[j] = [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
    return pose;
  }

  var api = {
    play: function (name, opts) {
      opts = opts || {};
      if (curName === name && !opts.force) { manual = !!opts.manual; return; }
      if (cur) prevPose = sample(cur, cur.loop ? (time / cur.dur) % 1 : Math.min(1, time / cur.dur));
      cur = CLIPS[name]; curName = name; time = 0; manual = !!opts.manual; t01manual = 0;
      fadeT = prevPose ? 0 : 1;
    },
    setT01: function (t) { t01manual = t - Math.floor(t); },
    current: function () { return curName; },
    update: function (dt) {
      if (!cur) return;
      if (!manual) time += dt;
      var t01 = manual ? t01manual : (cur.loop ? (time / cur.dur) % 1 : Math.min(1, time / cur.dur));
      var pose = sample(cur, t01);
      var a = 1;
      if (fadeT < 1) { fadeT = Math.min(1, fadeT + dt / FADE); a = fadeT; }
      for (var j in joints) {
        var jt = joints[j], t = pose[j] || Z3, p = (prevPose && prevPose[j]) || Z3;
        jt.rotation.set(p[0] + (t[0] - p[0]) * a, p[1] + (t[1] - p[1]) * a, p[2] + (t[2] - p[2]) * a);
        var bp = jt.userData && jt.userData.bp;
        if (bp) {
          var tp = pose[j + '@'] || Z3, pp = (prevPose && prevPose[j + '@']) || Z3;
          jt.position.set(bp[0] + pp[0] + (tp[0] - pp[0]) * a, bp[1] + pp[1] + (tp[1] - pp[1]) * a, bp[2] + pp[2] + (tp[2] - pp[2]) * a);
        }
      }
      if (fadeT >= 1) prevPose = null;
    },
  };
  return api;
}

/* ============================================================
   人物装配:骨骼 + 服饰网格
============================================================ */
export function makePerson(opt, skinColor) {
  var robe = opt.robe || 0x6b7f8a, hat = opt.hat || 'futou', female = opt.female, scale = opt.scale || 1;
  var style = opt.style || 'robe';
  var g = new THREE.Group();
  var R = makeRig(g);
  var robeMat = new THREE.MeshLambertMaterial({ color: robe });
  var trimMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(robe).multiplyScalar(0.66) });
  var topMat = female ? new THREE.MeshLambertMaterial({ color: 0xead9b8 }) : robeMat;
  var sleeveMat = female ? topMat : robeMat;
  var cuffMat = female ? robeMat : trimMat;
  var pantsMat = new THREE.MeshLambertMaterial({ color: opt.pants || 0x5a5148 });
  var bindMat = new THREE.MeshLambertMaterial({ color: 0xd8cbb0 });
  var black = new THREE.MeshLambertMaterial({ color: 0x201d1a });
  var skinMat = new THREE.MeshLambertMaterial({ color: skinColor });
  var beltMat = new THREE.MeshLambertMaterial({ color: 0x3a3028 });
  var legMat = style === 'pants' ? pantsMat : robeMat;
  var wide = style !== 'pants';

  // ---- 腿（锥形腿，袍下隐约可见） ----
  for (var li = 0; li < 2; li++) {
    var s = li === 0 ? 'L' : 'R';
    var thigh = cyl(0.078, 0.066, 0.42, legMat, 10); thigh.position.y = -0.2; R['thigh' + s].add(thigh);
    var calf = cyl(0.062, 0.05, 0.42, legMat, 10); calf.position.y = -0.19; R['knee' + s].add(calf);
    if (style === 'pants') {
      for (var wb = 0; wb < 2; wb++) { var wrap = cyl(0.066, 0.062, 0.055, bindMat, 8); wrap.position.y = -0.11 - wb * 0.13; R['knee' + s].add(wrap); }
    }
    var shoe = box(0.11, 0.07, 0.23, black); shoe.position.set(0, -0.05, 0.045); R['foot' + s].add(shoe);
    var toe = box(0.1, 0.05, 0.07, black); toe.position.set(0, -0.032, 0.16); toe.rotation.x = -0.2; R['foot' + s].add(toe);
  }
  // ---- 下裳：曲面裙摆（腰部枢轴关节，舞动时裙摆可摇） ----
  var skirtJ = J(g, 0, 1.12, 0);
  var hemPts;
  if (female && style === 'robe') {
    hemPts = [[0.335, -0.96], [0.32, -0.85], [0.275, -0.55], [0.235, -0.2], [0.212, 0.1], [0.2, 0.26]];
  } else if (style === 'pants') {
    hemPts = [[0.255, -0.5], [0.245, -0.32], [0.22, -0.15], [0.2, 0]];
  } else {
    hemPts = [[0.325, -0.9], [0.29, -0.72], [0.25, -0.45], [0.22, -0.15], [0.2, 0.02]];
  }
  var skirtMat = robeMat.clone(); skirtMat.side = THREE.DoubleSide;
  var skirt = new THREE.Mesh(new THREE.LatheGeometry(hemPts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 14), skirtMat);
  skirt.castShadow = true; skirt.receiveShadow = true; skirtJ.add(skirt);
  if (style === 'robe') {
    var hemBand = cyl(female ? 0.315 : 0.305, female ? 0.34 : 0.33, 0.07, trimMat, 14);
    hemBand.position.y = female ? -0.92 : -0.865; skirtJ.add(hemBand);
    if (female) { var band = cyl(0.205, 0.215, 0.1, trimMat, 12); band.position.y = 0.235; skirtJ.add(band); }
  }
  // ---- 腰带 + 绦带 ----
  var belt = cyl(0.215, 0.225, 0.085, beltMat, 12); belt.position.y = 0; R.spine.add(belt);
  for (var sa = -1; sa <= 1; sa += 2) {
    var sash = box(0.05, 0.34, 0.015, beltMat);
    sash.position.set(sa * 0.05, -0.24, 0.212); sash.rotation.x = 0.09; R.spine.add(sash);
  }
  // ---- 上身 + 交领（缘边 + 衬里） ----
  var torso = cyl(0.19, 0.222, 0.55, topMat, 12); torso.position.y = -0.02; R.chest.add(torso);
  var linMat = new THREE.MeshLambertMaterial({ color: female ? 0xd8c8a8 : 0xe6dcc4 });
  for (var cs = -1; cs <= 1; cs += 2) {
    var collar = box(0.075, 0.32, 0.018, trimMat);
    collar.position.set(cs * 0.05, 0.12, 0.198); collar.rotation.z = cs * 0.52; collar.rotation.x = -0.08; R.chest.add(collar);
    var lining = box(0.028, 0.3, 0.02, linMat);
    lining.position.set(cs * 0.098, 0.12, 0.2); lining.rotation.z = cs * 0.52; lining.rotation.x = -0.08; R.chest.add(lining);
  }
  // ---- 袖：宽袖如翼（劳作窄袖），肩头球过渡 ----
  for (var ai = 0; ai < 2; ai++) {
    var s2 = ai === 0 ? 'L' : 'R';
    var capS = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), sleeveMat);
    capS.scale.set(1, 0.8, 1); capS.position.y = -0.02; capS.castShadow = true; R['shoulder' + s2].add(capS);
    if (wide) {
      var upper = cyl(0.085, 0.115, 0.4, sleeveMat, 10); upper.position.y = -0.19; R['shoulder' + s2].add(upper);
      var lower = cyl(0.115, 0.185, 0.3, sleeveMat, 10); lower.position.y = -0.12; R['elbow' + s2].add(lower);
      var cuffT = cyl(0.18, 0.19, 0.05, cuffMat, 10); cuffT.position.y = -0.26; R['elbow' + s2].add(cuffT);
    } else {
      var upper2 = cyl(0.075, 0.088, 0.4, sleeveMat, 10); upper2.position.y = -0.19; R['shoulder' + s2].add(upper2);
      var lower2 = cyl(0.085, 0.095, 0.28, sleeveMat, 10); lower2.position.y = -0.12; R['elbow' + s2].add(lower2);
      var cuffB = cyl(0.095, 0.1, 0.06, bindMat, 8); cuffB.position.y = -0.25; R['elbow' + s2].add(cuffB);
    }
    var hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skinMat);
    hand.position.y = -0.03; hand.castShadow = true; R['hand' + s2].add(hand);
  }
  // ---- 头（挂头关节） ----
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 12), skinMat);
  head.position.y = -0.02; head.castShadow = true; R.head.add(head);
  var hair = new THREE.Mesh(new THREE.SphereGeometry(0.172, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), black);
  hair.position.set(0, -0.005, -0.015); hair.rotation.x = -0.35; R.head.add(hair);
  // ---- 五官（眉眼唇，女性眉柔唇朱） ----
  var faceMat = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
  for (var es = -1; es <= 1; es += 2) {
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), faceMat);
    eye.scale.set(1, 1.35, 0.6); eye.position.set(es * 0.06, 0.008, 0.152); R.head.add(eye);
    var brow = box(0.052, 0.011, 0.01, faceMat);
    brow.position.set(es * 0.058, 0.055, 0.15); brow.rotation.z = es * (female ? -0.1 : -0.18); R.head.add(brow);
  }
  var mouth = box(0.042, 0.009, 0.01, new THREE.MeshLambertMaterial({ color: female ? 0xb14a3c : 0x9a5844 }));
  mouth.position.set(0, -0.062, 0.155); R.head.add(mouth);
  if (opt.beard) {
    var beardMat = new THREE.MeshLambertMaterial({ color: opt.beard === 'white' ? 0xd8d4c8 : 0x3a3028 });
    var beard = box(0.085, 0.13, 0.025, beardMat); beard.position.set(0, -0.14, 0.125); beard.rotation.x = 0.12; R.head.add(beard);
    var moustache = box(0.07, 0.018, 0.015, beardMat); moustache.position.set(0, -0.045, 0.155); R.head.add(moustache);
  }
  if (hat === 'futou') {
    var cap = cyl(0.165, 0.178, 0.14, black, 12); cap.position.y = 0.125; R.head.add(cap);
    for (var w = -1; w <= 1; w += 2) {
      var wing = box(0.26, 0.025, 0.045, black);
      wing.position.set(w * 0.27, 0.135, -0.01); wing.rotation.z = w * -0.12; R.head.add(wing);
    }
  } else if (hat === 'douli') {
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.2, 14), new THREE.MeshLambertMaterial({ color: 0xb8a060 }));
    cone.position.y = 0.16; cone.castShadow = true; R.head.add(cone);
    var knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), black); knob.position.y = 0.26; R.head.add(knob);
  } else if (hat === 'bun') {
    var hairBase = cyl(0.168, 0.172, 0.1, black, 12); hairBase.position.y = 0.08; R.head.add(hairBase);
    var bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), black); bun.position.y = 0.18; R.head.add(bun);
    var pin = cyl(0.012, 0.012, 0.22, new THREE.MeshLambertMaterial({ color: 0xc8a44a }), 4);
    pin.rotation.z = Math.PI / 2; pin.position.y = 0.18; R.head.add(pin);
    if (female) { var tail = box(0.16, 0.5, 0.06, black); tail.position.set(0, -0.22, -0.21); tail.rotation.x = 0.1; R.head.add(tail); }
  } else if (hat === 'scarf') {
    var sc = cyl(0.172, 0.18, 0.13, new THREE.MeshLambertMaterial({ color: 0x5a6a72 }), 12); sc.position.y = 0.1; R.head.add(sc);
    var knot = box(0.08, 0.08, 0.08, new THREE.MeshLambertMaterial({ color: 0x4a5a62 })); knot.position.set(0, 0.08, -0.19); R.head.add(knot);
  } else if (hat === 'monk') {
    var mc = cyl(0.16, 0.168, 0.06, new THREE.MeshLambertMaterial({ color: 0x3a3028 }), 12); mc.position.y = 0.08; R.head.add(mc);
  }
  g.scale.setScalar(scale);
  var joints = Object.assign({}, R, { skirt: skirtJ });
  var anim = makeAnimator(joints);
  anim.play('idle');
  g.userData = { rig: R, anim: anim, armL: R.shoulderL, armR: R.shoulderR, legL: R.thighL, legR: R.thighR, skirt: skirtJ, phase: Math.random() * 6.28 };
  return g;
}

/* ============================================================
   主角:月白襕衫 · 青缘大袖 · 皂靴 · 五官
============================================================ */
export function makeHero(skinColor) {
  var g = new THREE.Group();
  var R = makeRig(g);
  var whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2ede0 });
  var trimMat = new THREE.MeshLambertMaterial({ color: 0x33505c });
  var beltMat = new THREE.MeshLambertMaterial({ color: 0x2e2822 });
  var goldMat = new THREE.MeshLambertMaterial({ color: 0xc8a44a });
  var black = new THREE.MeshLambertMaterial({ color: 0x201d1a });
  var skinMat = new THREE.MeshLambertMaterial({ color: skinColor });

  // ---- 腿（白袴 + 皂靴） ----
  for (var li = 0; li < 2; li++) {
    var s = li === 0 ? 'L' : 'R';
    var thigh = cyl(0.08, 0.068, 0.42, whiteMat, 10); thigh.position.y = -0.2; R['thigh' + s].add(thigh);
    var calf = cyl(0.064, 0.052, 0.42, whiteMat, 10); calf.position.y = -0.19; R['knee' + s].add(calf);
    var boot = cyl(0.062, 0.058, 0.14, black, 10); boot.position.set(0, -0.02, 0); R['foot' + s].add(boot);
    var bootSole = box(0.115, 0.06, 0.25, black); bootSole.position.set(0, -0.055, 0.05); R['foot' + s].add(bootSole);
    var bootTip = box(0.1, 0.05, 0.07, black); bootTip.position.set(0, -0.03, 0.16); bootTip.rotation.x = -0.25; R['foot' + s].add(bootTip);
  }
  // ---- 襕衫袍摆（月白 + 青缘，腰部枢轴可摇） ----
  var skirtJ = J(g, 0, 1.12, 0);
  var skirtMat = whiteMat.clone(); skirtMat.side = THREE.DoubleSide;
  var skirt = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.33, -0.9), new THREE.Vector2(0.295, -0.72), new THREE.Vector2(0.25, -0.45),
    new THREE.Vector2(0.222, -0.15), new THREE.Vector2(0.2, 0.02)
  ], 14), skirtMat);
  skirt.castShadow = true; skirt.receiveShadow = true; skirtJ.add(skirt);
  var hemTrim = cyl(0.305, 0.335, 0.075, trimMat, 14); hemTrim.position.y = -0.865; skirtJ.add(hemTrim);
  // ---- 鞶带（金銙 + 玉佩） ----
  var belt = cyl(0.215, 0.225, 0.09, beltMat, 14); belt.position.y = 0; R.spine.add(belt);
  for (var bp = -1; bp <= 1; bp++) {
    var plaque = box(0.07, 0.06, 0.02, goldMat);
    plaque.position.set(bp * 0.1, 0, 0.222); R.spine.add(plaque);
  }
  var cord = box(0.03, 0.2, 0.015, new THREE.MeshLambertMaterial({ color: 0x9a2f2a }));
  cord.position.set(-0.14, -0.14, 0.26); R.spine.add(cord);
  var jade = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshLambertMaterial({ color: 0x6fa88a }));
  jade.position.set(-0.14, -0.26, 0.26); jade.castShadow = true; R.spine.add(jade);
  // ---- 上身 + 交领 ----
  var torso = cyl(0.19, 0.222, 0.55, whiteMat, 14); torso.position.y = -0.02; R.chest.add(torso);
  for (var cs = -1; cs <= 1; cs += 2) {
    var collar = box(0.1, 0.36, 0.022, trimMat);
    collar.position.set(cs * 0.052, 0.12, 0.198); collar.rotation.z = cs * 0.52; collar.rotation.x = -0.08; R.chest.add(collar);
    var collarEdge = box(0.03, 0.36, 0.024, whiteMat);
    collarEdge.position.set(cs * 0.112, 0.12, 0.2); collarEdge.rotation.z = cs * 0.52; collarEdge.rotation.x = -0.08; R.chest.add(collarEdge);
  }
  // ---- 大袖（层叠宽袖 + 青缘袖口） ----
  for (var ai = 0; ai < 2; ai++) {
    var s2 = ai === 0 ? 'L' : 'R';
    var capS = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), whiteMat);
    capS.scale.set(1, 0.8, 1); capS.position.y = -0.02; capS.castShadow = true; R['shoulder' + s2].add(capS);
    var upper = cyl(0.09, 0.125, 0.4, whiteMat, 10); upper.position.y = -0.19; R['shoulder' + s2].add(upper);
    var lower = cyl(0.125, 0.2, 0.3, whiteMat, 10); lower.position.y = -0.12; R['elbow' + s2].add(lower);
    var cuffTrim = cyl(0.195, 0.205, 0.055, trimMat, 10); cuffTrim.position.y = -0.26; R['elbow' + s2].add(cuffTrim);
    var hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skinMat);
    hand.position.y = -0.03; hand.castShadow = true; R['hand' + s2].add(hand);
  }
  // ---- 头 + 五官 ----
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 14), skinMat);
  head.position.y = -0.02; head.castShadow = true; R.head.add(head);
  var hair = new THREE.Mesh(new THREE.SphereGeometry(0.172, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), black);
  hair.position.set(0, -0.005, -0.015); hair.rotation.x = -0.35; R.head.add(hair);
  var faceMat = new THREE.MeshLambertMaterial({ color: 0x2a2018 });
  for (var es = -1; es <= 1; es += 2) {
    var eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), faceMat);
    eye.scale.set(1, 1.4, 0.6); eye.position.set(es * 0.062, 0.005, 0.155); R.head.add(eye);
    var brow = box(0.055, 0.012, 0.01, faceMat);
    brow.position.set(es * 0.06, 0.055, 0.152); brow.rotation.z = es * -0.18; R.head.add(brow);
  }
  var mouth = box(0.045, 0.01, 0.01, new THREE.MeshLambertMaterial({ color: 0xa8503c }));
  mouth.position.set(0, -0.065, 0.158); R.head.add(mouth);
  // ---- 幞头 ----
  var cap = cyl(0.165, 0.178, 0.15, black, 12); cap.position.y = 0.13; R.head.add(cap);
  for (var w = -1; w <= 1; w += 2) {
    var wing = box(0.28, 0.025, 0.045, black);
    wing.position.set(w * 0.28, 0.125, -0.01); wing.rotation.z = w * -0.18; R.head.add(wing);
    var wingTip = box(0.05, 0.02, 0.04, black);
    wingTip.position.set(w * 0.42, 0.15, -0.01); wingTip.rotation.z = w * -0.5; R.head.add(wingTip);
  }
  var joints = Object.assign({}, R, { skirt: skirtJ });
  var anim = makeAnimator(joints);
  anim.play('idle');
  g.userData = { rig: R, anim: anim, armL: R.shoulderL, armR: R.shoulderR, legL: R.thighL, legR: R.thighR, skirt: skirtJ, phase: Math.random() * 6.28 };
  return g;
}

var FALLBACK_ZONE = { x1: -40, x2: 40, z1: 2, z2: 12 };
function zoneRect(zones, key) { return (zones && zones[key]) || FALLBACK_ZONE; }

export function parseRow(row) {
  return {
    id: row.id, name: row.name, role: row.role || '', user_id: row.user_id || '',
    hat: row.hat || 'futou', female: !!row.female,
    persona: row.persona || '', zone: row.zone || 'street', city: row.city || '',
    fixed: !!row.fixed, loc: row.loc || '',
    portrait: typeof row.portrait === 'string' ? JSON.parse(row.portrait) : (row.portrait || {}),
    say: parseSay(row.say),
  };
}

function parseSay(v) {
  if (!v) return [];
  var arr;
  try { arr = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.map(function (it) { return { t: it.t || it.text || '', w: it.w != null ? Number(it.w) : 1, f: it.f != null ? Number(it.f) : 10 }; }).filter(function (it) { return it.t; });
}

export function spawnNPC(scene, M, npcs, row, zones, world, opts) {
  opts = opts || {};
  var d = parseRow(row);
  var robe = d.portrait.robe ? new THREE.Color(d.portrait.robe).getHex() : (d.female ? DRESSES[Math.random() * DRESSES.length | 0] : ROBES[Math.random() * ROBES.length | 0]);
  var scale = d.role === '孩童' ? 0.62 : 0.92 + Math.random() * 0.14;
  var PANTS = { '船夫': 1, '挑夫': 1, '脚夫': 1, '车夫': 1, '农夫': 1, '孩童': 1, '货郎': 1, '伙计': 1, '工匠': 1, '更夫': 1, '酒保': 1 };
  var style = PANTS[d.role] ? 'pants' : 'robe';
  var beard = d.role === '老者' ? 'white' : (d.portrait.beard ? 'dark' : null);
  var g = makePerson({ robe: robe, hat: d.hat, female: d.female, scale: scale, style: style, beard: beard }, C.skin);
  var r = zoneRect(zones, d.zone);
  var x, z;
  if (d.loc) { var p = d.loc.split(',').map(Number); x = p[0]; z = p[1]; }
  else {
    x = opts.x != null ? opts.x : (r.x1 + Math.random() * (r.x2 - r.x1));
    z = opts.z != null ? opts.z : (r.z1 + Math.random() * (r.z2 - r.z1));
    if (!opts.route) for (var t = 0; t < 20; t++) {
      var ok = true;
      for (var oi = 0; oi < npcs.length; oi++) if (Math.hypot(npcs[oi].g.position.x - x, npcs[oi].g.position.z - z) < 1.6) { ok = false; break; }
      if (ok) break; x = r.x1 + Math.random() * (r.x2 - r.x1); z = r.z1 + Math.random() * (r.z2 - r.z1);
    }
  }
  g.position.set(x, 0, z); g.rotation.y = Math.random() * 6.28;
  if (d.name) { var label = makeNameLabel(d.name); label.position.y = scale * 2.4; g.add(label); }
  var bubble = null;
  if (d.say.length) { bubble = makeSayBubble(); bubble.position.y = scale * 2.55; bubble.visible = false; g.add(bubble); }
  scene.add(g);
  var npc = {
    id: d.id, name: d.name, role: d.role, g: g, zone: d.zone, user_id: d.user_id,
    speed: d.role === '孩童' ? 2.3 : d.role === '老者' ? 0.8 : 1.1 + Math.random() * 0.5,
    tx: x, tz: z, idle: Math.random() * 3, walkPhase: Math.random() * 6.28,
    route: opts.route || null, routeIdx: 0, routeDir: 1,
    lane: Math.random() > 0.5 ? 1.3 : -1.3, stuck: 0, prevD: 1e9,
    persona: d.persona, portrait: d.portrait,
    fixed: d.fixed, talking: false,
    zones: zones, world: world,
    say: d.say, bubble: bubble, _sayTimer: 3 + Math.random() * 6, _sayShow: 0,
  };
  npcs.push(npc); return npc;
}

export function npcPickTarget(n) {
  var r = zoneRect(n.zones, n.zone);
  n.tx = r.x1 + Math.random() * (r.x2 - r.x1);
  n.tz = r.z1 + Math.random() * (r.z2 - r.z1);
}

function phaseTo01(ph) { var t = (ph / (Math.PI * 2)) % 1; return t < 0 ? t + 1 : t; }

export function updateNPC(n, dt, playerPos, npcs) {
  var world = n.world;
  var p = n.g.position;
  var anim = n.g.userData.anim;
  updateSay(n, dt);
  // 跳舞优先
  if (n._dance > 0) {
    n._dance -= dt;
    anim.play('dance');
    if (n._dance <= 0) anim.play('idle');
    anim.update(dt);
    return;
  }
  if (n._jumpVy != null || n._jump > 0) {
    if (n._jumpVy == null) { n._jumpVy = 8; n._jumpCount = n._jump; n._jump = 0; }
    n._jumpVy -= 20 * dt;
    p.y += n._jumpVy * dt;
    var gj = groundHeight(p.x, p.z, world);
    anim.play('jump');
    if (p.y <= gj) {
      p.y = gj; n._jumpCount--;
      if (n._jumpCount > 0) n._jumpVy = 8; else { n._jumpVy = null; n._jumpCount = 0; anim.play('idle'); }
    }
    anim.update(dt);
    return;
  }
  if (n.talking) {
    var tRot = Math.atan2(playerPos.x - p.x, playerPos.z - p.z); var dr = tRot - n.g.rotation.y;
    while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2;
    n.g.rotation.y += dr * Math.min(1, dt * 6);
    anim.play('talk'); anim.update(dt);
    if (n._jumpVy == null) p.y = groundHeight(p.x, p.z, world);
    return;
  }
  if (n.idle > 0) {
    n.idle -= dt;
    anim.play('idle'); anim.update(dt);
    if (n._jumpVy == null) p.y = groundHeight(p.x, p.z, world);
    return;
  }
  if (n.fixed) { anim.play('idle'); anim.update(dt); return; }
  var tx, tz;
  var rv = world.river, br = world.bridge;
  if (n.route) { tx = n.route[n.routeIdx][0]; tz = n.route[n.routeIdx][1]; if (rv && br && (tz <= rv.zS + 4 || p.z < rv.zS + 4)) tx = br.x + n.lane; }
  else { if (Math.hypot(n.tx - p.x, n.tz - p.z) < 0.5) npcPickTarget(n); tx = n.tx; tz = n.tz; }
  var dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
  if (dist < 0.4) { n.stuck = 0; if (n.route) { n.routeIdx += n.routeDir; if (n.routeIdx >= n.route.length || n.routeIdx < 0) { n.routeDir *= -1; n.routeIdx += n.routeDir * 2; } n.idle = 1 + Math.random() * 3; } else n.idle = 1.5 + Math.random() * 3.5; return; }
  if (dist > n.prevD - n.speed * dt * 0.25) n.stuck += dt; else n.stuck = Math.max(0, n.stuck - dt * 2);
  n.prevD = dist;
  if (n.stuck > 3.5) { n.stuck = 0; if (n.route) n.routeDir *= -1; else { npcPickTarget(n); n.idle = 0.4 + Math.random(); } return; }
  var vx = dx / dist * n.speed, vz = dz / dist * n.speed;
  p.x += vx * dt; p.z += vz * dt;
  for (var oi = 0; oi < npcs.length; oi++) { var o = npcs[oi]; if (o === n || o.talking) continue; var ox = p.x - o.g.position.x, oz = p.z - o.g.position.z, od = Math.hypot(ox, oz); if (od < 1 && od > 0.001) { var push = (1 - od) * dt * 5; p.x += ox / od * push; p.z += oz / od * push; p.x += -oz / od * push * 0.6; p.z += ox / od * push * 0.6; } }
  if (rv && br) {
    if (p.z < rv.zS + 0.3 && p.z > rv.zN - 0.3 && Math.abs(p.x - br.x) > br.half - 0.3) p.z = p.z > (rv.zS + rv.zN) / 2 ? rv.zS + 0.3 : rv.zN - 0.3;
    if (p.z <= rv.zS + 4 && p.z >= rv.zN - 4 && Math.abs(p.x - br.x) < br.half + 1) p.x = br.x + Math.sign(p.x - br.x || 0.01) * Math.min(Math.abs(p.x - br.x), br.half - 0.3);
  }
  var targetRot = Math.atan2(vx, vz); var dr2 = targetRot - n.g.rotation.y; while (dr2 > Math.PI) dr2 -= Math.PI * 2; while (dr2 < -Math.PI) dr2 += Math.PI * 2; n.g.rotation.y += dr2 * Math.min(1, dt * 8);
  n.walkPhase += dt * n.speed * 3.2;
  anim.play('walk', { manual: true });
  anim.setT01(phaseTo01(n.walkPhase));
  anim.update(dt);
  if (n._jumpVy == null) p.y = groundHeight(p.x, p.z, world) + Math.abs(Math.cos(n.walkPhase)) * 0.045;
}

// ---------- 头顶随机冒话气泡 ----------
var sayTexCache = {};
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function makeSayTexture(text) {
  if (sayTexCache[text]) return sayTexCache[text];
  var cv = document.createElement('canvas'); cv.width = 400; cv.height = 100;
  var g = cv.getContext('2d');
  g.fillStyle = 'rgba(248,242,222,.96)'; rr(g, 6, 6, 388, 76, 16); g.fill();
  g.strokeStyle = '#8a734c'; g.lineWidth = 3; rr(g, 6, 6, 388, 76, 16); g.stroke();
  g.fillStyle = 'rgba(248,242,222,.96)'; g.beginPath(); g.moveTo(188, 82); g.lineTo(212, 82); g.lineTo(200, 97); g.closePath(); g.fill();
  var fs = 34; g.fillStyle = '#3a3226'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold ' + fs + 'px "Ma Shan Zheng","STKaiti","Noto Serif SC",serif';
  while (g.measureText(text).width > 356 && fs > 16) { fs -= 2; g.font = 'bold ' + fs + 'px "Ma Shan Zheng","STKaiti","Noto Serif SC",serif'; }
  g.fillText(text, 200, 44);
  var tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
  sayTexCache[text] = tex; return tex;
}
function makeSayBubble() {
  var mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
  var sp = new THREE.Sprite(mat);
  sp.scale.set(2.6, 0.65, 1);
  sp.center.set(0.5, 0);
  return sp;
}
function setBubble(n, text) { n.bubble.material.map = makeSayTexture(text); n.bubble.material.needsUpdate = true; }
function pickSay(say) {
  var total = 0, i;
  for (i = 0; i < say.length; i++) total += say[i].w / Math.max(5, say[i].f);
  var r = Math.random() * total;
  for (i = 0; i < say.length; i++) { r -= say[i].w / Math.max(5, say[i].f); if (r <= 0) return say[i]; }
  return say[say.length - 1];
}
function updateSay(n, dt) {
  if (!n.bubble || !n.say || !n.say.length) return;
  if (n.talking) { n.bubble.visible = false; n._sayShow = 0; if (n._sayTimer < 2) n._sayTimer = 2; return; }
  if (n._sayShow > 0) { n._sayShow -= dt; if (n._sayShow <= 0) n.bubble.visible = false; }
  n._sayTimer -= dt;
  if (n._sayTimer <= 0) {
    var line = pickSay(n.say);
    setBubble(n, line.t);
    n.bubble.visible = true;
    n._sayShow = 1.0;
    n._sayTimer = Math.max(5, line.f) * (1.0 + Math.random() * 0.6);
  }
}

var portraitCache = {};
export function clearCaches() { portraitCache = {}; nameLabelCache = {}; sayTexCache = {}; }
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
  cv.width = 256; cv.height = 64;
  var g = cv.getContext('2d');
  g.font = 'bold 22px "Ma Shan Zheng", "STKaiti", "Noto Serif SC", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(20,16,10,.55)'; g.fillText(name, 129, 33);
  g.fillStyle = '#fff8ee'; g.fillText(name, 128, 32);
  var tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1);
  nameLabelCache[name] = sprite;
  return sprite.clone();
}