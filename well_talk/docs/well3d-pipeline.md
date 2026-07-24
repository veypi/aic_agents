# Well3D 技术说明：从数据进入到 Three.js 渲染的完整管线

本文档描述 well3d（`ui/lib/well3d.js`）的端到端数据处理管线：
**数据注入 → 轨迹解析 → 几何生成 → 场景组装 → 渲染集成 → 交互系统**。
文中标注的代码位置对应 `well3d.js` 行号。

## 0. 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│ 页面层 (ui/index.html)                                               │
│  合成数据生成 / 真实数据接入                                            │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼  store.set(key, id, value)
┌─────────────────────────────────────────────────────────────────────┐
│ ① 数据层    DataStore                    L458                        │
│             key → Map(id → value) 的二级内存表                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼  trajectoryFromStore / build*(store, id)
┌─────────────────────────────────────────────────────────────────────┐
│ ② 解析层    getTrajectory              L200                          │
│             坐标归一化 + 样条插值 + 弧长参数化 + MD↔曲线参数映射         │
├─────────────────────────────────────────────────────────────────────┤
│ ③ 几何层    buildTubeGeometry / buildCasings / buildCompletionTools / │
│             buildSurfaceGeometry / buildContourLines ...  L248–1046  │
│             输出: positions/normals/uvs/indices (TypedArray)          │
├─────────────────────────────────────────────────────────────────────┤
│ ④ 组件层    create*Component           L1059–1410                    │
│             几何 + 材质 + userData + 指针事件注册 → THREE.Object3D     │
├─────────────────────────────────────────────────────────────────────┤
│ ⑤ 渲染层    Well3DViewer                L2154                         │
│             WebGLRenderer / Scene / Camera / OrbitControls / 灯光 /   │
│             ResizeObserver / requestAnimationFrame 渲染循环            │
├─────────────────────────────────────────────────────────────────────┤
│ ⑥ 交互层    PointerEventManager (L1414)  LabelLayer (L1586)          │
│             WellMap (L1816)                                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. 数据进入：DataStore 与数据契约

### 1.1 DataStore（L458）

引擎使用同步内存表作为数据管线：

```js
store.set('position-logs', 'F-01', Float32Array)   // 写入
store.get('position-logs', 'F-01')                  // 读取单条
store.get('position-logs')                          // 读取整个 Map
store.ids('wellbore-headers')                       // 全部 id
```

结构为 `Map<key, Map<id, value>>`，无序列化、无深拷贝——写入的 TypedArray/对象按引用存储，
生成器读取时直接消费，零拷贝。

### 1.2 数据契约（所有 key 与格式）

| key | 格式 | 消费方 |
|---|---|---|
| `position-logs` | `Float32Array`，步长 4：`[easting, tvdMsl, northing, mdMsl, ...]` | 轨迹及所有井筒组件 |
| `wellbore-headers` | `{id, name, status, easting, northing, depthMdMsl, kickoffDepthMsl, parent, depthReferenceElevation, ...}` | 井位图、信息面板、AI 接口 |
| `casings` | `[{mdTopMsl, mdBottomMsl, outerDiameter, innerDiameter, type, isShoe, properties}]` | 套管管体 |
| `completion-tools` | `[{name, category, mdTopMsl, mdBottomMsl, length, diameterTop/Bottom/Max/Drift}]` | 完井工具 |
| `perforations` | `[{mdTopMsl, mdBottomMsl, status, density, phase, innerDiameter, outerDiameter}]` | 射孔弹实例 |
| `formations` | `[{name, color, level, mdTopMsl, mdBottomMsl}]` | 地层标记盘/地层柱 |
| `surface-meta` | `{header:{nx,ny,xinc,yinc,xori,yori,rot}, min, max, color, name}` | 构造面 |
| `surface-values` | `Float32Array`（nx·ny 行主序深度网格，NaN 或 ≤-999 为空值） | 构造面 |

### 1.3 坐标系约定（贯穿全管线）

- 输入：油藏坐标（Easting, Northing, TVD Msl，深度为正）
- 场景：Three.js 右手系，**x = 东向偏移，y = -TVD（深度向下为负），z = -北向偏移**
- 所有深度接口对外使用 MD Msl（米），对内映射为归一化曲线参数 u ∈ [0,1]

