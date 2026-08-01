# VeriSim Pro — 浏览器里的数字 IC 设计验证工作台

## 一句话介绍

在网页里写 Verilog，**真实运行** Icarus Verilog 仿真和 Yosys 综合，看波形、看原理图、看面积报告——所有 EDA 计算都在你的浏览器里完成，旁边还有一个能直接帮你跑仿真、改代码的 AI 助手。

## 它是什么

VeriSim Pro 是一个全客户端的数字 IC 学习/验证平台。传统流程里需要安装几十 GB 的 Vivado/Quartus/ModelSim 才能做的事，这里打开网页就能做：

| 能力 | 实现方式 |
|---|---|
| Verilog 编辑 | 内置轻量代码区（行号、示例库、会话文件加载） |
| **真实仿真** | Icarus Verilog 编译为 WASM（ivlpp → ivl → vvp），浏览器内运行 |
| 波形查看 | VCD 自动抓取 + Canvas 波形器：缩放、平移、游标取值、总线 hex 显示 |
| **真实综合** | Yosys WASM，完整 `proc/opt/fsm/memory/techmap` 流程 |
| 综合报告 | 单元数 / 线网 / 触发器 KPI + 单元映射表 |
| 门级网表 + 原理图 | `write_verilog` + netlistsvg 渲染，可缩放平移 |
| **多工艺映射** | 12 种 FPGA 工艺（iCE40/ECP5/Gowin/Xilinx/GateMate/Intel ALM/安路/钛金…）+ ASIC Liberty 流程（内置 NanGate 45nm，支持自带 `.lib`） |
| **AI 协同** | 内置 AI 对话框，可直接调用前端跑仿真/综合、读取结果、迭代修码 |

## 核心特点

1. **零安装、零服务器算力**——引擎是 WASM，仿真综合全在浏览器跑，服务器只发静态文件；
2. **结果是真实的，不是模拟的**——跑的是业界标准的 Icarus Verilog 和 Yosys，单元映射到 `SB_LUT4`、`TRELLIS_FF`、`DFFR_X1` 这些真实原语；
3. **AI 不只是聊天**——AI 通过事件接口直接驱动工作台：写码 → 仿真 → 读 `$display` 输出和波形摘要 → 定位错误 → 修码重跑，形成闭环；
4. **工艺库自由**——FPGA 工艺库引擎内置；ASIC 工艺可导入任意 Liberty 文件，**只存浏览器缓存，不上传服务器**（保密工艺可用）；
5. **国内网络友好**——引擎走国内镜像（jsdmirror）优先、海外镜像次之、服务器本地兜底，配置见 `ui/js/sources.js`。

## 适用人群

| 人群 | 使用场景 |
|---|---|
| **高校师生**（微电子/集成电路/电子工程） | Verilog 课程教学、数电实验、作业演示——学生无需配置任何 EDA 环境，打开链接即做实验；老师当堂演示“改一行代码→波形怎么变→面积怎么变” |
| **IC/FPGA 初学者** | 边写边验证的学习闭环：语法错误、位宽告警、时序行为即时可见，AI 助手随时讲解报错 |
| **数字 IC 设计工程师** | 小模块快速验证、算法原型试错、面积/触发器数量快速评估（“这个 FSM 到底用了几个 DFF”） |
| **培训与在线课程机构** | 免运维的在线实验平台，单文件示例 + AI 辅导降低教学成本 |
| **开源硬件 / EDA 社区** | 基于 Yosys + Icarus 开放工具链，可二次开发、可内网部署 |
| **企业内训 / 涉密环境** | 自带工艺库不上传、引擎可全本地化，支持内网离线部署 |

## 与现有方案的差异

- **对比 Vivado/Quartus/ModelSim**：它们是完整的芯片生产工具（布局布线、时序签核），VeriSim Pro 不取代它们，而是把“写代码 → 仿真 → 综合看结构”这段最高频的学习验证循环压缩到一个网页里，秒开秒用；
- **对比 EDA Playground**：无需注册排队、计算完全在本地（快且离线可用）、AI 深度集成、自定义工艺库不经过第三方服务器；
- **边界说明**：不适合大规模设计的布局布线与时序收敛——那是生产级 EDA 的领域。

## 技术架构速览

- 前端：AgentUI（vhtml）单页应用，入口 `ui/index.html`，详见 `ui/启动说明.md`；
- 引擎：Icarus Verilog WASM（仿真）、YoWASP Yosys 0.64 WASM（综合）、netlistsvg + ELK（原理图）；
- 引擎分发：镜像源列表统一配置于 `ui/js/sources.js`（国内镜像 → 海外镜像 → 服务器相对地址）；
- AI 接入：`ai-box` 对话组件 + `exec 1host=page` 页面指令（sim_code / sim_file / synth_file / show_pane / clear_console），指令文档见 `index.md`。
