# SLICE_013 序章教学（§12）

> 「约 15 秒内开始操作：主角四选一（天赋当场展示）→ 车辆自动驶向仓库 → 路上若干可拾取物资与一次装不下的取舍 → 抵达仓库，带回内容即开局资源。不做长过场。」

## Core 层

- `GameState` 新增 `prologueHold: HoldState | null`（序章货舱，抵仓置 null）与 `prologueStep: number`（站点进度；旧档缺失视为 0 = 序章已结束）。
- `createNewGame(hero, seed, stockOverride?)`：第三参覆盖开局库存——序章传空舱，「带回即开局资源」。
- `prologueTake(state, resource, amount)`：序章装舱，复用货舱规则（每格堆叠上限 + 总格数 = 取舍压力；装不下部分留在路上）。
- `finishPrologue(state)`：货舱全量转入仓库（每资源独立上限、溢出作废，与返仓入库同语义），不推进天数。
- 测试 +1（40 全绿）：装舱按格规则、抵仓换算（120 材料→100、20 溢出作废）、重复结算拒绝、旧档（无 prologueHold 字段）等同序章已结束。

## 表现层

- `RegionJourney` 新增 `PROLOGUE_PALETTE`（灰黄晨雾荒原，六区色板之外独立氛围）。
- `RegionalScene`：
  - `pickHero` → 空舱开局 → `buildPrologue()`：卷轴底 + 「货舱 / 赶路」双键；subtitle 显示已过站点与货舱占格。
  - 四站剧本 `PROLOGUE_STOPS`：①超市废墟（食物 60）②抛锚油罐车（燃油 30 + 材料 40）③诊所残骸（药品 20 + 弹药 80）④幸存者营地遗址（8 件物资，超余量——取舍即核心体验第一课）。
  - 站点弹层：逐件「装舱 / 已装舱 / 装不下」三态（`remainingCapacity` 实时算牌面）；「继续赶路」播卷轴进下一站。
  - `settlePrologue`：抵仓结算面板（溢出作文明细）→「开始经营」进仓库主屏。
  - 序章中断可续：`start()` 恢复档时 `prologueHold` 非空即回序章屏（货舱状态随档保存）。
- 取舍语义注记：货舱满格后**同资源未满槽仍可部分装入**（如 100 弹药只进 20、80 留在路上）——「装不下」只在同资源槽全满时出现。这是 loadResource 既有语义，牌面即真相；教学上反而演示了取舍灰度。

## 验证

- `npm run verify` 全绿（40 测试）；微信构建 + 编译通过（web-adapter WARN 无实际影响，沿 012 结论）。
- CDP 冒烟（直调口径：`pickHero → prologueDrive + journey.skip 逐站推进 → 装舱等价 state 操作 → settlePrologue 走真命令`）：
  - 空舱开局 ✓；四站推进 ✓（各站标题/8 件物资 ✓）；满舱 12 格后 5「已装舱」+ 1「装不下」（药品满格）+ 2 可部分装入（弹药 20/100、燃油 10/20）✓；
  - 抵仓结算：food 160→100、material 140→100、ammo 180→100（溢出作废）、fuel 30、medicine 20 ✓；`prologueHold: null` 落档 ✓；进仓库主屏四入口 ✓；
  - CDP 0 JS 错误（2 warning 为已知噪音）。
- 卷轴视觉与四站节奏手感待财哥真机过目。

## 结果

PASS（2026-10-24）。
