# vedio_studio 架构设计

> 浏览器端视频制作 Agent：文件驱动（page_fs）+ 确定性帧引擎（DOM 渲染）+ 浏览器导出（WebCodecs + mp4-muxer）。
> 零后端渲染、零本机二进制（ffmpeg 不需要）、零构建（vendored ESM）。
> 参考：Remotion（帧时间轴模型 / Sequence / interpolate / spring / transitions / Studio 编辑器），
> ppt_studio（headless 引擎 + vhtml 组件分层 + panel/toolbar 编辑模式）。

## 0. 阶段规划

| 阶段 | 目标 | 状态 |
|---|---|---|
| 基建 | engine.js（确定性帧引擎）、render.js（MP4 导出）、stage.html（预览）、index.html（AI 侧栏 + page_exec）、cases | ✅ 已完成 |
| **Phase 1（当前）** | **手动视频制作台**：无 AI 依赖的可视化编辑器，对标 Remotion Studio 的编辑体验 | 🚧 进行中 |
| Phase 2 | AI 辅助创作（page_exec 指令已预埋，见 §8）；AI 与手动编辑共存 | 未开始 |
| Phase 3+ | Showreel 高级能力：spring 物理、stagger 逐字动画、bezier 缓动、音频可视化、后期特效、Google Fonts、全局 overlay | 未开始 |

Phase 1 的边界：**用户打开页面即可从零做出一个多场景、带转场/动画/字幕/配乐的视频并导出 MP4，全程不需要 AI**。
AI 侧栏（ai-box）保留在 UI 中（tab 切换），但 Phase 1 不为其开发新能力。

## 1. 分层架构（Phase 1）

```
┌──────────────────────────────────────────────────────────────────┐
│ ui/index.html（vhtml 页面：顶栏 + 三栏工作区 + 底部时间轴）            │
│   ├ <video-scenes>     左栏：场景列表（选中/增删/复制/排序）          │
│   ├ <video-stage>      中栏：预览舞台（播放 + 点选/拖拽/缩放/双击改字）│
│   ├ <video-inspector>  右栏：属性面板（项目/场景/元素三态表单）        │
│   ├ ai-box             右栏 tab：AI 对话（Phase 2 主战场）           │
│   └ <video-timeline>   底栏：时间轴（标尺/playhead/场景轨/元素轨）    │
├──────────────────────────────────────────────────────────────────┤
│ ui/video/engine.js —— headless 时间轴引擎（核心，纯 JS，不碰 UI）     │
│   文档模型 video/1 · 确定性帧渲染（DOM 节点）· 动画插值 · 音频图      │
│ ui/video/render.js —— 导出器（纯 JS）                              │
│   DOM → SVG foreignObject → canvas → WebCodecs H.264 + AAC → MP4   │
├──────────────────────────────────────────────────────────────────┤
│ $mod.$cloud_fs（服务端 UFS，/aic/fs httpfs）                      │
│   sessions/{sid}/vedio/{项目名}/index.json · assets/ · exports/    │
└──────────────────────────────────────────────────────────────────┘
```

三层职责严格分离：

- **engine.js = 数据 + 逻辑**：输入文档 JSON，输出确定性帧 DOM（预览与导出共用同一渲染内核）。
- **html 组件 = 渲染 + 交互**：index 持有文档真身与选中态，子组件各自负责一块交互。
- **cloud_fs = 存储**：项目文件、素材、导出产物全在服务端 UFS（与 AI 会话同一 $SESSION 根，
  AI 可直接用 fs 工具读写——page_exec 文件指令与其等价，仅存 UI 联动差异）。

> 存储选型注记：初版设计为浏览器 IndexedDB（page_fs），但 `page_fs()` 前端操作对象
> 仅暴露 get/put(文本)/ls/rm/exists，无二进制写能力，无法支撑素材上传与 MP4 落盘。
> cloud_fs（ppt_studio 同款）put 直收 Blob、AI 同根可读写，Phase 2 因此无需额外协议。

## 2. Phase 1 编辑器设计

