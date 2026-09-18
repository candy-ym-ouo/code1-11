/**
 * 文本工具：词面拼接、确定性分词、匹配键规范化。
 *
 * 这些函数是分段与重对齐的基础，必须对相同输入永远产生
 * 相同输出，因此不依赖任何环境状态（时区、语言环境等）。
 */

/** 拉丁字母或数字（用于判断词间是否需要补空格）。 */
const LATIN_EDGE = /[A-Za-z0-9]/;

/**
 * 把词面序列拼接成连续文本。
 * 规则：仅当左词以拉丁字母/数字结尾且右词以拉丁字母/数字开头时
 * 补一个空格，其余情况直接相连（CJK 之间、CJK 与拉丁混排均不补）。
 */
export function joinWordTexts(texts: string[]): string {
  let out = '';
  for (const text of texts) {
    if (!text) continue;
    if (
      out.length > 0 &&
      LATIN_EDGE.test(out[out.length - 1]) &&
      LATIN_EDGE.test(text[0])
    ) {
      out += ' ';
    }
    out += text;
  }
  return out;
}

/** 词在拼接文本中的字符区间（UTF-16 code unit 偏移，左闭右开）。 */
export interface WordSpan {
  start: number;
  end: number;
}

/**
 * 与 joinWordTexts 相同的拼接规则，同时返回每个词在拼接结果中的
 * 字符区间，用于把重新分词得到的 token 映射回原词时间戳。
 * 空文本词不产出区间（span 为 null）。
 */
export function joinWithWordSpans(texts: string[]): {
  joined: string;
  spans: (WordSpan | null)[];
} {
  let out = '';
  const spans: (WordSpan | null)[] = [];
  for (const text of texts) {
    if (!text) {
      spans.push(null);
      continue;
    }
    if (
      out.length > 0 &&
      LATIN_EDGE.test(out[out.length - 1]) &&
      LATIN_EDGE.test(text[0])
    ) {
      out += ' ';
    }
    const start = out.length;
    out += text;
    spans.push({ start, end: out.length });
  }
  return { joined: out, spans };
}

/** 带字符区间的分词 token。 */
export interface TokenWithOffset {
  text: string;
  /** 在源文本中的起始偏移（UTF-16 code unit，含） */
  start: number;
  /** 结束偏移（不含） */
  end: number;
}

/** CJK 表意文字与假名：逐字成 token。 */
const CJK_CHAR =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿\u{20000}-\u{2A6DF}]/u;


/** 标点与符号：独立成 token。 */
const PUNCT_OR_SYMBOL = /[\p{P}\p{S}]/u;

const WHITESPACE = /\s/u;

/**
 * 确定性分词：
 * - 空白只作为分隔符，不产出 token；
 * - CJK 表意文字/假名逐字一个 token；
 * - Unicode 标点与符号每个字符一个 token；
 * - 其余连续字符（拉丁字母、数字等）累积为一个 token。
 *
 * 原文与修订文本使用同一个分词器，保证对齐粒度一致。
 */
export function tokenizeWithOffsets(text: string): TokenWithOffset[] {
  const tokens: TokenWithOffset[] = [];
  let buffer = '';
  let bufferStart = -1;

  const flush = (end: number) => {
    if (buffer.length > 0) {
      tokens.push({ text: buffer, start: bufferStart, end });
      buffer = '';
      bufferStart = -1;
    }
  };

  let offset = 0;
  for (const char of text) {
    const length = char.length; // 1 或 2（代理对）
    if (WHITESPACE.test(char)) {
      flush(offset);
    } else if (CJK_CHAR.test(char) || PUNCT_OR_SYMBOL.test(char)) {
      flush(offset);
      tokens.push({ text: char, start: offset, end: offset + length });
    } else {
      if (buffer.length === 0) bufferStart = offset;
      buffer += char;
    }
    offset += length;
  }
  flush(offset);
  return tokens;
}

/** 分词便捷入口：只要 token 文本。 */
export function tokenize(text: string): string[] {
  return tokenizeWithOffsets(text).map((token) => token.text);
}

/**
 * 中文标点/符号到 ASCII 等价物的映射。
 * 修订时把全角标点改成半角（或反之）不应破坏锚点，
 * 因此匹配前把标点归一到同一个代表。
 */
const PUNCT_EQUIVALENTS: ReadonlyMap<string, string> = new Map([
  ['，', ','],
  ['、', ','],
  ['。', '.'],
  ['．', '.'],
  ['·', '.'],
  ['！', '!'],
  ['？', '?'],
  ['；', ';'],
  ['：', ':'],
  ['（', '('],
  ['）', ')'],
  ['［', '['],
  ['］', ']'],
  ['【', '['],
  ['】', ']'],
  ['《', '<'],
  ['》', '>'],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['「', '"'],
  ['」', '"'],
  ['『', '"'],
  ['』', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['‚', "'"],
  ['…', '...'],
  ['‥', '..'],
  ['—', '-'],
  ['–', '-'],
  ['―', '-'],
  ['～', '~'],
  ['〜', '~'],
]);

/**
 * 计算 token 的匹配键。键相同的 token 视为“同一个词”，
 * 重对齐时保留原时间戳（锚点）。
 *
 * 规范化步骤（顺序固定）：
 * 1. NFC 归一；
 * 2. 全角 ASCII（！-～）转半角；
 * 3. 小写化；
 * 4. NFD 后去除组合变音符（é -> e）；
 * 5. 标点等价映射。
 */
export function normalizeToken(token: string): string {
  let text = token.normalize('NFC');
  text = text.replace(/[！-～]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
  text = text.toLowerCase();
  text = text.normalize('NFD').replace(/\p{M}/gu, '');
  return PUNCT_EQUIVALENTS.get(text) ?? text;
}
