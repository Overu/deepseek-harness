// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as links from '../../src/client/canvas-created-links';
import * as protocol from '../../src/shared/protocol';
import { canvasResultsClosingSeq } from '../../src/client/canvas-results';
const code = ts.transpileModule(readFileSync(resolve('..', 'src/client/CanvasCreatedLinks.tsx'), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} as any };
runInNewContext(code, { exports: module.exports, module, require: (name: string) => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return jsxRuntime;
  if (name === './canvas-created-links.ts') return links;
  if (name === './canvas-results.ts') return { canvasResultsClosingSeq };
  if (name === './CanvasResults.ts') return { CANVAS_RESULTS_NS: 'desktop-canvas-results' };
  if (name === '../shared/protocol.ts') return protocol;
  throw Error('Unexpected import: ' + name);
} });
const View = module.exports.CanvasCreatedLinks;
function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return { getSnapshot: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }, set(next: T) { value = next; listeners.forEach(fn => fn()) }, listeners };
}
const tool = (canvasId = '103490') => ({ root: { kind: 'tool-result', callId: 'created-' + canvasId, name: 'canvas_create', seq: 5, isError: false, subCalls: [], content: [{ type: 'text', text: JSON.stringify({ status: 'created', canvasId, address: 'dsh-resource://canvas/' + canvasId, name: '未命名画布', requestId: 'receipt-' + canvasId, runtime: 'ready', version: '0' }) }] } });
const turn = { turn: 1, end: { seq: 10 } };
let root: Root, container: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container) });
afterEach(() => { React.act(() => root.unmount()); container.remove() });
function fixture(initial: any[] = []) {
  const tools = observable(initial), chats = observable({ nodes: { turnDataSource: (_turn: number, kind: string) => { expect(kind).toBe('tool-call'); return tools } } });
  const opened: string[] = [];
  return { tools, chats, opened, props: { turn, seq: 9, getCanvasChat: () => chats, openCreatedCanvas: (id: string) => opened.push(id), t: () => '画布 ID：' } };
}
it('empty canvas receipt adds a real ID link with any prose; it opens only on click and preserves prose', () => {
  const f = fixture();
  const prose = '空白画布已经创建好。\n- 画布名称：未命名画布\n- 画布 ID：103490\n接下来要添加什么？';
  const render = () => React.createElement(React.Fragment, null, React.createElement('p', { 'data-native-prose': true }, prose), React.createElement(View, f.props));
  React.act(() => root.render(render())); expect(container.querySelector('a')).toBeNull();
  React.act(() => f.tools.set([tool()]));
  const anchor = container.querySelector('a')!;
  expect(anchor.textContent).toBe('103490'); expect(anchor.getAttribute('href')).toBe('dsh-resource://canvas/103490'); expect(f.opened).toEqual([]);
  React.act(() => anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(f.opened).toEqual(['103490']); expect(container.querySelector('[data-native-prose]')?.textContent).toBe(prose);
  expect(container.textContent).not.toContain('dsh-resource://');
});
it('reopening historical UI retains links and releases subscriptions on session switch', () => {
  const first = fixture([tool()]); React.act(() => root.render(React.createElement(View, first.props)));
  expect(container.querySelectorAll('a')).toHaveLength(1);
  React.act(() => root.unmount()); root = createRoot(container);
  expect(first.tools.listeners.size).toBe(0); expect(first.chats.listeners.size).toBe(0);
  React.act(() => root.render(React.createElement(View, first.props))); expect(container.querySelector('a')?.textContent).toBe('103490');
  const other = fixture(); React.act(() => root.render(React.createElement(View, other.props)));
  expect(container.querySelector('a')).toBeNull(); expect(first.tools.listeners.size).toBe(0);
  React.act(() => first.tools.set([tool('103491')])); expect(container.querySelector('a')).toBeNull();
});
it('multiple creations show unique clickable IDs and no extra open button', () => {
  const f = fixture([tool(), tool(), tool('103491')]); React.act(() => root.render(React.createElement(View, f.props)));
  expect([...container.querySelectorAll('a')].map(a => a.textContent)).toEqual(['103490', '103491']); expect(container.querySelector('button')).toBeNull();
});
