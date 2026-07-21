/**
 * ============================================================================
 * brep-kernel.js —— BrepView 几何内核（纯数据，无 DOM / 无渲染依赖）
 * ============================================================================
 *
 * 内容：
 *   1. 基础数学工具（向量 / 矩阵）
 *   2. GeomError 与内核执行控制（超时 / 中断）
 *   3. Shape —— 三角网格几何体（变换 / CSG / fillet / 统计）
 *   4. 二维轮廓工具（三角化 / 矩形 / 圆 / 圆角）
 *   5. 拉伸与旋转成型
 *   6. 图元（box / cylinder / cone / sphere / torus / pipe / gear）
 *   7. CSG 布尔运算（BSP 树）
 *   8. 网格导出器（STL / OBJ / BREP-JSON）
 *   9. @param 参数解析
 *  10. KERNEL_API —— 注入用户代码作用域的内核 API
 *  11. 格式化工具
 * ============================================================================
 */

/* ============================================================================
 * 一、基础数学工具
 * ========================================================================== */

const DEG2RAD = Math.PI / 180;

function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function vLength(a) { return Math.hypot(a[0], a[1], a[2]); }
function vNormalize(a) {
  const l = vLength(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function vLerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 行主序 4x4 矩阵 */
function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mat4Multiply(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}
function mat4Apply(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}
function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[3] = x; m[7] = y; m[11] = z;
  return m;
}
function mat4Scale(x, y, z) {
  const m = mat4Identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}
/** 绕任意单位轴旋转（Rodrigues），角度制 */
function mat4Rotate(axis, deg) {
  const [x, y, z] = vNormalize(axis);
  const t = deg * DEG2RAD;
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [
    c + x * x * C,     x * y * C - z * s, x * z * C + y * s, 0,
    y * x * C + z * s, c + y * y * C,     y * z * C - x * s, 0,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,     0,
    0, 0, 0, 1,
  ];
}

/* ============================================================================
 * 二、几何内核错误类型
 * ========================================================================== */

export class GeomError extends Error {
  constructor(message, { code = 'KERNEL_ERROR', recoverable = false, suggestion = '' } = {}) {
    super(message);
    this.name = 'GeomError';
    this.errorType = 'KERNEL_ERROR';
    this.code = code;
    this.recoverable = recoverable;
    this.suggestion = suggestion;
  }
}

/** 内核执行控制（超时 / 中断），由 BrepView.run 注入 */
const _kernelCtrl = { deadline: 0, aborted: false };
let _kernelCheckCounter = 0;
function kernelCheckpoint() {
  if ((++_kernelCheckCounter & 0xff) !== 0) return;
  if (_kernelCtrl.aborted) {
    throw new GeomError('计算已被用户中断', { code: 'ABORTED', recoverable: true, suggestion: '点击"运行"重新开始' });
  }
  if (_kernelCtrl.deadline && Date.now() > _kernelCtrl.deadline) {
    throw new GeomError('计算超时', { code: 'TIMEOUT', recoverable: true, suggestion: '请减小模型精度（如降低圆弧分段数）或简化布尔运算' });
  }
}

/* ============================================================================
 * 三、Shape —— 三角网格几何体（内核核心数据结构）
 * ========================================================================== */

let _shapeUid = 0;

export class Shape {
  /**
   * @param {Array<number>|Float32Array} positions 扁平的 xyz 顶点数组
   * @param {Array<number>|Uint32Array}  indices   三角形索引
   * @param {object|null} meta 生成元数据（用于 fillet 等参数化操作）
   */
  constructor(positions, indices, meta = null) {
    this.id = ++_shapeUid;
    this.positions = positions instanceof Float32Array ? positions : Float32Array.from(positions);
    this.indices = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
    this.meta = meta; // { kind, params, matrix }
  }

  get vertexCount() { return this.positions.length / 3; }
  get triangleCount() { return this.indices.length / 3; }

  clone() {
    return new Shape(
      Float32Array.from(this.positions),
      Uint32Array.from(this.indices),
      this.meta ? { ...this.meta, matrix: [...(this.meta.matrix || mat4Identity())], params: { ...this.meta.params } } : null,
    );
  }

  /* ---------- 几何统计 ---------- */

  bounds() {
    const p = this.positions;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
    return { min, max };
  }

  /** 有符号四面体体积求和（自动取绝对值） */
  volume() {
    const p = this.positions, idx = this.indices;
    let v = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      v +=
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return Math.abs(v / 6);
  }

  area() {
    const p = this.positions, idx = this.indices;
    let s = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      s += vLength(vCross(ab, ac)) / 2;
    }
    return s;
  }

  /** 唯一边统计（用于属性面板） */
  edgeCount() {
    const idx = this.indices;
    const set = new Set();
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = idx[i + k], b = idx[i + ((k + 1) % 3)];
        set.add(a < b ? a * 0x100000000 + b : b * 0x100000000 + a);
      }
    }
    return set.size;
  }

  /* ---------- 变换（链式，原地修改并返回 this） ---------- */

  _applyMatrix(m) {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i]     = m[0] * x + m[1] * y + m[2] * z + m[3];
      p[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
      p[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    }
    if (this.meta) {
      this.meta.matrix = mat4Multiply(m, this.meta.matrix || mat4Identity());
    }
    return this;
  }

  translate(x = 0, y = 0, z = 0) { return this._applyMatrix(mat4Translate(x, y, z)); }
  scale(x = 1, y, z) {
    if (y === undefined) { y = x; z = x; }
    return this._applyMatrix(mat4Scale(x, y, z));
  }
  rotateX(deg) { return this._applyMatrix(mat4Rotate([1, 0, 0], deg)); }
  rotateY(deg) { return this._applyMatrix(mat4Rotate([0, 1, 0], deg)); }
  rotateZ(deg) { return this._applyMatrix(mat4Rotate([0, 0, 1], deg)); }
  rotate(axis, deg) { return this._applyMatrix(mat4Rotate(axis, deg)); }

  /* ---------- 布尔运算（CSG） ---------- */

  fuse(other) { return _csgCombine(this, other, 'union'); }
  cut(other) { return _csgCombine(this, other, 'subtract'); }
  intersect(other) { return _csgCombine(this, other, 'intersect'); }

  /* ---------- 圆角 ----------
   * 支持：box / 任意拉伸体（对截面多边形的凸角倒圆）。
   * 其他类型返回警告并保持不变。
   */
  fillet(radius = 1, segments = 5) {
    const meta = this.meta;
    if (!meta) {
      this._warning = `fillet: 该几何体经过布尔运算，内置内核不支持对其倒圆角（已忽略）`;
      return this;
    }
    if (meta.kind === 'box') {
      const { w, d, h } = meta.params;
      const r = Math.min(radius, w / 2 - 1e-6, d / 2 - 1e-6);
      const profile = roundedRectProfile(w, d, r, segments);
      const out = extrudeProfile(profile, h);
      out._applyMatrix(meta.matrix || mat4Identity());
      return out;
    }
    if (meta.kind === 'extrude') {
      const r = radius;
      const profile = roundProfileCorners(meta.params.profile, r, segments);
      const out = extrudeProfile(profile, meta.params.height);
      out._applyMatrix(meta.matrix || mat4Identity());
      return out;
    }
    this._warning = `fillet: 内置内核暂不支持对 ${meta.kind} 倒圆角（已忽略）`;
    return this;
  }

  toJSON() {
    return {
      positions: Array.from(this.positions),
      indices: Array.from(this.indices),
    };
  }
}

