import { useMemo } from 'react';
import { useLayerStore } from '../../store/layerStore';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import { PropertyBar } from '../common/PropertyBar';
import { CommonProps } from './CommonProps';
import { TextProps } from './TextProps';
import { ShapeProps } from './ShapeProps';
import { ImageProps } from './ImageProps';

interface PropertyPanelProps {
  onStartCrop?: (objectId: string) => void;
  onStartMatting?: (objectId: string) => void;
}

export function PropertyPanel({ onStartCrop, onStartMatting }: PropertyPanelProps) {
  const activeIds = useLayerStore(state => state.activeIds);
  const engine = useEditorEngine();

  const activeObject = useMemo(() => {
    if (activeIds.length !== 1) return null;
    return engine.getObjectById(activeIds[0]);
  }, [activeIds, engine]);

  if (!activeObject) {
    return null;
  }

  const objectType = activeObject.type;

  return (
    <PropertyBar className='overflow-x-auto'>
      {/* 特定属性 */}
      {(objectType === 'textbox' || objectType === 'text') && <TextProps object={activeObject} />}

      {(objectType === 'rect' || objectType === 'circle' || objectType === 'triangle' || objectType === 'polygon') && <ShapeProps object={activeObject} />}

      {objectType === 'image' && <ImageProps object={activeObject} onStartCrop={onStartCrop} onStartMatting={onStartMatting} />}

      {/* 通用属性 */}
      <CommonProps object={activeObject} />
    </PropertyBar>
  );
}
