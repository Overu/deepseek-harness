import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MediaPreview from '@/components/common/MediaPreview';
import HistoryUpload from './HistoryUpload';
import LocalUpload from './LocalUpload';
import CustomTabs from '../common/CustomTabs';
import { toast } from 'sonner';

interface UploadModalProps {
  visible: boolean;
  allowLocal?: boolean;
  nodeId?: string;
  onCancel: () => void;
  onOk: (url: string, meta?: { file: File; preview?: string }) => void;
  title?: string;
  accept?: string;
  maxCount?: number;
  maxSize?: number;
  maxDuration?: number | null;
}

const UploadModal: React.FC<UploadModalProps> = ({ visible, allowLocal = true, nodeId, onCancel, onOk, title = '文件上传', accept = '*', maxSize = 10, maxDuration }) => {
  const [activeTab, setActiveTab] = useState('upload'); // 添加tab状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string>('');

  const previewUrls = useMemo(() => {
    return uploadedUrl ? [uploadedUrl] : [];
  }, [uploadedUrl]);

  const handleOk = (url: string, meta?: { file: File; preview?: string }) => {
    setUploadedUrl(url);
    onOk(url, meta);
  };

  const handleCancel = () => {
    onCancel();
  };

  // 弹窗关闭后再重置 tab / 预览 URL，避免从历史选择成功时先闪回「本地上传」再关闭
  useEffect(() => {
    if (!visible) {
      setActiveTab('upload');
      setUploadedUrl('');
    }
  }, [visible]);

  // 处理tab切换
  const handleTabChange = (key: string) => {
    if (uploading) {
      toast.warning('文件上传中，请稍后再切换');
      return;
    }
    setActiveTab(key);
  };

  // 处理历史素材选择
  const handleAssetSelect = (url: string) => {
    handleOk(url);
  };

  // 定义tab配置
  const tabs = [
    {
      key: 'upload',
      label: '本地上传',
      content: (
        <LocalUpload
          uploading={uploading}
          accept={accept}
          maxSize={maxSize}
          maxDuration={maxDuration}
          nodeId={nodeId}
          onOk={handleOk}
          updateUploading={isUploading => setUploading(isUploading)}
        />
      ),
    },
    {
      key: 'asset',
      label: '资产库',
      content: <HistoryUpload type={accept} onSelect={handleAssetSelect} />,
    },
  ];

  return (
    <Dialog open={visible} onOpenChange={open => !open && handleCancel()}>
      <DialogContent data-canvas-ignore-drop='true' className='max-w-[1000px] bg-[#262626] h-[75vh] w-screen flex flex-col'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {allowLocal ? (
          <div className='flex flex-col flex-1 h-0'>
            <CustomTabs tabs={tabs} activeKey={activeTab} onChange={handleTabChange} width={292} />

            {/* Tab内容区域 */}
            <div className='flex flex-col flex-1 h-0'>{tabs.find(tab => tab.key === activeTab)?.content}</div>
          </div>
        ) : (
          // 当allowLocal为false时，直接显示资产库内容，不显示tab
          <div className='flex flex-col flex-1 h-0'>
            <HistoryUpload type={accept} onSelect={handleAssetSelect} />
          </div>
        )}

        <MediaPreview visible={previewVisible} url={previewUrls} onClose={() => setPreviewVisible(false)} initialIndex={0} />
      </DialogContent>
    </Dialog>
  );
};

export default UploadModal;
