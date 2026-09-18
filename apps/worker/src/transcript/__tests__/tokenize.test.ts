import { describe, expect, it } from 'vitest';
import { joinPackedWords, packWords, tokenize } from '../tokenize.js';

describe('tokenize', () => {
  it('按 CJK 单字与拉丁连续词切分', () => {
    const tokens = tokenize('Hello, 我们走。');
    expect(tokens.map((t) => [t.kind, t.value] as const)).toEqual([
      ['word', 'Hello'],
      ['punct', ','],
      ['space', ' '],
      ['word', '我'],
      ['word', '们'],
      ['word', '走'],
      ['punct', '。'],
    ]);
  });

  it('空白折叠为单个空格', () => {
    const tokens = tokenize('a\t\n  b');
    expect(tokens.filter((t) => t.kind === 'space').every((t) => t.value === ' ')).toBe(true);
    expect(tokens.filter((t) => t.kind === 'space')).toHaveLength(1);
  });

  it('记录字符偏移', () => {
    const tokens = tokenize('ab 中');
    expect(tokens[0]).toMatchObject({ kind: 'word', value: 'ab', offset: 0 });
    expect(tokens[2]).toMatchObject({ kind: 'word', value: '中', offset: 3 });
  });

  it('数字与下划线并入拉丁词', () => {
    expect(tokenize('a1_b').filter((t) => t.kind === 'word').map((t) => t.value)).toEqual([
      'a1_b',
    ]);
  });
});

describe('packWords / joinPackedWords', () => {
  it('标点挂在词后、空白挂在词前', () => {
    const packed = packWords(tokenize('Hello, 世界。'));
    expect(packed).toEqual([
      { text: 'Hello', spaceBefore: '', punctuation: [','] },
      { text: '世', spaceBefore: ' ', punctuation: [] },
      { text: '界', spaceBefore: '', punctuation: ['。'] },
    ]);
  });

  it('多标点序列全部挂到最近的前一个词', () => {
    const packed = packWords(tokenize('等等…… 再来'));
    expect(packed[1].punctuation).toEqual(['…', '…']);
    expect(packed[0].punctuation).toEqual([]);
  });

  it('忽略前导空白，可还原正文', () => {
    const text = 'Hello, 我们走。';
    expect(joinPackedWords(packWords(tokenize(`  ${text}`)))).toBe(text);
  });
});
