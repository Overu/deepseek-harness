import { useState } from 'react';
import { Eye, Download } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import CanvasAssetPreview from '../CanvasAssetPreview';
import VideoPlayer from '@/components/common/fileControl/VideoPlayer';
import { downloadFile, compressImage } from '@/utils';
import hooks from '../../hooks';

const { useButtonScale } = hooks;

interface ProductItem {
  value: string;
}

interface ProductListProps {
  list: Array<ProductItem>;
  type?: 'image' | 'video';
  width?: number;
  height?: number;
  previewUrls: Array<string>;
  nodeId: string;
  onSet: (url: string) => void;
}

const ProductList = ({ list, type, width, height, previewUrls, nodeId, onSet }: ProductListProps) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const mediaType = type || 'image';

  const buttonScale = useButtonScale();

  const handlePreview = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    const index = previewUrls.indexOf(url);
    setPreviewIndex(index >= 0 ? index : 0);
    setPreviewVisible(true);
  };

  const handleDownload = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    downloadFile(url);
  };

  return (
    <div className='absolute left-full top-0 w-full flex items-start gap-4 ml-4'>
      {list.map((item: ProductItem, index: number) => {
        return (
          <div className='relative shrink-0 rounded-2xl bg-black/70' key={index}>
            {mediaType === 'image' ? (
              <img src={compressImage(item.value)} className='object-contain rounded-2xl' style={{ width, height }} onDoubleClick={e => handlePreview(e, item.value)} />
            ) : (
              <VideoPlayer url={item.value} style={{ width, height }} onPreview={e => handlePreview(e, item.value)} />
            )}
            <div className='absolute top-2 right-2'>
              <div className='flex items-center nodrag gap-2' style={{ transform: `scale(${buttonScale})`, transformOrigin: 'top right' }}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className='flex items-center justify-center bg-black/45 hover:bg-black/85 w-8 h-8 cursor-pointer rounded-lg transition-colors backdrop-blur-md'>
                        <Eye size={18} color='#fff' onClick={e => handlePreview(e, item.value)} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>预览</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className='flex items-center justify-center bg-black/45 hover:bg-black/85 w-8 h-8 cursor-pointer rounded-lg transition-colors backdrop-blur-md'>
                        <Download size={18} color='#fff' onClick={e => handleDownload(e, item.value)} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>下载</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div
                  onClick={() => onSet(item.value)}
                  className='flex items-center justify-center bg-black/45 hover:bg-black/85 text-white text-sm p-2 h-8 cursor-pointer rounded-lg transition-colors backdrop-blur-md'
                >
                  设为主{mediaType == 'image' ? '图' : '视频'}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <CanvasAssetPreview visible={previewVisible} nodeId={nodeId} urls={previewUrls} initialIndex={previewIndex} onClose={() => setPreviewVisible(false)} />
    </div>
  );
};

export default ProductList;
