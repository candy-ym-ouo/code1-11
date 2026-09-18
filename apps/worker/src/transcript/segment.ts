/**
 * 转录分段：把连续的词流切成片段，片段边界一律「吸附」到词时间戳，
 * 绝不出现落在某个词中间的边界。
 *
 * 切分决策全部发生在词边界上，且优先次序固定，相同输入必然产出相同片段：
 *   1. ASR 段落标记（上一个词带段落结束标记）且当前片段已有内容 -> 断开；
 *   2. 当前片段词数达到 maxWords 硬上限 -> 断开；
 *   3. 加入下一个词会使片段时长超过 maxDurationMs -> 断开；
 *      单独一个词自身超长时允许它独占一段。
 */

import type { AlignedSegment, AlignedWord, SegmentOptions, TimedWord } from './types.js';
import { joinPackedWords } from './tokenize.js';

export const DEFAULT_MAX_DURATION_MS = 30_000;
export const DEFAULT_MAX_WORDS = 120;

export interface ResolvedSegmentOptions {
  maxDurationMs: number;
  maxWords: number;
  respectParagraphBreaks: boolean;
  idNamespace: string;
}

export function resolveOptions(options: SegmentOptions = {}): ResolvedSegmentOptions {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;
  if (!Number.isInteger(maxDurationMs) || maxDurationMs <= 0) {
    throw new Error('maxDurationMs 必须是正整数');
  }
  if (!Number.isInteger(maxWords) || maxWords <= 0) {
    throw new Error('maxWords 必须是正整数');
  }
  return {
    maxDurationMs,
    maxWords,
    respectParagraphBreaks: options.respectParagraphBreaks ?? true,
    idNamespace: options.idNamespace ?? '',
  };
}

/** 确定性片段 ID：命名空间 + 序号 + 边界时间，相同输入重算一致。 */
export function segmentId(
  namespace: string,
  index: number,
  startMs: number,
  endMs: number,
): string {
  return `seg_${namespace ? `${namespace}_` : ''}${index}_${startMs}_${endMs}`;
}

/**
 * 核心分段函数。
 *
 * @param words 已对齐词流（单调不减、含 anchorId）。
 * @param options 分段参数。
 * @param paragraphAnchorIds 带段落结束标记的词锚点集合；该词之后允许断开。
 */
export function buildSegments(
  words: AlignedWord[],
  options: SegmentOptions = {},
  paragraphAnchorIds: ReadonlySet<string> = new Set(),
): AlignedSegment[] {
  const resolved = resolveOptions(options);
  if (words.length === 0) return [];

  const breaks = new Set(paragraphAnchorIds);
  const segments: AlignedSegment[] = [];
  let current: AlignedWord[] = [];
  let segmentStartMs = words[0].startMs;
  // 上一个词本身超长、已独占当前段：它后面的第一个新词必须另起一段。
  let overlongPending = false;

  const pushCurrent = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    segments.push({
      id: segmentId(resolved.idNamespace, segments.length, first.startMs, last.endMs),
      startMs: first.startMs,
      endMs: last.endMs,
      speakerId: first.speakerId,
      words: [...current],
      text: joinPackedWords(current),
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0) {
      const last = current[current.length - 1];
      let cut = false;

      // 规则 0：上一个词是独占超长词，任何新词到来都断开。
      if (overlongPending) {
        cut = true;
      }
      // 规则 1：上一个词带段落结束标记。
      if (!cut && resolved.respectParagraphBreaks && breaks.has(last.anchorId)) {
        cut = true;
      }
      // 规则 2：词数硬上限。
      if (!cut && current.length >= resolved.maxWords) {
        cut = true;
      }
      // 规则 3：当前段已达到时长上限即在词边界断开；
      // 但单个词自身超长（singleOverlong）时不做词内切分，交给规则 0 处理。
      if (!cut) {
        const currentDuration = last.endMs - segmentStartMs;
        const singleOverlong =
          current.length === 1 && currentDuration > resolved.maxDurationMs;
        if (currentDuration >= resolved.maxDurationMs && !singleOverlong) {
          cut = true;
        }
      }

      if (cut) {
        pushCurrent();
        segmentStartMs = word.startMs;
        overlongPending = false;
      }
    }
    current.push(word);
    overlongPending =
      current.length === 1 && word.endMs - segmentStartMs > resolved.maxDurationMs;
  }
  pushCurrent();
  return segments;
}

/**
 * 把目标时间点吸附到最近的词间空隙：
 * 选择 |gapMidpoint - targetMs| 最小的词边界；平局取较早边界（可复现）。
 * 返回切点下标 cutIndex：words[0..cutIndex-1] 归前段，取值范围 [1, n-1]；
 * 词数不足 2 时返回 null（无可吸附边界）。
 */
export function snapBoundaryToWords(words: TimedWord[], targetMs: number): number | null {
  if (words.length < 2) return null;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let k = 1; k < words.length; k += 1) {
    const gapMidpoint = (words[k - 1].endMs + words[k].startMs) / 2;
    const distance = Math.abs(gapMidpoint - targetMs);
    // 严格小于：平局保留更早出现的边界，次序确定。
    if (distance < bestDistance) {
      bestDistance = distance;
      best = k;
    }
  }
  return best;
}
