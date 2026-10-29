// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as referenceData from '../../src/shared/canvas-node-references';
import * as protocol from '../../src/shared/protocol';

function load(name: string, dependencies: Record<string, unknown> = {}) {
  const source = readFileSync(resolve('..', 'src/client', name), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as Record<string, any> };
  runInNewContext(code, { exports: loaded.exports, module: loaded, require: (name: string) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === '../shared/canvas-node-references.ts') return referenceData;
    if (name === '../shared/protocol.ts') return protocol;
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return loaded.exports;
}
function HoverCard({ anchor, content }: { anchor: React.ReactNode; content: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return React.createElement('span', { 'data-preview-anchor': true, onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) },
    anchor, open && React.createElement('div', { 'data-preview': true }, content));
}
const primitives = { '@deepseek-ai/dsh-client-ui-primitives': { HoverCard } };
const dock = load('CanvasReferenceDock.tsx', primitives);
const { createCanvasReferenceMessageView, registerCanvasReferenceMessageViews } = load('CanvasReferenceMessage.tsx', { ...primitives, './CanvasReferenceDock.tsx': dock });
const refs = referenceData.toReferenceItems([{ canvasId: '1001', node: { id: 'n1', type: 'image', position: { x: 0, y: 0 },
  data: { title: 'Image Generator', value: 'https://media.test/image.png', params: { model: 'flux' } } } }]);
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { React.act(() => root.unmount()); container.remove(); });

