# BrepView 开发文档

> 版本：v1.2（2026-07-21）——含 OCCT 适配器 7 处修复与全量内核测试

## 1. 项目概述

BrepView 是一个纯浏览器端的 3D CAD 参数化建模环境，作为 AgentOS 平台的 Agent UI 页面运行。
Agent 通过消息通道向页面推送建模代码，页面同步执行并返回 AI 友好的几何统计结果，
实现「自然语言 → 代码 → 3D 模型 → 数据反馈」的闭环。

## 2. 目录结构

```
$AGENT/
├── index.md                    # Agent Prompt（暂未编写）
├── doc/
│   ├── README.md               # 项目速览（历史文档）
│   ├── development.md          # 本文档
│   ├── model-design-guide.md   # 建模代码编写指南（用户代码侧）
│   └── occt-api-reference.md   # OCCT 内核 API 参考
└── ui/
    ├── index.html              # 入口页面（vhtml 组件，嵌入宿主页面）
    ├── brepview.js             # 核心引擎（3037 行，15 个模块）
    ├── occt-kernel.js          # OCCT WASM 内核适配器
    ├── opencascade.wasm.wasm   # OCCT 几何内核（62.81 MB，本地加载）
    ├── three.module.js         # Three.js 渲染引擎
    ├── orbit-controls.js       # 轨道相机
    ├── gltf-exporter.js        # GLTF/GLB 导出
    └── Supported APIs.md       # opencascade.js 支持清单（参考）
```

## 3. 总体架构

```
Agent (ui_run run_code, mode=sync)
   │  发布 NATS 消息到  s.{sid}.ui_run.run_code
   ▼
index.html 订阅回调 ──► viewer.run(code)
   │                      │
   │                      ▼
   │              new Function(...内核API名)(code)   ← 用户代码沙盒执行
   │                      │
   │            ┌─────────┴──────────┐
   │            │ 内置纯 JS 内核       │ OCCT WASM 内核（可选）│
   │            │ BSP 树 CSG         │ 工业级 B-Rep        │
   │            └─────────┬──────────┘
   │                      ▼  鸭子类型统一（Shape / OCCTShape）
   │              _normalizeResult() → 统计聚合
   │                      ▼
   │              Three.js 渲染 / 面板更新 / 导出
   │                      │
   ◄──────────────────────┘
   返回 { success, stats, parts, warnings, executionTime }
```

### 3.1 双内核对比

| 维度 | 内置纯 JS 内核 | OCCT WASM 内核 |
|---|---|---|
| 启动 | 零依赖，即时 | 需加载 62.8MB WASM（本地，约 2~5s） |
| 几何表示 | 三角网格 | B-Rep（精确边界表示） |
| 体积精度 | 网格近似（−0.6%~−3.2%） | 精确到 0.00% |
| 三角面数 | 高（乐高 22,981） | 低（乐高 860，−96%） |
| 圆角 | 2.5D（仅 box/extrude，见 §8 已知问题） | 全 3D 真实圆角（任意实体） |
| 边统计 | 网格边（乐高 35,216） | B-Rep 拓扑边（乐高 96，更有意义） |
| 适用 | 快速预览、离线兜底 | 精确建模、导出生产文件 |

### 3.2 内核切换

页面默认使用内置内核。切换 OCCT：

```js
import { createOCCTKernel } from './occt-kernel.js';
viewer.options.kernel = await createOCCTKernel();
```

`viewer.run()` 通过 `this.options.kernel || KERNEL_API` 选取内核，
`_normalizeResult()` 以鸭子类型（`typeof obj.volume === 'function'`）兼容两种 Shape。

## 4. brepview.js 模块地图（15 个模块）