---

## 2. 轨迹解析层（核心枢纽）

轨迹是所有井筒组件的"脊柱"：套管、完井、地层、射孔、深度标注全部以
`轨迹曲线 + MD区间` 为输入。解析分四步。

### 2.1 坐标归一化（L200–212）

```js
const origEast  = poslogMsl[0];   // 首点东坐标
const origNorth = poslogMsl[2];   // 首点北坐标
points.push([ poslog[j] - origEast, -poslog[j+1], origNorth - poslog[j+2] ]);
```

**每口井的曲线以其井口为局部原点**。设计目的：

1. 浮点精度——油藏坐标动辄数十万米，相对坐标使顶点数值保持在 GPU 友好的量级；
2. 与引擎行为一致（引擎按井分组渲染）。

**代价与对策**：跨井几何计算（井间距离、防碰扫描）丢失井口偏移，必须在分析层
用 `header.easting/northing` 还原绝对坐标（见 `ui/local/ai-panel.html` 的 `absPoint()`）。
场景内渲染、拾取、标签、探针使用的都是局部坐标，自洽无影响。

### 2.2 样条插值（L84，`getSplineCurve`）

测斜点串（25m 间隔的折线）需要变成光滑曲线，使用
`curve-interpolator` 库（`vendor/curve-interpolator.js`）：

```js
new CurveInterpolator(points, { alpha: 1, tension: 0, closed: false })
```

- `alpha: 1` → **弦长参数化**（chordal），对不等距测点最稳健，不打圈；
- `tension: 0` → 最平滑的三次样条（Catmull-Rom 族）。

返回的 curve  facade 提供：`getPointAt(u)`、`getTangentAt(u)`、`getNormalAt(u)`、
`getBoundingBox()`、`nearest(point)`、`length`。

### 2.3 弧长参数化与 MD 映射（L217–244）

样条的参数 u 是几何参数，而工程数据都挂在 **MD（测深）** 上。库内建立双向映射：

```
MD → u:  pos = (md - measuredTop) / measuredLength      （clamped 可选越界拒绝）
u → 点:  curve.getPointAt(pos)  —— 内部经弧长查找表（LUT）+ 数值反解把
         归一化位置换算成样条参数，保证"等弧长"采样
```

`curve-interpolator` 内部用高斯数值积分计算弧长（`NumericalCurveMapper`），
`getPointAt(pos)` 得到的是**按弧长均匀**的点——这保证了后续管体采样密度
`segmentsPerMeter` 的物理意义真实（每米采样数），而不是参数空间均匀。

### 2.4 平行传输标架（L112，`calculateFrenetFrames`）

要沿曲线"扫掠"圆管截面，每个采样点需要一套局部坐标架 (tangent, normal, binormal)。
朴素的 Frenet 标架在直线段法线退化、且会绕切线自旋扭曲。库采用**平行传输
（parallel transport）**：

1. 首帧：选与切线最不共线的世界轴，叉积出初始法线；
2. 递推：第 i 帧法线 = 第 i-1 帧法线绕 `axis = T(i-1)×T(i)` 旋转两切线夹角 θ。

结果是全程无扭曲的标架序列，管体接缝平整（套管/筛管等长管体的关键）。

### 2.5 自适应采样（L158，`getCurvePositions`）

按 `segmentsPerMeter × 弧长` 计算目标段数，再用**切线偏差阈值**做简化：
直线段（相邻切线点积 ≈ 1）跳过分点，弯曲段自动加密。
演示页轨迹用 `segmentsPerMeter: 0.15`，3km 轨迹约 450 段，简化后远少于全量。

---

## 3. 几何生成层（build* 系列）

所有生成器是纯函数：`输入(store, id, options) → 输出 TypedArray 几何或对象清单`。
不碰 THREE 场景对象（除 `toBufferGeometry`/`mergeTubes` 两个转换器）。

### 3.1 变径圆管扫掠（L280，`buildTubeGeometry`）

核心算法（轨迹/套管/完井/地层柱共用）：

