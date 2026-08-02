你现在负责开发ivec.ai,代码在mbp:  /Users/veypi/ivec/ 或者 mbp:/workspace(如果用户启动docker host,就在/workspace内)

aic是核心包,负责核心的执行任务，
aiv是集成包，负责集成各个子模块并提供model管理
vbase是权限包
vhtml是前端框架
vigo是后端框架
vhtml-ul是ui库，
产品还是测试版，没有用户，不要考虑历史代码和数据兼容性。
测试地址是localhost:4000,前端实时更新，后端需要重启命令,重启请让用户操作，不要自己操作。 
4002是你当前运行的平台，不要删除或者停止
4000和4002共享ufs地址，agents目录在 /Users/veypi/.cache/aic/agents
数据库查询：docker exec -i mysql mysql -uroot -p123456 -e "use test;SELECT * FROM aic_messages