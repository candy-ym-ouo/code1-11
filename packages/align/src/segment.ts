import { joinWordTexts } from './text.js';
import type { TranscriptSegment, WordTiming } from './types.js';

/** 分段参数。所有字段都有默认值，缺省时行为完全确定。 */
export interface SegmentOptions {
  /** 词间静音达到该毫秒数即断开，默认 700 */
  pauseMs?: number;
  /** 单段最长时长（毫秒），超过则在下一词前断开，默认 12000 */
  maxSegmentMs?: number;
  /** 单段最多词数，默认 80 */
  maxWords?: number;
  /**
   * 句末标点判定（作用于词面末尾、忽略尾部闭合引号/括号）。
   * 默认匹配中英文句末标点：。！？；… ! ? . ;
   */
  sentenceEndPattern?: RegExp;
}

const DEFAULT_PAUSE_MS = 700;
const DEFAULT_MAX_SEGMENT_MS = 12_000;
const DEFAULT_MAX_WORDS = 80;
const DEFAULT_SENTENCE_END = /[。！？；…!?.;]$/u;
/** 句末标点之前允许出现的闭合引号/括号。 */
const TRAILING_CLOSERS = /["'”’」』）)\]]+$/u;

interface ResolvedOptions {
  pauseMs: number;
  maxSegmentMs: number;
  maxWords: number;
  sentenceEndPattern: RegExp;
}

function resolveOptions(options: SegmentOptions): ResolvedOptions {
  return {
    pauseMs: options.pauseMs ?? DEFAULT_PAUSE_MS,
    maxSegmentMs: options.maxSegmentMs ?? DEFAULT_MAX_SEGMENT_MS,
    maxWords: options.maxWords ?? DEFAULT_MAX_WORDS,
    sentenceEndPattern: options.sentenceEndPattern ?? DEFAULT_SENTENCE_END,
  };
}

function endsWithSentencePunctuation(text: string, pattern: RegExp): boolean {
  const stripped = text.replace(TRAILING_CLOSERS, '');
  return pattern.test(stripped);
}

/**
 * 把词序列切分为转录分段。单遍扫描，规则按优先级依次判定，
 * 在词 i（i >= 1）之前断开的条件：
 * 1. 与上一词之间的静音 >= pauseMs；
 * 2. 上一词以句末标点结尾；
 * 3. 纳入词 i 后段时长将超过 maxSegmentMs；
 * 4. 段内词数已达 maxWords。
 *
 * 纯函数：相同输入与参数必然得到相同分段（重算可复现）。
 */
export function segmentWords(
  words: WordTiming[],
  options: SegmentOptions = {},
): TranscriptSegment[] {
  const resolved = resolveOptions(options);
  const segments: TranscriptSegment[] = [];
  if (words.length === 0) return segments;

  let segStart = 0;
  const pushSegment = (end: number) => {
    const slice = words.slice(segStart, end);
    segments.push({
      index: segments.length,
      startMs: slice[0].startMs,
      endMs: slice[slice.length - 1].endMs,
      wordStart: segStart,
      wordEnd: end,
      text: joinWordTexts(slice.map((word) => word.text)),
      clipId: null,
    });
  };

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const curr = words[i];
    const count = i - segStart;
    const gapMs = curr.startMs - prev.endMs;
    const wouldExceedDuration = curr.endMs - words[segStart].startMs > resolved.maxSegmentMs;

    if (
      gapMs >= resolved.pauseMs ||
      endsWithSentencePunctuation(prev.text, resolved.sentenceEndPattern) ||
      wouldExceedDuration ||
      count >= resolved.maxWords
    ) {
      pushSegment(i);
      segStart = i;
    }
  }
  pushSegment(words.length);
  return segments;
}
