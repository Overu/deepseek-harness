import React from 'react';
import { Image, Copy } from 'lucide-react';
import AudioImage from '@/assets/images/audio.png';
import { Button } from '@/components/ui/button';
import { getLabelByFieldValue } from '@/components/canvasFlow/utils/util';
import { toast } from 'sonner';
import type { SourceParamParsed } from '../types';
import { parsePromptWithRefs } from './utils';
import { buildToolParamDisplayValues, buildToolPromptTexts, resolveToolNodeName } from './toolSourceParamDisplay';

/** 将字段 key 转为展示用标签（如 some_key -> Some key） */
const humanizeFieldKey = (key: string): string => {
  if (!key) return key;
  const withSpaces = key.replace(/_/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).toLowerCase();
};

/**
 * model 模式「参数选择」rest 列表中排除的字段：
 * - 专用逻辑拆解展示：modelType / model / cameraControl / cameraMovement / seniorParams
 * - 硬编码隐藏不展示：gen_count / enableAudio
 */
const EXCLUDED_REST_PARAM_KEYS = ['modelType', 'model', 'cameraControl', 'cameraMovement', 'seniorParams', 'gen_count', 'enableAudio'] as const;
const EXCLUDED_REST_PARAM_KEY_SET = new Set<string>(EXCLUDED_REST_PARAM_KEYS);

interface RightPanelSourceParamsProps {
  sourceParam: SourceParamParsed | null;
  canvasName?: string;
  /** 是否展示「所属来源」区块，画布预览传 false */
  showCanvasSource?: boolean;
  toolNodeKey?: string;
  toolNodeName?: string;
  fieldChoicesMap: Record<string, { value: any; label: string }[]>;
  fieldLabelsMap: Record<string, string>;
  expandedPromptIndices: Set<number>;
  onTogglePromptExpand: (index: number) => void;
}

