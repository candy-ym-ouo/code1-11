import { describe, expect, it } from 'vitest';
import { allocateByWeight, ensureMonotonic } from '../time.js';

describe('allocateByWeight', () => {
  it('各段之和严格等于总时长', () => {
    const parts = allocateByWeight(100, [1, 1, 1]);
    expect(parts.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('按权重比例分配整数毫秒', () => {
    // 10 按 1:3 -> 2.5/7.5，floor 2/7 余 1；两个小数部分相同，平局取序号小 -> [3, 7]
    expect(allocateByWeight(10, [1, 3])).toEqual([3, 7]);
    expect(allocateByWeight(9, [1, 1, 1])).toEqual([3, 3, 3]);
  });

  it('余数按最大余数法分配且次序确定', () => {
    // 10/3 = 3.33, 3.33, 3.33：余数 1 给序号 0
    const a = allocateByWeight(10, [1, 1, 1]);
    expect(a).toEqual([4, 3, 3]);
    // 同样输入再次计算完全一致（可复现）
    expect(allocateByWeight(10, [1, 1, 1])).toEqual(a);
  });

  it('权重为 0 时退化为平均分配', () => {
    const parts = allocateByWeight(9, [0, 0, 0]);
    expect(parts).toEqual([3, 3, 3]);
  });

  it('零时长与单元素边界', () => {
    expect(allocateByWeight(0, [1, 2])).toEqual([0, 0]);
    expect(allocateByWeight(25, [1])).toEqual([25]);
    expect(allocateByWeight(25, [])).toEqual([]);
  });
});

describe('ensureMonotonic', () => {
  it('钳制为单调不减的整数毫秒', () => {
    expect(
      ensureMonotonic([
        [10, 20],
        [15, 14],
        [20, 30],
      ]),
    ).toEqual([
      [10, 20],
      [20, 20],
      [20, 30],
    ]);
  });
});
