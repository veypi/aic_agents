/**
 * ============================================================================
 * BrepView —— 轻量级 Web 3D CAD 查看器（纯逻辑引擎，无 DOM / 无样式）
 * ============================================================================
 *
 * 职责边界：
 *   - 本文件只做「数据处理 + 相关事件」：几何内核执行、Three.js 渲染、
 *     选择 / 测量 / 剖切 / 导出等能力，并通过事件向外暴露状态。
 *   - 不创建任何 DOM / 样式 / 界面元素；UI 全部由宿主页面（index.html）实现。
 *   - 构造函数接收一个 <canvas> 元素作为渲染目标。
 *
 * 用法：
 *   import BrepView from './brepview.js';
 *   const viewer = new BrepView(canvasEl, { theme: 'light', shadows: true });
 *   viewer.on('shapeLoaded', (r) => { ... });
 *   await viewer.run('return box(50, 30, 20).fillet(4);');
 *
 * 事件（viewer.on(name, cb)）：
 *   ready                          初始化完成
 *   status    {type,text}          运行状态（type: ok | busy | error）
 *   shapeLoaded result             模型更新（run() 的成功 result）
 *   error     result               运行错误（success:false 的 result）
 *   warnings  string[]             非致命警告（如不支持的 fillet）
 *   reset                          场景已清空
 *   kernelChange {name,reverted?}  几何内核切换（OCCT 加载完成 / 失败回退）
 *   viewModeChange mode            视图模式变化
 *   projectionChange mode          投影变化（perspective | orthographic）
 *   themeChange theme              场景主题变化（light | dark）
 *   selectionChange array          选中部件变化 [{index,name,volume,area}]
 *   measure   result|null          测量完成 {distance,points,text}；null 表示清除
 *   measureModeChange bool         测量模式开关
 *   sectionRange {axis,min,max,value}  剖切范围（模型变化 / 进入剖面时触发）
 *   click     {partIndex,partName,point}  部件点击
 *   export    {blob,format}        导出完成
 * ============================================================================
 */

import * as THREE from './three.module.js';
import { OrbitControls } from './orbit-controls.js';
import { GLTFExporter } from './gltf-exporter.js';
import {
  GeomError, Shape, KERNEL_API, kernelCtrl,
  parseParams, applyParamValue,
  toSTLBinary, toSTLAscii, toOBJ, toBREPJSON,
  fmtInt, fmtVol, fmtArea, fmtLen,
} from './brep-kernel.js';

const DEG2RAD = Math.PI / 180;

export class BrepView {
  /**
   * @param {string|HTMLCanvasElement} canvas 画布选择器或元素
   * @param {object} options
   *   theme: 'light' | 'dark' | 'auto'   场景主题（只影响 3D 场景配色）
   *   antialias / shadows / grid / axes / groundPlane: 显示开关
   *   maxTriangles: 三角面警告上限
   *   transparency: 透明 / X 光模式的不透明度
   *   kernel: 外部内核（默认内置 KERNEL_API）
   *   onReady / onError / onShapeChange: 兼容回调（等价于同名事件）
   *   autoInit: false 时需手动 await init()
   */
  constructor(canvas, options = {}) {
    const el = typeof canvas === 'string' ? document.querySelector(canvas) : canvas;
    if (!el || !(el instanceof HTMLCanvasElement)) {
      throw new Error('BrepView: 需要一个 <canvas> 元素作为渲染目标');
    }
    this.canvas = el;
    this.options = {
      theme: 'light',
      antialias: true,
      shadows: true,
      grid: true,
      axes: true,
      groundPlane: true,
      maxTriangles: 1_000_000,
      transparency: 0.5,
      kernel: null,
      onReady: null,
      onError: null,
      onShapeChange: null,
      ...options,
    };

    // 运行状态
    this._theme = this.options.theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : this.options.theme;
    this._parts = [];            // [{ name, shape, color, mesh, edges, wire, visible }]
    this._result = null;         // 最近一次 run 的返回值
    this._running = false;
    this._code = '';             // 最近一次执行的代码
    this._viewMode = 'solid';
    this._projection = 'perspective';
    this._measureMode = false;
    this._measure = { points: [], objects: [] };
    this._selected = new Set();
    this._listeners = {};
    this._clip = { axis: 'XY', offset: 0, invert: false, plane: null };
    this._kernelName = 'builtin';    // 当前内核：builtin（内置 JS）| occt（WASM 高性能）| custom
    this._params = [];
    this._animFrame = null;
    this._downPos = null;

    if (this.options.autoInit !== false) {
      this._initPromise = this.init();
      this.ready = this._initPromise;
    }
  }

  /* ================= 事件系统 ================= */

