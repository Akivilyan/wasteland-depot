# SLICE_006：道路事件接入行车途中

> 状态：自动验证 ✅ 通过（2026-09-03，71 规则测试 + 类型检查 + Web/微信构建 + 模拟器真实点击两趟事件全链路）；人工验收 ⏳ 待财哥确认手感。
> 本切片把 `game.ts` 事件表（6 个示例事件）接进行车演出：卷轴途中弹出
> 「信息 → 选择 → 后果」面板，后果经 `sim` 落权威 GameState 并持久化。

## 验证的问题

道路事件是否真正成立：行车途中按确定性随机抽到事件时，卷轴暂停、弹出事件面板，
玩家选择后后果（油/弹/粮/药/材料增减、情报揭示）真实落到 GameState（与出发扣费、
抵仓入库同一权威状态），存档可查、日志可追溯；无事件时演出照常走完；选择期间
「跳过」不可用，事件必须处理；整趟流程的油量守恒仍然成立。

## 范围（只做这些）

- 规则层 `core/sim.ts`：
  - 把原 `choose`（抽事件+结算糊成一步）拆成两个命令：
    - `drawRoadEvent(rng, config): GameEvent | null`——按 `ROAD_EVENT_CHANCE`
      概率抽一个事件，null 表示本趟无事件（概率为默认值，D8 未拍板）。
    - `resolveEvent(state, event, choiceIndex, config): ActionResult`——结算
      指定事件的指定选项（防护减免 damage 逻辑保留）；`reveal` 后果把地点
      加入 `state.explored`（原 applyOutcome 只出消息不改 explored，此处补上）。
  - `runSimulation` 改用 draw+resolve（null 跳过）。
- 规则层 `core/constants.ts`：`ROAD_EVENT_CHANCE = 0.8`（默认值，D8）。
- 表现层 `presentation/TravelScene.ts`：
  - 去程演出开始后约 1.4s 抽事件（返程不抽——事件密度属 D8，先每趟至多一次）；
    抽中则暂停全部行车 tween（卷轴/结束计时/触发计时同为 tween，一并暂停恢复），
    弹出事件面板：kind 标签 + 事件名 + 两个选项按钮。
  - 选择后：`resolveEvent` 落 GameState → `persistGame` → 面板显示后果文案 →
    约 1s 后销毁面板、恢复卷轴与「跳过」按钮。
  - 事件面板显示期间隐藏「跳过」按钮（事件必须处理，不可跳过未结算）。
  - rng 种子用时间戳（与 loot 会话同策略：表现层一次性会话不要求可重放，
    规则层确定性由可种子 Rng + node 测试保证）。

## 不做（明确排除）

- 事件池扩充与事件清单拍板（D8：仍为 6 个示例事件）。
- 返程途中事件、单趟多事件（密度/节奏待 D8 与手感验收）。
- 事件影响危险度/车辆损坏的实际效果（damage outcome 当前事件表未使用；
  vehicleDamaged 修复流程属后续切片）。
- 侦察员职业的事件情报预览（职业系统未做）。
- 事件面板的美术素材（沿用 Graphics 色块 + Label）。

## 实现文件

- 规则：`core/sim.ts`（drawRoadEvent/resolveEvent，choose 移除）、`core/constants.ts`（ROAD_EVENT_CHANCE）。
- 表现：`presentation/TravelScene.ts`（行车 tween 组管理、事件面板、暂停/恢复）。
- 测试：`tests/sim.test.mjs`（choose 用例改写为 draw+resolve，新增 reveal/防护/无效选项）。

## 验证结果

- 规则层：71 个 node 用例全绿（新增/改写 7 个：抽取确定性、gain/lose 截断、reveal 落 explored、防护减免 damage、无效选项原样返回、全事件空库存不出负资源）。
- 类型检查：`npm run typecheck` 通过（本切片首次接入，见 ADR-007；编写过程中拦下 `Node.setActive`、`Label.let()` 两个凭印象 API）。
- 构建：Web Mobile 与微信小游戏双端构建通过。
- 模拟器真实点击（微信新运行时，computer-use 系统级点击 + CDP 读态断言）：
  - 第 1 趟：出发城郊（油 8→7、弹 6→5）→ 行车约 1.4s 卷轴暂停、弹出「路障」面板、跳过按钮隐藏 → 选「绕路」→ 日志落「事件「路障」→ 失去 2 燃油」、油 7→5 → 结果停留后面板消失、卷轴恢复抵达节点。
  - 第 2 趟：抽到「无线电信号」→ 选「追踪」→ explored 增加 hospital、日志「发现新地点：医院」、资源仅扣出发费用。
  - 返程均无事件；材料 2×1 装舱 1 单位，抵仓入库（材料 4→5），推进到第 3 天（食物 4、危险度 2）。
  - 附带验证 TrunkGrid 高亮修复：点候选卡装舱不再静默抛错（tsc 抓出的 canPlace 参数错误，见 ADR-007）。

## 人工验收要点

- 行车途中事件面板弹出时卷轴停住、选项可点；选择后后果文案可见、卷轴继续。
- 事件扣的油/弹与地图状态行、抵仓结算一致（无凭空增减）。
- 无事件的趟次演出一气呵成，「跳过」始终可用。
