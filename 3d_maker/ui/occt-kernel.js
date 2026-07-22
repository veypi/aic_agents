/** occt-kernel.js — OpenCascade WASM adapter v1.1.2（CDN 加载 + Worker 编译 + IndexedDB 缓存 + 进度回调）
 *
 * 加载策略：
 *   - IndexedDB 两级缓存：支持 Module 序列化的浏览器（Firefox 等）存编译产物，二次访问免下载免编译；
 *     不支持的（Chrome）存 WASM 二进制，二次访问免下载、Worker 内编译，主线程仍无感；
 *   - 首次访问：胶水 JS 与 WASM 二进制走 CDN（unpkg，浏览器 HTTP 缓存兜底），下载失败回退服务器本地文件；
 *   - WASM 编译在 Web Worker 中进行，主线程不卡顿；环境不支持时回退主线程实例化；
 *   - onProgress(pct, text) 汇报 0~100 进度与阶段说明；
 *   - 加载完成后 createOCCTKernel() 返回与内置内核 API 兼容的内核对象。
 */
const CDN_BASE = 'https://unpkg.com/opencascade.js@1.1.1/dist/';
const LOCAL_WASM = '/aic/fs/agents/3e292cd175f649f6b7fa632327bec7b3/ui/opencascade.wasm.wasm';
/** 本地缓存键（绑定内核版本，升级内核时改这里即可使旧缓存失效） */
const WASM_CACHE_KEY = 'opencascade.js@1.1.1';
let oc = null, _p = null;

/** IndexedDB 缓存：持久化已编译的 WebAssembly.Module，二次访问跳过下载与编译。
 *  WebAssembly.Module 支持结构化克隆（Chrome 74+ / Firefox 79+ / Safari 15+）；
 *  不支持的环境读写会静默失败，自动回退完整加载流程。 */
function _idbStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open('brepview-cache', 1);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('wasm')) rq.result.createObjectStore('wasm'); };
    rq.onsuccess = () => {
      const db = rq.result;
      try {
        const tx = db.transaction('wasm', mode);
        // 注意：put() 可能同步抛错（如 Chrome 拒绝序列化 WebAssembly.Module），必须捕获
        fn(tx.objectStore('wasm'));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('transaction aborted')); };
      } catch (e) {
        try { db.close(); } catch (_) {}
        reject(e);
      }
    };
    rq.onerror = () => reject(rq.error);
  });
}
async function _cacheGet(key) {
  try {
    let out = null;
    await _idbStore('readonly', (st) => { const g = st.get(key); g.onsuccess = () => { out = g.result; }; });
    return out || null;
  } catch (_) { return null; }
}
async function _cachePut(key, val) {
  try { await _idbStore('readwrite', (st) => st.put(val, key)); return true; }
  catch (e) {
    // DataCloneError 是预期分支（Chrome 无法序列化 WebAssembly.Module），由调用方降级存二进制，不打警告
    if (!(e && e.name === 'DataCloneError')) {
      console.warn('[OCCT] 写入本地缓存失败:', (e && e.message) || e);
    }
    return false;
  }
}

/** 带进度汇报的 fetch（按字节流统计） */
async function _fetchWithProgress(url, onBytes) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const total = Number(resp.headers.get('Content-Length')) || 0;
  if (!resp.body || !resp.body.getReader) {
    const buf = await resp.arrayBuffer();
    onBytes?.(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes?.(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return buf.buffer;
}

/** 在 Web Worker 中编译 WASM：大模块（~15MB）的编译耗时数秒，直接在主线程会卡死页面。
 *  编译完成后将 WebAssembly.Module 传回主线程，主线程只做毫秒级的实例化。
 *  环境不支持（无 Worker / Module 不可传输 / 超时）时 reject，由调用方回退主线程实例化。 */
function _compileInWorker(buf) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      return reject(new Error('Worker/WebAssembly 不可用'));
    }
    const src = 'self.onmessage=async(e)=>{' +
      'try{const m=await WebAssembly.compile(e.data);' +
      'try{self.postMessage({ok:1,mod:m});}' +
      'catch(e2){self.postMessage({ok:0,err:"WebAssembly.Module 不可跨线程传输"});}}' +
      'catch(err){try{self.postMessage({ok:0,err:String(err&&err.message||err)});}catch(_){}}}';
    let w;
    try {
      w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    } catch (e) {
      return reject(e);
    }
    const timer = setTimeout(() => { try { w.terminate(); } catch (_) {} reject(new Error('编译超时')); }, 90000);
    w.onmessage = (e) => {
      clearTimeout(timer);
      try { w.terminate(); } catch (_) {}
      if (e.data && e.data.ok) resolve(e.data.mod);
      else reject(new Error((e.data && e.data.err) || '编译失败'));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      try { w.terminate(); } catch (_) {}
      reject(new Error('worker 错误: ' + ((e && e.message) || 'unknown')));
    };
    w.postMessage(buf, [buf]); // 转移所有权（调用方传入的是副本，主线程保留原始 buffer 供回退）
  });
}

