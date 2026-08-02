# vedio_studio 架构设计

> 浏览器端视频制作 Agent：文件驱动（page_fs）+ 时间轴引擎 + 浏览器导出（WebCodecs + mediabunny）。
> 零后端渲染、零本机二进制（ffmpeg 不需要）、零构建（vendored ESM）。
> 参考：ppt.js（headless 引擎 + vhtml 组件分层）、Remotion（frame 时间轴模型 /
> Sequence / interpolate / easing / captions）、Remotion canvas-capture-extension
> （官方浏览器录制即 canvas + mediabunny，验证本路线）。

## 1. 分层架构

```
┌───────────────────────────────────────────────────────────┐
│ ui/index.html（vhtml 页面：顶栏 + 舞台 + 右侧 ai-box 侧栏）   │
│   ├ <video-stage>     预览/播放组件（canvas + 控制条）        │
│   ├ <video-timeline>  时间轴条（二期：场景/元素/关键帧）       │
│   └ ai-box 对话 + page_exec 指令注册                        │
├───────────────────────────────────────────────────────────┤
│ ui/video/engine.js —— headless 时间轴引擎（核心，纯 JS）      │
│   文档模型 video/1 · 确定性帧渲染 · 动画插值 · 音频图         │
│ ui/video/render.js —— 导出器（纯 JS）                      │
│   WebCodecs VideoEncoder + mediabunny mux + 混音          │
├───────────────────────────────────────────────────────────┤
│ page_fs（浏览器 IndexedDB）                                │
│   projects/{name}/ · assets/ · exports/                   │
└───────────────────────────────────────────────────────────┘
```

三层职责严格分离（同 ppt.js 的 headless 契约）：

- **engine.js = 数据 + 逻辑**：不碰 DOM chrome、不注入 CSS、不挂 window。
  输入文档 JSON，输出 canvas 帧与音频图，导出器与预览共用同一渲染内核。
- **html 组件 = 渲染 + 交互**：canvas 宿主、控制条、时间轴条、导出面板。
- **page_fs = 存储**：项目文件、素材、导出产物全在浏览器本地 IndexedDB。

## 2. 模块职责

### engine.js（headless 时间轴引擎）

| 模块 | 职责 |
|---|---|
| `Video` 类 | `load(doc)` / `getDoc()` / `setDoc()` / `getState()` / `destroy()`；文档校验、场景索引 |
| 时间轴模型 | 帧驱动：`fps`、`durationInFrames = Σ scene.duration`；`t(frame)` → 当前场景、场景内局部时间、元素活跃区间 |
| 插值/缓动 | `interpolate(input, [inMin,inMax], [outMin,outMax], {easing, extrapolate})`、`easing` 函数集（easeInOut/linear/spring 近似）——移植 Remotion 语义 |
| 帧渲染 | `renderFrame(ctx, frame)`：场景背景 → 转场混合 → 元素按 z 序 → 字幕烧录 → 取景框；时间驱动、无 rAF 依赖（导出确定性） |
| 元素渲染器 | text / shape / image / svg / table / chart（复用 ppt.js 渲染内核思路）；video/audio 元素导出时渲染当前帧（video 取帧、audio 静默） |
| 动画 | `fx.enter/exit/delay`、`keyframes`（t→x/y/scale/rotation/opacity）、场景转场（fade/slide/zoom/wipes/iris） |
| 字幕 | captions 列表（场景级/全局 SRT）：样式（字体/大小/描边/背景）、烧录与预览共用 |
| 音频图 | 各轨（music/voice/audio 元素）→ 时间对齐（offset/volume/loop）→ 预览实时调度 / 导出混音两种消费方式 |
| 事件 | `statechange` / `progress` / `error`，与 ppt.js 同构 |

### render.js（导出器）

```
for frame in 0..N-1:
    engine.renderFrame(offscreenCanvas, frame)     // 确定性渲染
    new VideoFrame(canvas) → VideoEncoder(avc1)    // H.264（硬编/软编）
音频：各轨 decode → OfflineAudioContext 混音 → AudioBuffer
     → AudioEncoder(aac)                           // AAC
mediabunny/mp4-muxer：视频轨 + 音频轨 → Blob(mp4)
→ page_fs exports/ + 触发下载（可选镜像 UFS）
```