it.each(['user', 'steering'])('renders %s thumbnails above native content while preserving copy and attachment props', kind => {
  let received: any, copied: any;
  const attachment = { type: 'image', image: 'attachment' };
  const openFile = () => {};
  function NativeMessage(props: any) {
    received = props;
    return React.createElement('div', { 'data-native': true }, props.node.data.content.map((block: any) => block.type === 'text' ? block.text : '附件').join(''),
      React.createElement('button', { onClick: () => { copied = props.node.data.content; } }, 'copy'));
  }
  const focused: string[][] = [];
  const View = createCanvasReferenceMessageView(NativeMessage, (...ids: string[]) => focused.push(ids));
  const content = [{ type: 'text', text: '修改节点' }, attachment, { type: 'text', text: referenceData.serializeNodeRefs(refs) }];
  const node = { kind, data: { kind, content, time: 123, referenceLabels: ['file'], skillNames: ['skill'] } };
  React.act(() => root.render(React.createElement(View, { node, openFile })));
  expect(container.textContent).toContain('修改节点附件');
  expect(container.textContent).not.toContain('Image Generator');
  expect(container.textContent).not.toContain('node-refs');
  expect(container.textContent).not.toContain('"params"');
  expect(container.querySelector('img')!.getAttribute('src')).toBe('https://media.test/image.png');
  const thumbnail = container.querySelector<HTMLButtonElement>('[aria-label="Image Generator"]')!;
  expect(thumbnail.title).toBe('Image Generator');
  expect(thumbnail.style.width).toBe('40px');
  expect(thumbnail.style.height).toBe('40px');
  const wrapper = container.querySelector('[data-canvas-reference-message]')!;
  expect(wrapper.firstElementChild!.contains(thumbnail)).toBe(true);
  expect(wrapper.lastElementChild!.hasAttribute('data-native')).toBe(true);
  React.act(() => container.querySelector('[data-preview-anchor]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(container.querySelector('[data-preview]')!.textContent).toContain('Image Generator');
  expect(received.openFile).toBe(openFile);
  expect(received.node.data.referenceLabels).toEqual(['file']);
  expect(received.node.data.skillNames).toEqual(['skill']);
  expect(received.node.data.content[1]).toBe(attachment);
  React.act(() => container.querySelector<HTMLButtonElement>('[data-native] button')!.click());
  expect(copied).toEqual(content.slice(0, 2));
  React.act(() => thumbnail.click());
  expect(focused).toEqual([['1001', 'n1']]);
  expect(node.data.content).toHaveLength(3);
});

it.each(['user', 'steering'])('orders %s files and images before nodes and body without duplicating native actions', kind => {
  const file = { type: 'file', attachment: { attachmentId: 'file-id', name: 'AGENTS.md', bytes: 2662 } };
  const image = { type: 'image', attachment: { attachmentId: 'image-id', width: 100, height: 200, name: 'input.png' } };
  const body = { type: 'text', text: '修改节点 @AGENTS.md' };
  const content = [file, body, image, { type: 'text', text: referenceData.serializeNodeRefs(refs) }];
  const node = { kind, data: { kind, content, time: 123, referenceLabels: ['AGENTS.md'], skillNames: ['skill'] } };
  let received: any, copied = '';
  const openFile = vi.fn(), openSkill = vi.fn(), preview = vi.fn();
  const renderFactorySlot = vi.fn(() => React.createElement('div', { 'data-native-content': true },
    React.createElement('button', { title: file.attachment.name }, 'file'),
    React.createElement('button', { 'data-message-image': true, onClick: () => preview(image.attachment) }, 'image')));
  function Native(props: any) {
    received = props;
    return React.createElement('div', { 'data-native': true },
      React.createElement('div', { 'data-body': true }, props.node.data.content.map((block: any) => block.text).join('')),
      React.createElement('button', { 'data-copy': true, onClick: () => { copied = props.node.data.content.map((block: any) => block.text).join(''); } }, 'copy'),
      React.createElement('button', { 'data-file-reference': true, onClick: () => props.openFile('AGENTS.md') }, 'file'),
      React.createElement('button', { 'data-skill-reference': true, onClick: () => props.openSkill('skill') }, 'skill'));
  }
  const focused = vi.fn(), View = createCanvasReferenceMessageView(Native, focused);
  React.act(() => root.render(React.createElement(View, { node, openFile, openSkill, renderFactorySlot })));
  const wrapper = container.querySelector('[data-canvas-reference-message]')!;
  expect(wrapper.children).toHaveLength(3);
  expect(wrapper.children[0].hasAttribute('data-canvas-message-attachments')).toBe(true);
  expect(wrapper.children[1].querySelector('[aria-label="Image Generator"]')).not.toBeNull();
  expect(wrapper.children[2].hasAttribute('data-native')).toBe(true);
  expect(wrapper.children[0].querySelector('[data-native-content]')).not.toBeNull();
  expect(container.querySelectorAll('[title="AGENTS.md"]')).toHaveLength(1);
  expect(renderFactorySlot).toHaveBeenCalledWith('conversation.chat.user.content', {
    content: { text: '', extraBlocks: [], attachments: [
      { type: 'file', file: file.attachment }, { type: 'image', image: { attachment: image.attachment } },
    ] }, loadImage: undefined, facts: {},
  });
  expect(received.node.data.content).toEqual([body]);
  expect(received.node.data.content[0]).toBe(body);
  expect(received.node.data.time).toBe(123);
  expect(received.node.data.referenceLabels).toBe(node.data.referenceLabels);
  expect(received.node.data.skillNames).toBe(node.data.skillNames);
  expect(container.querySelectorAll('[data-copy]')).toHaveLength(1);
  React.act(() => container.querySelector<HTMLButtonElement>('[data-copy]')!.click());
  React.act(() => container.querySelector<HTMLButtonElement>('[data-message-image]')!.click());
  React.act(() => container.querySelector<HTMLButtonElement>('[data-file-reference]')!.click());
  React.act(() => container.querySelector<HTMLButtonElement>('[data-skill-reference]')!.click());
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Image Generator"]')!.click());
  expect(copied).toBe(body.text);
  expect(preview).toHaveBeenCalledWith(image.attachment);
  expect(openFile).toHaveBeenCalledWith('AGENTS.md');
  expect(openSkill).toHaveBeenCalledWith('skill');
  expect(focused).toHaveBeenCalledWith('1001', 'n1');
  expect(node.data.content).toBe(content);
  expect(content).toEqual([file, body, image, { type: 'text', text: referenceData.serializeNodeRefs(refs) }]);
});

it('delegates single-image content and preserves native actions when a referenced message has no text', () => {
  const image = { type: 'image', attachment: { attachmentId: 'image-id', width: 100, height: 200 } };
  let received: any;
  const Native = (props: any) => { received = props; return React.createElement('div', { 'data-native': true }, 'actions'); };
  const renderFactorySlot = vi.fn(() => React.createElement('button', { 'data-message-image': true }, 'image'));
  const View = createCanvasReferenceMessageView(Native, () => {});
  const content = [image, { type: 'text', text: referenceData.serializeNodeRefs(refs) }];
  React.act(() => root.render(React.createElement(View, { node: { data: { content } }, renderFactorySlot })));
  expect(renderFactorySlot).toHaveBeenCalledWith('conversation.chat.user.content', {
    content: { text: '', extraBlocks: [], attachments: [{ type: 'image', image: { attachment: image.attachment } }] },
    loadImage: undefined, facts: {},
  });
  expect(received.node.data.content).toEqual([]);
  expect(container.querySelectorAll('[data-native]')).toHaveLength(1);
  expect(container.textContent).toContain('actions');
});

it('shows one thumbnail per node, with all safe outputs on hover and type icons for empty or failed products', () => {
  const references = [
    { ...refs[0], products: [...refs[0].products, { kind: 'image', value: 'https://media.test/second.png' }, { kind: 'image', value: 'javascript:alert(1)' }] },
    ...referenceData.toReferenceItems([
      { canvasId: '1001', node: { id: 'empty', type: 'audio', position: { x: 0, y: 0 }, data: { title: 'Empty audio' } } },
      { canvasId: '1001', node: { id: 'text', type: 'text', position: { x: 0, y: 0 }, data: { title: 'Text node', value: 'Long text output' } } },
    ]),
  ];
  const Native = () => React.createElement('div', { 'data-native': true }, 'body');
  const View = createCanvasReferenceMessageView(Native, () => {});
  const node = { data: { content: [{ type: 'text', text: referenceData.serializeNodeRefs(references as any) }] } };
  React.act(() => root.render(React.createElement(View, { node })));
  expect(container.querySelectorAll('[data-preview-anchor] button')).toHaveLength(3);
  expect(container.querySelectorAll('img')).toHaveLength(1);
  expect(container.querySelector('[aria-label="Empty audio"] svg')).not.toBeNull();
  expect(container.textContent).not.toContain('Long text output');
  const row = container.querySelector('[data-canvas-reference-message]')!.firstElementChild as HTMLElement;
  expect(row.style.flexWrap).toBe('wrap');
  expect(row.style.justifyContent).toBe('flex-end');
  React.act(() => container.querySelector('[data-preview-anchor]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  const preview = container.querySelector('[data-preview]')!;
  expect(Array.from(preview.querySelectorAll('img')).map(image => image.getAttribute('src'))).toEqual([
    'https://media.test/image.png', 'https://media.test/second.png',
  ]);
  React.act(() => container.querySelector('[aria-label="Image Generator"] img')!.dispatchEvent(new Event('error')));
  expect(container.querySelector('[aria-label="Image Generator"] svg')).not.toBeNull();
});

it('passes ordinary and unknown-version messages through the native renderer without a wrapper', () => {
  let received: any;
  const Native = (props: any) => { received = props; return React.createElement('div', { 'data-native': true }, 'native'); };
  const View = createCanvasReferenceMessageView(Native, () => {});
  const node = { data: { content: [{ type: 'text', text: referenceData.serializeNodeRefs(refs).replace('version="1"', 'version="2"') }] } };
  React.act(() => root.render(React.createElement(View, { node })));
  expect(received.node).toBe(node);
  expect(container.querySelector('[data-canvas-reference-message]')).toBeNull();
});

it('registers both renderer keys and restores their original registrations on unload', () => {
  const native = () => null, active = ['user', 'steering'].map(key => ({ component: native, options: { key, priority: 0 } }));
  const disposers: (() => void)[] = [], calls: any[] = [];
  const ctx = { sidebarRight: { openResource() {} }, effect(fn: () => () => void) { disposers.push(fn()); },
    slots: { entriesOfSlot: () => active, register(options: any, component: any) {
      const entry = { options, component }; active.unshift(entry); calls.push(entry);
      return () => { active.splice(active.indexOf(entry), 1); };
    }, inject(_key: string, fn: () => Iterable<() => void>) { const cleanups = [...fn()]; return () => cleanups.reverse().forEach(dispose => dispose()); } } };
  registerCanvasReferenceMessageViews(ctx);
  expect(calls.map(entry => entry.options.key)).toEqual(['user', 'steering']);
  expect(calls.every(entry => entry.options.priority === -1 && entry.options.locale === 'chat')).toBe(true);
  disposers.forEach(dispose => dispose());
  expect(active.map(entry => entry.component)).toEqual([native, native]);
});