export const RightPanelSourceParams: React.FC<RightPanelSourceParamsProps> = ({
  sourceParam,
  canvasName,
  showCanvasSource = true,
  toolNodeKey,
  toolNodeName,
  fieldChoicesMap,
  fieldLabelsMap,
  expandedPromptIndices,
  onTogglePromptExpand,
}) => {
  const input = sourceParam?.input;
  let params = sourceParam?.params;
  const resolvedToolNodeKey = toolNodeKey ?? sourceParam?.toolNodeKey;
  const isToolSource = Boolean(resolvedToolNodeKey);
  const resolvedToolNodeName = isToolSource ? (toolNodeName ?? resolveToolNodeName(sourceParam)) : undefined;
  // 兼容后端将 params 存成 JSON 字符串的情况（二次编码）
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params) as Record<string, unknown>;
    } catch {
      params = undefined;
    }
  }
  const images = input?.images ?? [];
  const videos = input?.videos ?? [];
  const audio = input?.audio ?? [];
  const inputTexts = input?.texts ?? [];
  const promptTexts = isToolSource ? buildToolPromptTexts(params, inputTexts) : inputTexts;

  const hasInputRef = images.length > 0 || videos.length > 0 || audio.length > 0;
  const hasPrompt = promptTexts.length > 0;

  const paramsExceptPrompt = params ? Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'prompt')) : {};
  const paramEntries = Object.entries(paramsExceptPrompt);
  const modelTypeEntry = paramEntries.find(([k]) => k === 'modelType');
  const modelEntry = paramEntries.find(([k]) => k === 'model');
  const cameraControlEntry = paramEntries.find(([k]) => k === 'cameraControl');
  const cameraMovementEntry = paramEntries.find(([k]) => k === 'cameraMovement');
  const seniorParamsEntry = paramEntries.find(([k]) => k === 'seniorParams');
  const restEntries = paramEntries.filter(([k]) => !EXCLUDED_REST_PARAM_KEY_SET.has(k));

  // cameraControl 为 set 类型，拆解为子字段分别查 label 并展示
  const cameraControlItems: string[] = [];
  if (cameraControlEntry) {
    let cameraControlValue = cameraControlEntry[1];
    // 兼容 cameraControl 存成 JSON 字符串的情况
    if (typeof cameraControlValue === 'string') {
      try {
        cameraControlValue = JSON.parse(cameraControlValue) as Record<string, unknown>;
      } catch {
        cameraControlValue = undefined;
      }
    }
    if (cameraControlValue != null && typeof cameraControlValue === 'object' && !Array.isArray(cameraControlValue)) {
      const cameraControlObj = cameraControlValue as Record<string, unknown>;
      const isCameraControlEnabled = cameraControlObj.enable === true;
      if (isCameraControlEnabled) {
        for (const [subKey, subValue] of Object.entries(cameraControlObj)) {
          if (subKey === 'enable') continue;
          const valueLabel = getLabelByFieldValue(fieldChoicesMap, `cameraControl.${subKey}`, subValue);
          cameraControlItems.push(valueLabel);
        }
      }
    }
  }

  // cameraMovement：enable 为 true 时仅展示 name
  let cameraMovementName: string | undefined;
  if (cameraMovementEntry) {
    let cameraMovementValue = cameraMovementEntry[1];
    if (typeof cameraMovementValue === 'string') {
      try {
        cameraMovementValue = JSON.parse(cameraMovementValue) as Record<string, unknown>;
      } catch {
        cameraMovementValue = undefined;
      }
    }
    if (cameraMovementValue != null && typeof cameraMovementValue === 'object' && !Array.isArray(cameraMovementValue)) {
      const cameraMovementObj = cameraMovementValue as Record<string, unknown>;
      if (cameraMovementObj.enable === true && typeof cameraMovementObj.name === 'string' && cameraMovementObj.name) {
        cameraMovementName = cameraMovementObj.name;
      }
    }
  }

  // seniorParams 单独作为高级配置展示，每项展示「字段名: 字段值」
  const seniorParamItems: { fieldLabel: string; valueLabel: string }[] = [];
  if (seniorParamsEntry) {
    let seniorParamsValue = seniorParamsEntry[1];
    if (typeof seniorParamsValue === 'string') {
      try {
        seniorParamsValue = JSON.parse(seniorParamsValue) as Record<string, unknown>;
      } catch {
        seniorParamsValue = undefined;
      }
    }
    if (seniorParamsValue != null && typeof seniorParamsValue === 'object' && !Array.isArray(seniorParamsValue)) {
      for (const [subKey, subValue] of Object.entries(seniorParamsValue)) {
        const valueLabel = getLabelByFieldValue(fieldChoicesMap, subKey, subValue);
        seniorParamItems.push({
          fieldLabel: fieldLabelsMap[subKey] ?? humanizeFieldKey(subKey),
          valueLabel,
        });
      }
    }
  }

  const orderedParamValues = isToolSource
    ? buildToolParamDisplayValues(resolvedToolNodeKey!, params)
    : [
        ...(modelTypeEntry ? [getLabelByFieldValue(fieldChoicesMap, modelTypeEntry[0], modelTypeEntry[1])] : []),
        ...(modelEntry ? [getLabelByFieldValue(fieldChoicesMap, modelEntry[0], modelEntry[1])] : []),
        ...cameraControlItems,
        ...(cameraMovementName ? [cameraMovementName] : []),
        ...restEntries.map(([k, v]) => getLabelByFieldValue(fieldChoicesMap, k, v)),
      ];

  // 有待展示的参数但选项映射尚未加载完成时，显示解析中
  const hasParamsToResolve = !isToolSource && paramEntries.length > 0;
  const paramsResolving = hasParamsToResolve && Object.keys(fieldChoicesMap).length === 0;

  const showSourceSection = showCanvasSource || isToolSource;
  const sourceDisplayText = (() => {
    if (!showSourceSection) return null;
    const segments = ['工作流项目'];
    if (showCanvasSource || canvasName) {
      segments.push(canvasName ?? '—');
    }
    if (isToolSource && resolvedToolNodeName) {
      segments.push(resolvedToolNodeName);
    }
    return segments.join(' | ');
  })();

  const getUrl = (url: string | { url?: string }) => (typeof url === 'string' ? url : (url as { url?: string })?.url);

  return (
    <div className='space-y-6'>
      {sourceDisplayText && (
        <div>
          <h3 className='text-sm font-medium text-white/65 mb-2'>所属来源</h3>
          <div className='text-sm text-white/95 min-h-[2rem]'>{sourceDisplayText}</div>
        </div>
      )}

      {hasInputRef && (
        <div>
          <h3 className='text-sm font-medium text-white/65 mb-2'>输入参考</h3>
          <div className='flex flex-wrap gap-3'>
            {images.map((url, i) => (
              <div key={`img-${i}`} className='relative w-28 h-28 rounded-lg overflow-hidden bg-white/5 border border-white/10'>
                <span className='absolute top-1 left-1 px-1.5 py-0.5 rounded text-xs bg-black/50 text-white/90 z-10'>图片</span>
                <img src={getUrl(url)} alt='' className='w-full h-full object-cover' />
              </div>
            ))}
            {videos.map((url, i) => (
              <div key={`vid-${i}`} className='relative w-28 h-28 rounded-lg overflow-hidden bg-white/5 border border-white/10'>
                <span className='absolute top-1 left-1 px-1.5 py-0.5 rounded text-xs bg-black/50 text-white/90 z-10'>视频</span>
                <video src={getUrl(url)} className='w-full h-full object-cover' muted />
              </div>
            ))}
            {audio.map((_, i) => (
              <div key={`aud-${i}`} className='relative w-28 h-28 rounded-lg overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center'>
                <span className='absolute top-1 left-1 px-1.5 py-0.5 rounded text-xs bg-black/50 text-white/90 z-10'>音频</span>
                <img src={AudioImage} alt='' className='w-full h-full object-cover' />
              </div>
            ))}
          </div>
        </div>
      )}

      {(paramsResolving || orderedParamValues.length > 0) && (
        <div>
          <h3 className='text-sm font-medium text-white/65 mb-2'>参数选择</h3>
          <div className='text-sm text-white/95'>{paramsResolving ? <span className='text-white/50'>解析中…</span> : orderedParamValues.join(' | ')}</div>
        </div>
      )}

      {!isToolSource && ((paramsResolving && seniorParamsEntry) || seniorParamItems.length > 0) ? (
        <div>
          <h3 className='text-sm font-medium text-white/65 mb-2'>高级配置</h3>
          <div className='text-sm text-white/95 space-y-1'>
            {paramsResolving && seniorParamsEntry ? (
              <span className='text-white/50'>解析中…</span>
            ) : (
              seniorParamItems.map((item, i) => (
                <div key={i}>
                  {item.fieldLabel}: {item.valueLabel}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {hasPrompt && (
        <div>
          <div className='flex items-center justify-between gap-2 mb-2'>
            <h3 className='text-sm font-medium text-white/65'>提示词</h3>
            <Button
              variant='ghost'
              size='sm'
              className='h-8 px-2 text-white/60 hover:text-white hover:bg-white/10 shrink-0'
              title='一键复制全部提示词'
              onClick={async () => {
                const copyText = promptTexts.join('\n');
                if (!copyText.trim()) {
                  toast.info('暂无提示词内容');
                  return;
                }
                try {
                  await navigator.clipboard.writeText(copyText);
                  toast.success('已复制到剪贴板');
                } catch {
                  toast.error('复制失败');
                }
              }}
            >
              <Copy className='w-4 h-4 mr-1' />
              复制
            </Button>
          </div>
          <div className='text-sm text-white/95 space-y-2'>
            {promptTexts.map((t, i) => {
              const str = typeof t === 'string' ? t : String(t ?? '');
              const overLimit = str.length > 140;
              const expanded = expandedPromptIndices.has(i);
              const displayStr = !overLimit || expanded ? str : str.slice(0, 140) + '…';
              return (
                <div key={i} className='flex flex-col gap-1'>
                  <div className='flex flex-wrap items-center gap-1 text-white/95'>
                    {parsePromptWithRefs(displayStr).map((part, idx) =>
                      part.type === 'ref' ? (
                        <span key={`${i}-${idx}`} className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/10 text-white/90 overflow-hidden'>
                          {(() => {
                            const imgSrc = part.refIndex != null && images[part.refIndex - 1] != null ? getUrl(images[part.refIndex - 1]) : null;
                            return imgSrc ? (
                              <>
                                <img src={imgSrc} alt={part.value} className='h-4 w-4 rounded-full object-cover shrink-0' />
                                {part.value}
                              </>
                            ) : (
                              <>
                                <Image className='w-3.5 h-3.5 shrink-0' />
                                {part.value}
                              </>
                            );
                          })()}
                        </span>
                      ) : (
                        <span key={`${i}-${idx}`}>{part.value}</span>
                      )
                    )}
                  </div>
                  {overLimit && (
                    <button type='button' className='self-end text-xs text-white/50 hover:text-white/80 transition-colors' onClick={() => onTogglePromptExpand(i)}>
                      {expanded ? '收起' : '展开'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