```
samples  = getCurvePositions(curve, from, to, density)   // 弧长均匀的 u 序列
frames   = calculateFrenetFrames(curve, samples)         // 平行传输标架
radiusSteps 存在时: 把变径位置合并进 samples 再排序        // 保证变径处有截面
逐 frame 生成 radialSegments+1 个顶点的圆环:
  n = normal·cosθ + binormal·sinθ
  vertex = position + n·r(u),   normal = n
  uv = (θ/2π, 弧长比例)
相邻环四边形 → 两个三角形;  首尾端盖 → triangle fan
```

- **变径**：`radiusSteps = [[u0, r0], [u1, r1], ...]`，`interpolateRadius` 线性插值；
- `computeLengths: true` 时额外输出 `lengths` 顶点属性（供着色器做沿程效果）；
- 输出 `positions / normals / uvs / lengths? / indices` 纯数组包。

`toBufferGeometry`（L412）转 `THREE.BufferGeometry`；`mergeTubes`（L423）把多根管
合并为一个 Geometry（顶点数超 65535 自动升 Uint32 索引）——完井工具按类别
合并渲染，把数十件工具压到每类 1 次 draw call。

### 3.2 各井筒组件生成器

| 生成器 | 行号 | 数据 → 几何的关键逻辑 |
|---|---|---|
| `buildCasings` | L514 | 每层套管一段管体。MD 区间 → u 区间；`isShoe` 层底部扩径 `shoeFactor`（默认 2 倍）做鞋头；非鞋层两端倒角（radiusMin→radius 台阶）。按外径+顶深排序保证嵌套正确 |
| `buildCompletionTools` | L576 | 按 `category` 分组，同类工具管体 `mergeTubes` 合并；轮廓取 `diameterTop/Max/Bottom` 三级变径；配色 `completionToolCategoryColors`（L495） |
| `buildShoes` | L652 | 沿轨迹切线方向的锥形符号 + 可选标签 |
| `buildFormationMarkers` | L683 | 在各层顶深 MD 处取轨迹点与法线，生成垂直于轨迹的标记圆盘 |
| `buildFormationColumn` | L715 | 每个地层区间一段着色管体（按 formation.color），拼接成地层柱 |
| `buildPerforations` | L753 | 射孔段内按 `density`（孔/米）、`phase`（相位角）、方向数螺旋布点，`InstancedMesh` 实例化射孔弹（数千实例 1 次 draw call） |
| `buildDepthMarkers` | L811 | 按 MD 间隔（如 250m）在轨迹上取点，输出标签数据（非几何） |

所有 MD→u 换算统一使用 `clamp((md - measuredTop) / measuredLength, 0, 1)`，
并过滤区间在轨迹范围外的数据项（鲁棒性：数据越界不崩渲染）。

### 3.3 构造面几何（L862，`buildSurfaceGeometry`）

规则网格深度图 → 三角网：

1. **空值剔除**：`vertexIndex` 数组标记有效顶点，NaN/≤-999 的点不生成顶点；
2. **逐格三角化**：每 2×2 格生成两个三角形，要求参与顶点全部有效
   （z = -north，故交换绕序保持法线朝上）；
3. 顶点属性：`position`（ix·xinc, -v, -iy·yinc）、`depth`（原始深度值，供色带）、`uv`；
4. `computeVertexNormals()` 平滑法线；
5. **坐标变换**：先绕网格中心旋转 `rot` 度，再平移到 `(xori, 0, -yori)` 原点。

### 3.4 深度色带与等值线

- **色带**（L912–955）：`colorRamps` 提供 rainbow/viridis/depth/terrain 四组色标；
  组件层按 `depth` 属性在 [displayMin, displayMax] 内归一化采样 `sampleRamp`，
  写入顶点色（`vertexColors: true`），关闭色带时回退单色；
- **等值线**（L962，`buildContourLines`）：**marching squares** 算法——
  对每个等值 level 遍历全部网格单元，四边做线性插值求穿越点，
  2 交点直接连线；4 交点的鞍点按中心均值决定配对方式；
  输出单份 `THREE.LineSegments`（`depthWrite: false` 半透明叠加在曲面上）。

---

## 4. 组件组装层（create*Component，L1059–1410）

生成器到场景的胶水层，以 `createCasingsComponent` 为例：

