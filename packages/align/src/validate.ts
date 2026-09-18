import type { WordTiming } from './types.js';

/**
 * 运行时校验词序列（零依赖，供 API/任务边界使用）。
 * 不合法时抛出带中文说明的 TypeError；合法时原样返回。
 */
export function validateWordTimings(value: unknown): WordTiming[] {
  if (!Array.isArray(value)) {
    throw new TypeError('词序列必须是数组');
  }
  for (let i = 0; i < value.length; i++) {
    const word = value[i] as Partial<WordTiming> | null;
    if (!word || typeof word !== 'object') {
      throw new TypeError(`第 ${i} 个词不是对象`);
    }
    if (typeof word.text !== 'string' || word.text.length === 0) {
      throw new TypeError(`第 ${i} 个词缺少文本`);
    }
    if (
      !Number.isInteger(word.startMs) ||
      !Number.isInteger(word.endMs) ||
      (word.startMs as number) < 0 ||
      (word.endMs as number) < (word.startMs as number)
    ) {
      throw new TypeError(`第 ${i} 个词的时间戳无效: ${JSON.stringify(word)}`);
    }
  }
  return value as WordTiming[];
}
