import { describe, expect, it } from 'vitest';
import { alignWordSequences, buildAnchorId } from '../anchor.js';

describe('buildAnchorId', () => {
  it('相同输入产生相同 ID（可复现）', () => {
    expect(buildAnchorId('rec1', 3, '家')).toBe(buildAnchorId('rec1', 3, '家'));
  });

  it('序号不同则锚点不同，重复词各自独立', () => {
    expect(buildAnchorId('rec1', 0, '好')).not.toBe(buildAnchorId('rec1', 1, '好'));
  });

  it('命名空间隔离不同录音', () => {
    expect(buildAnchorId('rec1', 0, '家')).not.toBe(buildAnchorId('rec2', 0, '家'));
  });

  it('匹配时大小写不敏感，但 ID 规范化稳定', () => {
    expect(buildAnchorId('r', 0, 'Hello')).toBe(buildAnchorId('r', 0, 'hello'));
  });
});

describe('alignWordSequences', () => {
  it('完全相同得到全部 equal', () => {
    const ops = alignWordSequences(['a', 'b'], ['a', 'b']);
    expect(ops).toEqual([
      { type: 'equal', aIndex: 0, bIndex: 0 },
      { type: 'equal', aIndex: 1, bIndex: 1 },
    ]);
  });

  it('识别插入与删除', () => {
    expect(alignWordSequences(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { type: 'equal', aIndex: 0, bIndex: 0 },
      { type: 'insert', bIndex: 1 },
      { type: 'equal', aIndex: 1, bIndex: 2 },
    ]);
    expect(alignWordSequences(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { type: 'equal', aIndex: 0, bIndex: 0 },
      { type: 'delete', aIndex: 1 },
      { type: 'equal', aIndex: 2, bIndex: 1 },
    ]);
  });

  it('不同词识别为 replace', () => {
    expect(alignWordSequences(['a', 'x', 'c'], ['a', 'y', 'c'])).toEqual([
      { type: 'equal', aIndex: 0, bIndex: 0 },
      { type: 'replace', aIndex: 1, bIndex: 1 },
      { type: 'equal', aIndex: 2, bIndex: 2 },
    ]);
  });

  it('大小写差异仍视为匹配', () => {
    const ops = alignWordSequences(['Hello'], ['hello']);
    expect(ops).toEqual([{ type: 'equal', aIndex: 0, bIndex: 0 }]);
  });

  it('重复词场景锚点吸附到正确位置', () => {
    // 第二个 把 保留，第一个 把 被删除
    const ops = alignWordSequences(['把', '把', '门'], ['把', '门']);
    expect(ops).toContainEqual({ type: 'equal', aIndex: 1, bIndex: 0 });
    expect(ops).toContainEqual({ type: 'delete', aIndex: 0 });
  });

  it('空序列边界', () => {
    expect(alignWordSequences([], ['a'])).toEqual([{ type: 'insert', bIndex: 0 }]);
    expect(alignWordSequences(['a'], [])).toEqual([{ type: 'delete', aIndex: 0 }]);
  });

  it('相同输入多次计算结果一致（确定性）', () => {
    const args = [['the', 'cat', 'sat'], ['a', 'cat', 'sits']] as const;
    expect(alignWordSequences([...args[0]], [...args[1]])).toEqual(
      alignWordSequences([...args[0]], [...args[1]]),
    );
  });
});
