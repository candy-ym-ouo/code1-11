/**
 * 整数毫秒时间计算工具。
 *
 * 所有输出时间戳都是非负整数，且对同一个词序列单调不减；
 * 余数分配采用「最大余数法 + 稳定次序」，保证重算结果可复现。
 */

export const clampInt = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
};

/**
 * 把总时长 totalMs 按权重 weights 拆成 n 段整数毫秒，各段之和严格等于 totalMs。
 *
 * 先按权重分底额，再把余数依次分给「余数最大、序号最小」的段（最大余数法）。
 * 全部权重为 0 时退化为平均分配，次序仍然确定。
 */
export function allocateByWeight(totalMs: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [clampInt(totalMs)];
  const total = totalMs;
  const weightSum = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);

  if (total <= 0) return new Array(n).fill(0);

  let raw: number[];
  if (weightSum > 0) {
    raw = weights.map((weight) => (total * Math.max(0, weight)) / weightSum);
  } else {
    raw = weights.map(() => total / n);
  }

  const floors = raw.map((value) => Math.floor(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);

  // 按「小数部分降序、原序号升序」分配余数；同分情况下由序号打破平局。
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac > a.frac ? 1 : b.frac < a.frac ? -1 : a.index - b.index));

  let cursor = 0;
  while (remainder > 0) {
    floors[order[cursor % order.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return floors;
}

/**
 * 保证时间戳序列单调不减：相邻词 endMs > startMs 不可能时压缩为同点，
 * 同时每个词的 endMs 不小于自身 startMs。
 */
export function ensureMonotonic(pairs: Array<[number, number]>): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let prevEnd = 0;
  for (const [rawStart, rawEnd] of pairs) {
    const startMs = Math.max(prevEnd, clampInt(rawStart));
    const endMs = Math.max(startMs, clampInt(rawEnd));
    result.push([startMs, endMs]);
    prevEnd = endMs;
  }
  return result;
}
