import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { alignTranscript, reviseTranscript, verifyAnchors } from '../index.js';
import type { TimedWord } from '../types.js';

/** 确定性 LCG 随机源：测试本身可复现。 */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SYLLABLES = ['爷', '爷', '出', '生', '在', '北', '京', '上', '海', '搬', '到', '家', '乡'];
const LATIN = ['the', 'family', 'lived', 'in', 'a', 'small', 'town', 'then', 'moved'];

function randomTimedWords(rng: () => number, count: number, useLatin = false): TimedWord[] {
  const pool = useLatin ? LATIN : SYLLABLES;
  const result: TimedWord[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const startMs = cursor;
    const dur = 120 + Math.floor(rng() * 600);
    const endMs = startMs + dur;
    // 10% 概率留一个词间空隙
    cursor = endMs + (rng() < 0.1 ? 200 + Math.floor(rng() * 800) : 0);
    result.push({
      text: pool[Math.floor(rng() * pool.length)],
      startMs,
      endMs,
      isParagraphEnd: rng() < 0.15 || undefined,
    });
  }
  return result;
}

function randomEdit(text: string[], rng: () => number): string[] {
  const out = [...text];
  const operations = 1 + Math.floor(rng() * 4);
  for (let n = 0; n < operations; n += 1) {
    const roll = rng();
    if (roll < 0.4 && out.length > 0) {
      out.splice(Math.floor(rng() * out.length), 1); // 删除
    } else if (roll < 0.7) {
      out.splice(Math.floor(rng() * (out.length + 1)), 0, SYLLABLES[Math.floor(rng() * SYLLABLES.length)]); // 插入
    } else if (out.length > 0) {
      out[Math.floor(rng() * out.length)] = SYLLABLES[Math.floor(rng() * SYLLABLES.length)]; // 替换
    }
  }
  return out;
}

describe('随机不变量', () => {
  it('对齐：跨 50 组随机输入满足确定性、边界吸附、时间单调', () => {
    const rng = makeRng(20260918);
    for (let trial = 0; trial < 50; trial += 1) {
      const timed = randomTimedWords(rng, 4 + Math.floor(rng() * 30), rng() < 0.3);
      const options = {
        idNamespace: `rec-${trial}`,
        maxDurationMs: 1000 + Math.floor(rng() * 30_000),
        maxWords: 3 + Math.floor(rng() * 20),
      } as const;

      const a = alignTranscript(timed, options);
      const b = alignTranscript(timed, options);
      // 1) 可复现
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));

      // 2) 边界吸附在词时间戳上
      for (const segment of a.segments) {
        expect(segment.startMs).toBe(segment.words[0].startMs);
        expect(segment.endMs).toBe(segment.words.at(-1)!.endMs);
        expect(segment.endMs).toBeGreaterThan(segment.startMs);
      }

      // 3) 词时间单调不减
      for (let i = 1; i < a.words.length; i += 1) {
        expect(a.words[i].startMs).toBeGreaterThanOrEqual(a.words[i - 1].endMs);
      }

      // 4) 分段拼回词流与原词流一致
      expect(a.segments.flatMap((s) => s.words).map((w) => w.anchorId)).toEqual(
        a.words.map((w) => w.anchorId),
      );
    }
  });

  it('修订：跨 60 组随机编辑不破坏任何保留锚点，插入词落在相邻锚点区间内', () => {
    const rng = makeRng(424242);
    for (let trial = 0; trial < 60; trial += 1) {
      const timed = randomTimedWords(rng, 6 + Math.floor(rng() * 20));
      const aligned = alignTranscript(timed, { idNamespace: `rec-${trial}` });

      const originalTexts = aligned.words.map((w) => w.text);
      const revisedText = randomEdit(originalTexts, rng).join('');
      const revised = reviseTranscript(aligned.words, revisedText, { idNamespace: `rec-${trial}` });

      // 硬性不变量：保留锚点零违例
      expect(verifyAnchors(aligned.words, revised.words)).toEqual([]);

      // 插入词时间必须夹在前后锚点之间（首尾贴齐），且整体单调
      for (let i = 0; i < revised.words.length; i += 1) {
        const w = revised.words[i];
        expect(w.endMs).toBeGreaterThanOrEqual(w.startMs);
        if (i > 0) {
          expect(w.startMs).toBeGreaterThanOrEqual(revised.words[i - 1].endMs);
        }
        if (w.anchored === false) {
          const prev = revised.words.slice(0, i).reverse().find((x) => x.anchored === true);
          const next = revised.words.slice(i + 1).find((x) => x.anchored === true);
          if (prev && next) {
            expect(w.startMs).toBeGreaterThanOrEqual(prev.endMs);
            expect(w.endMs).toBeLessThanOrEqual(next.startMs);
          }
        }
      }

      // 同一修订再次计算，逐字节一致
      const again = reviseTranscript(aligned.words, revisedText, { idNamespace: `rec-${trial}` });
      expect(JSON.stringify(again)).toBe(JSON.stringify(revised));
    }
  });
});

describe('跨进程可复现', () => {
  it('两个独立进程对同一输入产出相同 JSON', () => {
    const input = JSON.stringify(randomTimedWords(makeRng(7), 12));
    const script = `
      import('./src/transcript/index.ts').then((mod) => {
        const words = ${input};
        process.stdout.write(JSON.stringify(mod.alignTranscript(words, { idNamespace: 'xproc' })));
      });
    `;
    const run = () =>
      execFileSync('node_modules/.bin/tsx', ['-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
    expect(run()).toBe(run());
  });
});