/** 顶点焊接：消除 CSG 输出的重复顶点，减小网格体积 */
function weldShape(positions, precision = 1e4) {
  const map = new Map();
  const outPos = [];
  const outIdx = [];
  const triCount = positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = `${Math.round(positions[o] * precision)},${Math.round(positions[o + 1] * precision)},${Math.round(positions[o + 2] * precision)}`;
      let idx = map.get(key);
      if (idx === undefined) {
        idx = outPos.length / 3;
        map.set(key, idx);
        outPos.push(positions[o], positions[o + 1], positions[o + 2]);
      }
      outIdx.push(idx);
    }
  }
  return { positions: outPos, indices: outIdx };
}

/* ============================================================================
 * 四、二维轮廓工具
 * ========================================================================== */

function polygonSignedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function ensureCCW(pts) {
  return polygonSignedArea(pts) < 0 ? [...pts].reverse() : pts;
}

/** 耳切法三角化（支持简单凹多边形），返回索引三元组 */
function triangulateProfile(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  const tris = [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inTri = (p, a, b, c) => {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return d1 > -1e-9 && d2 > -1e-9 && d3 > -1e-9;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 100 * n) {
    let earFound = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue; // 凹角或退化
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(pts[j], a, b, c)) { ok = false; break; }
      }
      if (ok) {
        tris.push([ia, ib, ic]);
        idx.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break; // 兜底：扇形三角化
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  else for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
  return tris;
}

/** 矩形轮廓（中心在原点） */
function rectProfile(w, d) {
  return [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2],
  ];
}

