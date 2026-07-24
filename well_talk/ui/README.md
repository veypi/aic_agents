# videx-3d 纯 JS 移植版（vhtml 版）

将 Equinor 的 [`@equinor/videx-3d`](https://github.com/equinor/videx-3d)（React + React Three Fiber）核心功能
移植为**零依赖构建、可直接在 HTML 页面中引用的纯 JavaScript 库**（ES Module），仅依赖 three.js
（已本地化到 `lib/vendor/`，离线可用）。

> **vhtml 转换说明**（2026-07-24）：`index.html` 已从纯 HTML 演示页转换为 vhtml 组件页（agentui 首页 `/i`）：
> - 工具栏复选框、Readout/Selected 面板、Tooltip 改为 vhtml 响应式绑定（`v-for`/`v-show`/`:checked`/`v-html`）；
> - 不再使用 importmap：`lib/videx3d.js` 与 `lib/vendor/OrbitControls.js` 中的裸导入 `'three'` 已改为相对路径
>   `./vendor/three.module.js`，页面通过动态 `import()` 加载（three 单例由 ES Module 缓存保证）；
> - 3D 场景搭建等命令式逻辑保留在 `<script>` 块，`<script dispose>` 负责 `viewer.dispose()` 资源清理；
> - 原版纯 HTML 备份于 `../backup/index-pure.html`（独立 HTTP 服务下仍可用，需自行恢复 importmap 的引用方式）。

> **AI 原生化**（2026-07-24）：右侧新增 AI 分析助手面板（`local/ai-panel.html`，内置 `<ai-box>` 对话组件）。
> 面板将 16 个数据查询/视图联动函数注册为 `s.{session_id}.ui_run.{action}` 事件（NATS 订阅，`$watch` 会话 ID 自动重订阅），
> AI 通过 ui_run 调用实现"问答即落图"：数据查询（`well_list/info/trajectory_stats/casings/completion/perforations/formations/at_depth/formation_at/distance/closest_approach/surface_list/qc`）
> + 视图联动（`well_select/locate/selected`）。设计纪律：AI 只消费聚合摘要，原始大数组（position-logs/surface-values）在前端函数内消化成统计值；
> 数值判定在代码里，语言解读在模型里。事件声明见 `../index.md`（agent 系统提示词）。
> 注意：库内轨迹曲线以各自井口为原点，跨井几何计算已在分析层用井口坐标还原为绝对坐标。

## 目录结构

```
app/
├── index.html                 # 演示页面（含合成示例数据）
├── README.md
└── lib/
    ├── videx3d.js             # 库本体（单文件 ES Module）
    └── vendor/
        ├── three.module.js    # three.js r171
        ├── three.core.js
        ├── OrbitControls.js
        └── curve-interpolator.js  # 与原库相同的样条插值器
```

## 快速开始

```html
<script type="importmap">
  { "imports": { "three": "./lib/vendor/three.module.js" } }
</script>
<script type="module">
  import { VidexViewer, DataStore, WellMap } from './lib/videx3d.js';

  const store = new DataStore();
  store.set('position-logs', 'A-1', poslog);   // Float32Array，见下方数据格式
  store.set('casings', 'A-1', casings);

  const viewer = new VidexViewer(document.getElementById('viewer'), { store });
  viewer.addTrajectory('A-1', { color: '#e8c25a', radius: 0.5 });
  viewer.addCasings('A-1');
  viewer.addFormationMarkers('A-1');
  viewer.addSurface('top-reservoir');

  const wellMap = new WellMap(document.getElementById('wellmap'), { interactive: true });
  wellMap.setWellbores(headers);
</script>
```

本地预览：在 `app/` 目录运行 `python3 -m http.server 8080`，浏览器打开 `http://localhost:8080`。
（ES Module 不能用 `file://` 直接打开，需要 HTTP 服务。）

## 已实现功能（对应原库）

| 原库功能 | 移植情况 |
|---|---|
| Wellbore trajectories | ✅ 线（radius=0）与圆管两种轨迹，样条插值与原库一致（curve-interpolator） |
| Casings | ✅ 逐节套管、倒角端面、鞋部扩径（`isShoe` + `shoeFactor`） |
| Completion tools | ✅ 按类别合并渲染、变径轮廓（top/max/bottom）、类别配色表 |
| Shoes | ✅ 沿切线方向的锥形符号 + 标签 |
| Formation markers | ✅ 垂直于轨迹的标记圆盘 + 标签 |
| Formation column | ✅ 按地层区间着色的轨迹柱 |
| Perforations | ✅ 实例化射孔弹（密度、相位、方向数可配） |
| Depth markers | ✅ 按 MD 间隔生成深度标注（支持 MSL/RT 基准） |
| Horizons / surfaces | ✅ 规则网格三角化（空值剔除、旋转变换、彩虹/viridis 等深度色带、单色、线框）+ marching squares 等值线 |
| Pointer events | ✅ 通用 click / move / enter / exit（射线拾取、悬停高亮、`passthrough` 穿透点击） |
| Point-feature label system | ✅ HTML 标签层：优先级、碰撞检测、引线、锚点、可点击、自定义 HTML |
| HTML well map schematic | ✅ SVG 井位图：深度轴、造斜点轴、父子井轨道分支、选中/悬停/深度游标联动 |

**未移植**：Web Worker/Comlink 数据管线（改为内存 `DataStore`，同步生成）、SDF 着色器文字标注
（改为 HTML 标签）、OIT 渲染通道、地震剖面、投影坐标系转换（proj4）、网格简化（Delatin）。

## 数据格式（与原库语义一致）

所有数据通过 `store.set(key, wellboreId, value)` 注入：

| key | 格式 |
|---|---|
| `position-logs` | `Float32Array`，步长 4：`[easting, tvdMsl, northing, mdMsl, ...]` |
| `wellbore-headers` | `{ id, name, well, depthReferenceElevation, kickoffDepthMsl, parent, easting, northing, depthMdMsl, status, ... }` |
| `casings` | `[{ mdTopMsl, mdBottomMsl, outerDiameter, innerDiameter, type, isShoe, properties }]` |
| `completion-tools` | `[{ name, mdTopMsl, mdBottomMsl, length, diameterTop, diameterBottom, diameterMax, diameterDrift, category }]` |
| `perforations` | `[{ mdTopMsl, mdBottomMsl, status, density, phase, innerDiameter, outerDiameter }]` |
| `formations` | `[{ name, color, level, mdTopMsl, mdBottomMsl }]` |
| `surface-meta` | `{ header: { nx, ny, xinc, yinc, xori, yori, rot }, min, max, displayMin, displayMax, color, name }` |
| `surface-values` | `Float32Array`（nx·ny 行主序网格深度，NaN 或 ≤-999 视为空值） |

坐标系：x = 东向偏移，y = -TVD（深度向下为负），z = -北向偏移。

## 主要 API

### `VidexViewer(container, options)`
场景/相机/光照/轨道控制器/渲染循环一体封装。

- `options`: `{ store, background, cameraPosition, target, fov, near, far, grid, gridY, axes, fog, shadows }`
- 组件方法（均返回 `THREE.Object3D`，可用 `visible` 或 `viewer.remove(obj)` 控制）：
  `addTrajectory / addCasings / addCompletionTools / addShoes / addFormationMarkers /
  addFormationColumn / addPerforations / addDepthMarkers / addSurface`
- `viewer.getTrajectory(id)` / `viewer.getPointAtDepth(id, md)`：按 MD 求轨迹点
- `viewer.focus(point, distance)` / `viewer.focusWellbore(id)`：相机聚焦
- `viewer.onBeforeRender(fn)`：逐帧回调

### 指针事件
任意组件方法都接受 `events` 选项：

```js
viewer.addCasings('A-1', {
  events: {
    cursor: 'pointer',
    passthrough: false,            // true 时点击穿透到后面的对象（适合半透明曲面）
    onPointerEnter: (e) => {},     // e: { type, root, object, point, uv, distance, userData, originalEvent }
    onPointerMove:  (e) => {},
    onPointerExit:  (e) => {},
    onClick:        (e) => {},
  },
});
```

### 标签系统 `viewer.labels`

```js
viewer.labels.add({
  id: 'fm1',
  position: [x, y, z],       // 世界坐标锚点
  direction: [dx, dy, dz],   // 可选：标签沿屏幕垂直于该方向偏移
  name: 'Viking Gr.',        // 或 html: '<b>...</b>'
  distance: 18,              // 偏移像素
  side: 1,                   // 偏移侧（1 / -1）
  priority: 3,               // 碰撞检测时高优先级优先显示
  color: '#c0392b',
  collide: true,             // 参与碰撞检测
  dot: true,                 // 显示锚点
  leaderLine: true,          // 显示引线
  onClick: (data, ev) => {}, // 可点击标签
});
viewer.labels.setVisible(id, false);
viewer.labels.collisionDetection = true;
```

### 井位图 `WellMap(container, options)`

```js
const wm = new WellMap(el, {
  interactive: true, depthCursor: true,
  colorMap: { 'A-1': '#e8c25a' },
  onSelect: (id, depth) => {},
  onDepthChange: (depth) => {},
  onWellboreOver: (header, depth) => {},
});
wm.setWellbores(headers);       // 支持 parent 父子井分支
wm.setActiveDepths({ 'A-1': 2500 }); // 实线=活跃段，虚线=未钻段
wm.select('A-1'); wm.setDepth(2450);
```

## 演示页面

`index.html` 参照官方 Storybook 的风格，用合成数据展示全部功能：

- **井丛**：14 口井（12 口从同一平台扇形展开 + 2 口侧钻井），细线轨迹，点击选中（金色高亮）；
- **构造面**：多穹窿 + 渐变断层的大型网格，彩虹色带（浅红深绿蓝）+ 30m 等值线；
- **按需图层**（对应官方 Controls）：套管/完井、套管鞋、地层标记、地层柱、射孔、深度标注、
  线框、色带、等值线，默认仅轨迹 + 曲面可见；
- **Readout / Selected 面板**：悬停轨迹实时显示 Easting/Northing/TVD/MD，点击显示井头信息；
- **井位图联动**：悬停显示轨迹上的深度探针球与红色深度游标，点击选中井。

> 注：套管等组件做了约 15 倍径向夸张（`RADIAL` 常量），否则公里级全景下井筒不足一个像素。
> 使用真实数据时按场景尺度自行调整。
