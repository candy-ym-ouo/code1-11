import { segmentWords, type SegmentOptions } from './segment.js';
import { joinWordTexts } from './text.js';
import type {
  ClipRange,
  ClipTranscript,
  TranscriptSegment,
  WordClipAssignment,
  WordTiming,
} from './types.js';

/**
 * 片段排序比较器：按 (startMs, endMs, id) 升序。
 * 所有归属判定都基于排序后的顺序，与调用方传入顺序无关，
 * 保证重算结果可复现。
 */
export function compareClips(a: ClipRange, b: ClipRange): number {
  return a.startMs - b.startMs || a.endMs - b.endMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 返回排序后的新数组，不修改入参。 */
export function sortClips(clips: ClipRange[]): ClipRange[] {
  return [...clips].sort(compareClips);
}

function assertValidClip(clip: ClipRange): void {
  if (
    !Number.isInteger(clip.startMs) ||
    !Number.isInteger(clip.endMs) ||
    clip.startMs < 0 ||
    clip.endMs <= clip.startMs
  ) {
    throw new TypeError(`非法片段时间范围: ${JSON.stringify(clip)}`);
  }
}

/**
 * 把每个词按时间戳归属到一个片段：
 * - 词的中点落在片段 [startMs, endMs) 内即归属该片段
 *   （中点比较用 2 倍整数运算，避免浮点误差）；
 * - 中点同时落在多个重叠片段内时，取排序最靠前的片段；
 * - 中点不在任何片段内时，吸附到边界距离最近的片段，
 *   距离相同取排序最靠前的片段。
 *
 * 纯函数，输出仅取决于输入。
 */
export function assignWordsToClips(
  words: WordTiming[],
  clips: ClipRange[],
): WordClipAssignment[] {
  const sorted = sortClips(clips);
  for (const clip of sorted) assertValidClip(clip);
  if (sorted.length === 0) {
    throw new TypeError('至少需要一个片段才能吸附词序列');
  }

  return words.map((word, wordIndex) => {
    // 中点的 2 倍（整数）：mid2 = 2 * (startMs + endMs) / 2
    const mid2 = word.startMs + word.endMs;

    let covering: ClipRange | null = null;
    for (const clip of sorted) {
      if (2 * clip.startMs <= mid2 && mid2 < 2 * clip.endMs) {
        covering = clip;
        break;
      }
    }
    if (covering) {
      return { wordIndex, clipId: covering.id, snapped: false };
    }

    let best = sorted[0];
    let bestDistance = distanceToClip(mid2, best);
    for (let i = 1; i < sorted.length; i++) {
      const distance = distanceToClip(mid2, sorted[i]);
      if (distance < bestDistance) {
        best = sorted[i];
        bestDistance = distance;
      }
    }
    return { wordIndex, clipId: best.id, snapped: true };
  });
}

/** 词中点到片段边界距离的 2 倍（整数）。 */
function distanceToClip(mid2: number, clip: ClipRange): number {
  if (mid2 < 2 * clip.startMs) return 2 * clip.startMs - mid2;
  if (mid2 >= 2 * clip.endMs) return mid2 - 2 * clip.endMs;
  return 0;
}

export interface AlignToClipsResult {
  assignments: WordClipAssignment[];
  segments: TranscriptSegment[];
  clips: ClipTranscript[];
}

/**
 * 顶层入口：词序列 -> 分段 -> 按词时间戳吸附到片段。
 * 返回每个词的归属、不跨片段的分段，以及每个片段聚合出的转写。
 */
export function alignWordsToClips(
  words: WordTiming[],
  clips: ClipRange[],
  options: SegmentOptions = {},
): AlignToClipsResult {
  const assignments = assignWordsToClips(words, clips);
  const clipOf = new Map(assignments.map((a) => [a.wordIndex, a.clipId]));

  // 分段：在通用断句规则之外，词归属的片段发生变化时也断开
  const baseSegments = segmentWords(words, options);
  const segments: TranscriptSegment[] = [];
  for (const base of baseSegments) {
    let runStart = base.wordStart;
    const flush = (end: number) => {
      const slice = words.slice(runStart, end);
      segments.push({
        index: segments.length,
        startMs: slice[0].startMs,
        endMs: slice[slice.length - 1].endMs,
        wordStart: runStart,
        wordEnd: end,
        text: joinWordTexts(slice.map((word) => word.text)),
        clipId: clipOf.get(runStart) ?? null,
      });
    };
    for (let i = base.wordStart + 1; i < base.wordEnd; i++) {
      if (clipOf.get(i) !== clipOf.get(runStart)) {
        flush(i);
        runStart = i;
      }
    }
    flush(base.wordEnd);
  }

  const clipTranscripts: ClipTranscript[] = sortClips(clips).map((clip) => {
    const wordIndexes: number[] = [];
    for (const assignment of assignments) {
      if (assignment.clipId === clip.id) wordIndexes.push(assignment.wordIndex);
    }
    const clipWords = wordIndexes.map((index) => words[index]);
    return {
      clipId: clip.id,
      wordCount: clipWords.length,
      startMs: clipWords.length > 0 ? clipWords[0].startMs : null,
      endMs: clipWords.length > 0 ? clipWords[clipWords.length - 1].endMs : null,
      text: joinWordTexts(clipWords.map((word) => word.text)),
      segments: segments.filter((segment) => segment.clipId === clip.id),
    };
  });

  return { assignments, segments, clips: clipTranscripts };
}