async function _initOCCT(cdnBase, onProgress) {
  if (oc) { onProgress?.(100, '高性能解析器就绪'); return oc; }
  if (_p) return _p;
  cdnBase = cdnBase || CDN_BASE;
  const ratio = (loaded, total) => (total > 0 ? Math.min(1, loaded / total) : 0.5);
  _p = (async () => {
    // 0. 检查 IndexedDB 两级缓存：
    //    L1 编译产物（WebAssembly.Module）→ 跳过下载 + 编译（Firefox 等支持序列化的浏览器）
    //    L2 WASM 二进制（ArrayBuffer）      → 跳过下载，仅 Worker 内编译（Chrome：Module 不可入库）
    let compiledModule = null;
    let cachedBinary = null;
    if (typeof indexedDB !== 'undefined') {
      onProgress?.(0, '正在检查本地缓存…');
      const cached = await _cacheGet(WASM_CACHE_KEY);
      if (cached && cached.version === WASM_CACHE_KEY) {
        if (cached.module instanceof WebAssembly.Module) {
          compiledModule = cached.module;
          console.log('[OCCT] 命中 L1 缓存（编译产物），跳过下载与编译');
        } else if (cached.binary instanceof ArrayBuffer && cached.binary.byteLength) {
          cachedBinary = cached.binary;
          console.log('[OCCT] 命中 L2 缓存（二进制），跳过下载');
        }
      }
    }

    // 1. 下载胶水脚本（OCCT 类绑定层，每次都需要；浏览器 HTTP 缓存兜底，刷新一般不走真实网络）
    const glueBase = compiledModule ? 90 : 0;
    onProgress?.(glueBase, '正在加载高性能解析器…');
    const glueBuf = await _fetchWithProgress(cdnBase + 'opencascade.wasm.js', (loaded, total) => {
      onProgress?.(glueBase + Math.round(ratio(loaded, total) * 5), '正在加载高性能解析器…');
    });
    let text = new TextDecoder().decode(glueBuf);

    // 2. 未命中 L1 缓存：获取 WASM 二进制（L2 缓存 → CDN → 服务器本地）并在 Worker 中编译
    let wasmUrl = null;
    if (!compiledModule) {
      let wasmBuf = null;
      if (cachedBinary) {
        wasmBuf = cachedBinary;
        onProgress?.(90, '已从本地缓存读取高性能解析器…');
      } else {
        try {
          wasmBuf = await _fetchWithProgress(cdnBase + 'opencascade.wasm.wasm', (loaded, total) => {
            onProgress?.(5 + Math.round(ratio(loaded, total) * 85), '正在加载高性能解析器…');
          });
        } catch (e) {
          console.warn('[OCCT] CDN WASM 下载失败，回退服务器本地文件:', e.message);
          onProgress?.(60, '正在从服务器加载高性能解析器…');
          wasmBuf = await _fetchWithProgress(LOCAL_WASM, (loaded, total) => {
            onProgress?.(60 + Math.round(ratio(loaded, total) * 30), '正在从服务器加载高性能解析器…');
          });
        }
      }
      // 3. 在 Web Worker 中编译 WASM：大模块直接在主线程编译会卡死页面数秒，
      //    改由 Worker 离线编译后传回 WebAssembly.Module，主线程只做毫秒级实例化。
      //    不支持时（旧浏览器 / 传输受限）回退胶水自带的主线程流程。
      try {
        onProgress?.(92, '正在后台编译高性能解析器…');
        compiledModule = await _compileInWorker(wasmBuf.slice(0)); // 传副本，保留原 buffer 供回退
        // 写缓存（仅首次下载时）：优先存编译产物；浏览器拒绝序列化 Module（Chrome）时退存二进制
        if (!cachedBinary) {
          const okFull = await _cachePut(WASM_CACHE_KEY, { version: WASM_CACHE_KEY, module: compiledModule, binary: wasmBuf.slice(0) });
          if (!okFull) await _cachePut(WASM_CACHE_KEY, { version: WASM_CACHE_KEY, binary: wasmBuf.slice(0) });
          console.log('[OCCT] 已写入本地缓存:', okFull ? 'L1 编译产物 + L2 二进制' : 'L2 二进制（浏览器不支持 Module 入库）');
        }
      } catch (e) {
        console.warn('[OCCT] 后台编译不可用，将使用主线程实例化:', (e && e.message) || e);
      }
      // 转本地 Blob 地址（仅主线程回退实例化时需要）
      wasmUrl = URL.createObjectURL(new Blob([wasmBuf], { type: 'application/wasm' }));
    }
    const instantiateWasm = compiledModule
      ? (imports, receive) => {
          // Chrome 主线程禁止同步实例化 >8MB 的模块（RangeError），而 OCCT 二进制高达 ~65MB，必中此限。
          // 先试同步快路径；被拒则回退异步 WebAssembly.instantiate：立即返回 {} + 完成后调 receive，
          // 语义与胶水自带的默认异步实例化路径等价——胶水所有 wasm 函数封装均为惰性 thunk，
          // 首次调用才经 Module["asm"] 解析（receiveInstance 已先行赋值），不会有时序问题。
          try {
            const inst = new WebAssembly.Instance(compiledModule, imports);
            receive(inst, compiledModule);
            return inst.exports;
          } catch (e) {
            WebAssembly.instantiate(compiledModule, imports).then(
              (inst) => receive(inst, compiledModule),
              (e2) => console.error('[OCCT] WASM 实例化失败:', e2)
            );
            return {};
          }
        }
      : undefined;

    // 4. 改写胶水脚本：去掉 export、绑定 WASM 地址
    text = text.replace(/export\s*\{[^}]*\}/g, '').replace(/export\s+default\s+\w+\s*;?/g, '');
    text = text.replace(/var _scriptDir = .+;/, 'var _scriptDir = "' + cdnBase + '";');
    text = text.replace(
      /var Module=typeof opencascade!=="undefined"\?opencascade:\{\};/,
      'var Module=typeof opencascade!=="undefined"?opencascade:{wasmBinaryFile:"' + (wasmUrl || '') + '"};',
    );

    // 5. 注入执行胶水脚本（预置 Module，兼容非 MODULARIZE 构建，让钩子在脚本执行前生效）
    window.opencascade = window.opencascade || {};
    if (wasmUrl) window.opencascade.wasmBinaryFile = wasmUrl;
    if (instantiateWasm) window.opencascade.instantiateWasm = instantiateWasm;
    const blob = new Blob([text], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('script load'));
      document.head.appendChild(s);
    });
    URL.revokeObjectURL(url);

    // 6. 实例化（有编译产物时主线程不再编译 WASM，无卡顿）
    onProgress?.(98, '正在初始化高性能解析器…');
    const overrides = Object.assign(wasmUrl ? { wasmBinaryFile: wasmUrl } : {}, instantiateWasm ? { instantiateWasm } : {});
    oc = typeof window.opencascade === 'function' ? await window.opencascade(overrides) : await window.opencascade;
    onProgress?.(100, '高性能解析器就绪');
    return oc;
  })();
  _p.catch(() => { _p = null; }); // 失败后允许下次重试
  return _p;
}

