import {
  joinWithWordSpans,
  normalizeToken,
  tokenizeWithOffsets,
  type TokenWithOffset,
} from './text.js';
import type { RealignResult, RealignedToken, WordTiming } from './types.js';

/**
 * 原文侧 token：由词序列拼接文本重新分词得到，
 * 通过字符区间映射回原词，继承原词时间戳。
 */
interface SourceToken {
  key: string;
  startMs: number;
  endMs: number;
  /** 覆盖的首个原词下标 */
  sourceIndex: number;
}

/**
 * 最长公共子序列（Hirschberg 算法）：时间 O(n*m)，空间 O(m)。
 * 返回匹配对 (aIndex, bIndex)，两个下标均升序。
 * 算法本身无随机性，相同输入必然得到相同匹配（重算可复现）。
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];

  /** 两个序列窗口的 LCS 长度矩阵最后一行（滚动数组，O(m) 空间）。 */
  const lcsRow = (seqA: string[], seqB: string[]): Uint32Array => {
    let prev = new Uint32Array(seqB.length + 1);
    let curr = new Uint32Array(seqB.length + 1);
    for (let i = 0; i < seqA.length; i++) {
      curr[0] = 0;
      for (let j = 0; j < seqB.length; j++) {
        curr[j + 1] =
          seqA[i] === seqB[j] ? prev[j] + 1 : Math.max(prev[j + 1], curr[j]);
      }
      [prev, curr] = [curr, prev];
    }
    return prev;
  };

  const solve = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    const aLen = aHi - aLo;
    const bLen = bHi - bLo;
    if (aLen === 0 || bLen === 0) return;

    if (aLen === 1) {
      const key = a[aLo];
      for (let j = bLo; j < bHi; j++) {
        if (b[j] === key) {
          pairs.push([aLo, j]);
          return;
        }
      }
      return;
    }

    const aMid = aLo + (aLen >> 1);
    // left[k] = a[aLo,aMid) 与 b[bLo,bLo+k) 的 LCS 长度
    const left = lcsRow(a.slice(aLo, aMid), b.slice(bLo, bHi));
    // right[k] = a[aMid,aHi) 与 b[bHi-k,bHi) 的 LCS 长度（反向序列求解）
    const right = lcsRow(
      a.slice(aMid, aHi).reverse(),
      b.slice(bLo, bHi).reverse(),
    );

    // 选择切分点 k 使 left[k] + right[bLen-k] 最大；平局取较小 k（确定性）
    let bestK = 0;
    let bestValue = -1;
    for (let k = 0; k <= bLen; k++) {
      const value = left[k] + right[bLen - k];
      if (value > bestValue) {
        bestValue = value;
        bestK = k;
      }
    }

    solve(aLo, aMid, bLo, bLo + bestK);
    solve(aMid, aHi, bLo + bestK, bHi);
  };

  // 先剥离公共前后缀：修订场景下中间段通常很小，且前后缀直接配对
  // 符合“未改动部分保持锚点”的直觉。
  let lo = 0;
  const minLength = Math.min(a.length, b.length);
  while (lo < minLength && a[lo] === b[lo]) lo++;

  let aHi = a.length;
  let bHi = b.length;
  while (aHi > lo && bHi > lo && a[aHi - 1] === b[bHi - 1]) {
    aHi--;
    bHi--;
  }

  for (let i = 0; i < lo; i++) pairs.push([i, i]);
  solve(lo, aHi, lo, bHi);
  for (let i = aHi; i < a.length; i++) {
    pairs.push([i, bHi + (i - aHi)]);
  }

  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return pairs;
}