### 2.1 布局（对标 Remotion Studio）

```
┌────────────────────────────────────────────────────────────────┐
│ 顶栏: ▶ Vedio Studio · 标题 · 保存状态 · 样例 · 项目 · 新建 · 导出MP4 │
├───────────┬──────────────────────────────────┬─────────────────┤
│ 场景列表   │                                  │ [属性] [AI助手]  │
│ (video-   │         舞台 video-stage          │  video-         │
│  scenes)  │    （缩放适配 + 编辑交互）          │  inspector /    │
│           │                                  │  ai-box         │
├───────────┴──────────────────────────────────┴─────────────────┤
│ 时间轴 video-timeline: 添加元素条 · 标尺+playhead · 场景轨 · 元素轨 │
└────────────────────────────────────────────────────────────────┘
```

- 顶栏固定；工作区 flex 自适应；时间轴固定高度（~180px，横向滚动）。
- 右栏 tab 默认「属性」（Phase 1 主角），AI 在第二个 tab。
- 暗色主题（沿用现有 #0a0e16 系），样式变量用 agentui 注入的设计 token。

### 2.2 组件划分与职责

| 组件 | 文件 | 职责 | 主要 props | 主要事件 |
|---|---|---|---|---|
| 主页面 | `ui/index.html` | doc 真身/选中态/保存/page_exec/导出/快捷键 | — | — |
| 场景列表 | `ui/video/scenes.html` | 场景卡片（序号/时长/转场/元素数/底色块），点选、添加、复制、删除、上下移 | `:scenes` `:cur` `:readonly` | `pick` `add` `dup` `del` `move(i,dir)` |
| 舞台 | `ui/video/stage.html` | 缩放适配渲染、播放控制、音频预览、**编辑交互**（点选/拖拽移动/八向缩放手柄/双击文本编辑）、导出进度遮罩 | `:editable` `:selid` | `select` `change` |
| 属性面板 | `ui/video/inspector.html` | 三态表单：项目（title/size/fps/theme/字幕样式/音轨）/ 场景（时长/转场/背景/字幕）/ 元素（几何/类型专属/fx/关键帧/图层） | `:doc` `:sel` `:frame` `:readonly` `:uploadasset` | `change` `saveas` `pickel` `delel` `dupel` |
| 时间轴 | `ui/video/timeline.html` | 添加元素工具条、秒标尺、playhead（点击/拖拽 seek）、场景块（宽度∝时长）、当前场景元素轨（关键帧点） | `:doc` `:frame` `:sel` `:readonly` | `seek` `pickscene` `pickel` `addel(type,sub)` |

组件通信规则（与 ppt_studio 相同）：子组件 `$emit('evt', payload)`，父组件 `@evt="handler"`，handler 第一个参数即 payload；父调子用 `$refs.xxx.$data.method()`。

### 2.3 数据流与状态模型

index.html 是唯一状态源：

```js
doc       // video/1 文档对象（$data proxy，所有子组件共享引用）
curName   // 项目名（'' = 样例只读模式）
sel       // 选中态 { kind: 'none'|'scene'|'element', sceneIndex, elId }
curFrame  // 当前帧（rAF 循环从 stage.engine.frame 同步，顶层标量驱动时间轴）
assets    // 素材 ref → dataURL 映射
```

**编辑数据流**（所有编辑操作统一走此管道）：

```
子组件直接改 doc（proxy 嵌套写，响应式自动联动）
  → $emit('change')
  → index.onDocChange()
      ├ $refs.stage.refreshFrame()   // engine.load(doc) 保持帧号重渲染
      └ scheduleSave()               // 600ms 防抖
          └ pf.writeText(index.json) // 持久化 page_fs
```

舞台拖拽是特例（性能）：拖拽中 stage 自己改 doc + 自己 refreshFrame（rAF 节流），
`mouseup` 才 emit('change') 触发保存。

关键约定：

1. **doc 是真身，engine.doc 是副本**。engine.load() 内部 deepClone + normalize，
   任何 doc 修改必须显式 refreshFrame 才反映到画面。
