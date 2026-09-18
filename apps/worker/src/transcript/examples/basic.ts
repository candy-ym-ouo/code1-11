/**
 * 端到端示例：pnpm exec tsx src/transcript/examples/basic.ts
 */
import { alignTranscript, resegment, reviseTranscript, verifyAnchors } from '../index.js';
import type { TimedWord } from '../types.js';

const asr: TimedWord[] = [
  { text: '爷爷', startMs: 0, endMs: 400 },
  { text: '出生', startMs: 400, endMs: 800 },
  { text: '在', startMs: 800, endMs: 1000 },
  { text: '北京', startMs: 1000, endMs: 1400, isParagraphEnd: true },
  { text: '后来', startMs: 2000, endMs: 2400 },
  { text: '搬到', startMs: 2400, endMs: 2800 },
  { text: '上海', startMs: 2800, endMs: 3200, isParagraphEnd: true },
];

const opts = { idNamespace: 'recording-123', maxDurationMs: 30_000 } as const;

const first = alignTranscript(asr, opts);
console.log('首次对齐片段数:', first.segments.length);
console.log('片段 0:', first.segments[0].text, `[${first.segments[0].startMs}-${first.segments[0].endMs}ms]`);

// 重算：逐字节一致
const again = resegment(first.words, opts, first.paragraphAnchorIds);
console.log('重算结果一致:', JSON.stringify(again) === JSON.stringify(first.segments));

// 修订：把「北京」改成「南京」，在「出生」后插入「一九四零年」
const revised = reviseTranscript(
  first.words,
  '爷爷出生一九四零年在南京。后来搬到上海。',
  opts,
  first.paragraphAnchorIds,
);
console.log('修订统计:', {
  保留: revised.preservedAnchors,
  新增: revised.insertedWords,
  删除: revised.removedAnchors,
  替换: revised.replacedWords,
});
console.log('锚点违例:', verifyAnchors(first.words, revised.words));
const sample = revised.words.find((w) => w.text === '爷');
console.log('未改动词「爷」仍在原时间戳:', sample?.startMs, sample?.endMs);