- 参数：分辨率（默认 720p，可 1080p）、码率、fps（默认与文档一致）
- 进度：帧号/总帧、阶段（渲染帧/编码/混音/封装）、可取消；帧号记录支持断点（二期）
- 内存：流式逐帧编码，VideoFrame 即时 close，峰值 <500MB

### stage.html（`<video-stage>`）

- canvas 宿主 + 引擎实例（$data 持有）
- 控制条：播放/暂停/进度条 seek/循环/音量/帧号显示
- 状态：`preview`（rAF 播放）/ `exporting`（禁用交互显示进度）
- `@cmd` 上报交互意图（同 ppt_studio 的 stage → 页面模式）

### index.html（主页面）

- 顶栏：样例 / 项目列表 / 新建 / 导出 mp4 / 模式切换
- 舞台（`<video-stage>`）+ 右侧切换式侧栏（ai-box 对话 / 属性面板，二期）
- page_exec 指令注册（见 §5）

## 3. 文件架构

```
vedio_studio/                          # agent 根（UFS agents 仓库白名单）
├── index.md                           # 系统提示词：身份 + video/1 格式 + 指令 + 工作规则
├── docs/
│   └── ARCHITECTURE.md                # 本文件
└── ui/
    ├── index.html                     # 主页面（vhtml）：顶栏 + 舞台 + 侧栏
    ├── langs.json                     # 双语 zh-CN / en-US
    ├── video/
    │   ├── engine.js                  # 时间轴引擎（headless，核心，约 4-6k 行）
    │   ├── render.js                  # 导出器（WebCodecs + mediabunny + OfflineAudioContext）
    │   ├── stage.html                 # <video-stage> 预览组件
    │   └── vendor/                    # 离线依赖：mediabunny（mp4 muxer + aac-encoder，tree-shaken）
    └── cases/                         # 内置样例（只读）：cases.json 清单 + <id>/index.json + scenes/
```

依赖引入：mediabunny 为纯 TS ESM（零依赖、可 tree-shake），构建一次打成单个
ESM 文件放 vendor/（同 ppt_studio 的 vendor/ 模式），页面 `<script type="module">`
引入，无需 CDN、无 SAB/COOP-COEP 要求。

## 4. video/1 文档格式

```jsonc
{
  "format": "video/1", "version": 1, "title": "产品宣传片",
  "size": { "width": 1280, "height": 720 }, "fps": 30,
  "theme": { "background": "#0f1420", "color": "#fff", "accent": "#3a6ff7",
             "fontFamily": "system-ui", "captionStyle": { "fontSize": 40, "stroke": "#000" } },
  "music": { "src": "audio/bg.mp3", "volume": 0.3, "loop": true, "offset": 0 },
  "voice": { "src": "audio/voice.mp3", "volume": 1, "offset": 0 },        // 可选整片配音轨
  "scenes": [{
    "id": "s1", "duration": 5,                       // 秒（帧 = round(duration*fps)）
    "transition": "fade",                            // 进入本场景的转场（含时长）
    "transitionIn": 0.6,
    "captions": [{ "start": 0.5, "end": 4.2, "text": "欢迎观看" }],   // 相对场景起点
    "elements": [
      { "id": "t1", "type": "text", "x": 80, "y": 100, "w": 1120, "h": 120,
        "html": "标题", "fontSize": 64, "color": "#fff",
        "fx": { "enter": "fade-up", "enterDur": 0.8, "delay": 0.5,
                "exit": "fade-out", "exitDur": 0.4 } },
      { "id": "k1", "type": "shape", "shape": "rect", "x": 80, "y": 260, "w": 400, "h": 200,
        "fill": "#3a6ff7",
        "keyframes": [ { "t": 0, "x": 80, "opacity": 0 },
                        { "t": 2, "x": 400, "opacity": 1 } ] },        // t 为场景内秒
      { "id": "im1", "type": "image", "src": "image/logo.png", "x": 40, "y": 40, "w": 200, "h": 80 }
    ]
  }]
}
```

