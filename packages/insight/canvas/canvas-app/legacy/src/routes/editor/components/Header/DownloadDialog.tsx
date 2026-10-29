import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import InsTooltip from '@/components/ui/ins-tooltip';
import { EditorEngine } from '../../core/EditorEngine';
import type { ExportOptions } from '../../core/types';
import dayjs from 'dayjs';

interface DownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DownloadDialog: React.FC<DownloadDialogProps> = ({ open, onOpenChange }) => {
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [scale, setScale] = useState<string>('1');
  const [quality, setQuality] = useState<string>('1');
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  useEffect(() => {
    if (open) {
      // 每次打开重置为默认值
      setFormat('png');
      setScale('1');
      setQuality('1');
      updateDimensions(1);
    }
  }, [open]);

  const updateDimensions = (multiplier: number) => {
    const engine = EditorEngine.getInstance();
    const workspace = engine.getObjectById('workspace');
    if (workspace && workspace.width && workspace.height) {
      setDimensions({
        width: Math.floor(workspace.width * multiplier),
        height: Math.floor(workspace.height * multiplier),
      });
    }
  };

  const handleScaleChange = (value: string) => {
    setScale(value);
    updateDimensions(parseFloat(value));
  };

  const handleDownload = () => {
    const engine = EditorEngine.getInstance();
    const options: ExportOptions = {
      format,
      quality: parseFloat(quality),
      multiplier: parseFloat(scale),
    };

    const dataUrl = engine.exportImage(options);
    if (!dataUrl) return;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `编辑器_${dayjs().format('YYYYMMDD_HHmmss')}.${format === 'jpeg' ? 'jpg' : 'png'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[425px] select-none'>
        <DialogHeader>
          <DialogTitle>下载</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3 py-4'>
          {/* Format Selection */}
          <div className='flex items-center gap-4'>
            <Label className='min-w-16'>图片格式</Label>
            <div className='flex'>
              <InsTooltip label='支持透明像素，文件较大'>
                <Button variant={format === 'png' ? 'secondary' : 'outline'} size='sm' onClick={() => setFormat('png')} className='w-20 rounded-none'>
                  PNG
                </Button>
              </InsTooltip>

              <InsTooltip label='不支持透明像素，文件较小'>
                <Button variant={format === 'jpeg' ? 'secondary' : 'outline'} size='sm' onClick={() => setFormat('jpeg')} className='w-20 rounded-none'>
                  JPG
                </Button>
              </InsTooltip>
            </div>
          </div>

          {/* Scale Selection */}
          <div className='flex items-center gap-4'>
            <Label className='min-w-16'>导出比例</Label>
            <div className='flex'>
              <Select value={scale} onValueChange={handleScaleChange}>
                <SelectTrigger>
                  <SelectValue placeholder='Select scale' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='0.5'>0.5x</SelectItem>
                  <SelectItem value='0.75'>0.75x</SelectItem>
                  <SelectItem value='1'>1x</SelectItem>
                  <SelectItem value='1.5'>1.5x</SelectItem>
                  <SelectItem value='2'>2x</SelectItem>
                  <SelectItem value='3'>3x</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* JPG Quality Selection */}
          {format === 'jpeg' && (
            <div className='flex items-center gap-4 animate-in fade-in slide-in-from-top-1 duration-200'>
              <Label className='min-w-16'>压缩比例</Label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger>
                  <SelectValue placeholder='Select quality' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='1'>100% (无压缩)</SelectItem>
                  <SelectItem value='0.8'>80%</SelectItem>
                  <SelectItem value='0.7'>70%</SelectItem>
                  <SelectItem value='0.5'>50% (普通压缩)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Size Preview */}
          <div className='flex items-center gap-4'>
            <Label className='min-w-16'>尺寸大小</Label>
            <div className='text-sm text-muted-foreground bg-muted p-2 rounded-md text-center'>
              {dimensions.width} x {dimensions.height} px
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className='btn ins-btn-primary w-24' onClick={handleDownload}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
