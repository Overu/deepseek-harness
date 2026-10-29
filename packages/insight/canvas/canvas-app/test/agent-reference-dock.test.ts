// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as referenceData from '../../src/shared/canvas-node-references';
import * as protocol from '../../src/shared/protocol';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { CanvasNodeReferences } from '../../src/client/canvas-node-references';

// Render the Client component with the test renderer's React. Production Client/iframe use separate React versions.
function HoverCard({ anchor, content, disabled }: { anchor: React.ReactNode; content: React.ReactNode; disabled: boolean }) {
  const [open, setOpen] = React.useState(false);
  return React.createElement('span', { 'data-preview-anchor': true, 'data-disabled': String(disabled),
    onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) }, anchor, open && !disabled ? content : null);
}
const source = readFileSync(resolve('..', 'src/client/CanvasReferenceDock.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} as Record<string, any> };
runInNewContext(code, { exports: loaded.exports, module: loaded, require: (name: string) => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return jsxRuntime;
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { HoverCard };
  if (name === '../shared/canvas-node-references.ts') return referenceData;
  throw new Error(`Unexpected Client dependency: ${name}`);
} });
const { CanvasReferenceDock, referencesZh } = loaded.exports;
const composerSource = readFileSync(resolve('..', 'src/client/CanvasComposerAttachments.tsx'), 'utf8');
const composerCode = ts.transpileModule(composerSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const composer = { exports: {} as Record<string, any> };
runInNewContext(composerCode, { exports: composer.exports, module: composer, require: (name: string) => {
  if (name === 'react/jsx-runtime') return jsxRuntime;
  if (name === './CanvasReferenceDock.tsx') return loaded.exports;
  if (name === '../shared/protocol.ts') return protocol;
  throw new Error(`Unexpected composer dependency: ${name}`);
} });
const t = (key: string, values: Record<string, string> = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, value), referencesZh[key]);
let root: Root, container: HTMLDivElement, references: CanvasNodeReferences;
const identity = { protocolVersion: 1 as const, type: 'canvas.references.changed' as const, canvasId: '2873', viewId: 'view', subscriptionId: 'sub', revision: 1, reason: 'select' as const };
const node = (id: string, data = {}, type = 'image') => ({ id, data, type, position: { x: 0, y: 0 } });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); references = new CanvasNodeReferences();
});
afterEach(() => { React.act(() => root.unmount()); container.remove(); });

it('dock previews first/all products and separates focus from removal', () => {
  const focused: string[] = [];
  references.receive('session', { ...identity, nodes: [node('image', { title: '图片', value: 'https://media.test/1.png', product: [{ value: 'https://media.test/2.png' }] }), node('empty', { title: '文字' }, 'text')] });
  React.act(() => root.render(React.createElement(CanvasReferenceDock, { references, referenceSessionId: 'session', t, openReference: (ref: any) => focused.push(ref.node.id) })));
  expect(container.querySelectorAll('img')).toHaveLength(1);
  const previews = container.querySelectorAll<HTMLElement>('[data-preview-anchor]');
  expect(previews[1].dataset.disabled).toBe('true');
  React.act(() => previews[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(container.querySelectorAll('[aria-label="节点产物"] img')).toHaveLength(2);
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="定位节点：图片"]')!.click());
  expect(focused).toEqual(['image']);
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="移除引用：图片"]')!.click());
  expect(focused).toEqual(['image']);
  expect(references.getSnapshot('session').references.map(ref => ref.node.id)).toEqual(['empty']);
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="清空节点引用"]')!.click());
  expect(container.querySelector('[data-canvas-references]')).toBeNull();
});

it('mounted dock responds to deleted nodes and updated outputs without resurrecting dismissed references', () => {
  references.receive('session', { ...identity, nodes: [node('n', { title: 'old', value: 'https://media.test/old.png' })] });
  React.act(() => root.render(React.createElement(CanvasReferenceDock, { references, referenceSessionId: 'session', t, openReference: () => {} })));
  React.act(() => references.receive('session', { ...identity, reason: 'update', nodes: [node('n', { title: 'new', value: 'https://media.test/new.png' })] }));
  expect(container.querySelector('img')!.getAttribute('src')).toBe('https://media.test/new.png');
  expect(container.querySelector('[aria-label="定位节点：new"]')).not.toBeNull();
  React.act(() => references.receive('session', { ...identity, reason: 'update', nodes: [] }));
  expect(container.querySelector('[data-canvas-references]')).toBeNull();
  React.act(() => references.receive('session', { ...identity, reason: 'update', nodes: [node('n')] }));
  expect(container.querySelector('[data-canvas-references]')).toBeNull();
});