```
buildCasings(store, id) → sections[]
for each section:
  new THREE.Mesh(geometry, MeshStandardMaterial({ color by type }))
  mesh.userData = { type: 'casing', wellboreId, casing: item }   ← 拾取回传数据
组入 THREE.Group(name=`casings-${id}`)
options.events 存在时 → viewer.events.add(group, handlers)      ← 注册射线拾取
return group
```

要点：

- **userData 携带业务对象**：射线拾取命中后 `e.object.userData.casing` 直接拿到
  该层套管的全部属性（tooltip/信息面板/AI 均依赖此通道）；
- **事件就地注册**：`events: { cursor, passthrough, onPointerEnter/Move/Exit/Click }`
  作为组件选项传入，由 PointerEventManager 统一管理；
- 返回的 Object3D 已加入场景，调用方持有引用控制 `visible`（图层开关）或 `viewer.remove()`。

---

## 5. 渲染集成层：Well3DViewer（L2154）

一体化封装，构造时完成全部渲染基础设施：

```
WebGLRenderer   antialias + setPixelRatio(devicePixelRatio) + setSize(容器)
Scene           background / 可选 fog
PerspectiveCamera   fov 50, near 0.1, far 100000（公里级场景）
OrbitControls   enableDamping(0.08) —— 左键旋转/右键平移/滚轮缩放
灯光 ×4         Ambient + Hemisphere(天/地双色) + Directional×2(主光+补光)
PointerEventManager   绑定 renderer.domElement 与 camera
LabelLayer      HTML 标签层（见 §6.2）
ResizeObserver  容器尺寸变化 → 相机 aspect + renderer 重设
requestAnimationFrame 循环:
  controls.update()  → onBeforeRender 回调 → renderer.render() → labels.update()
```

组件入口即前述 `addTrajectory / addCasings / ... / addSurface` 系列（L2259–2309），
以及查询接口 `getTrajectory(id)` / `getPointAtDepth(id, md)`、相机接口
`focus(point, distance)` / `focusWellbore(id)`（包围盒适配，L2339）。

**资源清理**（L2247）：`dispose()` 停止 rAF、断开 ResizeObserver、注销指针事件、
清空标签层、`renderer.dispose()` 并移除 canvas——vhtml 的 `<script dispose>`
在组件销毁时调用它，防止 WebGL 上下文泄漏。

---

## 6. 交互系统

### 6.1 射线拾取 PointerEventManager（L1414）

- 注册表 `Map<rootObject, handlers>`，拾取时对全部注册根做
  `raycaster.intersectObjects(roots, true)`（递归子对象），每根取最近命中；
- `raycaster.params.Line.threshold = 8`——细线轨迹（radius=0 的 Line）也可被点中；
- 命中映射回根对象后按 handlers 分发 `onPointerEnter/Move/Exit/onClick`，
  事件对象含 `{root, object, point, uv, distance, userData, originalEvent}`；
- `passthrough: true`（如半透明曲面）时该命中被跳过，事件穿透到后方对象；
- `cursor: 'pointer'` 时自动切换鼠标样式。

演示页的典型链路：悬停轨迹 → `curve.nearest()` 反解最近点 u → 换算 MD →
Readout 面板显示 Easting/Northing/TVD/MD；点击 → 材质变色高亮 + Selected 面板。

### 6.2 HTML 标签层 LabelLayer（L1586）

井名/地层/深度标注不走 WebGL 文字（暂不支持 SDF 着色器文字），改为 DOM 方案：

- 容器内叠加 `div.w3-label-layer`（含一张 SVG 画布画引线）；
- 每帧 `labels.update()`：世界坐标 `project(camera)` → NDC → CSS 像素定位；
- 支持 `direction + distance + side` 沿屏幕垂直方向偏移、`dot` 锚点、`leaderLine` 引线；
- **碰撞检测**：按 `priority` 排序，高优先级优先占位，重叠标签自动隐藏
  （演示中井名 priority 10，深度标注 priority 1）；
- 标签可点击（`onClick`），井名标签即选中入口之一。

### 6.3 SVG 井位图 WellMap（L1816）

独立的 2D SVG 组件：纵轴深度标尺 + 各井按造斜点分支的轨道线（父子井 `parent`
关系构图，侧钻井从母井 KOP 处岔出）。交互回调：`onSelect`（点选井）、
`onDepthChange`（深度游标拖动）、`onWellboreOver`（悬停联动 3D 探针球与 Readout）、
`setActiveDepths`（实线=已钻段 / 虚线=未钻段）。与 3D 共用同一 DataStore 数据。

