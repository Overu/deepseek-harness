import type { SourceParamParsed } from '../types';

export function parseSourceParam(sourceParam: string): SourceParamParsed | null {
  try {
    return JSON.parse(sourceParam) as SourceParamParsed;
  } catch {
    return null;
  }
}

/** 将 prompt 中的 {{@图片1}} 等拆成片段，用于渲染标签+文本 */
export function parsePromptWithRefs(prompt: string): { type: 'text' | 'ref'; value: string; refIndex?: number }[] {
  const parts: { type: 'text' | 'ref'; value: string; refIndex?: number }[] = [];
  const re = /\{\{@图片(\d+)\}\}/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', value: prompt.slice(lastIndex, m.index) });
    }
    parts.push({ type: 'ref', value: `图片${m[1]}`, refIndex: parseInt(m[1], 10) });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < prompt.length) {
    parts.push({ type: 'text', value: prompt.slice(lastIndex) });
  }
  return parts;
}