2. **嵌套写必须走 proxy 路径**（vhtml 响应式契约）：子组件收到的 el/scene 引用
   是 proxy，直接 `el.x = 100` 即可；禁止先 `const raw = {...el}` 再改。
3. **列表 `:key` 用稳定 id**（scene.id / element.id），禁止用数组索引。
4. 样例模式（curName=''）所有编辑入口被 `readonly` 闸住，inspector 顶部显示
   「另存为项目」按钮（doc 写入新项目目录后变为可编辑）。

### 2.4 舞台编辑交互（stage.html）

渲染结构（修正现有缩放 bug——frame 节点是文档尺寸，必须 transform 缩放）：

```
.vd-box (尺寸 = 文档尺寸 × scale，margin auto 居中，阴影)
  ├ .vd-clip (尺寸 = 文档尺寸，transform: scale(s)，origin 0 0，overflow hidden)
  │    └ engine.buildFrame() 产出的帧 DOM（每帧 replaceChildren）
  ├ .vd-sel (选中框，scaled 坐标，pointer-events:none)
  │    ├ .nm 元素 id 标签
  │    └ 8 × .vd-handle (nw/n/ne/e/se/s/sw/w，pointer-events:auto)
  └ .vd-textedit (双击文本时的 textarea 浮层)
```

交互：

| 操作 | 行为 |
|---|---|
| 单击元素 | mousedown 委托 `.vd-box` → `closest('[data-el-id]')` → emit select；同时开始拖拽 |
| 单击空白 | emit select(null) → 父级选中当前场景 |
| 拖拽元素 | 屏幕位移 ÷ scale = 文档位移 → 改 el.x/y → rAF 节流 refreshFrame |
| 拖拽手柄 | 八向缩放（resize 忽略 rotation，Phase 1 简化）；最小 8px |
| 双击文本 | 浮层 textarea 编辑 el.html（支持白名单富文本标签）， blur/完成提交，Esc 取消 |
| 拖拽开始 | 若正在播放先暂停 |

`fit()` 用 ResizeObserver 监听宿主尺寸，scale = min(可用宽/文档宽, 可用高/文档高)。

### 2.5 时间轴（timeline.html）

```
[+文本 +矩形 +椭圆 +三角 +箭头 +图片 +图表 +表格]      0:04.2 / 0:16.5  [缩放]
┌──────────────────────────────────────────────────────────┐
│ 0s    1s    2s    3s    4s  … 标尺（点击/拖拽 seek）       │
│ ▌playhead（贯穿全高）                                      │
│ [S1──][S2────][S3────][S4──]  场景轨（宽∝时长，点击选中+seek）│
│ box1  ▓▓▓▓▓▓●───●───●▓▓▓  元素轨（当前场景，●=关键帧）       │
│ tag1  ▓▓▓▓●──────●▓▓▓▓▓▓                                │
└──────────────────────────────────────────────────────────┘
```

- pxPerSec 可选 30/60/100；内容总宽 = 总时长 × pps，横向滚动。
- 元素行：bar 覆盖其所属场景的区间，关键帧点按 `t × pps` 定位；点击行选中元素。
- playhead 位置 = `frame / fps × pps`，由父级 `:frame` prop 每帧驱动。

### 2.6 属性面板（inspector.html）

三态表单（提交时机一律 `@change`，数字输入 `parseFloat` 容错）：

| 态 | 内容 |
|---|---|
| 项目（sel.kind='none'） | 标题、分辨率 w/h、fps；theme（背景/文字色/强调色/字体族）；字幕样式（字号/颜色/描边/底背景/距底）；music、voice 轨（src+上传/音量/循环） |
| 场景（kind='scene'） | 时长、转场类型（none/fade/slide-*/zoom/iris）、转场时长、背景（支持 CSS 渐变文本）；字幕列表（start/end/text 增删改）；元素速选列表 |
| 元素（kind='element'） | 公共：x/y/w/h、rotation、opacity、z、删除/复制、图层上移下移；fx：enter/enterDur/delay、exit/exitDur、countUp；keyframes 编辑器（t/easing/x/y/scale/rotation/opacity，"在当前时间添加"按钮取舞台当前帧的场景内时间）；类型专属字段 |

