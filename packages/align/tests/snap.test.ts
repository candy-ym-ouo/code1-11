import { describe, expect, it } from 'vitest';
import {
  alignWordsToClips,
  assignWordsToClips,
  type ClipRange,
  type WordTiming,
} from '../src/index.js';

const w = (text: string, startMs: number, endMs: number): WordTiming => ({
  text,
  startMs,
  endMs,
});

const clip = (id: string, startMs: number, endMs: number): ClipRange => ({
  id,
  startMs,
  endMs,
});

describe('assignWordsToClips', () => {
  it('assigns a word to the clip covering its midpoint', () => {
    const assignments = assignWordsToClips([w('一', 100, 200)], [clip('a', 0, 1000)]);
    expect(assignments).toEqual([{ wordIndex: 0, clipId: 'a', snapped: false }]);
  });

  it('treats clip ranges as left-closed right-open at the seam', () => {
    const clips = [clip('a', 0, 1000), clip('b', 1000, 2000)];
    // 中点恰好 1000：属于 b（左闭右开）
    const [assignment] = assignWordsToClips([w('一', 900, 1100)], clips);
    expect(assignment).toMatchObject({ clipId: 'b', snapped: false });
  });

  it('snaps uncovered words to the nearest clip', () => {
    const clips = [clip('a', 0, 1000), clip('b', 2000, 3000)];
    const [assignment] = assignWordsToClips([w('一', 1200, 1300)], clips);
    expect(assignment).toMatchObject({ clipId: 'a', snapped: true });
  });

  it('breaks distance ties towards the earlier clip', () => {
    const clips = [clip('a', 0, 1000), clip('b', 2000, 3000)];
    // 中点 1500，距两个片段都是 500ms
    const [assignment] = assignWordsToClips([w('一', 1400, 1600)], clips);
    expect(assignment.clipId).toBe('a');
  });

  it('prefers the first sorted clip when ranges overlap', () => {
    const clips = [clip('b', 500, 1500), clip('a', 0, 1000)];
    const [assignment] = assignWordsToClips([w('一', 700, 800)], clips);
    expect(assignment).toMatchObject({ clipId: 'a', snapped: false });
  });

  it('is independent of the input clip order', () => {
    const words = [w('一', 100, 200), w('二', 2100, 2200)];
    const forward = assignWordsToClips(words, [clip('a', 0, 1000), clip('b', 2000, 3000)]);
    const reversed = assignWordsToClips(words, [clip('b', 2000, 3000), clip('a', 0, 1000)]);
    expect(forward).toEqual(reversed);
  });

  it('rejects invalid clip ranges', () => {
    expect(() => assignWordsToClips([w('一', 0, 100)], [clip('bad', 1000, 1000)])).toThrow(
      TypeError,
    );
  });

  it('requires at least one clip', () => {
    expect(() => assignWordsToClips([w('一', 0, 100)], [])).toThrow(TypeError);
  });
});

describe('alignWordsToClips', () => {
  const clips = [clip('a', 0, 1000), clip('b', 1000, 2000)];
  const words = [
    w('你好', 0, 400),
    w('世界', 400, 800),
    w('再见', 1200, 1600),
    w('朋友', 1600, 2000),
  ];

  it('never lets a segment cross a clip boundary', () => {
    const { segments } = alignWordsToClips(words, clips, { pauseMs: 10_000 });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ clipId: 'a', wordStart: 0, wordEnd: 2, text: '你好世界' });
    expect(segments[1]).toMatchObject({ clipId: 'b', wordStart: 2, wordEnd: 4, text: '再见朋友' });
  });

  it('aggregates transcript text and time range per clip', () => {
    const { clips: result } = alignWordsToClips(words, clips, { pauseMs: 10_000 });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      clipId: 'a',
      wordCount: 2,
      startMs: 0,
      endMs: 800,
      text: '你好世界',
    });
    expect(result[1]).toMatchObject({
      clipId: 'b',
      wordCount: 2,
      startMs: 1200,
      endMs: 2000,
      text: '再见朋友',
    });
  });

  it('reports empty clips with null range and empty text', () => {
    const { clips: result } = alignWordsToClips(
      [w('你好', 0, 400)],
      [clip('a', 0, 1000), clip('empty', 5000, 6000)],
    );

    expect(result[1]).toMatchObject({ clipId: 'empty', wordCount: 0, startMs: null, endMs: null, text: '' });
  });

  it('produces identical results for shuffled clip input', () => {
    const forward = alignWordsToClips(words, clips);
    const shuffled = alignWordsToClips(words, [...clips].reverse());
    expect(shuffled).toEqual(forward);
  });
});
