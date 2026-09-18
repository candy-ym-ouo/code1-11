/**
 * 转录分段与音频对齐模块的公共类型。
 *
 * 时间单位统一为毫秒（整数）。所有算法函数均为纯函数：
 * 相同的输入必然产生相同的输出（重算可复现）。
 */

/** 词级时间戳。ASR 引擎输出的最小对齐单元。 */
export interface WordTiming {
  /** 词面文本，按识别输出原样保留 */
  text: string;
  /** 起始毫秒，非负整数 */
  startMs: number;
  /** 结束毫秒，>= startMs */
  endMs: number;
}

/** 固定时间范围片段（与 Clip 表对齐的最小形状）。 */
export interface ClipRange {
  id: string;
  startMs: number;
  endMs: number;
}

/** 转录分段：一段连续的词及其时间范围。 */
export interface TranscriptSegment {
  /** 段序号，从 0 开始连续编号 */
  index: number;
  /** 段内首词的 startMs */
  startMs: number;
  /** 段内末词的 endMs */
  endMs: number;
  /** 首词在词序列中的下标（含） */
  wordStart: number;
  /** 末词在词序列中的下标（不含） */
  wordEnd: number;
  /** 段文本，由词面按规则拼接（拉丁词间补空格，CJK 直连） */
  text: string;
  /** 吸附到的片段 id；词序列为空或未参与吸附时为 null */
  clipId: string | null;
}

/** 词到片段的归属结果。 */
export interface WordClipAssignment {
  /** 词在词序列中的下标 */
  wordIndex: number;
  /** 归属的片段 id */
  clipId: string;
  /**
   * true 表示词中点原本不在任何片段范围内，
   * 被按“最近片段”规则吸附过去；false 表示自然覆盖。
   */
  snapped: boolean;
}

/** 一个片段聚合出的转写结果。 */
export interface ClipTranscript {
  clipId: string;
  /** 吸附到该片段的词数 */
  wordCount: number;
  /** 首词 startMs；无词时为 null */
  startMs: number | null;
  /** 末词 endMs；无词时为 null */
  endMs: number | null;
  /** 片段文本（由词面拼接） */
  text: string;
  /** 属于该片段的分段（不跨片段） */
  segments: TranscriptSegment[];
}

/** 重对齐后的词（实际是修订文本的分词 token）。 */
export interface RealignedToken {
  /** 词面文本，来自修订后文本 */
  text: string;
  /** 起始毫秒；无任何锚点可依据时为 null */
  startMs: number | null;
  /** 结束毫秒；无任何锚点可依据时为 null */
  endMs: number | null;
  /**
   * true 表示该 token 与原词序列中的某个词匹配，
   * 时间戳精确保留原值（锚点未被修订破坏）。
   */
  anchor: boolean;
  /** 匹配到的原词下标；插值 token 为 null */
  sourceIndex: number | null;
}

/** 重对齐结果与统计。 */
export interface RealignResult {
  tokens: RealignedToken[];
  /** 保留原时间戳的锚点 token 数 */
  matchedCount: number;
  /** 修订新增、按邻居插值的 token 数 */
  insertedCount: number;
  /** 原词序列中被修订删除的词数 */
  deletedCount: number;
}