| # | 模块 | 行号 | 说明 |
|---|---|---|---|
| 一 | 基础数学工具 | 27 | 向量/4x4 矩阵（行主序，Rodrigues 旋转） |
| 二 | GeomError | 96 | 错误类型：code / recoverable / suggestion |
| 三 | Shape | 124 | 三角网格几何体（Float32Array + Uint32Array + meta） |
| 四 | 二维轮廓工具 | 299 | 轮廓生成、耳切三角化、顶点焊接 |
| 五 | 拉伸/旋转成型 | 432 | extrudeProfile / revolveProfile |
| 六 | 图元 | 499 | box/cylinder/cone/sphere/torus/pipe + Sketch + gearProfile |
| 七 | CSG 布尔 | 631 | BSP 树实现 fuse/cut/intersect |
| 八 | 导出器 | 830 | STL(文本/二进制)/OBJ/BREP-JSON，GLB 走 GLTFExporter |
| 九 | @param 解析 | 913 | 注释解析生成参数化面板数据 |
| 十 | TEMPLATES | 951 | 内置模板：basic-box / stud-brick / gear / pipe-joint |
| 十一 | 内置样式 | 1119 | .bv-root 作用域 CSS 变量，亮/暗双主题 |
| 十二 | KERNEL_API | 1367 | 注入用户代码作用域的 API 表 |
| 十三 | 格式化工具 | 1379 | fmtVol / fmtArea / fmtLen（mm/cm/m 自适应） |
| 十四 | BrepView 主类 | 1401 | DOM/UI/Three.js/run() 管线/视图模式/测量/剖面/导出 |
| 十五 | 全局导出 | 3030 | export default BrepView |

## 5. run() 执行管线

```
run(code, opts)
  ├─ 防重入：this._running 时直接返回当前结果
  ├─ 状态：'编译中…' + 遮罩 + await this._frame()（双 rAF 让遮罩先绘制）
  ├─ 注入超时/中断控制：_kernelCtrl.deadline / aborted → kernelCheckpoint()
  ├─ 编译：new Function(...内核API名, 'kernel', '"use strict";\n' + code)
  ├─ 执行 → raw
  ├─ _normalizeResult(raw)：
  │     Shape → [{ name:'部件 1', shape, color:null }]
  │     Array → 逐项 { name, shape, color }（鸭子类型校验）
  │     否则抛 GeomError（NO_RETURN / INVALID_RETURN / EMPTY_RETURN）
  ├─ 统计聚合：volume/area/verts/tris/edges/bounds（跨部件求和与并集）
  ├─ maxTriangles 超限 → warning
  └─ 返回 { success, stats, parts[], warnings, executionTime }
```

### 5.1 成功返回格式

```json
{
  "success": true,
  "stats": {
    "volume": 1538.36, "area": 2906.3,
    "boundingBox": { "min": [...], "max": [...], "size": [...] },
    "mesh": { "vertices": 896, "triangles": 860, "edges": 96,
              "density": 0.30, "complexity": "low" },
    "partCount": 1
  },
  "parts": [{ "name": "部件 1", "color": null, "volume": ..., "area": ...,
              "vertices": ..., "triangles": ..., "boundingBox": {...}, "isSolid": true }],
  "warnings": [],
  "executionTime": 197
}
```

### 5.2 错误返回格式

错误字段在**顶层**（不是 result.error 子对象）：

```json
{
  "success": false,
  "errorType": "KERNEL_ERROR",
  "code": "NO_RETURN | INVALID_RETURN | EMPTY_RETURN | TIMEOUT | ABORTED | ...",
  "message": "代码没有返回几何体（得到 undefined）",
  "line": 3, "column": 5,
  "recoverable": true,
  "suggestion": "请在代码末尾加上 return <几何体>",
  "executionTime": 0
}
```

## 6. Agent 通信机制

### 6.1 订阅（index.html）

```js
let sid = $router.query.sid || 'default';   // 从 URL 查询参数获取订阅 ID
// run_code：直接执行代码字符串
let unsubCode = $mod.$nc.sub(`s.${sid}.ui_run.run_code`, async (err, msg) => {
  var code = JSON.parse(msg.string()).code;
  return await viewer.run(code);            // 返回值作为消息应答
});
// run_file：执行 UFS 代码文件
let unsubFile = $mod.$nc.sub(`s.${sid}.ui_run.run_file`, async (err, msg) => { ... });
```