类型专属字段：

| type | 字段 |
|---|---|
| text | html（textarea，支持 `<b><i><u><br><span>`）、fontSize、fontWeight、color、align、valign、lineHeight、letterSpacing |
| shape | shape（rect/ellipse/triangle/arrow/line）、fill、stroke、strokeWidth、radius、direction |
| image | src（文本 + 上传按钮 → uploadasset prop）、fit、radius |
| svg | markup（textarea） |
| table | columns/rows/header（JSON textarea + 应用按钮） |
| chart | option（JSON textarea + 应用按钮） |
| media | kind、src+上传、fit、loop、muted |

颜色控件统一为「色板 + 文本」双输入（色板覆盖为纯色；文本可填渐变/rgba）。

### 2.7 保存模型

- 编辑即改内存 doc，600ms 防抖写 `index.json`（整文档写，KB 级，成本可忽略）。
- 存储后端：`$mod.$cloud_fs` → 服务端 UFS `/sessions/{sid}/vedio/`；
  会话自举（ensureSession）：URL 带 sid 直接用 → localStorage 复用 → 新建隐藏工作台会话。
- 顶栏显示保存状态：已保存 / 未保存 / 保存中… / 保存失败。
- `localStorage.vedio_studio_last` 记住最后打开的项目，刷新自动恢复。
- 素材上传：`uploadAsset(file)` → `assets/{时间戳}.{ext}` Blob 直写项目目录 + 生成
  dataURL 进 assets 映射（预览/导出立即可用），返回相对引用给元素 src。
- 导出产物写 `vedio/exports/{标题}.mp4`（cloud_fs put Blob）并触发浏览器下载。

### 2.8 快捷键

| 键 | 行为 |
|---|---|
| Space | 播放/暂停（焦点不在输入控件时） |
| Delete / Backspace | 删除选中元素/场景（同上） |
| Esc | 取消文本编辑 / 取消选中 |

## 3. video/1 文档格式（Phase 1 修订）

格式主体不变（见旧版 §4 与 index.md），**一处语义修正** + **一轮动画能力升级**：

### keyframes x/y 改为绝对坐标

旧实现把 `kf.x` 当作相对 el.x 的偏移量（`state.dx = kf.x`），但文档与样例均按
绝对坐标撰写（el.x=120 ↔ kf {x:120}→{x:420}），二者矛盾导致样例中元素与标签错位。

修正（engine.js `sampleKeyframes` / `elementState`）：

- `sampleKeyframes` 未指定的属性返回 `null`（x/y），scale/rotation/opacity 缺省 1/0/1。
- `elementState`：`dx = kf.x != null ? kf.x - el.x : 0`，dy 同理。
- 预览与导出共用 elementState，自动一致。
- 编辑器「添加关键帧」记录绝对坐标（所见即所得）。

### 动画能力升级（2026-08-03，对标 Showreel 后提前落地部分 P3 项）

| 能力 | 字段 | 说明 |
|---|---|---|
| 真实弹簧物理 | easing `spring(damping,stiffness,mass)` | 欠阻尼闭式解（移植 remotion core spring-utils），过冲回弹；命名 `spring` = spring(10,100,1) |
| CSS 贝塞尔缓动 | easing `bezier(x1,y1,x2,y2)` | Newton-Raphson 求解；fx.enter 默认 `bezier(0.16,1,0.3,1)`，fx.exit 默认 `bezier(0.7,0,0.84,0)`（Showreel 曲线） |
| fx 自定义缓动 | `fx.enterEasing` / `fx.exitEasing` | 覆盖默认曲线（含 spring） |
| 逐字 stagger | 文本元素 `stagger: {by,step,delay,dur,dy,dx,rotation,scaleFrom,easing}` | 渲染期拆分 span 逐字/逐词弹簧入场（纯文本专用） |
| 循环环境动画 | 元素 `kfLoop: true` | 关键帧区间取模循环（漂移洗层/上升尘埃/走马灯） |
| 描边生长 | svg `draw: {dur,delay,easing}`；chart `option.draw` | pathLength dashoffset 确定性生长；折线图采样点随进度逐个出现 |