  on(evt, cb) {
    (this._listeners[evt] ||= []).push(cb);
    return this;
  }
  addEventListener(evt, cb) { return this.on(evt, cb); }
  off(evt, cb) {
    const arr = this._listeners[evt];
    if (arr) this._listeners[evt] = arr.filter((f) => f !== cb);
    return this;
  }
  _emit(evt, ...args) {
    for (const cb of this._listeners[evt] || []) {
      try { cb(...args); } catch (e) { console.error(`[BrepView] ${evt} 事件回调出错`, e); }
    }
  }
  _emitStatus(type, text) {
    this._status = { type, text };
    this._emit('status', this._status);
  }

  /* ================= 初始化 ================= */

  async init() {
    if (this._initialized) return this;
    this._initThree();
    this._bindPointer();
    this._initialized = true;
    this._emitStatus('ok', '就绪');
    this._emit('ready');
    this.options.onReady?.();
    return this;
  }

  _frame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }

  /* ================= Three.js 场景 ================= */

  _initThree() {
    const o = this.options;
    const dark = this._theme === 'dark';

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: o.antialias });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = o.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(dark ? 0x10131a : 0xeef0f4);

    // CAD 约定：Z 轴向上
    this.perspCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
    this.perspCamera.up.set(0, 0, 1);
    this.perspCamera.position.set(140, -170, 110);
    this.orthoCamera = new THREE.OrthographicCamera(-100, 100, 100, -100, -1e5, 1e5);
    this.orthoCamera.up.set(0, 0, 1);
    this.orthoCamera.position.copy(this.perspCamera.position);
    this.camera = this.perspCamera;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 0);

    // 灯光
    this.hemiLight = new THREE.HemisphereLight(0xffffff, dark ? 0x20242c : 0xbfc5cf, 0.85);
    this.scene.add(this.hemiLight);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.keyLight.position.set(120, -100, 180);
    this.scene.add(this.keyLight);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
    fill.position.set(-120, 100, 60);
    this.scene.add(fill);

    // 网格 / 坐标轴 / 地面（Z-up：网格位于 XY 平面）
    this.gridHelper = new THREE.GridHelper(2000, 40, dark ? 0x39404e : 0xc8ccd4, dark ? 0x262b36 : 0xdfe2e8);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.gridHelper.visible = o.grid;
    this.scene.add(this.gridHelper);

    this.axesHelper = new THREE.AxesHelper(80);
    this.axesHelper.visible = o.axes;
    this.scene.add(this.axesHelper);

    this.groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.2 }),
    );
    this.groundMesh.position.z = -0.01;
    this.groundMesh.receiveShadow = true;
    this.groundMesh.visible = o.groundPlane;
    this.scene.add(this.groundMesh);

    this._applyShadows();

    // 模型分组
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.measureGroup = new THREE.Group();
    this.scene.add(this.measureGroup);

    this._materialProps = { color: '#8fa3bf', metalness: 0.1, roughness: 0.6 };

    // 尺寸自适应（画布由 CSS 控制显示尺寸，这里只同步绘图缓冲）
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.canvas);
    this._resize();

    // 渲染循环
    const loop = () => {
      this._rafId = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  _resize() {
    if (!this.renderer) return;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); // 不改 canvas.style，尺寸交给 CSS
    const aspect = w / h;
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();
    const halfH = this.orthoCamera.top;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.updateProjectionMatrix();
  }

  _applyShadows() {
    const on = !!this.options.shadows;
    if (this.renderer) this.renderer.shadowMap.enabled = on;
    this.keyLight.castShadow = on;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    for (const part of this._parts || []) {
      part.mesh.castShadow = on;
      part.mesh.receiveShadow = on;
      part.mesh.material.needsUpdate = true;
    }
  }

  /* ================= 指针 / 键盘交互（绑定在 canvas 上） ================= */

  _bindPointer() {
    const c = this.canvas;
    this._onPointerDown = (e) => { this._downPos = [e.clientX, e.clientY]; };
    this._onPointerUp = (e) => {
      if (!this._downPos) return;
      const moved = Math.hypot(e.clientX - this._downPos[0], e.clientY - this._downPos[1]);
      this._downPos = null;
      if (moved > 5 || e.target !== c) return;
      if (this._measureMode) this._measureClick(e);
      else this._selectClick(e);
    };
    this._onDblClick = (e) => {
      const hit = this._raycastParts(e);
      if (hit) this._fitToObject(hit.object);
    };
    this._onKeyDown = (e) => this._hotkeys(e);
    c.addEventListener('pointerdown', this._onPointerDown);
    c.addEventListener('pointerup', this._onPointerUp);
    c.addEventListener('dblclick', this._onDblClick);
    c.addEventListener('keydown', this._onKeyDown);
  }

  _hotkeys(e) {
    switch (e.key.toLowerCase()) {
      case 'f': this.fitToView(); break;
      case 'm': this.enableMeasurement(!this._measureMode); break;
      case 's': this.setViewMode(this._viewMode === 'section' ? 'solid' : 'section'); break;
      case 'escape':
        if (this._running) this.abort();
        else if (this._measureMode) this.enableMeasurement(false);
        break;
    }
  }

  /* ================= 代码执行 ================= */

  /**
   * 运行用户代码。
   * @param {string} code BrepJs 风格代码，需 return 一个 Shape / Shape[] / {name,shape,color}[]
   * @param {object} opts { timeout, onProgress }
   * @returns {Promise<object>} result（success / parts / stats / warnings / executionTime）
   */
  async run(code, opts = {}) {
    if (this._running) return this._result;
    this._running = true;
    this._code = code;
    this._emitStatus('busy', '编译中…');
    opts.onProgress?.(10);
    await this._frame(); // 让状态先绘制

    const t0 = performance.now();
    kernelCtrl.aborted = false;
    kernelCtrl.deadline = opts.timeout ? Date.now() + opts.timeout : 0;

    let result;
    try {
      const api = this.options.kernel || KERNEL_API;
      const names = Object.keys(api);
      const values = Object.values(api);
      // eslint-disable-next-line no-new-func
      const fn = new Function(...names, 'kernel', `"use strict";\n${code}`);
      const raw = fn(...values, api);
      opts.onProgress?.(60);

      const parts = this._normalizeResult(raw);
      const warnings = [];
      for (const p of parts) {
        if (p.shape._warning) warnings.push(p.shape._warning);
      }

      // 统计
      let volume = 0, area = 0, verts = 0, tris = 0, edges = 0;
      const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const p of parts) {
        volume += p.shape.volume();
        area += p.shape.area();
        verts += p.shape.vertexCount;
        tris += p.shape.triangleCount;
        edges += p.shape.edgeCount();
        const b = p.shape.bounds();
        for (let k = 0; k < 3; k++) {
          bounds.min[k] = Math.min(bounds.min[k], b.min[k]);
          bounds.max[k] = Math.max(bounds.max[k], b.max[k]);
        }
      }
      if (tris > this.options.maxTriangles) {
        warnings.push(`三角面数 ${fmtInt(tris)} 超过上限 ${fmtInt(this.options.maxTriangles)}，建议降低圆弧分段数`);
      }

      const executionTime = Math.round(performance.now() - t0);

      // 构建每个部件的摘要（去掉 positions/indices 坐标数据，AI 不需要）
      const partsSummary = parts.map((p) => {
        const pb = p.shape.bounds();
        const pVol = p.shape.volume();
        const pArea = p.shape.area();
        const pSize = pb.max.map((v, i) => v - pb.min[i]);
        return {
          name: p.name,
          color: p.color,
          volume: pVol,
          area: pArea,
          vertices: p.shape.vertexCount,
          triangles: p.shape.triangleCount,
          edges: p.shape.edgeCount(),
          boundingBox: { min: pb.min, max: pb.max, size: pSize },
          isSolid: p.shape.volume() > 0.001,
        };
      });

      // 复杂度评级：三角面密度
      const meshDensity = volume > 0.001 ? tris / volume : tris;
      let complexity;
      if (tris < 1000) complexity = 'low';
      else if (tris < 10000) complexity = 'medium';
      else if (tris < 50000) complexity = 'high';
      else complexity = 'very_high';

      const bboxSize = bounds.max.map((v, i) => v - bounds.min[i]);

      result = {
        success: true,
        parts: partsSummary,
        stats: {
          volume,
          area,
          boundingBox: { min: bounds.min, max: bounds.max, size: bboxSize },
          mesh: { vertices: verts, triangles: tris, edges, density: Math.round(meshDensity * 100) / 100, complexity },
          partCount: parts.length,
        },
        warnings,
        executionTime,
      };

      this._setParts(parts);
      this._result = result;
      this._emitStatus('ok', `就绪（${executionTime} ms）`);
      this._emit('shapeLoaded', result);
      this.options.onShapeChange?.(result);
      if (warnings.length) this._emit('warnings', warnings);
    } catch (err) {
      result = this._makeErrorResult(err, performance.now() - t0);
      this._result = result;
      this._emitStatus('error', '错误：' + (result.message || '未知错误'));
      this._emit('error', result);
      this.options.onError?.(result);
    } finally {
      kernelCtrl.deadline = 0;
      kernelCtrl.aborted = false;
      this._running = false;
      opts.onProgress?.(100);
    }
    return result;
  }

  _normalizeResult(raw) {
    const isShape = (obj) => obj && typeof obj.volume === 'function';
    const asPart = (item, i) => {
      if (isShape(item)) return { name: `部件 ${i + 1}`, shape: item, color: null };
      if (item && isShape(item.shape)) {
        return { name: item.name || `部件 ${i + 1}`, shape: item.shape, color: item.color || null };
      }
      throw new GeomError(
        `第 ${i + 1} 个返回值不是几何体（得到 ${typeof item}）`,
        { code: 'INVALID_RETURN', recoverable: true, suggestion: '代码需要 return box(...) 之类的几何体，或几何体数组' },
      );
    };
    if (isShape(raw)) return [asPart(raw, 0)];
    if (Array.isArray(raw)) {
      if (!raw.length) throw new GeomError('返回了空数组', { code: 'EMPTY_RETURN', recoverable: true });
      return raw.map(asPart);
    }
    throw new GeomError(
      `代码没有返回几何体（得到 ${raw === undefined ? 'undefined' : typeof raw}）`,
      { code: 'NO_RETURN', recoverable: true, suggestion: '请在代码末尾加上 return <几何体>' },
    );
  }

  _makeErrorResult(err, elapsed) {
    let line = null, column = null;
    const m = String(err.stack || '').match(/(?:<anonymous>|Function):(\d+):(\d+)/);
    if (m) {
      // V8 中 new Function 的函数头占 2 行 + 注入的 "use strict" 占 1 行
      line = Math.max(1, parseInt(m[1], 10) - 3);
      column = parseInt(m[2], 10);
    }
    if (err instanceof GeomError) {
      return {
        success: false, errorType: err.errorType, code: err.code,
        message: err.message, line, column,
        recoverable: err.recoverable, suggestion: err.suggestion,
        executionTime: Math.round(elapsed),
      };
    }
    if (err instanceof SyntaxError) {
      return {
        success: false, errorType: 'PARSE_ERROR',
        message: err.message, line, column,
        suggestion: line ? `请检查第 ${line} 行附近的语法（括号、逗号是否配对）` : '请检查代码语法',
        executionTime: Math.round(elapsed),
      };
    }
    return {
      success: false, errorType: 'RUNTIME_ERROR',
      message: err.message || String(err), line, column,
      recoverable: true,
      suggestion: line ? `错误发生在第 ${line} 行附近` : '',
      executionTime: Math.round(elapsed),
    };
  }

  /** 中断当前计算（对 CSG 等长循环生效） */
  abort() {
    if (this._running) {
      kernelCtrl.aborted = true;
      this._emitStatus('busy', '正在中断…');
    }
  }

  get running() { return this._running; }
  getCode() { return this._code; }
  getResult() { return this._result; }
  getStats() { return this._result && this._result.success ? this._result.stats : null; }

  get kernelName() { return this._kernelName; }

  /**
   * 运行时切换几何内核（如内置 JS 内核 → OCCT WASM 高性能内核）。
   * 切换后默认用最近执行的代码重建模型；若新内核运行失败则自动回退旧内核。
   * @param {object|null} kernel 内核 API 对象（null 表示回退内置内核）
   * @param {object} opts { name: 内核标识名, rerun: 是否立即重建 }
   */
  async setKernel(kernel, { name = 'custom', rerun = true } = {}) {
    const prevKernel = this.options.kernel;
    const prevName = this._kernelName;
    this.options.kernel = kernel;
    this._kernelName = name;
    this._emit('kernelChange', { name });
    if (rerun && this._code) {
      const r = await this.run(this._code);
      if (!r || !r.success) {
        console.warn(`[BrepView] 内核(${name})运行失败，回退(${prevName}):`, r && r.message);
        this.options.kernel = prevKernel;
        this._kernelName = prevName;
        this._emit('kernelChange', { name: prevName, reverted: true, error: r && r.message });
        await this.run(this._code);
        return { success: false, reverted: true, error: r };
      }
    }
    return { success: true, name };
  }

  /* ================= 场景内容管理 ================= */

  _setParts(parts) {
    // 清理旧模型
    for (const p of this._parts) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.edges.geometry.dispose();
      p.wire.geometry.dispose();
      this.modelGroup.remove(p.mesh, p.edges, p.wire);
    }
    this._parts = [];
    this._selected.clear();
    this._emit('selectionChange', []);

    const edgeColor = this._theme === 'dark' ? 0x9ca3af : 0x374151;
    const wireColor = this._theme === 'dark' ? 0x6b7280 : 0x4b5563;

    for (const [i, part] of parts.entries()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.shape.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(part.shape.indices, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color || this._materialProps.color),
        metalness: this._materialProps.metalness,
        roughness: this._materialProps.roughness,
        flatShading: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = this.options.shadows;
      mesh.receiveShadow = this.options.shadows;
      mesh.userData.partIndex = i;

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 20),
        new THREE.LineBasicMaterial({ color: edgeColor }),
      );
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({ color: wireColor }),
      );
      edges.userData.partIndex = i;
      wire.userData.partIndex = i;

      this.modelGroup.add(mesh, edges, wire);
      this._parts.push({ ...part, mesh, edges, wire, visible: true });
    }
    this._applyViewMode();
    this.fitToView();
    this._emitSectionRange();
  }

  /* ================= 视图控制 ================= */

  get viewMode() { return this._viewMode; }

  /** solid | wireframe | hidden | transparent | xray | section */
  setViewMode(mode) {
    this._viewMode = mode;
    if (mode === 'section' && !this._clip.plane) {
      const r = this.getSectionRange();
      if (r) this.setSectionPlane(r.axis, r.value, this._clip.invert);
    }
    this._applyViewMode();
    this._emit('viewModeChange', mode);
    if (mode === 'section') this._emitSectionRange();
  }

  _applyViewMode() {
    const mode = this._viewMode;
    const t = this.options.transparency;
    const clipPlanes = mode === 'section' && this._clip.plane ? [this._clip.plane] : [];
    for (const p of this._parts) {
      const m = p.mesh.material;
      m.clippingPlanes = clipPlanes;
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      p.mesh.visible = p.visible && mode !== 'wireframe';
      p.edges.visible = p.visible && (mode === 'hidden' || mode === 'xray');
      p.wire.visible = p.visible && mode === 'wireframe';
      if (mode === 'transparent') {
        m.transparent = true;
        m.opacity = t;
        m.depthWrite = false;
        p.edges.visible = p.visible;
        p.edges.material.opacity = 0.5;
        p.edges.material.transparent = true;
      }
      if (mode === 'xray') {
        m.transparent = true;
        m.opacity = Math.min(t, 0.2);
        m.depthWrite = false;
      }
      m.needsUpdate = true;
    }
  }

  /**
   * 设置剖切平面。
   * @param {'XY'|'XZ'|'YZ'|'none'} plane 平面（法向分别为 Z / Y / X）
   * @param {number} offset 沿法向的偏移
   * @param {boolean} invert 翻转保留方向
   */
  setSectionPlane(plane = 'XY', offset = 0, invert = false) {
    this._clip.axis = plane;
    this._clip.offset = offset;
    this._clip.invert = invert;
    if (plane === 'none') {
      this._clip.plane = null;
    } else {
      const normal = { XY: [0, 0, -1], XZ: [0, -1, 0], YZ: [-1, 0, 0] }[plane];
      if (invert) normal.forEach((v, i) => (normal[i] = -v));
      this._clip.plane = new THREE.Plane(
        new THREE.Vector3(...normal),
        invert ? -offset : offset,
      );
    }
    if (this._viewMode === 'section') this._applyViewMode();
  }

  /** 当前轴向的剖切范围（供 UI 设置滑杆 min/max/value） */
  getSectionRange(axis = this._clip.axis) {
    if (!this._parts.length || !this.modelGroup) return null;
    const a = axis === 'none' ? 'XY' : axis;
    const box3 = new THREE.Box3().setFromObject(this.modelGroup);
    const key = { XY: 'z', XZ: 'y', YZ: 'x' }[a];
    const pad = (box3.max[key] - box3.min[key]) * 0.05 + 1;
    return {
      axis: a,
      min: Math.floor(box3.min[key] - pad),
      max: Math.ceil(box3.max[key] + pad),
      value: (box3.min[key] + box3.max[key]) / 2,
    };
  }

  _emitSectionRange() {
    const r = this.getSectionRange();
    if (r) this._emit('sectionRange', r);
  }

  /** 自适应缩放至全部模型 */
  fitToView(padding = 1.25) {
    if (!this._parts.length || !this.camera) {
      this.camera?.position.set(140, -170, 110);
      this.controls?.target.set(0, 0, 0);
      return;
    }
    const box3 = new THREE.Box3().setFromObject(this.modelGroup);
    this._fitToBox(box3, padding);
  }

  _fitToObject(object3d) {
    const box3 = new THREE.Box3().setFromObject(object3d);
    if (!box3.isEmpty()) this._fitToBox(box3, 1.6);
  }

  _fitToBox(box3, padding) {
    const center = box3.getCenter(new THREE.Vector3());
    const sphere = box3.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, -1.2, 0.8);
    dir.normalize();

    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfFovTan = Math.tan((this.perspCamera.fov / 2) * DEG2RAD);
    const dist = (sphere.radius / (halfFovTan * Math.min(1, aspect))) * padding;

    this.camera.position.copy(center).addScaledVector(dir, Math.max(dist, sphere.radius * 1.5));
    this.controls.target.copy(center);
    this.perspCamera.near = Math.max(dist / 1000, 0.1);
    this.perspCamera.far = dist * 100;
    this.perspCamera.updateProjectionMatrix();

    // 正交相机保持一致的视野高度
    const halfH = dist * halfFovTan;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.left = -halfH * aspect;
    this.orthoCamera.right = halfH * aspect;
    this.orthoCamera.position.copy(this.camera.position);
    this.orthoCamera.updateProjectionMatrix();

    // 主光源与阴影范围
    this.keyLight.position.copy(center).add(new THREE.Vector3(0.7, -0.9, 1.4).multiplyScalar(sphere.radius * 3));
    this.keyLight.target.position.copy(center);
    this.keyLight.target.updateMatrixWorld();
    const d = sphere.radius * 2.2;
    Object.assign(this.keyLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 0.1, far: sphere.radius * 10 });
    this.keyLight.shadow.camera.updateProjectionMatrix();

    // 网格 / 坐标轴 / 地面自适应模型尺寸，并贴到模型底部
    const floorZ = box3.min.z;
    const gridScale = Math.max((sphere.radius * 6) / 2000, 0.005);
    this.gridHelper.scale.set(gridScale, 1, gridScale);
    this.gridHelper.position.z = floorZ;
    const axesLen = Math.max(sphere.radius * 0.8, 1) / 80; // AxesHelper 默认长 80
    this.axesHelper.scale.set(axesLen, axesLen, axesLen);
    if (this.groundMesh) this.groundMesh.position.z = floorZ - 0.01;

    this.controls.update();
  }

  setCamera({ position, target } = {}) {
    if (position) this.camera.position.set(...position);
    if (target) this.controls.target.set(...target);
    this.controls.update();
  }

  get projection() { return this._projection; }

  /** perspective | orthographic */
  setProjection(mode) {
    if (mode === this._projection) return this._projection;
    const old = this.camera;
    const oldTarget = this.controls.target.clone();
    this._projection = mode;
    this.camera = mode === 'orthographic' ? this.orthoCamera : this.perspCamera;
    this.camera.position.copy(old.position);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.copy(oldTarget);
    this._resize();
    this._emit('projectionChange', mode);
    return mode;
  }

  toggleProjection() {
    return this.setProjection(this._projection === 'orthographic' ? 'perspective' : 'orthographic');
  }

  /* ================= 显示设置 / 主题 / 材质 ================= */

  /** { grid, axes, ground, shadows, transparency } —— 只传需要修改的键 */
  setDisplay(patch = {}) {
    const o = this.options;
    if (patch.grid !== undefined) {
      o.grid = !!patch.grid;
      if (this.gridHelper) this.gridHelper.visible = o.grid;
    }
    if (patch.axes !== undefined) {
      o.axes = !!patch.axes;
      if (this.axesHelper) this.axesHelper.visible = o.axes;
    }
    if (patch.ground !== undefined) {
      o.groundPlane = !!patch.ground;
      if (this.groundMesh) this.groundMesh.visible = o.groundPlane;
    }
    if (patch.shadows !== undefined) {
      o.shadows = !!patch.shadows;
      this._applyShadows();
    }
    if (patch.transparency !== undefined) {
      o.transparency = Math.min(0.95, Math.max(0.05, Number(patch.transparency)));
      if (this._viewMode === 'transparent' || this._viewMode === 'xray') this._applyViewMode();
    }
  }

  /** light | dark | auto —— 只影响 3D 场景配色，不涉及任何 DOM */
  setTheme(theme) {
    if (theme === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    this._theme = theme;
    const dark = theme === 'dark';
    if (this.scene) this.scene.background = new THREE.Color(dark ? 0x10131a : 0xeef0f4);
    if (this.hemiLight) this.hemiLight.groundColor.set(dark ? 0x20242c : 0xbfc5cf);
    if (this.gridHelper) this.gridHelper.material.color.set(dark ? 0x39404e : 0xc8ccd4);
    if (this.groundMesh) this.groundMesh.material.opacity = dark ? 0.35 : 0.2;
    for (const p of this._parts) {
      p.edges.material.color.set(dark ? 0x9ca3af : 0x374151);
      p.wire.material.color.set(dark ? 0x6b7280 : 0x4b5563);
    }
    this._emit('themeChange', theme);
  }

  get theme() { return this._theme; }

  /** { color, metalness, roughness } —— 只传需要修改的键 */
  setMaterial(patch = {}) {
    Object.assign(this._materialProps, patch);
    const { color, metalness, roughness } = this._materialProps;
    for (const p of this._parts) {
      p.mesh.material.color.set(p.color || color);
      p.mesh.material.metalness = metalness;
      p.mesh.material.roughness = roughness;
    }
  }

  getMaterial() { return { ...this._materialProps }; }

  /** 启用/关闭剖切工具（等价于切换 section 视图模式） */
  enableSection(on = true) {
    this.setViewMode(on ? 'section' : 'solid');
  }

  /** 高亮某个部件（按索引或名称） */
  highlight(kind, id) {
    if (kind === 'part' || kind === 'body' || kind === 'face') {
      const idx = typeof id === 'number' ? id : this._parts.findIndex((p) => p.name === id);
      if (idx >= 0) {
        this._selected.clear();
        this._selected.add(idx);
        this._applySelection();
      }
    }
  }

  /* ================= 选择与隔离 ================= */

  _raycastParts(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const meshes = this._parts.filter((p) => p.mesh.visible).map((p) => p.mesh);
    const hits = ray.intersectObjects(meshes, false);
    return hits[0] || null;
  }

  _selectClick(e) {
    const hit = this._raycastParts(e);
    if (!hit) {
      if (!e.shiftKey) { this._selected.clear(); this._applySelection(); }
      return;
    }
    const idx = hit.object.userData.partIndex;
    if (!e.shiftKey) this._selected.clear();
    if (this._selected.has(idx) && e.shiftKey) this._selected.delete(idx);
    else this._selected.add(idx);
    this._applySelection();
    this._emit('click', {
      partIndex: idx,
      partName: this._parts[idx].name,
      point: hit.point.toArray(),
    });
  }

  clearSelection() {
    this._selected.clear();
    this._applySelection();
  }

  _applySelection() {
    this._parts.forEach((p, i) => {
      const sel = this._selected.has(i);
      p.mesh.material.emissive = new THREE.Color(sel ? 0x2563eb : 0x000000);
      p.mesh.material.emissiveIntensity = sel ? 0.4 : 0;
    });
    this._emit('selectionChange', this.getSelection());
  }

  /** 当前选中部件摘要 [{index,name,volume,area}] */
  getSelection() {
    return [...this._selected]
      .filter((i) => this._parts[i])
      .map((i) => ({
        index: i,
        name: this._parts[i].name,
        volume: this._parts[i].shape.volume(),
        area: this._parts[i].shape.area(),
      }));
  }

  /** 只显示选中部件 */
  isolateSelected() {
    this._parts.forEach((p, i) => { p.visible = this._selected.has(i); });
    this._applyViewMode();
  }

  /** 隐藏选中部件并清除选择 */
  hideSelected() {
    this._parts.forEach((p, i) => { if (this._selected.has(i)) p.visible = false; });
    this._selected.clear();
    this._applySelection();
    this._applyViewMode();
  }

  /** 全部显示 */
  showAllParts() {
    this._parts.forEach((p) => { p.visible = true; });
    this._applyViewMode();
  }

  /* ================= 测量工具 ================= */

  get measureMode() { return this._measureMode; }

  enableMeasurement(on = true) {
    this._measureMode = on;
    if (!on) this._clearMeasure();
    this._emit('measureModeChange', on);
  }

  _measureClick(e) {
    const hit = this._raycastParts(e);
    if (!hit) return;
    if (this._measure.points.length >= 2) this._clearMeasure();
    const pt = hit.point.clone();
    this._measure.points.push(pt);

    const size = Math.max(1, new THREE.Box3().setFromObject(this.modelGroup).getBoundingSphere(new THREE.Sphere()).radius * 0.012);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(size, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5533, depthTest: false }),
    );
    marker.position.copy(pt);
    marker.renderOrder = 999;
    this.measureGroup.add(marker);
    this._measure.objects.push(marker);

    if (this._measure.points.length === 2) {
      const [a, b] = this._measure.points;
      const dist = a.distanceTo(b);
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff5533, depthTest: false }));
      line.renderOrder = 998;
      this.measureGroup.add(line);
      this._measure.objects.push(line);
      this._emit('measure', { distance: dist, points: [a.toArray(), b.toArray()], text: fmtLen(dist) });
    }
  }

  _clearMeasure() {
    for (const obj of this._measure.objects) {
      this.measureGroup.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    this._measure.objects = [];
    this._measure.points = [];
    this._emit('measure', null);
  }

  /* ================= 参数化（@param 注释） ================= */

  /** 解析代码中的 @param 注释，返回 [{name,label,value,min,max,step}] */
  extractParams(code = this._code) {
    this._params = parseParams(code);
    return this._params;
  }

  getParams() { return this._params; }

  /** 修改某个参数的值并重新运行（基于最近一次执行的代码） */
  async setParam(name, value) {
    this._code = applyParamValue(this._code, name, value);
    return this.run(this._code);
  }

  /** 参数动画：在 [from, to] 区间内驱动某个参数 */
  animate({ param, from, to, duration = 2000, easing = 'linear' } = {}) {
    const easings = {
      linear: (t) => t,
      easeInOut: (t) => t * t * (3 - 2 * t),
    };
    const ease = easings[easing] || easings.linear;
    cancelAnimationFrame(this._animFrame);
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / duration);
      const val = Math.round((from + (to - from) * ease(t)) * 100) / 100;
      this._code = applyParamValue(this._code, param, val);
      this.run(this._code).then(() => {
        if (t < 1) this._animFrame = requestAnimationFrame(step);
      });
    };
    step();
  }

  /* ================= 导出与下载 ================= */

  /**
   * 导出模型。格式：stl | stl-ascii | obj | glb | brep
   * @returns {Promise<Blob>}
   */
  async export(format = 'stl', opts = {}) {
    if (!this._parts.length) {
      throw new GeomError('没有可导出的模型', { code: 'NO_MODEL', recoverable: true, suggestion: '请先运行代码生成模型' });
    }
    const shapes = this._parts.filter((p) => p.visible).map((p) => p.shape);
    let blob;
    switch (format) {
      case 'stl': blob = toSTLBinary(shapes); break;
      case 'stl-ascii': blob = toSTLAscii(shapes); break;
      case 'obj': blob = toOBJ(shapes); break;
      case 'brep': blob = toBREPJSON(shapes); break;
      case 'gltf':
      case 'glb': blob = await this._exportGLB(); break;
      default:
        throw new GeomError(`不支持的导出格式: ${format}`, { code: 'BAD_FORMAT', recoverable: true });
    }
    this._emit('export', { blob, format });
    return blob;
  }

  _exportGLB() {
    return new Promise((resolve, reject) => {
      const group = new THREE.Group();
      for (const p of this._parts) {
        if (p.mesh.visible) group.add(p.mesh.clone());
      }
      new GLTFExporter().parse(
        group,
        (result) => resolve(new Blob([result], { type: 'model/gltf-binary' })),
        (err) => reject(err),
        { binary: true },
      );
    });
  }

  /** 导出并触发浏览器下载，返回 { filename, blob }（错误向上抛出，由 UI 层提示） */
  async download(format = 'stl', filename = null) {
    const ext = { stl: 'stl', 'stl-ascii': 'stl', obj: 'obj', glb: 'glb', gltf: 'glb', brep: 'brep.json' }[format] || format;
    const blob = await this.export(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `brepview-model.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { filename: a.download, blob };
  }

  /** 序列化为 BREP JSON 字符串 */
  toBREP() {
    return JSON.stringify({
      format: 'BrepView-BREP/1',
      parts: this._parts.map((p) => ({ name: p.name, ...p.shape.toJSON() })),
    });
  }

  /* ================= 其他 ================= */

  /** 清空场景，恢复默认视图 */
  reset() {
    this._setParts([]);
    this._clearMeasure();
    this._result = null;
    this.fitToView();
    this._emitStatus('ok', '就绪');
    this._emit('reset');
  }

  /** 安装插件：plugin.install(this) */
  use(plugin) {
    plugin?.install?.(this);
    return this;
  }

  /** 销毁实例，释放资源（不触碰任何 DOM，canvas 由宿主页面管理） */
  dispose() {
    cancelAnimationFrame(this._rafId);
    cancelAnimationFrame(this._animFrame);
    this._resizeObserver?.disconnect();
    this._clearMeasure();
    this._setParts([]);
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointerdown', this._onPointerDown);
      c.removeEventListener('pointerup', this._onPointerUp);
      c.removeEventListener('dblclick', this._onDblClick);
      c.removeEventListener('keydown', this._onKeyDown);
    }
    this.controls?.dispose();
    this.renderer?.dispose();
    this._initialized = false;
    this._listeners = {};
  }
}

/* ============================================================================
 * 导出（默认导出 BrepView；数据工具挂为静态属性，UI 层只需默认导入）
 * ========================================================================== */

BrepView.GeomError = GeomError;
BrepView.Shape = Shape;
BrepView.KERNEL_API = KERNEL_API;
BrepView.parseParams = parseParams;
BrepView.applyParamValue = applyParamValue;
BrepView.fmtInt = fmtInt;
BrepView.fmtVol = fmtVol;
BrepView.fmtArea = fmtArea;
BrepView.fmtLen = fmtLen;

export default BrepView;
export {
  GeomError, Shape, KERNEL_API,
  parseParams, applyParamValue,
  fmtInt, fmtVol, fmtArea, fmtLen,
} from './brep-kernel.js';