- 页面地址：`/a/{agent_id}/i?sid={session_id}`
- **sid 与会话绑定**：`ui_run` 工具固定发布到 `s.{当前会话ID}.ui_run.{action}`，
  因此页面必须用 `?sid={会话ID}` 打开才能收到该会话的建模指令。
  不同会话的页面用不同 sid 打开，互不干扰（避免队列订阅串台）。
- 订阅是**队列语义**：同一主题多个订阅者时，每条消息只路由给一个订阅者。

### 6.2 run_code：直接执行代码

```
ui_run action=run_code argv=["--code", "return box(20,15,10);"] mode=sync
```

sync 模式阻塞等待页面执行完毕并返回 JSON（最长约 180s）。

### 6.3 run_file：执行 UFS 代码文件

```
ui_run action=run_file argv=["--path", "agents/{agent_id}/examples/gear.js"] mode=sync
```

Agent 先用 `ufs write` 将建模代码写入任意 UFS 目录，再通过 run_file 让页面加载执行：

| path 示例 | 对应 UFS 位置 |
|---|---|
| `sessions/{session_id}/models/x.js` | `$SESSION/models/x.js`（会话产物） |
| `agents/{agent_id}/examples/x.js` | `$AGENT/examples/x.js`（内置案例库） |
| `home/{user_id}/x.js` | `$USER/x.js`（用户目录） |

**文件服务 URL 规则（实测）**：

```
GET /aic/fs/<全局 UFS 路径>        → 200
GET /aic/agents/{id}/fs/<任意>      → 404（该路由不存在）
```

页面组装地址的方式：`fsBase = '/' + $mod.scoped.split('/')[1] + '/fs'`（即 `/aic/fs`）。
注意 `$mod.scoped` = `/aic/agents/{agent_id}`，**不能直接拼 /fs**。

**关键坑：组件内裸 `fetch` 不是 `window.fetch`**。vhtml 运行时按
`$data → $mod → $sys → … → window` 解析标识符，`$mod.fetch` 是 scoped fetch，
会对以 `/` 开头的路径**自动 prepend 路由前缀**，导致 `/aic/fs/...` 被拼成
`/aic/agents/{id}/aic/fs/...` → 404。组件内请求绝对路径必须显式使用 `window.fetch`。

错误返回：`{ success:false, code: INVALID_PATH | FILE_NOT_FOUND | RUN_FILE_ERROR, message }`。

### 6.4 内置案例库（$AGENT/examples/）

| 文件 | 模型 |
|---|---|
| `examples/lego-brick.js` | 乐高积木（@param 凸点阵列） |
| `examples/gear.js` | 参数化直齿轮 + 键槽 |
| `examples/pipe-joint.js` | 管道三通接头 |
| `examples/flanged-bracket.js` | L 型支架（圆角，展示 OCCT 优势） |
| `examples/gear-reducer.js` | **两级齿轮减速器**（复杂度上限演示：9 部件装配、真实啮合关系 18→54/20→60 齿、~25 次布尔、191k 三角面、820ms；模数/齿厚/壁厚全参数化驱动布局） |

**页面案例选择器**：index.html 在 BrepView 工具栏注入「📦 案例…」下拉，
选择后经 `/aic/fs/agents/{id}/examples/{name}.js` 加载文件并 `viewer.run()` 渲染；
页面打开时默认展示 lego-brick。新增案例文件后需在 index.html 的 `EXAMPLES` 数组登记。

## 7. OCCT WASM 适配器（occt-kernel.js）

### 7.1 加载流程

1. fetch CDN 的 `opencascade.wasm.js`（unpkg，约 323KB），正则剥掉 `export` 语句
2. 注入 `_scriptDir` 与 `wasmBinaryFile`（指向本地 62.8MB WASM）
3. Blob URL → `<script>` 经典加载 → `await window.opencascade()` 工厂
4. 单例缓存（`oc` / `_p`），重复调用直接返回

