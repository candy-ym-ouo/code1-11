import { describe, expect, it } from 'vitest';
import { joinWordTexts, segmentWords, type WordTiming } from '../src/index.js';

const w = (text: string, startMs: number, endMs: number): WordTiming => ({
  text,
  startMs,
  endMs,
});

describe('segmentWords', () => {
  it('returns no segments for empty input', () => {
    expect(segmentWords([])).toEqual([]);
  });

  it('breaks on silence longer than pauseMs', () => {
    const words = [w('你好', 0, 500), w('世界', 600, 1100), w('再见', 2000, 2500)];
    const segments = segmentWords(words, { pauseMs: 700 });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ wordStart: 0, wordEnd: 2, startMs: 0, endMs: 1100 });
    expect(segments[1]).toMatchObject({ wordStart: 2, wordEnd: 3, startMs: 2000, endMs: 2500 });
  });

  it('does not break on silence shorter than pauseMs', () => {
    const words = [w('你好', 0, 500), w('世界', 600, 1100)];
    expect(segmentWords(words, { pauseMs: 700 })).toHaveLength(1);
  });

  it('breaks after sentence-ending punctuation even without silence', () => {
    const words = [w('你好。', 0, 500), w('今天', 500, 900), w('天气', 900, 1300)];
    const segments = segmentWords(words);

    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('你好。');
    expect(segments[1].text).toBe('今天天气');
  });

  it('recognizes sentence punctuation before trailing closing quotes', () => {
    const words = [w('他说。"', 0, 500), w('再见', 500, 900)];
    expect(segmentWords(words)).toHaveLength(2);
  });

  it('breaks when a segment would exceed maxSegmentMs', () => {
    const words = [w('一', 0, 400), w('二', 400, 800), w('三', 800, 1200)];
    const segments = segmentWords(words, { pauseMs: 10_000, maxSegmentMs: 1000 });

    expect(segments).toHaveLength(2);
    expect(segments[0].wordEnd).toBe(2);
    expect(segments[1].wordStart).toBe(2);
  });

  it('breaks when a segment reaches maxWords', () => {
    const words = [w('一', 0, 100), w('二', 100, 200), w('三', 200, 300), w('四', 300, 400), w('五', 400, 500)];
    const segments = segmentWords(words, { pauseMs: 10_000, maxWords: 2 });

    expect(segments.map((s) => s.wordEnd - s.wordStart)).toEqual([2, 2, 1]);
  });

  it('numbers segments consecutively from zero', () => {
    const words = [w('一。', 0, 100), w('二。', 100, 200), w('三', 200, 300)];
    expect(segmentWords(words).map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('is deterministic across runs', () => {
    const words = [w('你好。', 0, 500), w('世界', 800, 1200), w('再见', 5000, 5400)];
    expect(segmentWords(words)).toEqual(segmentWords(words));
  });
});

describe('joinWordTexts', () => {
  it('joins latin words with a space', () => {
    expect(joinWordTexts(['hello', 'world'])).toBe('hello world');
  });

  it('joins CJK words directly', () => {
    expect(joinWordTexts(['你好', '世界'])).toBe('你好世界');
  });

  it('does not insert spaces between CJK and latin', () => {
    expect(joinWordTexts(['说', 'hello'])).toBe('说hello');
    expect(joinWordTexts(['hello', '说'])).toBe('hello说');
  });

  it('skips empty word texts', () => {
    expect(joinWordTexts(['hello', '', 'world'])).toBe('hello world');
  });
});
