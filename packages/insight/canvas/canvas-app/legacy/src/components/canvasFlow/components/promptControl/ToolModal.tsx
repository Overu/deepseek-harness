import React, { useState, useEffect, Children, type ReactElement } from 'react';
import { useFlowStore } from '@/store/flowStore';
import util from '../../utils/util';

import ReadOnlyPromptGuard from './ReadOnlyPromptGuard';

interface PoseCreateProps {
  children?: React.ReactNode;
  id: string;
  /** default：带背景与边框；bare：无容器样式，子组件直接浮在画布上 */
  variant?: 'default' | 'bare';
  /** default: rounded-lg；large: rounded-2xl */
  radius?: 'default' | 'large';
}

const { getSourceMap } = util;

const isSameList = (prev: string[], next: string[]) => {
  return prev.length === next.length && prev.every((item, index) => item === next[index]);
};

const ToolModal: React.FC<PoseCreateProps> = ({ children, id, variant = 'default', radius = 'default' }) => {
  const { nodes, edges, canvasId } = useFlowStore(state => state);
  const [textList, setTextList] = useState([] as string[]);
  const [imageList, setImageList] = useState([] as string[]);
  const [videoList, setVideoList] = useState([] as string[]);

  useEffect(() => {
    const { texts, images, videos } = getSourceMap(nodes, edges, id);
    const nextTextList = texts.map(t => t.value);
    const nextImageList = images.map(item => item.value);
    const nextVideoList = videos.map(item => item.value);

    setTextList(prev => (isSameList(prev, nextTextList) ? prev : nextTextList));
    setImageList(prev => (isSameList(prev, nextImageList) ? prev : nextImageList));
    setVideoList(prev => (isSameList(prev, nextVideoList) ? prev : nextVideoList));
  }, [edges, nodes, id]);

  // 如果children是单个元素且需要传递参数，使用cloneElement
  const childrenWithProps = Children.map(children, child => {
    if (React.isValidElement(child)) {
      // 将参数传递给child组件
      return React.cloneElement(child as ReactElement<any>, {
        textList,
        imageList,
        videoList,
        canvasId,
        nodeId: id,
      });
    }
    return child;
  });

  const radiusClass = radius === 'large' ? 'rounded-2xl' : 'rounded-lg';
  const wrapperClass = variant === 'bare' ? 'flex flex-col z-10' : `flex flex-col ${radiusClass} bg-[#262626] border-white/10 border z-10`;

  return (
    <ReadOnlyPromptGuard>
      <div className={wrapperClass}>{childrenWithProps}</div>
    </ReadOnlyPromptGuard>
  );
};

export default ToolModal;
