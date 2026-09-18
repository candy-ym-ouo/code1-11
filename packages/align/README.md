# @history/align

转录分段与音频对齐模块。纯函数、零依赖，不读写时钟与随机数：
**相同输入必然产生相同输出（重算可复现）**。

## 能力

| 函数 | 说明 |
| --- | --- |
| `segmentWords(words, options?)` | 按静音间隔、句末标点、段时长/词数上限把词序列切成分段 |
| `assignWordsToClips(words, clips)` | 按词中点时间戳把每个词吸附到片段（左闭右开；未覆盖时吸附到最近片段） |
| `alignWordsToClips(words, clips, options?)` | 顶层流程：分段 + 吸附，段不跨片段，聚合出每个片段的转写文本 |
| `realignTranscript(originalWords, revisedText)` | 修订文本后重对齐：匹配 token 精确保留原时间戳，新增 token 在相邻锚点间整数均分插值 |
| `wordsDigest(words)` | 内容指纹（FNV-1a 64 位，带算法版本前缀），用于校验两次重算结果一致 |
| `validateWordTimings(value)` | 运行时校验词序列（API/任务边界使用） |

## 不变量

- **可复现**：所有算法为纯函数；片段归属先按 `(startMs, endMs, id)` 排序，
  与入参顺序无关；中点比较用 2 倍整数运算，无浮点误差；平局一律取排序最前者。
- **锚点不可破坏**：`realignTranscript` 中匹配 token（`anchor: true`）的
  `startMs/endMs` 逐值等于原词时间戳，修订文本只影响被改动的 token。
- **插值确定**：连续 k 个新增 token 在左锚点 `L` 与右锚点 `R` 之间均分，
  全程整数四舍五入；只有单侧锚点时贴该侧边界；无锚点可依据时时间为 `null`。
- **单调性**：输入词序列时间单调时，重对齐输出的 `startMs` 单调非降。

## 对齐粒度

原文与修订文本使用同一个确定性分词器（CJK 逐字、标点独立、拉丁连续成词），
原文 token 通过拼接时的字符区间映射回原词并继承其时间戳。因此中文改一个字、
英文改大小写或全半角，其余部分的锚点都精确保留。

## 用法

```ts
import {
  alignWordsToClips,
  realignTranscript,
  wordsDigest,
} from '@history/align';

// 1. ASR 词序列吸附到固定时间范围片段
const { clips, segments, assignments } = alignWordsToClips(words, [
  { id: 'clip-1', startMs: 0, endMs: 60_000 },
]);

// 2. 用户修订文本后重对齐，原锚点不动
const result = realignTranscript(words, revisedText);

// 3. 校验重算可复现
console.assert(wordsDigest(result.tokens) === expectedDigest);
```

## 版本

`ALGORITHM_VERSION`（当前 `align.v1`）随任何影响输出的规则变更递增，
`wordsDigest` 前缀同步变化，旧指纹自然失效。
