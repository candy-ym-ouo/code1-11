import { describe, expect, it } from 'vitest';
import { realignTranscript, type WordTiming } from '../src/index.js';

const w = (text: string, startMs: number, endMs: number): WordTiming => ({
  text,
  startMs,
  endMs,
});

/** 每字一词的中文词序列：今天天气很好 */
const chineseWords = (): WordTiming[] => [
  w('今', 0, 250),
  w('天', 250, 500),
  w('天', 500, 750),
  w('气', 750, 1000),
  w('很', 1000, 1250),
  w('好', 1250, 1500),
];

describe('realignTranscript', () => {
  it('keeps every anchor when the text is unchanged', () => {
    const result = realignTranscript(chineseWords(), '今天天气很好');

    expect(result.matchedCount).toBe(6);
    expect(result.insertedCount).toBe(0);
    expect(result.deletedCount).toBe(0);
    expect(result.tokens.map((t) => [t.text, t.startMs, t.endMs, t.anchor])).toEqual([
      ['今', 0, 250, true],
      ['天', 250, 500, true],
      ['天', 500, 750, true],
      ['气', 750, 1000, true],
      ['很', 1000, 1250, true],
      ['好', 1250, 1500, true],
    ]);
  });

  it('preserves anchors around a replaced character', () => {
    const result = realignTranscript(chineseWords(), '今天天气真好');

    expect(result.matchedCount).toBe(5);
    expect(result.insertedCount).toBe(1);
    expect(result.deletedCount).toBe(1);

    const zhen = result.tokens[4];
    expect(zhen).toMatchObject({ text: '真', anchor: false, startMs: 1000, endMs: 1250 });
    // 未改动的字时间戳精确保留
    expect(result.tokens[3]).toMatchObject({ text: '气', startMs: 750, endMs: 1000, anchor: true });
    expect(result.tokens[5]).toMatchObject({ text: '好', startMs: 1250, endMs: 1500, anchor: true });
  });

  it('interpolates inserted characters evenly inside a pause', () => {
    const words = [w('我们', 0, 400), w('学校', 1000, 1400)];
    const result = realignTranscript(words, '我们一起去学校');

    expect(result.matchedCount).toBe(4);
    expect(result.insertedCount).toBe(3);
    // 400~1000 之间均分给 一/起/去：[400,600] [600,800] [800,1000]
    expect(result.tokens.slice(2, 5).map((t) => [t.text, t.startMs, t.endMs, t.anchor])).toEqual([
      ['一', 400, 600, false],
      ['起', 600, 800, false],
      ['去', 800, 1000, false],
    ]);
    expect(result.tokens[5]).toMatchObject({ text: '学', startMs: 1000, endMs: 1400, anchor: true });
  });

  it('drops deleted words without touching neighbouring anchors', () => {
    const result = realignTranscript(chineseWords(), '今天很好');

    expect(result.deletedCount).toBe(2);
    expect(result.tokens.map((t) => [t.text, t.startMs, t.endMs, t.anchor])).toEqual([
      ['今', 0, 250, true],
      ['天', 250, 500, true],
      ['很', 1000, 1250, true],
      ['好', 1250, 1500, true],
    ]);
  });

  it('pins tokens inserted at the very beginning to the first anchor', () => {
    const result = realignTranscript(chineseWords(), '嗯，今天天气很好');

    expect(result.tokens[0]).toMatchObject({ text: '嗯', startMs: 0, endMs: 0, anchor: false });
    expect(result.tokens[1]).toMatchObject({ text: '，', startMs: 0, endMs: 0, anchor: false });
    expect(result.tokens[2]).toMatchObject({ text: '今', startMs: 0, endMs: 250, anchor: true });
  });

  it('pins tokens appended at the very end to the last anchor', () => {
    const result = realignTranscript(chineseWords(), '今天天气很好呀');
    const last = result.tokens[result.tokens.length - 1];

    expect(last).toMatchObject({ text: '呀', startMs: 1500, endMs: 1500, anchor: false });
  });

  it('returns null times when nothing matches', () => {
    const result = realignTranscript(chineseWords(), '完全不一样的内容');

    expect(result.matchedCount).toBe(0);
    expect(result.tokens.every((t) => t.startMs === null && t.endMs === null && !t.anchor)).toBe(
      true,
    );
  });

  it('matches across case and full/half-width differences', () => {
    const words = [w('Hello', 0, 500), w('World', 700, 1200)];
    const result = realignTranscript(words, 'hello ｗorld');

    expect(result.matchedCount).toBe(2);
    expect(result.tokens[0]).toMatchObject({ text: 'hello', startMs: 0, endMs: 500, anchor: true });
    expect(result.tokens[1]).toMatchObject({ text: 'ｗorld', startMs: 700, endMs: 1200, anchor: true });
  });

  it('treats equivalent punctuation as the same token', () => {
    const words = [w('你好', 0, 400), w('，', 400, 500), w('世界', 500, 900)];
    const result = realignTranscript(words, '你好,世界');

    expect(result.matchedCount).toBe(5);
    expect(result.tokens[2]).toMatchObject({ text: ',', startMs: 400, endMs: 500, anchor: true });
  });

  it('interpolates an inserted english word between anchors', () => {
    const words = [w('hello', 0, 500), w('world', 700, 1200)];
    const result = realignTranscript(words, 'hello brave world');

    expect(result.tokens[1]).toMatchObject({ text: 'brave', startMs: 500, endMs: 700, anchor: false });
    expect(result.tokens[2]).toMatchObject({ text: 'world', startMs: 700, endMs: 1200, anchor: true });
  });

  it('handles an empty original word list', () => {
    const result = realignTranscript([], '全新的文本');

    expect(result.matchedCount).toBe(0);
    expect(result.tokens).toHaveLength(5);
    expect(result.tokens.every((t) => t.startMs === null)).toBe(true);
  });

  it('keeps token times monotonically non-decreasing for monotonic input', () => {
    const result = realignTranscript(chineseWords(), '今天嗯天气真的很不错好');
    const times = result.tokens.map((t) => t.startMs);

    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
    }
  });

  it('never mutates anchor timestamps across chained revisions', () => {
    const original = chineseWords();
    const first = realignTranscript(original, '今天天气真好');
    const second = realignTranscript(original, '今天天气真的很不错');

    // 两次修订里仍是锚点的字，时间戳必须与原序列逐一相等
    for (const result of [first, second]) {
      for (const token of result.tokens) {
        if (!token.anchor || token.sourceIndex === null) continue;
        const source = original[token.sourceIndex];
        expect([token.startMs, token.endMs]).toEqual([source.startMs, source.endMs]);
      }
    }
  });
});
