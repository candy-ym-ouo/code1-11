/**
 * @history/align —— 转录分段与音频对齐模块。
 *
 * 全部函数为纯函数：相同输入必然产生相同输出（重算可复现）。
 * 修订文本通过 realignTranscript 重新对齐时，未改动词的
 * 时间戳精确保留（不破坏原锚点）。
 */
export * from './types.js';
export {
  joinWordTexts,
  joinWithWordSpans,
  normalizeToken,
  tokenize,
  tokenizeWithOffsets,
  type TokenWithOffset,
  type WordSpan,
} from './text.js';
export { segmentWords, type SegmentOptions } from './segment.js';
export {
  alignWordsToClips,
  assignWordsToClips,
  compareClips,
  sortClips,
  type AlignToClipsResult,
} from './snap.js';
export { realignTranscript } from './realign.js';
export { ALGORITHM_VERSION, fnv1a64, wordsDigest } from './digest.js';
export { validateWordTimings } from './validate.js';
