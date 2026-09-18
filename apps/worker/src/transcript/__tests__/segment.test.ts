import { describe, expect, it } from 'vitest';
import { buildSegments, snapBoundaryToWords } from '../segment.js';
import type { AlignedWord, TimedWord } from '../types.js';
import { buildAnchorId } from '../anchor.js';

const word = (
  index: number,
  text: string,
  startMs: number,
  endMs: number,
  extra: Partial<AlignedWord> = {},
): AlignedWord => ({
  text,
  spaceBefore: index === 0 ? '' : ' ',
  punctuation: [],
  startMs,
  endMs,
  anchorId: buildAnchorId('r', index, text),
  ...extra,
});

describe('buildSegments', () => {
  it('边界吸附在词时间戳上，不落在词中间', () => {
    const words = [word(0, 'a', 0, 100), word(1, 'b', 100, 200), word(2, 'c', 200, 300)];
    // 当前段达到 200ms（>=150）时，在 c 到来前断开，切点吸附在 b 的 endMs
    const segments = buildSegments(words, { idNamespace: 'r', maxDurationMs: 150 });
    expect(segments.length).toBe(2);
    expect(segments[0]).toMatchObject({ startMs: 0, endMs: 200 });
    expect(segments[1]).toMatchObject({ startMs: 200, endMs: 300 });
    // 切分点两侧共享词边界 200ms，且各段首尾就是词的首尾
    expect(segments[0].words.at(-1)?.endMs).toBe(200);
    expect(segments[1].words[0]?.startMs).toBe(200);
  });

  it('片段 ID 由序号与边界决定，重算一致', () => {
    const words = [
      word(0, 'a', 0, 100),
      word(1, 'b', 100, 200),
      word(2, 'c', 200, 300),
    ];
    const first = buildSegments(words, { idNamespace: 'r', maxDurationMs: 150 });
    const second = buildSegments(words, { idNamespace: 'r', maxDurationMs: 150 });
    expect(second).toEqual(first);
    expect(first[0].id).toBe('seg_r_0_0_200');
    expect(first[1].id).toBe('seg_r_1_200_300');
  });

  it('段落标记处优先断开', () => {
    const words = [word(0, 'a', 0, 100), word(1, 'b', 100, 200), word(2, 'c', 200, 300)];
    const breaks = new Set([words[0].anchorId]);
    const segments = buildSegments(words, { idNamespace: 'r', maxDurationMs: 60_000 }, breaks);
    expect(segments.map((segment) => segment.words.map((w) => w.text))).toEqual([['a'], ['b', 'c']]);
  });

  it('maxWords 硬上限强制断开', () => {
    const words = Array.from({ length: 5 }, (_, index) =>
      word(index, `w${index}`, index * 10, index * 10 + 10),
    );
    const segments = buildSegments(words, { idNamespace: 'r', maxWords: 2 });
    expect(segments.map((segment) => segment.words.length)).toEqual([2, 2, 1]);
  });

  it('单个超长词独占一段', () => {
    const words = [
      word(0, 'long', 0, 100_000),
      word(1, 'a', 100_000, 100_050),
      word(2, 'b', 100_050, 100_100),
    ];
    const segments = buildSegments(words, { idNamespace: 'r', maxDurationMs: 30_000 });
    expect(segments[0].words.map((w) => w.text)).toEqual(['long']);
    expect(segments[1].words.map((w) => w.text)).toEqual(['a', 'b']);
  });

  it('空词流产出空片段', () => {
    expect(buildSegments([], { idNamespace: 'r' })).toEqual([]);
  });

  it('片段文本可还原且保留标点', () => {
    const words = [
      word(0, 'Hello', 0, 100),
      word(1, 'world', 100, 200, { punctuation: ['。'] }),
    ];
    const segments = buildSegments(words, { idNamespace: 'r' });
    expect(segments[0].text).toBe('Hello world。');
  });

  it('参数非法时抛出', () => {
    expect(() => buildSegments([word(0, 'a', 0, 1)], { maxDurationMs: 0 })).toThrow();
    expect(() => buildSegments([word(0, 'a', 0, 1)], { maxWords: 0 })).toThrow();
  });
});

describe('snapBoundaryToWords', () => {
  const timed: TimedWord[] = [
    { text: 'a', startMs: 0, endMs: 100 },
    { text: 'b', startMs: 200, endMs: 300 },
    { text: 'c', startMs: 400, endMs: 500 },
  ];

  it('吸附到最近的词间空隙中点', () => {
    // 空隙 100~200 中点 150；空隙 300~400 中点 350
    expect(snapBoundaryToWords(timed, 140)).toBe(1);
    expect(snapBoundaryToWords(timed, 300)).toBe(2);
  });

  it('平局取较早边界（确定）', () => {
    expect(snapBoundaryToWords(timed, 250)).toBe(1);
  });

  it('少于两个词时无边界可吸附', () => {
    expect(snapBoundaryToWords([{ text: 'a', startMs: 0, endMs: 10 }], 5)).toBeNull();
  });
});