/** 圆轮廓 */
function circleProfile(r, segments = 48) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

/** 圆角矩形轮廓 */
function roundedRectProfile(w, d, r, cornerSeg = 5) {
  const pts = [];
  const hw = w / 2, hd = d / 2;
  const corners = [
    [hw - r, hd - r, 0],
    [-hw + r, hd - r, Math.PI / 2],
    [-hw + r, -hd + r, Math.PI],
    [hw - r, -hd + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= cornerSeg; i++) {
      const t = start + (i / cornerSeg) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  return ensureCCW(pts);
}

/** 对任意凸/凹多边形的凸角倒圆 */
function roundProfileCorners(profile, r, seg = 5) {
  const pts = ensureCCW(profile);
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const e1 = [cur[0] - prev[0], cur[1] - prev[1]];
    const e2 = [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const u1 = [e1[0] / l1, e1[1] / l1];
    const u2 = [e2[0] / l2, e2[1] / l2];
    const crossZ = u1[0] * u2[1] - u1[1] * u2[0];
    if (crossZ <= 1e-9) { out.push(cur); continue; } // 凹角或共线，保持尖锐
    const dot = Math.min(1, Math.max(-1, u1[0] * u2[0] + u1[1] * u2[1]));
    const theta = Math.acos(dot); // 转角
    const half = theta / 2;
    const trim = Math.min(r / Math.tan(half), l1 * 0.49, l2 * 0.49);
    const rEff = trim * Math.tan(half);
    const a = [cur[0] - u1[0] * trim, cur[1] - u1[1] * trim];
    const b = [cur[0] + u2[0] * trim, cur[1] + u2[1] * trim];
    // 圆心：角平分线方向，距顶点 rEff/sin(half)
    const bis = vNormalize([u2[0] - u1[0], u2[1] - u1[1], 0]);
    const center = [cur[0] + bis[0] * (rEff / Math.sin(half)), cur[1] + bis[1] * (rEff / Math.sin(half))];
    const a0 = Math.atan2(a[1] - center[1], a[0] - center[0]);
    const a1 = Math.atan2(b[1] - center[1], b[0] - center[0]);
    let delta = a1 - a0;
    while (delta > 0) delta -= Math.PI * 2; // 顺时针弧
    while (delta < -Math.PI * 2) delta += Math.PI * 2;
    for (let k = 0; k <= seg; k++) {
      const t = a0 + (delta * k) / seg;
      out.push([center[0] + rEff * Math.cos(t), center[1] + rEff * Math.sin(t)]);
    }
  }
  return ensureCCW(out);
}

/* ============================================================================
 * 五、拉伸与旋转成型
 * ========================================================================== */

/** 沿 Z 轴拉伸二维轮廓（-h/2 ~ +h/2），生成封闭棱柱 */
function extrudeProfile(profile, height) {
  const pts = ensureCCW(profile);
  const n = pts.length;
  const h2 = height / 2;
  const positions = [];
  const indices = [];
  // 底环 0..n-1（z=-h2），顶环 n..2n-1（z=+h2）
  for (const [x, y] of pts) positions.push(x, y, -h2);
  for (const [x, y] of pts) positions.push(x, y, h2);
  // 侧面
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  // 顶盖（法线 +Z，CCW）
  const caps = triangulateProfile(pts);
  for (const [a, b, c] of caps) indices.push(n + a, n + b, n + c);
  // 底盖（法线 -Z，反向）
  for (const [a, b, c] of caps) indices.push(a, c, b);
  return new Shape(positions, indices, {
    kind: 'extrude',
    params: { profile: pts.map((p) => [...p]), height },
    matrix: mat4Identity(),
  });
}

/**
 * 绕 Z 轴旋转成型（lathe）。
 * profile: [[半径, z], ...]，closed=true 时首尾相连（可生成管道等中空体）。
 */
function revolveProfile(profile, segments = 64, closed = false) {
  let pts = profile.filter((p, i) => i === 0 || Math.hypot(p[0] - profile[i - 1][0], p[1] - profile[i - 1][1]) > 1e-9);
  const M = pts.length;
  const positions = [];
  const indices = [];
  for (const [r, z] of pts) {
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      positions.push(r * Math.cos(t), r * Math.sin(t), z);
    }
  }
  const rowPairs = closed ? M : M - 1;
  for (let j = 0; j < rowPairs; j++) {
    const j2 = (j + 1) % M;
    for (let i = 0; i < segments; i++) {
      const i2 = (i + 1) % segments;
      const a = j * segments + i;
      const b = j * segments + i2;
      const c = j2 * segments + i2;
      const d = j2 * segments + i;
      // 过滤极点处的退化三角形
      if (pts[j][0] !== 0) indices.push(a, b, c);
      if (pts[j2][0] !== 0) indices.push(a, c, d);
    }
  }
  return new Shape(positions, indices, {
    kind: 'revolve',
    params: { profile: pts.map((p) => [...p]), segments, closed },
    matrix: mat4Identity(),
  });
}

/* ============================================================================
 * 六、图元（kernel API）
 * ========================================================================== */

/** 立方体，中心在原点 */
function box(w = 10, d = w, h = d) {
  const shape = extrudeProfile(rectProfile(w, d), h);
  shape.meta = { kind: 'box', params: { w, d, h }, matrix: mat4Identity() };
  return shape;
}

/** 圆柱，轴向为 Z，中心在原点 */
function cylinder(r = 5, h = 10, segments = 48) {
  const shape = revolveProfile([[r, -h / 2], [r, h / 2]], segments);
  // 补上下端盖
  const pos = Array.from(shape.positions);
  const idx = Array.from(shape.indices);
  const addCap = (z, flip) => {
    const cIdx = pos.length / 3;
    pos.push(0, 0, z);
    for (let i = 0; i < segments; i++) {
      const i2 = (i + 1) % segments;
      const row = z > 0 ? segments : 0; // 顶行或底行
      if (flip) idx.push(cIdx, row + i2, row + i);
      else idx.push(cIdx, row + i, row + i2);
    }
  };
  addCap(-h / 2, true);  // 底盖，法线 -Z
  addCap(h / 2, false);  // 顶盖，法线 +Z
  const out = new Shape(pos, idx, { kind: 'cylinder', params: { r, h, segments }, matrix: mat4Identity() });
  return out;
}

/** 圆台/圆锥，轴向为 Z（rBottom 在 -Z 端） */
function cone(rBottom = 5, rTop = 0, h = 10, segments = 48) {
  const parts = [];
  const shape = revolveProfile([[rBottom, -h / 2], [rTop, h / 2]], segments);
  const pos = Array.from(shape.positions);
  const idx = Array.from(shape.indices);
  if (rBottom > 1e-9) {
    const c = pos.length / 3;
    pos.push(0, 0, -h / 2);
    for (let i = 0; i < segments; i++) idx.push(c, (i + 1) % segments, i);
  }
  if (rTop > 1e-9) {
    const c = pos.length / 3;
    pos.push(0, 0, h / 2);
    for (let i = 0; i < segments; i++) idx.push(c, segments + i, segments + ((i + 1) % segments));
  }
  return new Shape(pos, idx, { kind: 'cone', params: { rBottom, rTop, h, segments }, matrix: mat4Identity() });
}

/** 球体，中心在原点 */
function sphere(r = 5, segments = 48, rings = 24) {
  const profile = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    profile.push([r * Math.sin(phi), -r * Math.cos(phi)]);
  }
  const shape = revolveProfile(profile, segments);
  shape.meta = { kind: 'sphere', params: { r, segments, rings }, matrix: mat4Identity() };
  return shape;
}