/** 把词序列映射为原文侧 token（继承原词时间戳）。 */
function buildSourceTokens(words: WordTiming[]): SourceToken[] {
  const texts = words.map((word) => word.text);
  const { joined, spans } = joinWithWordSpans(texts);
  const tokens = tokenizeWithOffsets(joined);

  const result: SourceToken[] = [];
  for (const token of tokens) {
    // 找与 token 字符区间相交的首末原词
    let first = -1;
    let last = -1;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (!span) continue;
      if (token.start < span.end && token.end > span.start) {
        if (first === -1) first = i;
        last = i;
      }
    }
    if (first === -1) continue; // 理论上不会发生，防御性跳过
    result.push({
      key: normalizeToken(token.text),
      startMs: words[first].startMs,
      endMs: words[last].endMs,
      sourceIndex: first,
    });
  }
  return result;
}

/**
 * 整数版四舍五入：round(numerator / denominator)，denominator > 0。
 * 全程整数运算，避免浮点环境差异。
 */
function divideRound(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * 重对齐：把修订后的文本对齐回原词序列的时间戳。
 *
 * 保证（对任意输入成立）：
 * - 匹配 token 的时间戳精确保留原值，修订文本不会破坏原锚点；
 * - 新增 token 在左右最近锚点之间均分插值；只有单侧锚点时贴该侧
 *   边界；全文无锚点可依据时时间为 null；
 * - 相同输入必然产生相同输出。
 */
export function realignTranscript(
  originalWords: WordTiming[],
  revisedText: string,
): RealignResult {
  const sourceTokens = buildSourceTokens(originalWords);
  const revisedTokens: TokenWithOffset[] = tokenizeWithOffsets(revisedText);

  const sourceKeys = sourceTokens.map((token) => token.key);
  const revisedKeys = revisedTokens.map((token) => normalizeToken(token.text));

  const pairs = lcsPairs(sourceKeys, revisedKeys);
  const matchedByRevised = new Map<number, number>();
  for (const [sourceIndex, revisedIndex] of pairs) {
    matchedByRevised.set(revisedIndex, sourceIndex);
  }

  const tokens: RealignedToken[] = revisedTokens.map((token, index) => {
    const sourceIndex = matchedByRevised.get(index);
    if (sourceIndex !== undefined) {
      const source = sourceTokens[sourceIndex];
      return {
        text: token.text,
        startMs: source.startMs,
        endMs: source.endMs,
        anchor: true,
        sourceIndex: source.sourceIndex,
      };
    }
    // 占位，插值在下一步统一处理
    return {
      text: token.text,
      startMs: null,
      endMs: null,
      anchor: false,
      sourceIndex: null,
    };
  });

  // 连续未匹配段在左右锚点之间均分插值
  let runStart = 0;
  while (runStart < tokens.length) {
    if (tokens[runStart].anchor) {
      runStart++;
      continue;
    }
    let runEnd = runStart;
    while (runEnd < tokens.length && !tokens[runEnd].anchor) runEnd++;

    const left = runStart > 0 ? tokens[runStart - 1] : null;
    const right = runEnd < tokens.length ? tokens[runEnd] : null;
    const leftMs = left?.endMs ?? null;
    const rightMs = right?.startMs ?? null;
    const count = runEnd - runStart;

    for (let i = 0; i < count; i++) {
      const token = tokens[runStart + i];
      if (leftMs !== null && rightMs !== null && rightMs >= leftMs) {
        token.startMs = leftMs + divideRound((rightMs - leftMs) * i, count);
        token.endMs = leftMs + divideRound((rightMs - leftMs) * (i + 1), count);
      } else if (leftMs !== null) {
        // 只有左锚点（含右锚点乱序）：贴左锚点末尾
        token.startMs = leftMs;
        token.endMs = leftMs;
      } else if (rightMs !== null) {
        // 只有右锚点：贴右锚点开头
        token.startMs = rightMs;
        token.endMs = rightMs;
      }
      // 左右都没有：保持 null
    }
    runStart = runEnd;
  }

  return {
    tokens,
    matchedCount: pairs.length,
    insertedCount: revisedTokens.length - pairs.length,
    deletedCount: sourceTokens.length - pairs.length,
  };
}