### 7.2 opencascade.js v1.1.1 API 规律（实测）

| 规律 | 说明 | 示例 |
|---|---|---|
| 构造器编号 | `Class_N` 的 N **不一定等于参数个数** | `MakeTorus_4` 实际要 5 个参数 |
| 枚举路径 | 必须走枚举对象，不能用裸常量 | `oc.TopAbs_ShapeEnum.TopAbs_FACE` |
| 无后缀方法 | 部分方法无数字后缀 | `gp_Trsf.SetScale`、`BRepBndLib.Add`、`BRepFilletAPI_MakeFillet` |
| 布尔参数 | 用 0/1 | `Add_2(radius, edge)` |
| Handle | 需 `.get()` 解引用 | `BRep_Tool.Triangulation(f, loc).get()` |
| 易踩坑 | `Bnd_Box` 绑定不稳定（Add 后仍 IsVoid，Get 需 6 引用参数） | 建议用网格顶点算包围盒 |

### 7.3 v1.2 修复记录（2026-07-21，全部经浏览器实测）

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 1 | sphere() | `MakeSphere_4(r, 2π)` 参数个数错误（期望 4） | 改 `MakeSphere_2(r, 2π)` |
| 2 | torus() | `MakeTorus_4(R, r, 2π)` 参数个数错误（期望 5） | 改 `MakeTorus_4(R, r, 0, 2π, 2π)` |
| 3 | box() | OCCT 盒子以角点锚定（[0,w]³），与内置内核中心原点语义不一致，导致所有布尔结果错位 | 创建后平移 (−w/2, −d/2, −h/2) |
| 4 | fillet() | 枚举路径错误（`oc.ChFi3d_Rational` undefined、`oc.TopAbs_EDGE` 裸常量）导致静默失败；`_warn` 与引擎 `_warning` 字段名不匹配导致警告丢失 | 改 `oc.ChFi3d_FilletShape.ChFi3d_Rational` + `TopAbs_ShapeEnum.*`；字段统一 `_warning`；失败时 console.warn |
| 5 | scale() | `SetScale_1` 不存在 | 改无后缀 `SetScale(pnt, s)` |
| 6 | revolve() | `MakeRevol_2` 多传第 4 参；旋转体法线朝内（体积为负） | 改 3 参调用；新增 `_positive()` 方向校正（同时应用于 extrude） |
| 7 | bounds() | `BRepBndLib.Add_3` 不存在且 `Bnd_Box` 绑定不稳定，静默返回全 0 | 改为基于三角化网格顶点计算 |

## 8. 已知问题

| 问题 | 内核 | 严重度 | 说明 |
|---|---|---|---|
| extrude 圆角过量切削 | 内置 | 高 | `roundProfileCorners()` 对拉伸体倒角时去除材料过多：30×20×10 拉伸体 R5 圆角体积 2977.5（期望 5785.2，−48.5%），R2 −7.5%。box.fillet 正常（走 roundedRectProfile）。**建议：需要圆角时用 OCCT 内核** |
| sketchCircle 是多边形 | OCCT | 低 | OCCT 适配器的 sketchCircle/sketchRoundedRect 用 48 边形多边形近似（−0.29%），非真圆。需要真圆请用 cylinder() |
| revolve 轮廓需闭合 | 通用 | 低 | 轮廓首尾应在轴上（r=0）或自身闭合（如 torus），否则体积无意义（开放网格） |
| 无头浏览器 rAF 暂停 | 环境 | 低 | `viewer.run()` 内 `await this._frame()` 依赖 requestAnimationFrame；无头/后台标签页中会永久挂起。自动化测试时先执行 `viewer._frame = async () => {}` |
| Supported APIs.md 体积大 | 文档 | 低 | 11,579 行自动导出清单，仅供查阅 |

