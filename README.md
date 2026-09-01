# 末班车：废土仓库

一款竖屏、纯 2D 的微信小游戏。玩家驾驶车辆外出搜集物资，在有限载荷中取舍，返回废弃仓库后分配资源、修复车辆并扩展下一次探索范围。

当前阶段是技术探路版，只验证一条最小链路：拖动物资进入后备箱、保存状态、重新载入，并分别构建 Web Mobile 与微信小游戏工程。

## 环境

- Cocos Creator 3.8.8
- TypeScript
- 微信开发者工具 2.01.2510290
- Node.js 22 或更高版本

## 常用命令

```bash
npm run doctor
npm run verify
npm run build:web
npm run build:wechat
npm run wechat:open
npm run wechat:preview
```

本机路径可通过 `COCOS_CREATOR_BIN` 与 `WECHAT_DEVTOOLS_CLI` 覆盖。Cocos 的命令行构建仍需要 macOS 图形会话。

游戏共同模型见 [docs/GAME_SKELETON.md](docs/GAME_SKELETON.md)，架构与产品边界见 [docs/DECISIONS.md](docs/DECISIONS.md)，正式货舱交互提案见 [docs/INVENTORY_DESIGN.md](docs/INVENTORY_DESIGN.md)。

当前可测试切片及人工验收步骤见 [docs/SLICE_001_TECH_PROBE.md](docs/SLICE_001_TECH_PROBE.md)。