## 4. 引擎/舞台缺陷修正清单（Phase 1 附带）

| # | 问题 | 修正 |
|---|---|---|
| 1 | keyframes x/y 偏移 vs 绝对语义矛盾（§3） | elementState 改绝对坐标换算 |
| 2 | 舞台缩放 bug：frame DOM（文档尺寸）直接塞进缩小 box，无 transform，画面被裁切 | sizer/clip 双层结构 + `transform: scale()`（§2.4） |
| 3 | fit() 仅在 setDoc 时执行，窗口变化不适配 | ResizeObserver |

## 5. Showreel 能力对照与路线图

参考 `ivec/my-video`（Remotion Showreel，localhost:3000/Showreel）逐场景分析：

| Showreel 场景 | 使用的 Remotion 能力 | vedio_studio 对应 | 阶段 |
|---|---|---|---|
| 01 Title | spring() 物理、逐字母 stagger、Easing.bezier、radial-gradient 光晕 | 渐变背景 ✅、逐字动画/弹簧/贝塞尔 ❌ | P3 |
| 02 Kinetic Type | 动态排印（字级时序、位移/旋转组合） | fx enter/exit + keyframes 可近似 ✅（手动排） | P1 可手做 |
| 03 Three.js | react-three-fiber 3D | ❌ 不支持 | 远期 |
| 04 Data Viz | 图表动画、数字滚动 | chart 元素 ✅、fx.countUp ✅ | P1 ✅ |
| 05 Audio | useWindowedAudioData 频谱/波形可视化 | 音轨播放/混音 ✅、可视化 ❌ | P3 |
| 06 Post FX | glitch 等后期效果 | ❌ | P3 |
| 07 Outro | 同 01 | ✅ 近似 | P1 可手做 |
| TransitionSeries | wipe/slide/flip/clockWipe/fade + spring/linear timing | transition（fade/slide/zoom/iris）✅ 简化版 | P1 ✅ / flip·wipe P3 |
| LightLeakOverlay | 全片 overlay 层 | ❌（doc 级 overlay 元素列表） | P3 |
| Hud | 跨场景常驻组件（帧号/进度） | ❌（可做 watermark 元素） | P3 |
| schema.ts + Studio | zod schema → 可视化 props 编辑 | video/1 + inspector ✅ | P1 ✅ |
| google-fonts | 字体加载 | fontFamily 系统字体 ✅、Web 字体 ❌ | P3 |
| `<Player>` | 预览播放器 | video-stage ✅ | P1 ✅ |
| `<Composition>` 侧边栏 | 多合成管理 | 场景列表 + 项目列表 ✅ | P1 ✅ |

**Phase 1 达成标准**：用编辑器手动复刻 Showreel 的 01/02/04/07 场景形态
（标题入场、动态排印、数据图表、片尾）+ 转场串联 + 字幕 + 配乐 + 导出 MP4。

## 6. 模块职责（engine.js / render.js，保持不变）

> 对照验证：Remotion 官方浏览器渲染包 `packages/web-renderer` 与我们同路线
> （DOM → canvas → WebCodecs），但其用 `mediabunny`（mp4-muxer 作者的后继库）
> 做封装，并为保真度自研了 CSS 盒模型光栅器（`web-renderer/src/drawing/`）。
> 我们的 SVG foreignObject 路线是轻量折中（Chrome 支持良好）；若日后遇到
> foreignObject 渲染失真，可参考 `web-renderer/src/drawing/*` 逐步替换为
> 自绘 canvas 元素。

### engine.js（headless 时间轴引擎）

