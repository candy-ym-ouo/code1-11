import { describe, expect, it } from 'vitest';
import {
  alignTranscript,
  resegment,
  reviseTranscript,
  verifyAnchors,
} from '../index.js';
import type { TimedWord } from '../types.js';

const fixture: TimedWord[] = [
  { text: '爷爷', startMs: 0, endMs: 400 },
  { text: '出生', startMs: 400, endMs: 800 },
  { text: '在', startMs: 800, endMs: 1000 },
  { text: '北京', startMs: 1000, endMs: 1400, isParagraphEnd: true },
  { text: '后来', startMs: 2000, endMs: 2400 },
  { text: '搬到', startMs: 2400, endMs: 2800 },
  { text: '上海', startMs: 2800, endMs: 3200, isParagraphEnd: true },
];

describe('alignTranscript', () => {
  it('展开 ASR 项并生成锚点词流', () => {
    const { words, segments } = alignTranscript(fixture, {
      idNamespace: 'rec-1',
      maxDurationMs: 30_000,
    });
    // 「爷爷」是两个 CJK 字，各自成词；「北京」同理
    expect(words.map((w) => w.text)).toEqual([
      '爷',
      '爷',
      '出',
      '生',
      '在',
      '北',
      '京',
      '后',
      '来',
      '搬',
      '到',
      '上',
      '海',
    ]);
    // 同一项展开出的词时间相邻不重叠，区间闭合
    expect([words[0].startMs, words[0].endMs]).toEqual([0, 200]);
    expect([words[1].startMs, words[1].endMs]).toEqual([200, 400]);
    // 段落标记 -> 两个片段，边界吸附在词上
    expect(segments).toHaveLength(2);
    expect(segments[0].endMs).toBe(1400);
    expect(segments[1].startMs).toBe(2000);
  });

  it('每个词都有确定性 anchorId，且互不相同', () => {
    const { words } = alignTranscript(fixture, { idNamespace: 'rec-1' });
    const ids = new Set(words.map((w) => w.anchorId));
    expect(ids.size).toBe(words.length);
  });
});

describe('resegment 可复现', () => {
  it('相同输入重算得到逐字节一致的结果', () => {
    const { words, paragraphAnchorIds } = alignTranscript(fixture, {
      idNamespace: 'rec-1',
      maxDurationMs: 1000,
    });
    const options = { idNamespace: 'rec-1', maxDurationMs: 1000 } as const;
    const a = resegment(words, options, paragraphAnchorIds);
    const b = resegment(words, options, paragraphAnchorIds);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('调整参数只改切分位置，不动任何词锚点与时间', () => {
    const { words, paragraphAnchorIds } = alignTranscript(fixture, {
      idNamespace: 'rec-1',
      maxDurationMs: 30_000,
    });
    const resegmented = resegment(
      words,
      { idNamespace: 'rec-1', maxDurationMs: 500 },
      paragraphAnchorIds,
    );
    const flat = resegmented.flatMap((segment) => segment.words);
    expect(flat.map((w) => w.anchorId)).toEqual(words.map((w) => w.anchorId));
    expect(flat.map((w) => [w.startMs, w.endMs])).toEqual(
      words.map((w) => [w.startMs, w.endMs]),
    );
  });
});

describe('reviseTranscript 锚点保护', () => {
  it('仅改正标点与大小写：全部锚点原样保留', () => {
    const { words } = alignTranscript(fixture, { idNamespace: 'rec-1' });
    const revised = reviseTranscript(
      words,
      '爷爷出生在北京。后来搬到上海！',
      { idNamespace: 'rec-1', maxDurationMs: 30_000 },
    );
    expect(revised.preservedAnchors).toBe(words.length);
    expect(revised.insertedWords).toBe(0);
    expect(revised.removedAnchors).toBe(0);
    expect(verifyAnchors(words, revised.words)).toEqual([]);
  });

  it('插入新词：旧锚点时间不变，新词时间在相邻锚点之间插值', () => {
    const { words } = alignTranscript(fixture, { idNamespace: 'rec-1' });
    // 在「出生」与「在」之间插入「一九九零年」
    const revised = reviseTranscript(
      words,
      '爷爷出生一九九零年在北京，后来搬到上海。',
      { idNamespace: 'rec-1', maxDurationMs: 30_000 },
    );
    expect(verifyAnchors(words, revised.words)).toEqual([]);
    expect(revised.insertedWords).toBe(5); // 一/九/九/零/年

    const inserted = revised.words.filter((w) => w.anchored === false);
    expect(inserted.map((w) => w.text)).toEqual(['一', '九', '九', '零', '年']);
    // 前锚点「生」结束 800，后锚点「在」开始 800：空隙为 0 时全部贴齐
    for (const word of inserted) {
      expect(word.startMs).toBeGreaterThanOrEqual(800);
      expect(word.endMs).toBeLessThanOrEqual(800);
    }
  });

  it('有真实空隙时按字符权重分配，和为空隙长度且单调', () => {
    const spaced: TimedWord[] = [
      { text: '开头', startMs: 0, endMs: 400 },
      { text: '结尾', startMs: 1400, endMs: 1800 },
    ];
    const { words } = alignTranscript(spaced, { idNamespace: 'r' });
    const revised = reviseTranscript(
      words,
      '开头插入两个字结尾',
      { idNamespace: 'r', maxDurationMs: 30_000 },
    );
    const inserted = revised.words.filter((w) => w.anchored === false);
    expect(inserted).toHaveLength(5);
    // 空隙 400~1400，共 1000ms，按「插入两个字」5 个等长字分配 -> 200 每个
    expect(inserted.map((w) => [w.startMs, w.endMs])).toEqual([
      [400, 600],
      [600, 800],
      [800, 1000],
      [1000, 1200],
      [1200, 1400],
    ]);
  });

  it('替换与删除：旧锚点释放，其余锚点不动', () => {
    const { words } = alignTranscript(fixture, { idNamespace: 'rec-1' });
    // 把「北京」改成「南京」，删掉「后来」
    const revised = reviseTranscript(
      words,
      '爷爷出生在南京，搬到上海。',
      { idNamespace: 'rec-1', maxDurationMs: 30_000 },
    );
    expect(revised.replacedWords).toBe(1); // 北 -> 南
    expect(revised.removedAnchors).toBe(3); // 北(替换) + 后/来(删除)
    expect(verifyAnchors(words, revised.words)).toEqual([]);

    // 「京」以及其他未动词仍在原时间戳上
    const byText = new Map(revised.words.map((w) => [w.text, w]));
    expect(byText.get('京')?.startMs).toBe(1200);
    expect(byText.get('上')?.startMs).toBe(2800);
  });

  it('整段重写没有可保留锚点时不抛错，时间归零', () => {
    const { words } = alignTranscript(fixture, { idNamespace: 'rec-1' });
    const revised = reviseTranscript(words, '完全不同的内容', {
      idNamespace: 'rec-1',
      maxDurationMs: 30_000,
    });
    expect(revised.preservedAnchors).toBe(0);
    expect(revised.words.every((w) => w.startMs === 0 && w.endMs === 0)).toBe(true);
  });

  it('修订后重算仍可复现：同一修订文本两次结果一致', () => {
    const { words } = alignTranscript(fixture, { idNamespace: 'rec-1' });
    const text = '爷爷出生在南京，后来搬到上海居住。';
    const a = reviseTranscript(words, text, { idNamespace: 'rec-1' });
    const b = reviseTranscript(words, text, { idNamespace: 'rec-1' });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
