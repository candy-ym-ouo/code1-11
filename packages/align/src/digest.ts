import type { WordTiming } from './types.js';

/**
 * 算法版本。任何影响输出结果的规则变更（断句阈值默认值、
 * 分词规则、插值公式等）都必须递增该版本号，便于判断两次
 * 重算是否可比较。
 */
export const ALGORITHM_VERSION = 'align.v1';

/**
 * FNV-1a 64 位哈希，输出 16 位十六进制字符串。
 * 纯整数（BigInt）运算，跨平台、跨运行结果一致。
 */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

const FIELD_SEPARATOR = '\u001f';
const RECORD_SEPARATOR = '\u001e';

/**
 * 词序列/对齐结果的内容指纹。
 * 两次重算的指纹相同即结果一致（可复现性的校验手段）；
 * 指纹包含算法版本，版本升级后旧指纹自然失效。
 */
export function wordsDigest(
  words: readonly (WordTiming | { text: string; startMs: number | null; endMs: number | null })[],
): string {
  const body = words
    .map((word) => `${word.text}${FIELD_SEPARATOR}${word.startMs}${FIELD_SEPARATOR}${word.endMs}`)
    .join(RECORD_SEPARATOR);
  return `${ALGORITHM_VERSION}:${fnv1a64(body)}`;
}