- `Video` 类：`load/getDoc/getState/seek/buildFrame/assetRefs/audioTracks/renderAudioMix/destroy`
- 帧模型：`fps`、`totalFrames = Σ round(scene.duration × fps)`；`frameToScene` 定位场景与场景内时间
- 确定性渲染：`buildFrame(doc, frame)` → 文档尺寸的 detached DOM（内联样式，export-safe）
- 动画：`enterProgress/exitProgress`（fx）、`sampleKeyframes`（关键帧）、`easing` 函数集、`applyCountUp`
- 元素渲染器：text / shape / image / svg / table / chart / media，节点带 `data-el-id`（舞台点选依赖）
- 音频图：music / voice / audio 元素 → 预览（HTMLAudioElement）与导出（OfflineAudioContext 混音）

### render.js（导出器）

- 逐帧：`engine.buildFrame(f)` → SVG foreignObject 序列化 → canvas → `VideoFrame` → `VideoEncoder(avc1)`
- 音频：`renderAudioMix` → `AudioEncoder(mp4a.40.2)`；不支持 AAC 时静默跳过
- 封装：`vendor/mp4-muxer.js`（Muxer + ArrayBufferTarget，fastStart in-memory）
  - 后续可迁移 mediabunny（同作者后继库：流式 target、更多编码器封装、
    web-renderer 同款），Phase 1 维持 mp4-muxer（已 vendored 且可用）
- 约束：素材必须 data: URL（隔离 SVG 文档不加载 blob:/相对路径）；进度回调；可取消（signal）

## 7. 文件架构（Phase 1）

```
vedio_studio/
├── index.md                  # 系统提示词（Phase 2 主战场，Phase 1 不动）
├── docs/
│   └── ARCHITECTURE.md       # 本文件
└── ui/
    ├── index.html            # 主页面：顶栏 + 三栏 + 时间轴 + 状态源 + page_exec
    ├── video/
    │   ├── engine.js         # 时间轴引擎（§3 修订 keyframes）
    │   ├── render.js         # 导出器（不变）
    │   ├── stage.html        # <video-stage> 预览 + 编辑交互（重写）
    │   ├── scenes.html       # <video-scenes> 场景列表（新）
    │   ├── timeline.html     # <video-timeline> 时间轴（新）
    │   ├── inspector.html    # <video-inspector> 属性面板（新）
    │   └── vendor/
    │       └── mp4-muxer.js  # MP4 封装（已就位）
    └── cases/                # 内置样例（只读）：cases.json + product-pitch/index.json
```

## 8. page_exec 指令集（Phase 2 预埋，已可用）

现有指令全部保留、行为不变：`list_video / new_video / open_video / read_video_file /
write_video_file / asset_download / run_video / stop_video / export_video /
delete_video / get_video`。

Phase 1 的编辑器建立在这些指令共用的同一套 doc/page_fs 模型上，因此
「AI 写文档 → 页面自动 reload → 用户手动微调 → 防抖保存」天然闭环，无需额外协议。
AI 侧栏 tab 与属性 tab 并存；`write_video_file` 写 index.json 后页面保持当前帧刷新。

## 9. 关键实现点与风险

1. **确定性渲染**：导出不用 captureStream，手动逐帧 buildFrame + VideoFrame 编码（已验证）。
2. **拖拽性能**：拖拽中每 mousemove 都 engine.load(deepClone) + 重建帧 DOM，rAF 节流；
   文档 ≤ 数十 KB 时远小于帧预算。播放中拖拽先暂停。
3. **文本编辑与帧重建隔离**：编辑浮层是舞台模板节点，不在 clip 内，
   播放/刷新帧（replaceChildren clip 子树）不会销毁 textarea。
4. **导出素材**：foreignObject 隔离文档只认 data: URL，assets 映射在 loadAssets 时
   统一转 dataURL（现有逻辑）；新增上传素材走同一路径。
