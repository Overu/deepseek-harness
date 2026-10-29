// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as links from '../../src/shared/canvas-message-links';
import * as protocol from '../../src/shared/protocol';
const code=ts.transpileModule(readFileSync(resolve('..','src/client/CanvasMessageLinks.tsx'),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loaded={exports:{} as any};
runInNewContext(code,{exports:loaded.exports,module:loaded,require:(name:string)=>name==='react/jsx-runtime'?jsxRuntime:name==='../shared/canvas-message-links.ts'?links:name==='../shared/protocol.ts'?protocol:React});
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.append(container);root=createRoot(container)});
afterEach(()=>{React.act(()=>root.unmount());container.remove()});
it('renders a real canonical ID anchor, opens within the plugin and leaves original node/copy data untouched',()=>{
  const node={data:{status:'completed',blocks:[{kind:'reasoning',text:'分析'},{kind:'text',text:'当前画布 ID：[103334](dsh-resource://canvas/103334)。'}],finalNode:{seq:99}}};let received:any;const opened:string[]=[];
  const Native=(props:any)=>{received=props;return React.createElement('span',{'data-native':true},props.node.data.blocks.filter((b:any)=>b.kind==='reasoning').map((b:any)=>b.text).join(''))};
  const View=loaded.exports.createCanvasMessageLinks(Native,(id:string)=>opened.push(id));React.act(()=>root.render(React.createElement(View,{node})));
  const anchor=container.querySelector('a')!;expect(anchor.textContent).toBe('103334');expect(anchor.getAttribute('href')).toBe('dsh-resource://canvas/103334');React.act(()=>anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
  expect(opened).toEqual(['103334']);expect(node.data.blocks).toHaveLength(2);expect(received.node.data.finalNode).toBe(node.data.finalNode);expect(container.textContent).not.toContain('dsh-resource');expect(container.textContent).toContain('分析');
});
it('keeps streaming, ordinary Markdown and reasoning-only views on their native renderer',()=>{
  let received:any;const Native=(props:any)=>{received=props;return React.createElement('span',null,'native')};const View=loaded.exports.createCanvasMessageLinks(Native,()=>{throw Error('not clicked')});
  for(const props of [{node:{data:{status:'running',blocks:[{kind:'text',text:'当前画布 ID：[103334](dsh-resource://canvas/103334)。'}]}}},{node:{data:{status:'completed',blocks:[{kind:'text',text:'[普通网站](https://example.com)'}]}}}]){React.act(()=>root.render(React.createElement(View,props)));expect(received).toEqual(props);expect(container.querySelector('a')).toBeNull()}
});
