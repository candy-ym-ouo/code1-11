/**
 * 转录分段与音频对齐模块对外入口。
 *
 * 三个核心能力：
 *   - alignTranscript：首次把 ASR 词时间戳对齐成词流与片段（边界吸附到词）；
 *   - resegment：用相同输入重算分段，结果（含 ID）逐字节可复现；
 *   - reviseTranscript：用户修订文本后重新对齐，未改动的词保持原 anchorId
 *     与原时间戳不变（锚点不被破坏），新增词的时间由相邻锚点线性插值得到。
 */

import {
  alignWordSequences,
  buildAnchorId,
  type AlignOp,
  type AnchorViolation,
} from './anchor.js';
import { buildSegments, resolveOptions } from './segment.js';
import { allocateByWeight, ensureMonotonic } from './time.js';
import { packWords, tokenize, type PackedWord } from './tokenize.js';
import type {
  AlignedSegment,
  AlignedWord,
  RevisionResult,
  SegmentOptions,
  TimedWord,
} from './types.js';

export * from './types.js';
export {
  alignWordSequences,
  buildAnchorId,
  type AlignOp,
  type AnchorViolation,
} from './anchor.js';
export {
  buildSegments,
  resolveOptions,
  segmentId,
  snapBoundaryToWords,
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MAX_WORDS,
} from './segment.js';
export { tokenize, packWords, joinPackedWords } from './tokenize.js';
export { allocateByWeight, ensureMonotonic } from './time.js';

export interface AlignResult {
  words: AlignedWord[];
  segments: AlignedSegment[];
  /** 带段落结束标记的词锚点 ID 集合；重分段/修订后可继续传入。 */
  paragraphAnchorIds: Set<string>;
}

/**
 * 首次（或重新）对齐：ASR 词时间戳 -> 锚点词流 -> 吸附词边界的片段。
 *
 * 纯函数：同样的输入必然得到同样的输出，不读取时钟、不产生随机量。
 * ASR 单个时间戳项若夹带多个词（例如 "you know"），会在其时间区间内
 * 按字符权重展开为多个锚点词。
 */
export function alignTranscript(
  timedWords: TimedWord[],
  options: SegmentOptions = {},
): AlignResult {
  const namespace = options.idNamespace ?? '';
  const { words, paragraphAnchorIds } = expandTimedWords(timedWords, namespace);
  const segments = buildSegments(words, options, paragraphAnchorIds);
  return { words, segments, paragraphAnchorIds };
}

