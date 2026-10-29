// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('@/store/flowStore', () => ({ useFlowStore: (selector: (state: unknown) => unknown) => selector({ modelMaxPromptMap: {} }) }));
vi.mock('@/routes', () => ({ router: { navigate: vi.fn() } }));
vi.mock('@/hooks/useFileUpload', () => ({}));
vi.mock('@/components/ui/slider', () => ({ Slider: ({ onValueChange }: { onValueChange?: (value: number[]) => void }) => createElement('button', { 'data-slider': true, onClick: () => onValueChange?.([1]) }, 'slider') }));
import hooks from '../legacy/src/components/canvasFlow/hooks';
import DurationSliderControl from '../legacy/src/components/canvasFlow/components/promptControl/DurationSliderControl';
import { GenSeniorParams } from '../legacy/src/components/canvasFlow/customNode/audio/SeniorParams';
import { AudioModelType, type MusicGenAudioNodeParams } from '../legacy/src/components/canvasFlow/customNode/audio/types';
import { isAgentEditorBusy } from '../src/agent-edit-guard';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); act(() => vi.runAllTimers()); container.remove(); vi.useRealTimers(); expect(isAgentEditorBusy()).toBe(false); });
const input = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});

it('native prompt uses 1500ms, keeps pending after blur/unmount, and preserves manual flush', () => {
  const commit = vi.fn();
  function Prompt() {
    const { prompt, setPrompt, debouncedUpdateValue, flushPrompt } = hooks.usePromptModelCommon({ nodeId: 'n1', nodePrompt: 'old', status: '', onChangePrompt: commit });
    return createElement('div', null, createElement('textarea', { value: prompt, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { setPrompt(event.target.value); debouncedUpdateValue(event.target.value); } }), createElement('button', { onClick: flushPrompt }, 'send'));
  }
  act(() => root.render(createElement(Prompt))); input(container.querySelector('textarea')!, 'draft');
  expect(isAgentEditorBusy()).toBe(true); act(() => vi.advanceTimersByTime(1499)); expect(commit).not.toHaveBeenCalled();
  act(() => container.querySelector('button')!.click()); expect(commit).toHaveBeenCalledExactlyOnceWith('draft'); expect(isAgentEditorBusy()).toBe(false);
  input(container.querySelector('textarea')!, 'after close'); act(() => root.render(null));
  expect(isAgentEditorBusy()).toBe(true); act(() => vi.advanceTimersByTime(1500)); expect(commit).toHaveBeenLastCalledWith('after close'); expect(isAgentEditorBusy()).toBe(false);
});

it('native audio title/lyrics stay protected for 500ms after blur without changing advanced payloads', () => {
  const commit = vi.fn();
  const params: MusicGenAudioNodeParams = { model: 'fixture', modelType: AudioModelType.MUSIC_GEN, prompt: '', gen_count: 1, seniorParams: { title: 'old', lyrics: 'old', audioWeight: 0, instrumental: false, customMode: true, styleWeight: 0, vocalGender: 0, weirdnessConstraint: 0 } };
  act(() => root.render(createElement(GenSeniorParams, { nodeId: 'n2', params, seniorParamsOption: [], instrumental: false, onSelectChange: commit })));
  input(container.querySelector('input')!, 'title draft'); input(container.querySelector('textarea')!, 'lyrics draft');
  act(() => container.querySelector('textarea')!.blur()); expect(isAgentEditorBusy()).toBe(true);
  act(() => vi.advanceTimersByTime(499)); expect(commit).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(commit.mock.calls).toEqual([['seniorParams', { title: 'title draft' }], ['seniorParams', { lyrics: 'lyrics draft' }]]); expect(isAgentEditorBusy()).toBe(false);
});

it('native duration slider keeps its 1000ms delay and flushes on unmount', () => {
  const commit = vi.fn(); const options = [3, 5].map(value => ({ value, label: String(value) }));
  act(() => root.render(createElement(DurationSliderControl, { nodeId: 'n3', label: '时长', value: 3, options, onChange: commit })));
  act(() => container.querySelector<HTMLButtonElement>('[data-slider]')!.click());
  expect(isAgentEditorBusy()).toBe(true); act(() => vi.advanceTimersByTime(999)); expect(commit).not.toHaveBeenCalled();
  act(() => root.render(null)); expect(commit).toHaveBeenCalledExactlyOnceWith(5); expect(isAgentEditorBusy()).toBe(false);
});

it('native duration typed draft commits only at its original blur and snaps to supported values', () => {
  const commit = vi.fn(); const options = [3, 5].map(value => ({ value, label: String(value) }));
  function Duration() {
    const [value, setValue] = useState(3);
    return createElement(DurationSliderControl, { nodeId: 'n3', label: '时长', value, options, onChange: next => { commit(next); setValue(next); } });
  }
  act(() => root.render(createElement(Duration))); const element = container.querySelector('input')!;
  act(() => element.focus()); input(element, '6'); act(() => vi.advanceTimersByTime(2000));
  expect(isAgentEditorBusy()).toBe(true); expect(commit).not.toHaveBeenCalled();
  act(() => element.blur()); expect(commit).toHaveBeenCalledExactlyOnceWith(5); expect(element.value).toBe('5'); expect(isAgentEditorBusy()).toBe(false);
});