function composerFixture(Native: React.ComponentType<any>) {
  const core = new SlotCore(), disposers: (() => void)[] = [], navigations: any[] = [];
  core.register({ name: 'root', children: { 'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' } } }, () => null);
  core.register({ name: 'conversation.input.attachments', locale: 'conversation' }, Native);
  composer.exports.registerCanvasComposerAttachments({
    effect(callback: () => () => void) { const dispose = callback(); disposers.push(dispose); return dispose; },
    slots: {
      entriesOfSlot: (key: string) => core.entriesOfSlot(key),
      register: (options: any, component: any) => core.register(options, component),
      inject(_key: string, callback: () => Iterable<() => void>) {
        const cleanups = [...callback()]; return () => cleanups.reverse().forEach(dispose => dispose());
      },
    },
    sidebarRight: { openResource: (...args: any[]) => navigations.push(args) },
  }, references);
  const entry = core.entriesOfSlot('conversation.input.attachments')[0];
  const View = entry.component as React.ComponentType<any>;
  const render = (sessionId: string | undefined, props: Record<string, any> = {}) => React.act(() => root.render(
    React.createElement('div', { 'data-composer-card': true }, React.createElement(View, {
      ...entry.inject!(sessionId as never), attachments: [], t: (key: string) => key, ...props,
      renderSlot(key: string) {
        expect(sessionId).toBeDefined();
        const child = core.entriesOfSlot(key)[0];
        expect(child.locale).toBe('desktop-canvas-references');
        return React.createElement(child.component as React.ComponentType<any>, { ...child.inject!(sessionId as never), t });
      },
    }), React.createElement('textarea', { 'aria-label': 'draft' })),
  ));
  return { core, entry, render, navigations, dispose: () => disposers.reverse().forEach(dispose => dispose()) };
}

it('composes native attachments above the dock and editor, preserving native callbacks and one drop listener', () => {
  let received: any, mounts = 0, drops = 0, removals = 0, retries = 0;
  const attachments = [{ id: 'file', kind: 'file' }], uploads = { file: { status: 'error' } };
  const onAddFiles = () => { drops++; }, onRemoveAttachment = () => { removals++; }, onRetryFile = () => { retries++; };
  function Native(props: any) {
    received = props;
    React.useEffect(() => {
      mounts++; document.addEventListener('drop', props.onAddFiles);
      return () => { mounts--; document.removeEventListener('drop', props.onAddFiles); };
    }, [props.onAddFiles]);
    return React.createElement('div', { 'data-native-attachments': true },
      React.createElement('button', { onClick: () => props.onRemoveAttachment('file') }, 'remove attachment'),
      React.createElement('button', { onClick: () => props.onRetryFile('file') }, 'retry upload'));
  }
  const h = composerFixture(Native);
  references.receive('session', { ...identity, nodes: [node('n', { title: 'Node', value: 'https://media.test/n.png' })] });
  const props = { attachments, uploads, onAddFiles, onRemoveAttachment, onRetryFile, canAcceptDrop: true, dropLimits: { count: 3, size: '10MB' } };
  h.render('session', props);
  expect(Array.from(container.querySelector('[data-composer-card]')!.children).map(child => child.tagName)).toEqual(['DIV', 'SECTION', 'TEXTAREA']);
  expect(container.querySelector('[data-native-attachments]')).not.toBeNull();
  for (const [key, value] of Object.entries(props)) expect(received[key]).toBe(value);
  expect(h.entry.locale).toBe('conversation');
  expect(h.core.entriesOfSlot('conversation.input.dock')).toHaveLength(0);
  expect(mounts).toBe(1);
  document.dispatchEvent(new Event('drop')); expect(drops).toBe(1);
  React.act(() => container.querySelector<HTMLButtonElement>('[data-native-attachments] button')!.click());
  React.act(() => container.querySelectorAll<HTMLButtonElement>('[data-native-attachments] button')[1].click());
  expect(removals).toBe(1); expect(retries).toBe(1);
  expect(references.getSnapshot('session').references).toHaveLength(1);
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="定位节点：Node"]')!.click());
  expect(h.navigations).toEqual([['dsh-resource://canvas/2873', { params: { nodeId: 'n' } }]]);
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="清空节点引用"]')!.click());
  expect(container.querySelector('[data-canvas-references]')).toBeNull();
  expect(container.querySelector('[data-native-attachments]')).not.toBeNull();
  expect(mounts).toBe(1);
  React.act(() => root.render(null));
  document.dispatchEvent(new Event('drop')); expect(drops).toBe(1); expect(mounts).toBe(0);
  h.dispose();
  expect(h.core.entriesOfSlot('conversation.input.attachments')[0].component).toBe(Native);
  expect(h.core.specDynamic('desktop-canvas.composer.references')).toBeUndefined();
});

it('handles attachment-only, reference-only, empty and absent sessions without leaking references on session switches', () => {
  function Native({ attachments }: any) { return attachments.length ? React.createElement('div', { 'data-native-attachments': true }, 'file') : null; }
  const h = composerFixture(Native);
  h.render(undefined);
  expect(container.querySelector('[data-composer-card]')!.children).toHaveLength(1);
  h.render('empty', { attachments: [{ id: 'file' }] });
  expect(container.querySelector('[data-native-attachments]')).not.toBeNull();
  expect(container.querySelector('[data-canvas-references]')).toBeNull();
  references.receive('session', { ...identity, nodes: [node('a', { title: 'Session A' })] });
  references.receive('other', { ...identity, nodes: [node('b', { title: 'Session B' })] });
  h.render('session');
  expect(container.querySelector('[data-native-attachments]')).toBeNull();
  expect(container.querySelector('[aria-label="定位节点：Session A"]')).not.toBeNull();
  h.render('other');
  expect(container.querySelector('[aria-label="定位节点：Session A"]')).toBeNull();
  expect(container.querySelector('[aria-label="定位节点：Session B"]')).not.toBeNull();
  h.render('empty');
  expect(container.querySelector('[data-composer-card]')!.children).toHaveLength(1);
  h.render(undefined);
  expect(container.querySelector('[data-canvas-references]')).toBeNull();
  h.dispose();
});