/** 拉丁词之间默认空格；CJK 单字词之间不需要空格。 */
function defaultSpaceBefore(text: string): string {
  const cp = text.codePointAt(0) ?? 0;
  const isCjk =
    (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
  return isCjk ? '' : ' ';
}

/**
 * 把可能含多个词/标点的 ASR 时间戳项展开为若干锚点词。
 * 同一项内展开出的词在 [startMs, endMs] 内按字符权重分配时间。
 */
function expandTimedWords(
  timedWords: TimedWord[],
  namespace: string,
): { words: AlignedWord[]; paragraphAnchorIds: Set<string> } {
  const words: AlignedWord[] = [];
  const paragraphAnchorIds = new Set<string>();
  let anchorIndex = 0;

  timedWords.forEach((timed) => {
    const packed = packWords(tokenize(timed.text));
    const parts = packed.length > 0 ? packed : [{
      text: timed.text.trim(),
      spaceBefore: '',
      punctuation: [] as string[],
    }];

    const weights = parts.map((part) => Math.max(1, part.text.length));
    const spans = distributeSpan(timed.startMs, timed.endMs, weights);

    parts.forEach((part, k) => {
      const spaceBefore =
        words.length === 0
          ? ''
          : part.spaceBefore || defaultSpaceBefore(part.text);
      const word: AlignedWord = {
        text: part.text,
        spaceBefore,
        punctuation: part.punctuation,
        startMs: spans[k][0],
        endMs: spans[k][1],
        anchorId: buildAnchorId(namespace, anchorIndex, part.text),
        anchored: true,
        ...(timed.speakerId ? { speakerId: timed.speakerId } : {}),
      };
      words.push(word);
      // 段落标记挂在该项展开出的最后一个词上。
      if (timed.isParagraphEnd && k === parts.length - 1) {
        paragraphAnchorIds.add(word.anchorId);
      }
      anchorIndex += 1;
    });
  });

  return { words, paragraphAnchorIds };
}

/** 在 [startMs, endMs] 内按权重切出 n 个相邻不重叠的整数毫秒区间。 */
function distributeSpan(
  startMs: number,
  endMs: number,
  weights: number[],
): Array<[number, number]> {
  const total = Math.max(0, endMs - startMs);
  const durations = allocateByWeight(total, weights);
  const spans: Array<[number, number]> = [];
  let cursor = startMs;
  for (const duration of durations) {
    spans.push([cursor, cursor + duration]);
    cursor += duration;
  }
  return spans;
}

/**
 * 用既有词流重算分段（相同参数 -> 相同结果），词与锚点本身不变。
 * 典型场景：用户调整分段参数后重算，锚点时间与 ID 保持稳定。
 */
export function resegment(
  words: AlignedWord[],
  options: SegmentOptions = {},
  paragraphAnchorIds: ReadonlySet<string> = new Set(),
): AlignedSegment[] {
  return buildSegments(words, options, paragraphAnchorIds);
}

/**
 * 修订文本对齐：把修订后的纯文本与旧锚点词序列做全局对齐后重新分段。
 *
 * 锚点保证（硬性约束）：
 *   - 对齐为 equal 的词，anchorId / startMs / endMs / speakerId 原样保留；
 *   - 对齐为 replace 的位置视为「删旧词 + 插新词」，旧锚点释放；
 *   - 插入词时间由「前一个锚点结束 ~ 后一个锚点开始」之间的空隙按字符数
 *     权重分配（最大余数法）；位于词流首尾时贴齐边界锚点，不产生随机量；
 *   - 修订标点/空格只影响展示文本，不触碰锚点时间。
 *
 * @param previous 修订前的已对齐词流。
 * @param paragraphAnchorIds 修订前的段落标记；修订后锚点仍存在时继续生效。
 */
export function reviseTranscript(
  previous: AlignedWord[],
  revisedText: string,
  options: SegmentOptions = {},
  paragraphAnchorIds: ReadonlySet<string> = new Set(),
): RevisionResult {
  const namespace = options.idNamespace ?? '';
  const oldTexts = previous.map((word) => word.text);
  const revisedPacked = packWords(tokenize(revisedText));
  const newTexts = revisedPacked.map((part) => part.text);

  const ops = alignWordSequences(oldTexts, newTexts);
  const resultWords = applyOps(previous, revisedPacked, ops, namespace);

  // 旧段落标记只在对应锚点仍然存在时保留。
  const survivingBreaks = new Set(
    [...paragraphAnchorIds].filter((id) => resultWords.some((word) => word.anchorId === id)),
  );
  const segments = buildSegments(resultWords, options, survivingBreaks);

  const stats = { equal: 0, inserted: 0, deleted: 0, replaced: 0 };
  for (const op of ops) {
    if (op.type === 'equal') {
      stats.equal += 1;
    } else if (op.type === 'insert') {
      stats.inserted += 1;
    } else if (op.type === 'delete') {
      stats.deleted += 1;
    } else {
      // replace = 删一个旧词 + 插一个新词，两侧各计一次。
      stats.replaced += 1;
      stats.deleted += 1;
      stats.inserted += 1;
    }
  }

  return {
    segments,
    words: resultWords,
    preservedAnchors: stats.equal,
    removedAnchors: stats.deleted,
    insertedWords: stats.inserted,
    replacedWords: stats.replaced,
  };
}

type Slot =
  | { kind: 'anchor'; word: AlignedWord }
  | { kind: 'insert'; packed: PackedWord; tempId: number };

function applyOps(
  previous: AlignedWord[],
  revisedPacked: PackedWord[],
  ops: AlignOp[],
  namespace: string,
): AlignedWord[] {
  const slots: Slot[] = [];
  let insertCounter = 0;

  for (const op of ops) {
    if (op.type === 'equal') {
      // 锚点原样保留（含时间与 ID）；标点/空格采用修订文本中的写法。
      const packed = revisedPacked[op.bIndex];
      const old = previous[op.aIndex];
      slots.push({
        kind: 'anchor',
        word: { ...old, spaceBefore: packed.spaceBefore, punctuation: packed.punctuation },
      });
    } else if (op.type === 'insert') {
      slots.push({ kind: 'insert', packed: revisedPacked[op.bIndex], tempId: insertCounter++ });
    } else if (op.type === 'replace') {
      // 旧词锚点释放，新词走插入插值。
      slots.push({ kind: 'insert', packed: revisedPacked[op.bIndex], tempId: insertCounter++ });
    }
    // delete：旧词直接丢弃。
  }

  return fillInsertTiming(slots, namespace);
}

/**
 * 为所有连续插入段填充时间：
 *   - 夹在两个锚点之间：在 [prev.endMs, next.startMs] 空隙内按字符权重分配；
 *   - 位于词流开头：贴齐第一个锚点 startMs；
 *   - 位于词流结尾：贴齐最后一个锚点 endMs；
 *   - 整段重写、没有任何锚点：无法恢复音频位置，时间为 0 并标记为未锚定。
 */
function fillInsertTiming(slots: Slot[], namespace: string): AlignedWord[] {
  const anchorPositions: number[] = [];
  slots.forEach((slot, index) => {
    if (slot.kind === 'anchor') anchorPositions.push(index);
  });

  const result: AlignedWord[] = [];
  let i = 0;
  while (i < slots.length) {
    const slot = slots[i];
    if (slot.kind === 'anchor') {
      result.push(slot.word);
      i += 1;
      continue;
    }

    const runStart = i;
    while (i < slots.length && slots[i].kind === 'insert') i += 1;
    const runEnd = i; // 半开区间 [runStart, runEnd)

    let prevWord: AlignedWord | undefined;
    let nextWord: AlignedWord | undefined;
    for (const position of anchorPositions) {
      if (position < runStart) {
        prevWord = (slots[position] as { word: AlignedWord }).word;
      } else if (position >= runEnd && nextWord === undefined) {
        nextWord = (slots[position] as { word: AlignedWord }).word;
        break;
      }
    }

    let spanStart: number;
    let spanEnd: number;
    if (prevWord && nextWord) {
      spanStart = prevWord.endMs;
      spanEnd = Math.max(spanStart, nextWord.startMs);
    } else if (nextWord) {
      spanStart = nextWord.startMs;
      spanEnd = nextWord.startMs;
    } else if (prevWord) {
      spanStart = prevWord.endMs;
      spanEnd = prevWord.endMs;
    } else {
      spanStart = 0;
      spanEnd = 0;
    }

    const run = slots.slice(runStart, runEnd) as Array<{
      kind: 'insert';
      packed: PackedWord;
      tempId: number;
    }>;
    const weights = run.map((item) => Math.max(1, item.packed.text.length));
    const spans = distributeSpan(spanStart, spanEnd, weights);
    run.forEach((item, k) => {
      result.push({
        text: item.packed.text,
        spaceBefore: item.packed.spaceBefore,
        punctuation: item.packed.punctuation,
        startMs: spans[k][0],
        endMs: spans[k][1],
        // 插入词没有真实锚点：anchorId 由独立命名空间确定性生成，
        // 并用 anchored: false 显式区分（不靠 ID 子串猜测）。
        anchorId: buildAnchorId(`${namespace}::unanchored`, item.tempId, item.packed.text),
        anchored: false,
      });
    });
  }

  return monotonicWords(result);
}

function monotonicWords(words: AlignedWord[]): AlignedWord[] {
  const pairs = ensureMonotonic(words.map((word) => [word.startMs, word.endMs]));
  return words.map((word, index) => ({
    ...word,
    startMs: pairs[index][0],
    endMs: pairs[index][1],
  }));
}

/**
 * 校验修订结果：所有仍存在的原锚点必须与修订前完全一致。
 * 返回违例列表；空数组表示「修订没有破坏任何原锚点」。
 * 被删除的锚点不视为违例；修订插入的未锚定词不参与校验。
 */
export function verifyAnchors(
  before: AlignedWord[],
  after: AlignedWord[],
): AnchorViolation[] {
  const afterById = new Map(after.map((word) => [word.anchorId, word]));
  const violations: AnchorViolation[] = [];
  for (const oldWord of before) {
    if (oldWord.anchored === false) continue; // 旧的插入词本来就无锚点
    const current = afterById.get(oldWord.anchorId);
    if (!current) continue; // 被用户删除，允许
    if (
      current.startMs !== oldWord.startMs ||
      current.endMs !== oldWord.endMs ||
      current.text !== oldWord.text
    ) {
      violations.push({
        anchorId: oldWord.anchorId,
        expectedStartMs: oldWord.startMs,
        actualStartMs: current.startMs,
        expectedEndMs: oldWord.endMs,
        actualEndMs: current.endMs,
      });
    }
  }
  return violations;
}
