/**
 * 转录分段与音频对齐模块的数据结构。
 *
 * 时间单位统一为整数毫秒；锚点（anchor）是「词 ↔ 音频位置」的稳定绑定，
 * 文本修订后未改动的词必须仍然吸附在原来的时间戳上，且 anchorId 不变。
 */

/** ASR 产出的词级时间戳（对齐模块的原始输入）。 */
export interface TimedWord {
  /** 词面文本，可夹带标点，例如 "家"、"hello,"、"我们"。 */
  text: string;
  /** 词起始时间（毫秒，含）。 */
  startMs: number;
  /** 词结束时间（毫秒，不含）。 */
  endMs: number;
  /** ASR 给出的段落/句子结尾标记；为 true 时优先在此切分片段。 */
  isParagraphEnd?: boolean;
  /** 说话人标识（可选，分段时原样保留）。 */
  speakerId?: string;
}

/** 修订时用于回传旧锚点的已对齐词。 */
export interface AlignedWord {
  /** 词面文本（不含标点；标点在 punctuation 中）。 */
  text: string;
  /** 该词与前一个词之间的原始间隔文本，通常为 ' ' 或 ''。 */
  spaceBefore: string;
  /** 挂在该词后面的标点序列，例如 [',', '。']；可能为空数组。 */
  punctuation: string[];
  startMs: number;
  endMs: number;
  /** 稳定锚点 ID；首次对齐时确定，之后修订保持不变。 */
  anchorId: string;
  /**
   * 是否锚定到真实音频位置。修订新插入的词为 false（时间由相邻锚点插值）；
   * ASR 对齐得到的词始终为 true。
   */
  anchored?: boolean;
  speakerId?: string;
}

/** 对齐后的转录片段：所有边界都吸附在词时间戳上。 */
export interface AlignedSegment {
  /** 确定性片段 ID：由序号与边界时间决定，重算结果一致。 */
  id: string;
  /** 片段起始时间 = 第一个词的 startMs。 */
  startMs: number;
  /** 片段结束时间 = 最后一个词的 endMs。 */
  endMs: number;
  speakerId?: string;
  words: AlignedWord[];
  /** 由 words 还原出的可读文本（含空白与标点）。 */
  text: string;
}

/** 分段参数。 */
export interface SegmentOptions {
  /** 片段最长时长（毫秒）。贪心分段时超出会在最近的词边界断开。 */
  maxDurationMs?: number;
  /** 片段最多包含多少个词；硬上限，到达后强制断开。 */
  maxWords?: number;
  /** 是否尊重 ASR 的段落标记（isParagraphEnd）。默认 true。 */
  respectParagraphBreaks?: boolean;
  /** 生成 id/anchorId 时使用的命名空间（例如 recordingId），避免跨录音碰撞。 */
  idNamespace?: string;
}

/** 修订对齐结果。 */
export interface RevisionResult {
  segments: AlignedSegment[];
  words: AlignedWord[];
  /** 保留下来的锚点数量（与修订前时间戳、anchorId 完全一致）。 */
  preservedAnchors: number;
  /** 被删除词的锚点数量。 */
  removedAnchors: number;
  /** 修订新引入词的数量（无锚点，时间由相邻锚点插值得到）。 */
  insertedWords: number;
  /** 本次修订中被替换（删旧词+插新词）的词对数量。 */
  replacedWords: number;
}
