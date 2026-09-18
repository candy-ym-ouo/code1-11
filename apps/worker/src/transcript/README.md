# 转录分段与音频对齐

把 ASR 的词级时间戳转成「按词吸附边界」的转录片段，并支持文本修订后重新对齐。
纯函数、零外部依赖、无时钟/随机量：**相同输入在任何机器、任何进程上产出逐字节一致的结果**。

## 三个核心能力

```ts
import {
  alignTranscript,
  resegment,
  reviseTranscript,
  verifyAnchors,
} from './transcript/index.js';
```

### 1. 首次对齐 `alignTranscript(timedWords, options)`

- ASR 一个时间戳项若含多个词（如 `"you know"` 或 `"北京"`），在其时间区间内按字符权重展开为多个锚点词；
- 每个词获得确定性 `anchorId = w_<sha1(namespace + 原始序号 + 规范化词面)>`，重复词各自独立；
- 分段边界只出现在词边界上（`segment.startMs === words[0].startMs`），按固定优先级决策：
  段落标记 → `maxWords` 硬上限 → `maxDurationMs`（单独超长词独占一段）；
- 片段 ID = `seg_<namespace>_<序号>_<startMs>_<endMs>`。

### 2. 可复现重算 `resegment(words, options, paragraphAnchorIds)`

调整分段参数后重算：片段切分位置会变，但词的 `anchorId` 与时间戳一个不动。

### 3. 修订不破坏锚点 `reviseTranscript(previous, revisedText, options, paragraphAnchorIds)`

修订文本与旧词序列做自实现的 Needleman–Wunsch 全局对齐（平局方向固定，再经
`collapseIndels` 确定性归并 insert/delete/replace）：

| 情况 | 处理 |
| --- | --- |
| `equal` 未改动词 | `anchorId`、`startMs/endMs`、`speakerId` **原样保留**（仅标点/空格用新文本） |
| 插入新词 | `anchored: false`，时间在前后锚点空隙内按字符权重插值（最大余数法，整数毫秒）；首尾贴齐边界锚点；整段重写无锚点时为 0 |
| 删除词 | 旧锚点释放，其余词不受影响 |
| 替换词 | 等价于「删旧 + 插新」 |

用 `verifyAnchors(before, after)` 可校验：所有仍存在的原锚点时间戳必须与修订前完全一致，
返回空数组即零违例。

## 文件

- `types.ts` — `TimedWord` / `AlignedWord` / `AlignedSegment` 等数据结构
- `tokenize.ts` — 中英混排分词（汉字按字、拉丁连续成词），标点挂到最近的前词
- `anchor.ts` — 确定性锚点 ID + Needleman–Wunsch 对齐
- `time.ts` — 整数毫秒时间分配（最大余数法）与单调化
- `segment.ts` — 词边界吸附分段 + 任意时间点吸附到最近词间空隙 `snapBoundaryToWords`
- `index.ts` — 对外 API
- `__tests__/` — 48 个测试：单元、端到端、固定种子随机不变量（110 组）、跨进程复现

## 参数

```ts
interface SegmentOptions {
  maxDurationMs?: number;  // 默认 30000
  maxWords?: number;       // 默认 120
  respectParagraphBreaks?: boolean; // 默认 true
  idNamespace?: string;    // 建议传 recordingId，锚点跨录音隔离
}
```

## 复现性设计要点

1. 锚点/片段 ID 全部来自内容哈希，不用自增数据库 ID 或 `Math.random`/`Date.now`；
2. NW 打分平局固定取 `diag → up → left`，时间分配平局取序号最小；
3. 所有时间戳都是整数毫秒，分配总和严格等于区间长度。
