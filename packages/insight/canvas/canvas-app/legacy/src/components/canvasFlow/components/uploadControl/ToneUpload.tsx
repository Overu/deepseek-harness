import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import HistoryUpload from './HistoryUpload';
import LocalUpload from './LocalUpload';
import { toast } from 'sonner';
import { addTone } from '@/api/workflow';
import styles from '../index.module.less';
import pointImage from '@/assets/images/point.png';
import { usePointStore } from '@/store/pointStore';

const MIN_TONE_DURATION_SEC = 10;
const MAX_TONE_DURATION_SEC = 5 * 60; // 5 分钟

/** 通过 URL（含 blob）读取音频时长（秒），失败返回 null */
function getAudioDurationSec(url: string): Promise<number | null> {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    const done = (value: number | null) => {
      audio.removeAttribute('src');
      audio.load();
      resolve(value);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      if (!Number.isFinite(d) || d <= 0) {
        done(null);
      } else {
        done(d);
      }
    };
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

/** 校验音色音频时长，不通过时弹出提示（与提交、上传后、选择资产后一致） */
async function warnIfToneDurationInvalid(url: string): Promise<boolean> {
  const durationSec = await getAudioDurationSec(url);
  if (durationSec === null) {
    toast.warning('无法读取音频时长，请检查文件或网络后重试');
    return false;
  }
  if (durationSec < MIN_TONE_DURATION_SEC) {
    toast.warning(`音色音频时长需不少于 ${MIN_TONE_DURATION_SEC} 秒，当前约 ${durationSec.toFixed(1)} 秒`);
    return false;
  }
  if (durationSec > MAX_TONE_DURATION_SEC) {
    toast.warning(`音色音频时长不得超过 5 分钟，当前约 ${durationSec.toFixed(1)} 秒`);
    return false;
  }
  return true;
}

interface UploadModalProps {
  visible: boolean;
  onCancel: () => void;
  onOk: () => void;
  title?: string;
  accept?: string;
  maxCount?: number;
  maxSize?: number;
}

const ToneUpload: React.FC<UploadModalProps> = ({ visible, onCancel, onOk, title = '文件上传', accept = '*', maxSize = 10 }) => {
  const toneNeedPoint = 1000;
  const { updateUserPoint, setNeedPoint } = usePointStore(state => state.actions);
  const [activeTab, setActiveTab] = useState('upload'); // 添加tab状态
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string>('');
  const [name, setName] = useState('');
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string>(''); // 资产库选中的URL
  const [loading, setLoading] = useState(false);

  const validate = () => {
    if (!name.trim()) {
      toast.warning('请输入音色名称');
      return false;
    }
    if (activeTab == 'upload' && !uploadedUrl) {
      toast.warning('请上传音色文件');
      return false;
    }
    if (activeTab == 'asset' && !selectedAssetUrl) {
      toast.warning('请选择音色文件');
      return false;
    }
    return true;
  };

  const handleOk = async () => {
    if (!validate()) return;
    let originUrl = '';
    if (activeTab == 'upload') {
      originUrl = uploadedUrl;
    } else {
      originUrl = selectedAssetUrl;
    }
    if (!(await warnIfToneDurationInvalid(originUrl))) return;
    try {
      setNeedPoint(toneNeedPoint);
      const params = {
        name,
        originUrl,
      };
      setLoading(true);
      toast.success('生成音色文件中，请稍后');
      const res: any = await addTone(params);
      if (res.code === 'SUCCESS') {
        updateUserPoint();
        toast.success('新增成功');
        onOk();
        cancel();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = (url: string) => {
    setUploadedUrl(url);
    void warnIfToneDurationInvalid(url);
  };

  const handleDelete = () => {
    setUploadedUrl('');
  };

  const handleCancel = () => {
    cancel();
    onCancel();
  };

  const cancel = () => {
    setActiveTab('upload');
    setUploadedUrl('');
    setSelectedAssetUrl('');
  };

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
    if (url === selectedAssetUrl) {
      setSelectedAssetUrl('');
      return;
    }
    setSelectedAssetUrl(url);
    void warnIfToneDurationInvalid(url);
  };

  return (
    <Dialog open={visible} onOpenChange={open => !open && handleCancel()}>
      <DialogContent data-canvas-ignore-drop='true' className='max-w-[1000px] bg-[#262626] h-[75vh] w-screen flex flex-col' onKeyDown={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* 自定义Tab头部 */}
        <div className='relative mb-4 m-auto'>
          <div className='flex h-10 relative bg-black rounded-lg items-center w-fit px-[2px]'>
            <button
              className={`w-36 h-9 leading-9 text-center text-sm font-medium relative z-10 transition-colors ${
                activeTab === 'upload' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => handleTabChange('upload')}
            >
              本地上传
            </button>
            <button
              className={`w-36 h-9 leading-9 text-center text-sm font-medium relative z-10 transition-colors ${
                activeTab === 'asset' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => handleTabChange('asset')}
            >
              资产库
            </button>
            {/* 滑块槽 */}
            <div
              className={`w-36 h-9 absolute top-[2px] bg-white/25 rounded-lg transition-all duration-200 ease-in-out ${activeTab === 'upload' ? 'left-[2px]' : 'left-[146px]'}`}
            />
          </div>
        </div>

        {/* Tab内容区域（保持挂载，避免切换tab时本地上传文件丢失） */}
        <div className={`flex flex-col flex-1 h-0 ${activeTab === 'upload' ? '' : 'hidden'}`}>
          <LocalUpload
            uploading={uploading}
            accept={accept}
            maxSize={maxSize}
            extraTip='请上传10S~15S的音频文件'
            onOk={handleUpload}
            onDelete={handleDelete}
            updateUploading={isUploading => setUploading(isUploading)}
          />
        </div>
        <div className={`flex flex-col flex-1 h-0 ${activeTab === 'asset' ? '' : 'hidden'}`}>
          <HistoryUpload type={accept} selectedUrl={selectedAssetUrl} onSelect={handleAssetSelect} />
        </div>
        <div className='flex mt-2 flex-col gap-2'>
          <label className='text-sm text-white/60 flex items-center gap-1'>
            <span className='text-red-500'>*</span> 音色名称
          </label>
          <Input
            placeholder='请输入'
            className='w-[246px] bg-[#2C2C2E] border-none rounded-lg py-3 px-4 text-sm focus:ring-1 focus:ring-blue-500 outline-none transition-shadow'
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleOk} disabled={loading} className={styles.sendButton}>
            <div className='flex items-center gap-1'>
              <img src={pointImage} alt='point' />
              <div>{toneNeedPoint}</div>
            </div>
            <div>{loading ? '处理中...' : '确定'}</div>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ToneUpload;
