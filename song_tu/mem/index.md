# Memory

## Project

### Songtu
- AgentUI 「宋图/清明上河图」是 Three.js 低多边形古风游戏（$AGENT/ui）。架构：多城市数据驱动。
- 表：City(城市/地形terrain JSON)、Building(物件 kind+model JSON)、Npc(人物 city+zone)。Building 每用户上限已调至5000。
- City.terrain JSON: boundary/ground/river/bridge/roads/spawn/ambient/zones/scatter。每城独立加载自己的地形+建筑+NPC。
- ui 文件: index.html(入口+舆图切换UI+道具面板) / lib.js(initGame运行时+loadCity/unloadCity+位置缓存) / generators.js(GENERATORS注册表+buildCustom零件解释器+buildMaterials) / world.js(groundHeight(x,z,world)/makeGround/makeBridge/makeBuilding等，按world配置) / npc.js(zones按城市+world) / textures.js(makeTextures) / engine.js。
- 模型定义: Building.kind选生成器(building/stall/umbrella/tree/willow/bamboo/field/pagoda/well/oxcart/sedan/scarecrow/lantern/hill/boat/custom)，model为参数JSON；custom用{parts:[...]}。
- 城市切换: 舆图按钮→选城→unloadCity(dispose+clearCaches)+loadCity。默认城市is_default(汴京)；localStorage 'songtu_city'记住上次城市。
- 位置缓存: localStorage 'songtu_pos_{city}'(主角x/z/yaw/pitch)与'songtu_npc_{city}'(npc id→x/z/r)，定时2.5s+beforeunload+visibilitychange保存，loadCity时restoreState恢复。
- tables API 真实路径: /aic/agents/{agent_id}/tables/{Table}；ui模块服务路径 /aic/agents/{agent_id}/{file}.js。
- 已有城市: bianjing(汴京,137建筑+10NPC,默认)、luoyang(洛阳,10建筑+2NPC)。
