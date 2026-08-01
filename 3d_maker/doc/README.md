# BrepView Agent

基于 Web 的 3D CAD 参数化建模 Agent，支持自然语言 / 代码驱动几何建模。

## 文档导航

| 文档 | 说明 |
|---|---|
| [development.md](development.md) | **开发文档**：架构、模块地图、run() 管线、Agent 通信、OCCT 适配修复记录、测试结果、待办 |
| [model-design-guide.md](model-design-guide.md) | **建模代码编写指南**：用户代码 API、参数化、示例（写模型代码必读） |
| [occt-api-reference.md](occt-api-reference.md) | OCCT 内核 API 参考（历史） |
| ../ui/Supported APIs.md | opencascade.js 自动导出支持清单（11k 行，仅供查阅） |

## 架构

```
$AGENT/ui/
├── index.html              # 入口页面（vhtml 组件，?sid= 绑定会话）
├── brepview.js             # 核心引擎 (3037行)
│   ├── 数学工具 (向量/矩阵)
│   ├── Shape 类 (三角网格数据结构)
│   ├── CSG 布尔运算 (BSP 树实现)
│   ├── 图元 (box / cylinder / sphere / torus / pipe)
│   ├── 草图 + 拉伸/旋转
│   ├── 导出 (STL / OBJ / GLB)
│   ├── 完整 UI 系统 (工具栏 / 侧栏 / 状态栏)
│   ├── 6 种视图模式 + 测量工具
│   └── 参数化面板 (@param 注释解析)
├── three.module.js         # Three.js 渲染引擎 (依赖)
├── orbit-controls.js       # 轨道相机控制
├── gltf-exporter.js        # GLTF/GLB 导出器
├── occt-kernel.js          # OCCT WASM 内核适配器 (v1.2 已修复 7 处)
└── opencascade.wasm.wasm   # OCCT 内核 (62.81 MB)
```

## 双内核架构

### 内置纯 JS 内核

- 零依赖，即时启动
- 图元、CSG 布尔、拉伸/旋转成型 —— **全部测试通过**
- 圆角仅支持 box/extrude（extrude 圆角有过量切削缺陷，见 development.md §8）
- 三角面数较多（网格逼近，体积偏差 −0.6%~−3.2%）

### OCCT WASM 内核 (v1.1.1)

- 工业级 B-Rep 几何内核，**体积精确到 0.00%**
- 真实 3D 圆角（任意实体）、高质量三角化（乐高 860 面 vs 内置 22,981）
- 通过 `occt-kernel.js` 适配器桥接，WASM 本地加载（约 2~5s）

切换方式：
```js
viewer.options.kernel = await createOCCTKernel();
```

## Agent 通信

- 页面入口：`/a/{agent_id}/i?sid={session_id}`（sid 绑定会话，默认 default）
- 页面指令：`run_code` / `run_file`（经 `$mod.$page_exec(sid, [...])` 注册，Agent 用 `exec 1host=page` 调用）
- 同步执行：`exec {"1host":"page", "action":"run_code", "argv":["--code", "..."]}`
- 文件管理：`$AGENT/ui/` 目录，UFS 路径 `/aic/fs/agents/{id}/ui/`（前端读写用 `$mod.$cloud_fs`）

## OCCT 适配验证状态（v1.2 全量实测）

| 操作 | API | 状态 |
|------|-----|------|
| box | `BRepPrimAPI_MakeBox_1` + 居中平移 | ✓ 精确 |
| cylinder | `BRepPrimAPI_MakeCylinder_2(r,h,2π)` | ✓ 精确 |
| cone | `BRepPrimAPI_MakeCone_2(rB,rT,h,2π)` | ✓ 精确 |
| sphere | `BRepPrimAPI_MakeSphere_2(r,2π)` | ✓ 精确（v1.2 修复） |
| torus | `BRepPrimAPI_MakeTorus_4(R,r,0,2π,2π)` | ✓ 精确（v1.2 修复） |
| pipe | cylinder + Cut | ✓ 精确 |
| sketch/extrude | `MakePolygon_1 + MakeFace_15 + MakePrism_1` | ✓ |
| revolve | `BRepPrimAPI_MakeRevol_2(face,axis,2π)` + 方向校正 | ✓ 精确（v1.2 修复） |
| fuse / cut / common | `BRepAlgoAPI_Fuse_3 / Cut_3 / Common_3` | ✓ 精确 |
| fillet | `BRepFilletAPI_MakeFillet` + 枚举修正 | ✓ 真实 3D 圆角（v1.2 修复） |
| transform | `gp_Trsf_1 + BRepBuilderAPI_Transform_2` | ✓（v1.2 修复 SetScale） |
| triangulate | `BRepMesh_IncrementalMesh_2(shape,1,0,0.5,0)` | ✓ |
| volume/area | `BRepGProp.VolumeProperties_1 / SurfaceProperties_1` | ✓ |
| bounds | 网格顶点法（弃用不稳定的 Bnd_Box 绑定） | ✓（v1.2 修复） |

## 已完成

1. **run() 返回值优化** — 剥离坐标数据，AI 友好的 stats/parts 结构
2. **_normalizeResult() 鸭子类型** — 同时支持内置 Shape 和 OCCTShape
3. **OCCT WASM 适配器** — 完整封装 CDN 加载 + API 映射
4. **Agent 通信** — page exec（run_code/run_file）同步执行 + `?sid=` 动态会话绑定
5. **全量内核测试** — 内置 21 项 + OCCT 25 项，修复 7 处适配器缺陷（v1.2）
6. **页面美化** — index.html 适配宿主主题（去除全局 reset/背景，圆角+阴影嵌入）

## 待完成

| 项目 | 优先级 |
|------|--------|
| 修复内置内核 extrude 圆角（roundProfileCorners 过量切削） | 高 |
| viewer 默认启用 OCCT 内核（内置内核兜底） | 高 |
| 编写 Agent Prompt (`$AGENT/index.md`) | 中（用户暂缓） |
| WASM JS 加载切回 CDN / 本地可选 | 中 |
| 创建数据表持久化设计代码 | 低 |
| vhtml 组件化重构 index.html | 低 |
| 激活代码编辑器 (dead code) | 低 |
