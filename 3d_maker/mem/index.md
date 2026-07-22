# Memory

## Project

### KernelSemantics
- 两内核 DSL 语义对齐事实（2026-07 实测源码确认，旧记忆已作废）：内置内核 brep-kernel.js 的 extrudeProfile 沿 Z 居中拉伸（-h/2~+h/2，ensureCCW）；OCCT 适配器 MakePrism 原为 0~h，已在 occt-kernel.js OCCTSketch.extrude 中补 translate(0,0,-h/2) 对齐——此前“内置 0..h / OCCT 对称”的旧结论是错的。其余原语两内核一致：box/cylinder/cone/sphere/torus/pipe 均居中；rotate 均为右手定则（mat4Rotate Rodrigues 与 gp_Trsf.SetRotation 同号）；revolve 绕 Z。切换内核后模型错位的排查思路：对比同一原语在两内核下的包围盒/体积。

### OcctKernel
- occt-kernel.js 加载 OCCT 的关键事实（实测验证）：1) opencascade.js@1.1.1 胶水为 MODULARIZE ESM（factory 参数名 opencascade，返回 Module["ready"] promise），wasm 二进制 ~65MB（非 15MB）；2) 主线程 new WebAssembly.Instance >8MB 被 Chrome 禁止（RangeError），instantiateWasm 钩子必须 try 同步 → catch 后改异步 WebAssembly.instantiate(mod, imports).then(inst => receive(inst, mod)) 并 return {}——胶水 wasm 函数全是惰性 thunk（Module["asm"] 解析），异步安全；若钩子抛错被胶水吞掉会永远卡在 run dependency（现象：进度卡 98%）；3) Chrome 不允许 WebAssembly.Module 入 IndexedDB（DataCloneError，且 put 同步抛错需 try 包裹 tx），缓存降级为二进制 L2；Firefox 支持 Module 入库（L1）；4) factory 调用须传 overrides：window.opencascade({wasmBinaryFile?, instantiateWasm?})；5) 调试手段：web_browser eval 拉 unpkg 胶水 + 浏览器内完整复现 hook 流程（注意 --timeout 要放 argv 末尾，长任务用 fire-and-forget + wait --fn 轮询）。

### PorscheModel
- 保时捷911模型, 最佳版本 $SESSION/models/porsche_v5.js (115部件)。配色: 车身深金属蓝#2f4d75 + 车顶/后视镜/尾翼/A-B柱钢琴黑#191b1e(悬浮车顶) + 轮毂双色(枪灰辐条#4a4e54+银轮辋边#c2c7cc+金色轮毂盖#c8a24a) + 红卡钳#d61f2c + 镀铬饰条#d8dde2 + 琥珀侧转向灯#e8a33d。细节: 环形轮拱包边(pipe intersect)、大灯内组、车标、天窗、后窗饰条、鲨鱼鳍、前翼子板百叶、前唇鳍片、腰线、后视镜镜片、高位刹车灯、后反射器、5片扩散器鳍、hollow双排气。重要经验: (1)页面内核会在 OCCT 与内置间切换(用户在改前端渲染代码导致), 渲染反馈(超时/错位)可能是前端问题非模型问题; (2)extrude 居中依赖内核: OCCT extrude 对称不需translate, 内置 extrude 0..h 需 translate(0,+h/2,0) 居中; 当前 v5 用 OCCT 约定(无translate); (3)OCCT 无法给带凹轮拱的车身 fillet(会失败并可能回退内置内核), 不要用 body.fillet; (4)调优靠用户截图。