/** 圆环（主半径 R，截面半径 r），绕 Z 轴 */
function torus(R = 8, r = 2, segments = 48, tubeSeg = 24) {
  const profile = [];
  for (let i = 0; i <= tubeSeg; i++) {
    const t = (i / tubeSeg) * Math.PI * 2;
    profile.push([R + r * Math.cos(t), r * Math.sin(t)]);
  }
  const shape = revolveProfile(profile, segments, true);
  shape.meta = { kind: 'torus', params: { R, r, segments, tubeSeg }, matrix: mat4Identity() };
  return shape;
}

/** 圆管（空心圆柱），轴向为 Z */
function pipe(rOuter = 6, rInner = 4, h = 10, segments = 48) {
  const shape = revolveProfile(
    [[rOuter, -h / 2], [rOuter, h / 2], [rInner, h / 2], [rInner, -h / 2]],
    segments,
    true,
  );
  shape.meta = { kind: 'pipe', params: { rOuter, rInner, h, segments }, matrix: mat4Identity() };
  return shape;
}

/** 旋转成型（用户 API 别名） */
function revolve(profile, segments = 64) {
  return revolveProfile(profile, segments);
}
function lathe(profile, segments = 64) {
  return revolveProfile(profile, segments);
}

/** 齿轮轮廓（简化梯形齿）：module 模数, teeth 齿数 */
function gearProfile(teeth = 20, module = 2) {
  const rPitch = (module * teeth) / 2;
  const rTip = rPitch + module;
  const rRoot = Math.max(rPitch - 1.25 * module, module);
  const pts = [];
  const ta = (Math.PI * 2) / teeth;
  for (let t = 0; t < teeth; t++) {
    const a = t * ta;
    pts.push(
      [rRoot * Math.cos(a), rRoot * Math.sin(a)],
      [rRoot * Math.cos(a + 0.25 * ta), rRoot * Math.sin(a + 0.25 * ta)],
      [rTip * Math.cos(a + 0.4 * ta), rTip * Math.sin(a + 0.4 * ta)],
      [rTip * Math.cos(a + 0.6 * ta), rTip * Math.sin(a + 0.6 * ta)],
      [rRoot * Math.cos(a + 0.75 * ta), rRoot * Math.sin(a + 0.75 * ta)],
    );
  }
  return pts;
}

