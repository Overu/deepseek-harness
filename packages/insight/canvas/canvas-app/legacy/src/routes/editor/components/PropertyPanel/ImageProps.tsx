import type { Object as FabricObject, Image as FabricImage } from 'fabric';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { PropertyButton, PropertySeparator } from '../common/PropertyBar';
import { FlipHorizontal, FlipVertical, Crop } from 'lucide-react';
import { Button } from '../../../../components/ui/button';

interface ImagePropsProps {
  object: FabricObject;
  onStartCrop?: (objectId: string) => void;
  onStartMatting?: (objectId: string) => void;
}

export function ImageProps({ object, onStartCrop, onStartMatting }: ImagePropsProps) {
  const engine = useEditorEngine();
  const imageObject = object as FabricImage;

  // 水平翻转
  const handleFlipX = () => {
    if (!object.id) return;
    const newFlipX = !imageObject.flipX;
    engine.updateObjectProps(object.id, { flipX: newFlipX });
  };

  // 垂直翻转
  const handleFlipY = () => {
    if (!object.id) return;
    const newFlipY = !imageObject.flipY;
    engine.updateObjectProps(object.id, { flipY: newFlipY });
  };

  // 进入裁剪模式
  const handleCrop = () => {
    if (!object.id || !onStartCrop) return;
    onStartCrop(object.id);
  };

  // 进入抠图模式
  const handleMatting = () => {
    if (!object.id || !onStartMatting) return;
    onStartMatting(object.id);
  };

  return (
    <div className='flex items-center gap-1'>
      <Button className='chat-send-button w-20 !rounded-md text-white' size='sm' onClick={handleMatting}>
        退底抠图
      </Button>
      <PropertySeparator />
      {/* 水平翻转 */}
      <PropertyButton onClick={handleFlipX} tooltip='水平翻转' className={imageObject.flipX ? 'bg-zinc-700' : ''}>
        <FlipHorizontal size={12} />
      </PropertyButton>

      {/* 垂直翻转 */}
      <PropertyButton onClick={handleFlipY} tooltip='垂直翻转' className={imageObject.flipY ? 'bg-zinc-700' : ''}>
        <FlipVertical size={12} />
      </PropertyButton>

      {/* 裁剪 */}
      <PropertyButton onClick={handleCrop} tooltip='裁剪'>
        <Crop size={12} />
      </PropertyButton>

      <PropertySeparator />
    </div>
  );
}
