/**
 * 文本分词器：把自由文本切成 Token 序列，保留空白与标点位置。
 *
 * 支持中文（按字切分）与拉丁/数字文本（按连续词切分），例如：
 *   "Hello, 我们走。" -> [word Hello][punct ,][space " "][word 我][word 们][word 走][punct 。]
 *
 * 输出的 offset 是 Token 在原文中的起始字符下标，可用于回放编辑位置。
 */

export type TokenKind = 'word' | 'punct' | 'space';

export interface Token {
  kind: TokenKind;
  value: string;
  /** 在输入文本中的字符起始偏移。 */
  offset: number;
}

const isSpace = (ch: string): boolean => /\s/u.test(ch);

/** 字符是否属于汉字脚本（CJK 单字词）。\p{Script=Han} 覆盖扩展区。 */
const isHan = (ch: string): boolean => /\p{Script=Han}/u.test(ch);

/**
 * 成词字符：各类字母（Letter）、数字（Number）、下划线/连字号/撇号（词内连接符）。
 * 汉字本身也是词字符，但由 tokenize 单独按字切分。
 * 其余 P/S/C 类字符（含 … 等）一律落到标点分支。
 */
const isWordChar = (ch: string): boolean => /[\p{Letter}\p{Number}'’._\-]/u.test(ch);

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isSpace(ch)) {
      const start = i;
      while (i < text.length && isSpace(text[i])) i += 1;
      // 空白一律折叠为单个空格，避免换行/多空格影响对齐与重算。
      tokens.push({ kind: 'space', value: ' ', offset: start });
      continue;
    }
    if (isHan(ch)) {
      // 汉字按字成词，字间不插空格。
      tokens.push({ kind: 'word', value: ch, offset: i });
      i += 1;
      continue;
    }
    if (isWordChar(ch)) {
      // 拉丁/数字连续成词；连写的汉字不会进入这里（已被上面的分支按字切走）。
      const start = i;
      let value = '';
      while (i < text.length && isWordChar(text[i]) && !isHan(text[i])) {
        value += text[i];
        i += 1;
      }
      tokens.push({ kind: 'word', value, offset: start });
      continue;
    }
    // 其余字符（标点、符号等）各自成 token。
    tokens.push({ kind: 'punct', value: ch, offset: i });
    i += 1;
  }
  return tokens;
}

/**
 * 把 token 序列按词打包：每个词带上它之前的空白，以及挂在它后面、
 * 下一个词之前的标点。尾部标点挂在最后一个词上。
 *
 * 打包结果可以无损还原原文（空白折叠为单空格除外）。
 */
export interface PackedWord {
  text: string;
  spaceBefore: string;
  punctuation: string[];
}

export function packWords(tokens: Token[]): PackedWord[] {
  const words: PackedWord[] = [];

  // 先为每个词确定 spaceBefore：它与上一个词之间出现过空白即为 ' '。
  let gapSinceLastWord = false;
  for (const token of tokens) {
    if (token.kind === 'word') {
      words.push({
        text: token.value,
        spaceBefore: words.length === 0 ? '' : gapSinceLastWord ? ' ' : '',
        punctuation: [],
      });
      gapSinceLastWord = false;
    } else if (token.kind === 'space') {
      gapSinceLastWord = true;
    }
  }

  // 再挂标点：确定性规则——标点挂给它前面最近的词；
  // 第一个词之前的标点（如前导引号）挂给第一个词，不丢弃。
  let host = -1;
  for (const token of tokens) {
    if (token.kind === 'word') {
      host += 1;
    } else if (token.kind === 'punct') {
      const target = host >= 0 ? host : words.length > 0 ? 0 : -1;
      if (target >= 0) words[target].punctuation.push(token.value);
    }
  }

  return words;
}

/** 由打包后的词序列还原可读文本。 */
export function joinPackedWords(words: PackedWord[]): string {
  let out = '';
  for (const word of words) {
    out += word.spaceBefore;
    out += word.text;
    out += word.punctuation.join('');
  }
  return out;
}

/** 规范化：对齐比较时不区分大小写；后续如需更激进的归一化（全半角等）在此扩展。 */
export const normalizeForMatch = (text: string): string => text.toLocaleLowerCase('en');
