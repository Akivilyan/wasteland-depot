// 确定性可种子随机源（Mulberry32）。
//
// 规则层的所有随机（掉落、事件、风险结算）都必须经由这里，保证
// 「同 seed + 同操作序列 → 同结果」，测试与存档重放可复现。
// Cocos 与微信都不提供可种子的随机，这是官方没有、必须自写的最小部分。

export interface Rng {
  /** 返回 [0, 1) 的浮点数。 */
  next(): number;
  /** 返回 [min, max] 的整数（含两端）。 */
  int(min: number, max: number): number;
  /** 以 probability（0..1）概率返回 true。 */
  chance(probability: number): boolean;
  /** 从数组中随机取一个元素。 */
  pick<T>(values: readonly T[]): T;
  /** 当前内部状态，可序列化，用于存档后恢复随机序列。 */
  state(): number;
  /** 从存档恢复内部状态。 */
  restore(state: number): void;
}

export function createRng(seed: number): Rng {
  // Mulberry32：短、确定、覆盖 32 位种子空间。
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (lo > hi) {
        throw new RangeError(`int: empty range [${min}, ${max}]`);
      }
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(probability) {
      return next() < probability;
    },
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) {
        throw new RangeError('pick: empty array');
      }
      return values[Math.floor(next() * values.length)] as T;
    },
    state: () => state,
    restore(nextState) {
      state = nextState >>> 0;
    },
  };
}