---

## 7. 端到端数据流追踪（以一口井为例）

以演示页 `F-03` 为例，看一个数据包的完整旅程：

```
① index.html: makePoslog() 生成 137 个测点
   → Float32Array(548) [e, tvd, n, md]×137
   → store.set('position-logs', 'F-03', arr)

② viewer.addTrajectory('F-03', { radius: 0 })
   → trajectoryFromStore → getTrajectory:
       归一化(井口原点) → CurveInterpolator(alpha:1, tension:0)
       → 弧长 LUT（数值积分）→ curve
   → radius=0: curve.getPoints() 采样折线 → THREE.Line（细线轨迹）

③ viewer.addCasings('F-03')
   → buildCasings: 4 层套管 MD 区间 → 4 组 u 区间 + radiusSteps(倒角/鞋头)
   → buildTubeGeometry ×4（平行传输标架 + 圆环扫掠 + 端盖）
   → 4 个 MeshStandardMaterial Mesh，userData.casing 回传数据

④ viewer.addSurface('hugin-base', { ramp: rainbow, contours: {...} })
   → buildSurfaceGeometry: 130×130 网格 → ~16.9k 顶点 / ~33k 三角形
   → depth 属性 → sampleRamp(rainbow, t) 逐顶点着色
   → buildContourLines: marching squares，30m 间隔 → LineSegments

⑤ 渲染循环（60fps）: controls 阻尼更新 → 三光源 Phong 着色 → 光栅化
   → labels.update() 把井名标签投影到屏幕并做碰撞检测

⑥ 交互: pointermove → Raycaster(threshold=8) → 命中轨迹
   → curve.nearest() 反解 u → md = top + u·length → Readout 显示
```

数据量级参考（演示场景 14 井 + 1 曲面）：
轨迹采样 ~450 点/井、套管 ~2k 顶点/层、曲面 ~33k 三角形、射孔实例 ~2k/段，
合并后 draw call 数十次，普通核显即可满帧。

---

## 8. 页面编排与 AI 分析层

`ui/index.html`（vhtml 组件）的编排顺序：

1. `<script>` 动态 `import()` 库（无 importmap，相对路径导入 three.module.js）；
2. 合成数据生成（确定性伪随机 seed=42）→ 全部 `store.set()`；
3. `new Well3DViewer(viewerEl, { store, cameraPosition, target, ... })`；
4. 按需 `add*()` 挂载组件，可选图层默认 `visible = false`；
5. 响应式状态（readout/selected/tooltip/layers）⇄ 组件事件回调；
6. 数据与视图接口挂到 `$mod._w3`（store/wellIds/setSelected/locateDepth）。

`ui/local/ai-panel.html` 的 AI 分析层**消费同一 DataStore**，但遵守
"AI 只拿摘要"纪律：

- `trajectory_stats`：position-logs → 井斜/狗腿度(°/30m)/位移等统计值；
- `what_is_at`：四表联查（casings/completion/formations/perforations）+ 绝对坐标；
- `closest_approach`：`absPoint()` 还原井口偏移后双井采样扫描（§2.1 的修正）；
- 数值判定（井型分类、狗腿超标、顶底倒挂）全部在代码内完成，AI 只做工程解读。

---

## 9. 关键设计决策一览

| 决策 | 原因 |
|---|---|
| 井口局部坐标系 | 顶点数值小，GPU 精度友好；跨井计算用 header 偏移还引擎 |
| 弦长参数化样条 + 弧长 LUT | 不等距测点稳健；segmentsPerMeter 有物理意义 |
| 平行传输标架 | 长管体扫掠无扭曲，套管接缝平整 |
| 变径 radiusSteps 合并采样 | 变径位置必有截面，轮廓精确 |
| 完井按类别 mergeTubes | 数十工具 → 每类 1 次 draw call |
| HTML 标签层替代 SDF 文字 | 零着色器成本，天然支持碰撞检测/点击/富文本 |
| DataStore 同步内存表 | 演示/中等规模数据无需 Worker，API 与引擎语义一致 |
| userData 回传业务对象 | 拾取→展示→AI 查询共用一条数据通道 |
