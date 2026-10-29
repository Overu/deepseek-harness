import { forwardRef, useImperativeHandle, useMemo, useState, useCallback, memo } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import Posture from './Posture';

import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { createPortal } from 'react-dom';

// 1. 定义暴露给父组件的方法类型（规范类型，可选但推荐）
interface PoseCreateExposedMethods {
  intoEdit: () => void;
}

interface PoseCreateProps {
  // onImageSelect: (url: string) => void;
  createMode: string;
  onSuccess: (url: string) => void;
  uploadStatus: (status: 'running' | 'success' | 'failure' | 'interrupt') => void;
  onChangeMode: (value: string) => void;
  textList?: string[]; // 传入的文本列表
  imageList?: string[]; // 传入的图片列表
}

const PoseCreate = forwardRef<PoseCreateExposedMethods, PoseCreateProps>(({ createMode, onSuccess, onChangeMode, imageList }, ref) => {
  const [toolVisible, setToolVisible] = useState(false);
  const tabValue = useMemo(() => {
    if (!createMode) {
      return 'userDefined';
    } else {
      return createMode;
    }
  }, [createMode]);

  const handleButtonClick = useCallback(() => {
    setToolVisible(true);
  }, []);

  const handleValueChange = (value: string) => {
    if (value === createMode) {
      return;
    }
    if (value === 'consult' && !imageList?.length) {
      return;
    }
    if (value === 'userDefined' && imageList?.length) {
      return;
    }
    onChangeMode(value);
  };

  const onHandleImage = (imageUrl: string) => {
    onSuccess(imageUrl);
    setToolVisible(false);
  };

  // 用useImperativeHandle暴露内部方法给父组件
  useImperativeHandle(
    ref,
    () => ({
      intoEdit: handleButtonClick,
    }),
    [handleButtonClick]
  );

  const getImageFlag = () => {
    return imageList?.length;
  };

  return (
    <>
      <Tabs defaultValue='userDefined' className='w-full p-1' value={tabValue} onValueChange={handleValueChange}>
        <TabsList className='w-full bg-[#262626] p-0 h-auto'>
          <TabsTrigger
            value='userDefined'
            className='p-0  rounded-lg data-[state=active]:bg-[#ffffff40]'
            onMouseEnter={e => e.stopPropagation()}
            onMouseLeave={e => e.stopPropagation()}
          >
            {/* 自定义姿势 */}
            <TooltipProvider>
              <Tooltip delayDuration={100} disableHoverableContent={false}>
                <TooltipTrigger asChild>
                  <p className='py-1 px-6'>自定义姿势</p>
                </TooltipTrigger>
                {getImageFlag() ? (
                  <TooltipContent>
                    <p>请删除图片再试试吧</p>
                  </TooltipContent>
                ) : (
                  ''
                )}
                {/* <TooltipContent>
                  <p>请删除图片再试试吧</p>
                </TooltipContent> */}
              </Tooltip>
            </TooltipProvider>
          </TabsTrigger>
          <TabsTrigger
            value='consult'
            className='p-0  rounded-lg data-[state=active]:bg-[#ffffff40]'
            onMouseEnter={e => e.stopPropagation()}
            onMouseLeave={e => e.stopPropagation()}
          >
            {/* 自定义姿势 */}
            <TooltipProvider>
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <p className='py-1 px-6'>姿势参考</p>
                </TooltipTrigger>
                {!getImageFlag() ? (
                  <TooltipContent>
                    <p>请接入1张图片再试试吧</p>
                  </TooltipContent>
                ) : (
                  ''
                )}
                {/* <TooltipContent>
                  <p>请接入1张图片再试试吧</p>
                </TooltipContent> */}
              </Tooltip>
            </TooltipProvider>
          </TabsTrigger>
          {/* <TabsTrigger value="consult" className='py-1 px-6 w-1/2 rounded-lg data-[state=active]:bg-[#ffffff40]'>
            姿势参考
          </TabsTrigger> */}
        </TabsList>
      </Tabs>

      {toolVisible &&
        createPortal(
          <div
            className='fixed inset-0 top-0 left-0 w-full h-full bg-black p-4'
            style={{
              zIndex: 9999,
              padding: '16px 44px',
              display: 'grid',
              placeItems: 'center',
              height: '100%',
              overflowY: 'auto',
            }}
          >
            <Posture
              onImageSuccess={onHandleImage}
              onClose={() => {
                setToolVisible(false);
              }}
              backgroundImage={imageList?.[0]}
            ></Posture>
          </div>,
          document.body
        )}
    </>
  );
});

export default memo(PoseCreate);
