import { useMemo, useState } from 'react';
import { ChevronsLeft, CircleQuestionMark } from 'lucide-react';
import ToolCornerActionButton from './ToolCornerActionButton';
import setting from '../../settings/setting';

const { buildTryConnectLabel, TOOL_BOTTOM_HINT } = setting;

interface ToolContentProps {
  sourceNodeIds: string[];
  sourceValue?: string;
  createMode?: string;
  type: string;
  onClick?: () => void;
  onTryConnect?: () => void;
  onTipClick?: (flag: boolean) => void;
  hasValue?: boolean;
}

type TipText = string | ((ctx: { sourceNodeIds: string[]; tryConnectLabel: string }) => string);
type TipConfig = {
  type: 'text' | 'button';
  tip: TipText;
  leftControl: boolean;
  topControl: boolean;
  pulseAnimation: boolean;
  tryConnect?: boolean;
  gift?: string;
};

const tipMap: Record<string, TipConfig> = {
  highDefinitionVideoTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  highDefinitionTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  poseTool: {
    type: 'button',
    tip: '点击进入编辑器',
    leftControl: false,
    topControl: true,
    pulseAnimation: true,
  },
  imageLayoutTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  textRedrawTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  multiViewTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  imageLipSyncTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  poseTransVideoTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  audioClipTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  videoClipTool: {
    type: 'button',
    tip: ({ tryConnectLabel }) => tryConnectLabel,
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  sizeAdaptTool: {
    type: 'button',
    tip: ({ sourceNodeIds, tryConnectLabel }) => (sourceNodeIds.length ? '点击进入编辑器' : tryConnectLabel),
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
  imageInpaintTool: {
    type: 'button',
    tip: ({ sourceNodeIds, tryConnectLabel }) => (sourceNodeIds.length ? '点击进入编辑器' : tryConnectLabel),
    leftControl: true,
    topControl: true,
    pulseAnimation: true,
    tryConnect: true,
  },
};

const ToolBottomHint = () => (
  <div className='z-[1] absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-base text-white/95 whitespace-nowrap pointer-events-none'>
    <ChevronsLeft size={18} />
    <span>{TOOL_BOTTOM_HINT}</span>
  </div>
);

const ToolContent = ({ sourceNodeIds, type, onClick, onTryConnect, onTipClick, hasValue = false }: ToolContentProps) => {
  const tryConnectLabel = useMemo(() => buildTryConnectLabel(type), [type]);
  const tipCont = tipMap[type];

  const resolvedTipCont = useMemo(() => {
    if (!tipCont) return undefined;
    if (type !== 'sizeAdaptTool' && type !== 'imageInpaintTool') return tipCont;
    const hasSource = sourceNodeIds.length > 0;
    return {
      ...tipCont,
      type: 'button' as const,
      leftControl: !hasSource,
      pulseAnimation: true,
    };
  }, [tipCont, type, sourceNodeIds]);

  const [hoverTimer, setHoverTimer] = useState<NodeJS.Timeout | null>(null);

  const tipText = useMemo(() => {
    if (!resolvedTipCont) return '';
    return typeof resolvedTipCont.tip === 'function' ? resolvedTipCont.tip({ sourceNodeIds, tryConnectLabel }) : resolvedTipCont.tip;
  }, [resolvedTipCont, sourceNodeIds, tryConnectLabel]);

  const isTryConnectMode = Boolean(resolvedTipCont?.tryConnect && !sourceNodeIds.length);

  const handleClick = () => {
    if (isTryConnectMode) {
      onTryConnect?.();
      return;
    }
    onClick?.();
  };

  const showButtonIcon = resolvedTipCont?.type === 'button' && !isTryConnectMode;

  const handleMouseEnter = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }
    const timer = setTimeout(() => {
      if (onTipClick) {
        onTipClick(true);
      }
    }, 300);
    setHoverTimer(timer);
  };

  const handleMouseLeave = () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
    if (onTipClick) {
      onTipClick(false);
    }
  };

  const showTip = useMemo(() => {
    if (resolvedTipCont?.leftControl) return !sourceNodeIds.length;
    return true;
  }, [resolvedTipCont, sourceNodeIds]);

  const buttonActive = useMemo(() => {
    if (!resolvedTipCont) return false;
    if (isTryConnectMode) return true;
    if (resolvedTipCont.leftControl) return false;
    return true;
  }, [resolvedTipCont, isTryConnectMode]);

  return (
    <div className='w-full h-full flex flex-col justify-between rounded-2xl gap-10'>
      {resolvedTipCont?.topControl && (
        <div
          className={`z-[2] absolute top-3 right-3 flex items-center justify-center duration-200 cursor-pointer`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <CircleQuestionMark className='text-white/65 text-3xl hover:text-white/95'></CircleQuestionMark>
        </div>
      )}
      {showTip && resolvedTipCont && (
        <>
          <div
            className='z-[1] absolute w-60 bottom-1/2 translate-y-1/2 right-1/2 translate-x-1/2'
            style={{
              right: !hasValue ? '' : '12px',
              bottom: !hasValue ? '' : '12px',
              translate: hasValue ? 'none' : undefined,
            }}
          >
            <ToolCornerActionButton
              toolType={type}
              active={buttonActive}
              label={tipText}
              icon={showButtonIcon ? <div className='iconfont text-3xl icon-import' /> : undefined}
              stopPropagation={isTryConnectMode}
              onClick={handleClick}
            />
          </div>
          {isTryConnectMode && <ToolBottomHint />}
        </>
      )}
    </div>
  );
};

export default ToolContent;