/* ---------- Sketch（二维草图 API，BrepJs 风格） ---------- */

export class Sketch {
  constructor(points) {
    this.points = ensureCCW(points);
  }
  /** 沿 Z 拉伸为实体（中心在 z=0） */
  extrude(height) {
    return extrudeProfile(this.points, height);
  }
}

function sketchRect(w = 10, h = 10) { return new Sketch(rectProfile(w, h)); }
function sketchCircle(r = 5, segments = 48) { return new Sketch(circleProfile(r, segments)); }
function sketchRoundedRect(w = 10, h = 10, r = 2, seg = 5) { return new Sketch(roundedRectProfile(w, h, r, seg)); }
function sketchPolygon(points) { return new Sketch(points); }

/* ============================================================================
 * 七、CSG 布尔运算（BSP 树实现，支持 并 fuse / 差 cut / 交 intersect）
 * ========================================================================== */

const CSG_EPSILON = 1e-5;

class CSGVertex {
  constructor(pos) { this.pos = pos; }
  clone() { return new CSGVertex([...this.pos]); }
  interpolate(other, t) { return new CSGVertex(vLerp(this.pos, other.pos, t)); }
}

class CSGPolygon {
  constructor(vertices) {
    this.vertices = vertices;
    this.plane = CSGPlane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  }
  clone() { return new CSGPolygon(this.vertices.map((v) => v.clone())); }
  flip() {
    this.vertices.reverse();
    this.plane.flip();
  }
}

