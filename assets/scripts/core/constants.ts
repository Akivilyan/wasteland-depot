// 规则层默认值集中地。
//
// 本文件是唯一允许出现「玩法数字」的地方。任何改动只动这里，
// 不散落到 game/sim 里。所有取值都是 PENDING_DECISIONS.md 里
// 标注「当前为默认值」的临时决定，待财哥/丧彪拍板后改这里即可。

export const GAME_DAYS = 10;

export const STARTING_RESOURCES = {
  fuel: 8,
  food: 8,
  material: 4,
  medicine: 3,
  ammo: 6,
} as const;

export const DAILY_FOOD_COST = 2;
export const DAILY_FUEL_IDLE_COST = 1;
export const STARTING_DAY_NUMBER = 1;

/** 仓库初始（4 项设施，见 GAME_SKELETON 第 6 节）。 */
export const FACILITY_LEVELS = {
  storage: 1,
  repair: 1,
  clinic: 1,
  radio: 1,
} as const;

export interface VehicleStats {
  capacity: number;
  fuelCost: number;
  protection: number;
  range: number;
}

/** 车辆四项能力（载重/油耗/防护/探索距离），GAME_SKELETON 第 7 节。 */
export const VEHICLE_DEFAULT: VehicleStats = {
  capacity: 12,
  fuelCost: 2,
  protection: 0,
  range: 2,
};

/** 每次外出固定的弹药消耗基数。 */
export const TRIP_AMMO_COST = 1;

/** 事件导致的危险等级增长步长。 */
export const DANGER_STEP = 1;
export const MAX_DANGER = 10;

/** 世界危险度的增长方式（GAME_SKELETON 13 节未确认，此处为默认值）。 */
export const DANGER_GROWTH_PER_DAY = 1;

/** 目标：存活到第 10 天结束（GAME_SKELETON 13 节最终目标未确认，此处为默认值）。 */
export const FINAL_DAY_INDEX = GAME_DAYS - 1;

/** 单程油耗换算：每 10km 公路消耗 1 燃油（向上取整，最低 1）。SLICE_003 默认值。 */
export const LEG_FUEL_PER_10KM = 1;