- 元素公共字段沿用 ppt 模型：`id/x/y/w/h/rotation/opacity/z/fx`；`keyframes` 为视频新增
- 素材引用一律**相对路径**（相对项目目录），页面解析为 page_fs 可访问 URL
- 场景内 `t` 统一为**秒**（文档友好），引擎内部转帧号
- 拆分约定：index.json（元信息 + scenes 引用）+ `scenes/s1.json` 分文件，AI 逐文件读写

## 5. page_exec 指令集

| 指令 | 说明 |
|---|---|
| `list_video` | 项目列表（page_fs），返回 `{ ok, current, files: [{name, scenes, size, mod_time}], cases }` |
| `new_video` | 新建项目 `{ name, title?, size? }` → page_fs |
| `open_video` | 打开项目（成为当前文档，页面加载） |
| `read_video_file` | 读项目内文件（index.json / scenes/s1.json），返回文本 |
| `write_video_file` | 写项目内文件（AI 传 JSON 文本）——AI 内容创作主通道 |
| `asset_download` | `{ url, path }` 页面 fetch 外部素材 → page_fs（图片/音频） |
| `run_video` | 预览播放（自动推进，配音随动） |
| `stop_video` | 停止播放 |
| `export_video` | 导出 mp4：`{ name?, resolution?, fps?, bitrate? }` → 进度事件 → 产物 page_fs + 下载 |
| `delete_video` | 删除项目目录 |

AI 工作流（对齐 ppt_studio 文件驱动）：`new_video` → `write_video_file` 写
index.json + scenes/ → `run_video` 预览 → 修改 `write_video_file` → 完成
`export_video`。素材由 `asset_download`（AI 给 URL）或页面本地选择导入。

## 6. 与 Remotion 概念对照

| Remotion | vedio_studio 等价物 |
|---|---|
| `Composition`（fps/durationInFrames） | 文档 `fps` + Σ scene.duration |
| `useCurrentFrame()` | 引擎内部 frame 参数（渲染函数入参） |
| `interpolate()` / `easing` / `spring` | `interpolate` + `easing` 函数集（移植语义） |
| `<Sequence from durationInFrames>` | scene（`offset = Σ 前序 duration`） |
| `<Series>` | scenes 顺序数组 |
| `<Img>` / `<Audio>` / `<Video>` | image / audio(music·voice·元素) / video 元素 |
| `@remotion/captions` | captions 列表 + SRT 解析/序列化 |
| React 组件 + headless Chrome 截图 | canvas 确定性帧渲染（同内核预览/导出） |
| ffmpeg 编码 | WebCodecs VideoEncoder(H.264) + AudioEncoder(AAC) + mediabunny mux |
| `<Player>` | `<video-stage>` rAF 预览 |

## 7. 关键实现点与风险

1. **确定性渲染**：导出不用 captureStream（帧时间戳由浏览器决定、可能跳帧），
   改为手动 `renderFrame(ctx, frame)` + `VideoFrame` 逐帧编码——帧精确、可暂停
   续导、质量稳定。mediabunny `CanvasSource` 仅作 WebM 快速录制备选。
2. **音频对齐**：统一 48kHz；各轨 decode 后按 `offset` 对齐到场景时间轴，
   OfflineAudioContext 混音（含 loop、volume、交叉淡入淡出）。
3. **字幕烧录**：canvas 绘制（字体加载 ensure + 描边/阴影/背景框），预览导出一致。
4. **字体**：渲染前 `document.fonts.load` 关键字体（含中文），避免导出缺字。
5. **性能**：720p@30fps 预计 1-3 分钟/60s 视频（硬编）；默认 720p；导出放 rAF
   空闲/worker（二期）保持 UI 响应；单项目建议 ≤5 分钟。
6. **兼容**：Chrome 主目标（4002 平台）；WebCodecs 缺失时提示用 Chrome，或回退
   mediabunny CanvasSource WebM 录制。
7. **page_fs 与 AI 交互**：write_video_file 一次写一个场景文件（KB 级），避免
   长 JSON 进工具参数；read 按文件读。