class CSGPlane {
  constructor(normal, w) { this.normal = normal; this.w = w; }
  clone() { return new CSGPlane([...this.normal], this.w); }
  flip() { this.normal = vScale(this.normal, -1); this.w = -this.w; }
  static fromPoints(a, b, c) {
    const n = vNormalize(vCross(vSub(b, a), vSub(c, a)));
    return new CSGPlane(n, vDot(n, a));
  }
  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
    let polygonType = 0;
    const types = [];
    for (const v of polygon.vertices) {
      const t = vDot(this.normal, v.pos) - this.w;
      const type = t < -CSG_EPSILON ? BACK : t > CSG_EPSILON ? FRONT : COPLANAR;
      polygonType |= type;
      types.push(type);
    }
    switch (polygonType) {
      case COPLANAR:
        (vDot(this.normal, polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      case FRONT:
        front.push(polygon);
        break;
      case BACK:
        back.push(polygon);
        break;
      case SPANNING: {
        const f = [], b = [];
        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i], tj = types[j];
          const vi = polygon.vertices[i], vj = polygon.vertices[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
          if ((ti | tj) === SPANNING) {
            const t = (this.w - vDot(this.normal, vi.pos)) / vDot(this.normal, vSub(vj.pos, vi.pos));
            const v = vi.interpolate(vj, t);
            f.push(v);
            b.push(v.clone());
          }
        }
        if (f.length >= 3) front.push(new CSGPolygon(f));
        if (b.length >= 3) back.push(new CSGPolygon(b));
        break;
      }
    }
  }
}

class CSGNode {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }
  clone() {
    const node = new CSGNode();
    node.plane = this.plane ? this.plane.clone() : null;
    node.front = this.front ? this.front.clone() : null;
    node.back = this.back ? this.back.clone() : null;
    node.polygons = this.polygons.map((p) => p.clone());
    return node;
  }
  invert() {
    for (const p of this.polygons) p.flip();
    if (this.plane) this.plane.flip();
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
  }
  clipPolygons(polygons) {
    kernelCheckpoint();
    if (!this.plane) return polygons.slice();
    let front = [], back = [];
    for (const p of polygons) this.plane.splitPolygon(p, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }
  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }
  allPolygons() {
    let polygons = this.polygons.slice();
    if (this.front) polygons = polygons.concat(this.front.allPolygons());
    if (this.back) polygons = polygons.concat(this.back.allPolygons());
    return polygons;
  }
  build(polygons) {
    kernelCheckpoint();
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [], back = [];
    for (const p of polygons) {
      this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
    }
    if (front.length) {
      if (!this.front) this.front = new CSGNode();
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new CSGNode();
      this.back.build(back);
    }
  }
}

