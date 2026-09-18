import { describe, expect, it } from 'vitest';
import {
  alignWordsToClips,
  realignTranscript,
  segmentWords,
  validateWordTimings,
  wordsDigest,
  type ClipRange,
  type WordTiming,
} from '../src/index.js';

const w = (text: string, startMs: number, endMs: number): WordTiming => ({
  text,
  startMs,
  endMs,
});

const sampleWords = (): WordTiming[] => [
  w('今天', 0, 500),
  w('天气', 500, 1000),
  w('很好', 1000, 1500),
  w('我们', 2200, 2600),
  w('去', 2600, 2800),
  w('学校', 2800, 3200),
];

const sampleClips = (): ClipRange[] => [
  { id: 'clip-a', startMs: 0, endMs: 2000 },
  { id: 'clip-b', startMs: 2000, endMs: 4000 },
];

describe('reproducibility', () => {
  it('recomputing the full pipeline yields identical results', () => {
    const first = alignWordsToClips(sampleWords(), sampleClips());
    const second = alignWordsToClips(sampleWords(), sampleClips());

    expect(second).toEqual(first);
    expect(wordsDigest(first.clips.flatMap((c) => c.segments.map((s) => ({
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
    }))))).toBe(
      wordsDigest(second.clips.flatMap((c) => c.segments.map((s) => ({
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
      })))),
    );
  });

  it('recomputing realignment yields identical tokens and digest', () => {
    const revised = '今天天气真不错，我们一起去学校吧';
    const first = realignTranscript(sampleWords(), revised);
    const second = realignTranscript(sampleWords(), revised);

    expect(second).toEqual(first);
    expect(wordsDigest(second.tokens)).toBe(wordsDigest(first.tokens));
  });

  it('produces a stable, versioned digest for a fixed input', () => {
    const digest = wordsDigest(sampleWords());

    expect(digest).toMatch(/^align\.v1:[0-9a-f]{16}$/);
    expect(digest).toBe(wordsDigest(sampleWords()));
    // 防回归：算法或序列化格式变更时必须显式更新该值并递增版本号
    expect(digest).toBe('align.v1:cb0df6a97f3d947c');
  });

  it('is insensitive to clip input order', () => {
    const forward = alignWordsToClips(sampleWords(), sampleClips());
    const shuffled = alignWordsToClips(sampleWords(), [...sampleClips()].reverse());

    expect(shuffled).toEqual(forward);
  });

  it('segments realigned output deterministically', () => {
    const revised = realignTranscript(sampleWords(), '今天天气很好。我们去学校。');
    const timed = revised.tokens
      .filter((t) => t.startMs !== null && t.endMs !== null)
      .map((t) => w(t.text, t.startMs!, t.endMs!));

    const first = segmentWords(timed);
    const second = segmentWords(timed);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
  });
});

describe('validateWordTimings', () => {
  it('accepts a valid word list', () => {
    expect(validateWordTimings(sampleWords())).toHaveLength(6);
  });

  it('rejects malformed entries with a Chinese message', () => {
    expect(() => validateWordTimings([{ text: '', startMs: 0, endMs: 1 }])).toThrow(/缺少文本/);
    expect(() => validateWordTimings([{ text: '好', startMs: 10, endMs: 5 }])).toThrow(
      /时间戳无效/,
    );
    expect(() => validateWordTimings('not-an-array')).toThrow(/必须是数组/);
  });
});