## 9. 测试结果汇总（2026-07-21 实测）

### 9.1 内置 JS 内核

| 测试 | 结果 | 体积(实测/期望) | 备注 |
|---|---|---|---|
| box / cylinder / cone / sphere / torus / pipe | ✓ | 偏差 −0.6% ~ −3.2% | 网格逼近，符合预期 |
| sketchRect/Circle/RoundedRect/Polygon + extrude | ✓ | 精确或 −0.6% | |
| revolve / lathe | ✓ | 一致 | 别名正常 |
| gearProfile(20,2) + extrude | ✓ | 11471.9 | |
| fuse / cut / intersect（box±sphere、板开孔） | ✓ | 偏差 ≤2.8% | BSP 实现正确 |
| fillet: box | ✓ | 5922.7 理论 / 5918.1 | 2.5D 圆角 |
| fillet: extrude | ✗ | −7.5% ~ −48.5% | 见 §8 已知问题 |
| fillet: 不支持的类型 | ✓ | 正确返回警告 | |
| 链式变换 translate/rotate/scale | ✓ | 精确 | |
| 多部件 + 颜色 | ✓ | partCount=2 | |
| 错误处理（无 return / 语法错误 / 空数组） | ✓ | success=false + code | |

### 9.2 OCCT WASM 内核（修复后）

| 测试 | 结果 | 体积(实测/期望) |
|---|---|---|
| box / cylinder / cone / sphere / torus / pipe | ✓ | **全部 0.00% 偏差** |
| sketch + extrude | ✓ | 精确（圆为 48 边形近似 −0.29%） |
| fuse / cut / common | ✓ | **0.00%** |
| fillet: box R3 / cylinder R2 | ✓ | 真实 3D 圆角（box 6000→5572.62） |
| revolve / lathe（含反向轮廓） | ✓ | **0.00%** |
| 链式变换 | ✓ | 精确 |
| gearProfile + extrude | ✓ | 10974.13 |
| 乐高 2x4 对比 | ✓ | 860 三角面 vs 内置 22,981，体积一致 |
| 包围盒 | ✓ | 网格法精确 |

## 10. 待办事项

| 项目 | 优先级 | 状态 |
|---|---|---|
| 验证 fillet / sphere / torus / revolve | 高 | ✅ 已完成（v1.2） |
| 修复 extrude 圆角（roundProfileCorners） | 高 | 待修复 |
| viewer 默认启用 OCCT 内核（带内置内核兜底） | 高 | 待做 |
| 编写 Agent Prompt（$AGENT/index.md） | 中 | 用户要求暂缓 |
| WASM JS 加载切回 CDN / 本地可选 | 中 | 待做 |
| 数据表持久化设计代码 | 低 | 待做 |
| vhtml 组件化重构 | 低 | 待做 |
| 激活代码编辑器（dead code） | 低 | 待做 |

## 11. 自动化测试方法（无头浏览器）

```js
// 1. 绕过 rAF（无头页面 rAF 不触发，run() 会挂起）
viewer._frame = async () => {};

// 2. 加载 OCCT 内核（fire-and-poll，eval 对长 Promise 会超时）
window.__K = {state:'loading'};
import('/aic/fs/agents/{agent_id}/ui/occt-kernel.js').then(async m => {
  viewer.options.kernel = await m.createOCCTKernel();
  window.__K = {state:'ready'};
});

// 3. 批量测试（后台执行，轮询 window.__T）
window.__T = {done:false, result:null};
(async () => {
  const out = [];
  for (const [name, code] of tests) {
    const r = await viewer.run(code);
    out.push({name, ok: r.success, vol: r.stats?.volume, tris: r.stats?.mesh?.triangles});
  }
  window.__T = {done:true, result: out};
})();
```

注意：`web_browser eval` 会等待 Promise，但页面隐藏时 rAF 不触发会导致永久挂起；
所有后台任务应通过 `window.__X` 状态轮询获取结果。