function shapeToCSGNode(shape) {
  const p = shape.positions, idx = shape.indices;
  const polygons = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = [p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2]];
    const b = [p[idx[i + 1] * 3], p[idx[i + 1] * 3 + 1], p[idx[i + 1] * 3 + 2]];
    const c = [p[idx[i + 2] * 3], p[idx[i + 2] * 3 + 1], p[idx[i + 2] * 3 + 2]];
    if (vLength(vCross(vSub(b, a), vSub(c, a))) < 1e-12) continue; // 跳过退化三角形
    polygons.push(new CSGPolygon([new CSGVertex(a), new CSGVertex(b), new CSGVertex(c)]));
  }
  return new CSGNode(polygons);
}

function csgNodeToShape(node) {
  const positions = [];
  for (const poly of node.allPolygons()) {
    const vs = poly.vertices;
    for (let i = 1; i < vs.length - 1; i++) {
      positions.push(...vs[0].pos, ...vs[i].pos, ...vs[i + 1].pos);
    }
  }
  const welded = weldShape(positions);
  return new Shape(welded.positions, welded.indices, null);
}

function _csgCombine(shapeA, shapeB, op) {
  if (!(shapeB instanceof Shape)) {
    throw new GeomError(`布尔运算 ${op} 需要另一个 Shape 作为参数`, {
      code: 'INVALID_OPERAND', recoverable: true, suggestion: '请检查参数是否为几何体',
    });
  }
  const a = shapeToCSGNode(shapeA);
  const b = shapeToCSGNode(shapeB);
  switch (op) {
    case 'union':
      a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
      a.build(b.allPolygons());
      break;
    case 'subtract':
      a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
      a.build(b.allPolygons());
      a.invert();
      break;
    case 'intersect':
      a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a);
      a.build(b.allPolygons());
      a.invert();
      break;
    default:
      throw new GeomError(`未知布尔运算: ${op}`, { code: 'INVALID_OP' });
  }
  const result = csgNodeToShape(a);
  if (result.triangleCount === 0) {
    throw new GeomError(`布尔运算 ${op} 产生了空几何体`, {
      code: 'EMPTY_RESULT', recoverable: true, suggestion: '请检查两个几何体是否相交',
    });
  }
  return result;
}

/* ============================================================================
 * 八、网格导出器（STL / OBJ / BREP-JSON；GLB 由 Three.js GLTFExporter 完成）
 * ========================================================================== */

function mergeShapes(shapes) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const s of shapes) {
    positions.push(...s.positions);
    for (const i of s.indices) indices.push(i + offset);
    offset += s.vertexCount;
  }
  return { positions, indices };
}

function toSTLBinary(shapes) {
  const { positions: p, indices: idx } = mergeShapes(shapes);
  const triCount = idx.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  let offset = 80;
  view.setUint32(offset, triCount, true);
  offset += 4;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = vNormalize(vCross(ab, ac));
    for (const val of n) { view.setFloat32(offset, val, true); offset += 4; }
    for (const vi of [a, b, c]) {
      view.setFloat32(offset, p[vi], true); offset += 4;
      view.setFloat32(offset, p[vi + 1], true); offset += 4;
      view.setFloat32(offset, p[vi + 2], true); offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'model/stl' });
}