5. **字体**：系统字体族；Web 字体（Google Fonts）列入 P3（渲染前 document.fonts.load）。
6. **导出性能**：720p@30fps 约 1×实时（硬编）；默认 720p；单项目建议 ≤60s。
7. **兼容**：Chrome/Edge 主目标（WebCodecs）；缺失时导出按钮报错提示。
8. **响应式陷阱**（vhtml 契约）：禁止索引 key、禁止裸引用改写嵌套、流式更新走顶层标量。
9. **vhtml 事件名陷阱（已踩）**：组件自定义事件名**不得使用 DOM 内置事件名**
   （change/input/select 等在 utils.EventsList 中）。`$emit('change')` 会被父组件
   `@change` 当作原生 DOM 事件监听，自定义负载永远到不了——本工程统一用 `mutate`。
10. **vhtml 代理同一性（已踩）**：父子组件共享文档必须传 sandbox 读出的**代理对象**
    （如 `setDoc(doc)` 而非 `setDoc(d_raw)`）。vhtml copyBind 语义下，父组件 $data 的
    doc 代理在后续赋值中保持同一性，子组件拿到该代理后双方的写才落在同一响应式图上；
    传裸对象会造成「舞台改的东西 inspector 看得见、doSave 存不下」的隐性分叉。
11. **vhtml 代理数组 splice 陷阱（已踩）**：Wrap 代理数组上直接 `splice` 会把插入项
    复制到后续多个位置（实测复现）；`push` 安全。结构性修改（插入/删除/移动）统一
    「`slice()` 拷贝 → 原生数组上改 → 整体赋回」（赋值走 copyBind 数组合并）。
    另：v-for keyed 列表在重排后显示可能过期——结构变更时递增版本号拼进 `:key`
    （`ver + ':' + item.id`）强制重建；行内输入编辑的列表不拼数据值进 key（丢焦点）。
9. **已知简化**（Phase 1 接受）：resize 不感知 rotation、无多选、无撤销栈（P2/P3 评估）、
   场景排序用上下按钮而非拖拽。

## 10. Remotion 源码参考地图（/Users/veypi/test/remotion）

后续阶段实现高级能力时，直接对照以下源码移植（均为 MIT）：

| 能力 | 源码位置 | 移植目标 |
|---|---|---|
| spring() 物理弹簧 | `packages/core/src/spring/`（spring-utils.ts 解析解） | engine.js `easing` 集 |
| Easing.bezier 三次贝塞尔 | `packages/core/src/bezier.ts`、`easing.ts` | engine.js `easing` 集 |
| interpolate 完整语义 | `packages/core/src/interpolate.ts`（多段 range、extrapolate） | engine.js `interpolate`（已具备简化版） |
| TransitionSeries 转场合集 | `packages/transitions/src/`（wipe/flip/clockWipe/slide/fade） | engine.js `TRANSITION_ENTER` 扩展 |
| 交错/级联动画 | `packages/animation-utils/src`（stagger 工具） | engine.js fx.stagger（逐字/逐项） |
| 音频可视化 | `packages/media-utils/src`（visualizeAudio / visualizeAudioWaveform / createSmoothSvgPath） | engine.js 新增 visualizer 元素 |
| 后期特效 | `packages/effects/src`（glitch/light-leak 等，CSS filter 实现） | 场景/文档级 effects 字段 |
| Google Fonts 加载 | `packages/google-fonts/src`（按字体分包） | 主题 fontFamily + 渲染前 fonts.load |
| Studio 关键帧编辑深化 | `packages/studio/src/components/Timeline/`（拖拽关键帧、EasingEditorModal、剪贴板） | timeline.html P2/P3 升级参考 |
| Studio 属性检查器 | `packages/studio/src/components/Editor*.tsx`、`DefaultPropsEditor.tsx` | inspector.html 对照 |
| 浏览器导出深化 | `packages/web-renderer/src/`（mediabunny 封装、drawElementImage 探测、自研光栅器 drawing/） | render.js 演进路线（§6） |
| captions/SRT | `packages/captions/src` | engine.js captions 扩展（SRT 导入） |

注意：Remotion 的帧模型与我们一致（frame 驱动的纯函数渲染），移植时把 React
组件体内的时序逻辑换算为 video/1 的关键帧/fx 参数即可，无需引入 React。