class OCCTShape {
  constructor(s, meta) { this._oc = s; this._meta = meta || null; this._warn = null; this._mesh = null; }

  _ensure() {
    if (this._mesh) return;
    try {
      new oc.BRepMesh_IncrementalMesh_2(this._oc, 1.0, 0, 0.5, 0);
      const pos = [], idx = []; let off = 0;
      const exp = new oc.TopExp_Explorer_2(this._oc, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      while (exp.More()) {
        const f = oc.TopoDS.Face_1(exp.Current());
        const loc = new oc.TopLoc_Location_1();
        const tris = oc.BRep_Tool.Triangulation(f, loc).get();
        if (tris) {
          const T = loc.Transformation();
          for (let i = 1, n = tris.NbNodes(); i <= n; i++) {
            const p = tris.Node(i); if (!p) continue;
            const tp = p.Transformed(T);
            pos.push(tp.X(), tp.Y(), tp.Z());
          }
          for (let i = 1, n = tris.NbTriangles(); i <= n; i++) {
            const t = tris.Triangle(i); if (!t) continue;
            idx.push(t.Value(1) - 1 + off, t.Value(2) - 1 + off, t.Value(3) - 1 + off);
          }
          off += tris.NbNodes();
        }
        exp.Next();
      }
      this._mesh = { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
    } catch (e) {
      console.warn('[OCCT] mesh failed:', e.message);
      this._mesh = { positions: new Float32Array([]), indices: new Uint32Array([]) };
    }
  }

  get positions() { this._ensure(); return this._mesh.positions; }
  get indices() { this._ensure(); return this._mesh.indices; }
  get vertexCount() { this._ensure(); return this._mesh.positions.length / 3; }
  get triangleCount() { this._ensure(); return this._mesh.indices.length / 3; }

  edgeCount() { try { let n = 0; const e = new oc.TopExp_Explorer_2(this._oc, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); while (e.More()) { n++; e.Next(); } return n; } catch (_) { return 0; } }
  volume() { try { const p = new oc.GProp_GProps_1(); oc.BRepGProp.VolumeProperties_1(this._oc, p, 1e-4, false, false); return p.Mass(); } catch (_) { return 0; } }
  area() { try { const p = new oc.GProp_GProps_1(); oc.BRepGProp.SurfaceProperties_1(this._oc, p, 1e-4, false); return p.Mass(); } catch (_) { return 0; } }
  /** 包围盒：基于三角化网格顶点计算（与渲染几何一致，规避 Bnd_Box 绑定的不稳定性） */
  bounds() {
    const p = this.positions;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
    return { min, max };
  }

  _xform(trsf) { try { const b = new oc.BRepBuilderAPI_Transform_2(this._oc, trsf, true); this._oc = b.Shape(); this._mesh = null; } catch(_) {} return this; }
  translate(x,y,z) { x=x||0;y=y||0;z=z||0; const t=new oc.gp_Trsf_1(); t.SetTranslation_1(new oc.gp_Vec_4(x,y,z)); return this._xform(t); }
  scale(x,y,z) { if(y===undefined)y=z=x; if(x!==y||y!==z){const g=new oc.gp_GTrsf_1();g.SetValue(1,1,x);g.SetValue(2,2,y);g.SetValue(3,3,z); const b=new oc.BRepBuilderAPI_GTransform_2(this._oc,g,true);this._oc=b.Shape();this._mesh=null;return this;} const t=new oc.gp_Trsf_1();t.SetScale(new oc.gp_Pnt_3(0,0,0),x);return this._xform(t); }
  rotate(axis,deg) { const rad=deg*Math.PI/180; const ax=new oc.gp_Ax1_2(new oc.gp_Pnt_3(0,0,0),new oc.gp_Dir_4(axis[0],axis[1],axis[2])); const t=new oc.gp_Trsf_1();t.SetRotation_1(ax,rad);return this._xform(t); }
  rotateX(d){return this.rotate([1,0,0],d)} rotateY(d){return this.rotate([0,1,0],d)} rotateZ(d){return this.rotate([0,0,1],d)}

  _bool(o,op){ if(!o||!o._oc)throw new Error('not a shape'); let algo; if(op==='fuse')algo=new oc.BRepAlgoAPI_Fuse_3(this._oc,o._oc); else if(op==='cut')algo=new oc.BRepAlgoAPI_Cut_3(this._oc,o._oc); else if(op==='common')algo=new oc.BRepAlgoAPI_Common_3(this._oc,o._oc); else throw new Error('unknown:'+op); if(!algo.IsDone())throw new Error(op+' failed'); return new OCCTShape(algo.Shape(),null); }
  fuse(o){return this._bool(o,'fuse')} cut(o){return this._bool(o,'cut')} intersect(o){return this._bool(o,'common')}

  fillet(radius){ radius=radius||1; try{ const mf=new oc.BRepFilletAPI_MakeFillet(this._oc,oc.ChFi3d_FilletShape.ChFi3d_Rational); const exp=new oc.TopExp_Explorer_2(this._oc,oc.TopAbs_ShapeEnum.TopAbs_EDGE,oc.TopAbs_ShapeEnum.TopAbs_SHAPE); while(exp.More()){mf.Add_2(radius,oc.TopoDS.Edge_1(exp.Current()));exp.Next()} mf.Build(); if(mf.IsDone())return new OCCTShape(mf.Shape(),this._meta); }catch(e){ console.warn('[OCCT] fillet failed:', e.message); } const r=new OCCTShape(this._oc,this._meta);r._warning='fillet: OCCT 圆角操作失败（已保留原形状）';return r; }

  /** 序列化为网格 JSON（兼容 BREP 导出） */
  toJSON(){ return { positions: Array.from(this.positions), indices: Array.from(this.indices) }; }
}

class OCCTSketch {
  constructor(points){ this.points=points; const pg=new oc.BRepBuilderAPI_MakePolygon_1(); for(const[x,y]of points)pg.Add_1(new oc.gp_Pnt_3(x,y,0)); pg.Close(); this._face=new oc.BRepBuilderAPI_MakeFace_15(pg.Wire(),false).Face(); }
  extrude(h){ const prism=new oc.BRepPrimAPI_MakePrism_1(this._face,new oc.gp_Vec_4(0,0,h),false,true);
    // 与内置内核语义对齐：内置 extrudeProfile 沿 Z 居中拉伸（-h/2 ~ +h/2），
    // 而 MakePrism 从轮廓面向 +Z 拉伸 0~h，须补平移 -h/2，否则切换内核后模型整体错位。
    const t=new oc.gp_Trsf_1(); t.SetTranslation_1(new oc.gp_Vec_4(0,0,-h/2));
    const moved=new oc.BRepBuilderAPI_Transform_2(prism.Shape(),t,true).Shape();
    return new OCCTShape(_positive(moved),{kind:'extrude',params:{profile:this.points,height:h}}); }
}

/** 方向校正：B-Rep 实体体积为负时翻转面法线（保证体积为正、渲染法线朝外） */
function _positive(shape) {
  try {
    const p = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, p, 1e-4, false, false);
    if (p.Mass() < 0) { const r = shape.Reversed(); return r || shape; }
  } catch (_) {}
  return shape;
}

export async function createOCCTKernel(cdnBase, onProgress){ await _initOCCT(cdnBase, onProgress);
  const api = {
    box(w,d,h){if(d===undefined)d=w;if(h===undefined)h=d;const s=new oc.BRepPrimAPI_MakeBox_1(w,d,h).Shape();const t=new oc.gp_Trsf_1();t.SetTranslation_1(new oc.gp_Vec_4(-w/2,-d/2,-h/2));return new OCCTShape(new oc.BRepBuilderAPI_Transform_2(s,t,true).Shape(),{kind:'box',params:{w,d,h}});},
    cylinder(r,h,_s){r=r||5;h=h||10;const s=new oc.BRepPrimAPI_MakeCylinder_2(r,h,2*Math.PI).Shape();const t=new oc.gp_Trsf_1();t.SetTranslation_1(new oc.gp_Vec_4(0,0,-h/2));return new OCCTShape(new oc.BRepBuilderAPI_Transform_2(s,t,true).Shape(),{kind:'cylinder',params:{r,h}});},
    cone(rB,rT,h,_s){rB=rB||5;rT=rT||0;h=h||10;const s=new oc.BRepPrimAPI_MakeCone_2(rB,rT,h,2*Math.PI).Shape();const t=new oc.gp_Trsf_1();t.SetTranslation_1(new oc.gp_Vec_4(0,0,-h/2));return new OCCTShape(new oc.BRepBuilderAPI_Transform_2(s,t,true).Shape(),{kind:'cone',params:{rBottom:rB,rTop:rT,h}});},
    sphere(r,_s,_r){r=r||5;return new OCCTShape(new oc.BRepPrimAPI_MakeSphere_2(r,2*Math.PI).Shape(),{kind:'sphere',params:{r}});},
    torus(R,r,_s,_t){R=R||8;r=r||2;return new OCCTShape(new oc.BRepPrimAPI_MakeTorus_4(R,r,0,2*Math.PI,2*Math.PI).Shape(),{kind:'torus',params:{R,r}});},
    pipe(rO,rI,h,_s){rO=rO||6;rI=rI||4;h=h||10;const o=new oc.BRepPrimAPI_MakeCylinder_2(rO,h,2*Math.PI).Shape();const i=new oc.BRepPrimAPI_MakeCylinder_2(rI,h+2,2*Math.PI).Shape();const c=new oc.BRepAlgoAPI_Cut_3(o,i);const t=new oc.gp_Trsf_1();t.SetTranslation_1(new oc.gp_Vec_4(0,0,-h/2));return new OCCTShape(new oc.BRepBuilderAPI_Transform_2(c.Shape(),t,true).Shape(),{kind:'pipe',params:{rOuter:rO,rInner:rI,h}});},
    sketchRect(w,h){w=w||10;h=h||10;const hw=w/2,hh=h/2;return new OCCTSketch([[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]]);},
    sketchCircle(r,seg){r=r||5;seg=seg||48;const pts=[];for(let i=0;i<seg;i++){const t=(i/seg)*Math.PI*2;pts.push([r*Math.cos(t),r*Math.sin(t)]);}return new OCCTSketch(pts);},
    sketchRoundedRect(w,h,r,seg){w=w||10;h=h||10;r=r||2;seg=seg||5;const hw=w/2,hd=h/2,pts=[];for(const[cx,cy,s]of[[hw-r,hd-r,0],[-hw+r,hd-r,Math.PI/2],[-hw+r,-hd+r,Math.PI],[hw-r,-hd+r,Math.PI*1.5]])for(let i=0;i<=seg;i++){const t=s+(i/seg)*(Math.PI/2);pts.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]);}return new OCCTSketch(pts);},
    sketchPolygon(pts){return new OCCTSketch(pts);},
    revolve(profile,_s){const pg=new oc.BRepBuilderAPI_MakePolygon_1();for(const[r,z]of profile)pg.Add_1(new oc.gp_Pnt_3(r,0,z));const face=new oc.BRepBuilderAPI_MakeFace_15(pg.Wire(),false).Face();const axis=new oc.gp_Ax1_2(new oc.gp_Pnt_3(0,0,0),new oc.gp_Dir_4(0,0,1));return new OCCTShape(_positive(new oc.BRepPrimAPI_MakeRevol_2(face,axis,2*Math.PI).Shape()),{kind:'revolve',params:{profile}});},
    lathe:null,
    gearProfile(teeth,mod){teeth=teeth||20;mod=mod||2;const rP=(mod*teeth)/2,rT=rP+mod,rR=Math.max(rP-1.25*mod,mod),ta=(Math.PI*2)/teeth,pts=[];for(let t=0;t<teeth;t++){const a=t*ta;pts.push([rR*Math.cos(a),rR*Math.sin(a)],[rR*Math.cos(a+.25*ta),rR*Math.sin(a+.25*ta)],[rT*Math.cos(a+.4*ta),rT*Math.sin(a+.4*ta)],[rT*Math.cos(a+.6*ta),rT*Math.sin(a+.6*ta)],[rR*Math.cos(a+.75*ta),rR*Math.sin(a+.75*ta)]);}return pts;},
    Sketch:OCCTSketch, Shape:OCCTShape, deg2rad:(d)=>d*Math.PI/180,
  };
  api.lathe=api.revolve; return api;
}
export{OCCTShape,OCCTSketch,_initOCCT};
export default { createOCCTKernel, OCCTShape, OCCTSketch };