function toSTLAscii(shapes) {
  const { positions: p, indices: idx } = mergeShapes(shapes);
  const lines = ['solid brepview'];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = vNormalize(vCross(ab, ac));
    lines.push(`  facet normal ${n.map((v) => v.toExponential(6)).join(' ')}`);
    lines.push('    outer loop');
    for (const vi of [a, b, c]) {
      lines.push(`      vertex ${p[vi].toExponential(6)} ${p[vi + 1].toExponential(6)} ${p[vi + 2].toExponential(6)}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid brepview');
  return new Blob([lines.join('\n')], { type: 'model/stl' });
}

function toOBJ(shapes) {
  const lines = ['# BrepView OBJ export'];
  let offset = 1;
  shapes.forEach((s, si) => {
    lines.push(`o part_${si}`);
    const p = s.positions;
    for (let i = 0; i < p.length; i += 3) lines.push(`v ${p[i]} ${p[i + 1]} ${p[i + 2]}`);
    const idx = s.indices;
    for (let i = 0; i < idx.length; i += 3) {
      lines.push(`f ${idx[i] + offset} ${idx[i + 1] + offset} ${idx[i + 2] + offset}`);
    }
    offset += s.vertexCount;
  });
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

function toBREPJSON(shapes) {
  return new Blob(
    [JSON.stringify({ format: 'BrepView-BREP/1', generator: 'BrepView fallback kernel', parts: shapes.map((s) => s.toJSON()) })],
    { type: 'application/json' },
  );
}

/* ============================================================================
 * 九、参数化面板：解析 @param 注释并生成 UI 数据
 *
 * 约定格式（写在 const 声明的上一行）：
 *   // @param width 房屋宽度 (mm) {min: 4000, max: 20000, step: 100}
 *   const width = 8000;
 * ========================================================================== */

const PARAM_RE = /\/\/\s*@param\s+([A-Za-z_$][\w$]*)\s+([^\n{]*?)\s*(\{[^}]*\})?\s*\n\s*(?:const|let|var)\s+\1\s*=\s*(-?[\d.]+)/g;

function parseParams(code) {
  const params = [];
  let m;
  PARAM_RE.lastIndex = 0;
  while ((m = PARAM_RE.exec(code)) !== null) {
    const opts = {};
    if (m[3]) {
      const optRe = /(\w+)\s*:\s*(-?[\d.]+)/g;
      let om;
      while ((om = optRe.exec(m[3])) !== null) opts[om[1]] = parseFloat(om[2]);
    }
    params.push({
      name: m[1],
      label: (m[2] || m[1]).trim(),
      value: parseFloat(m[4]),
      min: opts.min ?? 0,
      max: opts.max ?? (parseFloat(m[4]) * 3 || 100),
      step: opts.step ?? (Number.isInteger(parseFloat(m[4])) ? 1 : 0.1),
    });
  }
  return params;
}

function applyParamValue(code, name, value) {
  const re = new RegExp(`((?:const|let|var)\\s+${name.replace(/[$]/g, '\\$')}\\s*=\\s*)-?[\\d.]+`);
  return code.replace(re, `$1${value}`);
}

/* ============================================================================
 * 十、用户代码内核 API（注入到用户代码作用域）
 * ========================================================================== */

const KERNEL_API = {
  box, cylinder, cone, sphere, torus, pipe,
  lathe, revolve, gearProfile,
  sketchRect, sketchCircle, sketchPolygon, sketchRoundedRect,
  Sketch, Shape,
  deg2rad: (d) => d * DEG2RAD,
};

/* ============================================================================
 * 十一、格式化工具
 * ========================================================================== */

function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(3) + ' m³';
  if (v >= 1e6) return (v / 1e6).toFixed(3) + ' cm³';
  return v.toFixed(1) + ' mm³';
}
function fmtArea(a) {
  if (a >= 1e6) return (a / 1e6).toFixed(3) + ' m²';
  if (a >= 1e4) return (a / 1e4).toFixed(3) + ' cm²';
  return a.toFixed(1) + ' mm²';
}
function fmtLen(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(3) + ' m';
  return v.toFixed(1) + ' mm';
}

/* ============================================================================
 * 十二、导出
 * ========================================================================== */

export {
  KERNEL_API,
  parseParams, applyParamValue,
  toSTLBinary, toSTLAscii, toOBJ, toBREPJSON,
  fmtInt, fmtVol, fmtArea, fmtLen,
};
export { _kernelCtrl as kernelCtrl };
