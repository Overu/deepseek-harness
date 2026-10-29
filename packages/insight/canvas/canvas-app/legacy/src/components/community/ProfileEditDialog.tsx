import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { updateUser, type UpdateUserParams } from '@/api/auth';
import type { CommunityUserProfile } from '@/api/community';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uploadFile } from '@/services/upload/uploadFile';
import type { UserData } from '@/store/userStore';
import { compressImage } from '@/utils';

const fallbackAvatar = 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/png/20260731-113037-3fb3f4def4432a80.png';
const USER_NAME_MAX_LENGTH = 15;
const SIGNATURE_MAX_LENGTH = 50;
const AVATAR_MAX_SIZE = 5 * 1024 * 1024;

type ApiResponse<T> = {
  code?: string | number;
  msg?: string;
  data?: T;
  body?: T;
  success?: boolean;
};

export interface ProfileEditValues {
  avatarUrl: string;
  userName: string;
  signature: string;
}

interface ProfileEditDialogProps {
  open: boolean;
  profile: CommunityUserProfile | null;
  userInfo: UserData | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (values: ProfileEditValues) => void;
}

const isSuccessResponse = <T,>(response: ApiResponse<T>) => {
  return response.success === true || response.code === 'SUCCESS' || response.code === 200 || String(response.code) === '0';
};

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object') {
    const maybeError = error as { msg?: unknown; message?: unknown };
    if (typeof maybeError.msg === 'string') return maybeError.msg;
    if (typeof maybeError.message === 'string') return maybeError.message;
  }

  return '保存失败，请重试';
};

const getUploadedUrl = (result: unknown) => {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';

  const data = result as {
    url?: unknown;
    fileUrl?: unknown;
    avatarUrl?: unknown;
    data?: unknown;
  };

  if (typeof data.url === 'string') return data.url;
  if (typeof data.fileUrl === 'string') return data.fileUrl;
  if (typeof data.avatarUrl === 'string') return data.avatarUrl;
  if (typeof data.data === 'string') return data.data;

  return '';
};

const getCurrentAvatarUrl = (profile: CommunityUserProfile | null, userInfo: UserData | null) => profile?.avatar_url || userInfo?.avatarUrl || '';

export function ProfileEditDialog({ open, profile, userInfo, onOpenChange, onSaved }: ProfileEditDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [userName, setUserName] = useState('');
  const [signature, setSignature] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setAvatarUrl(getCurrentAvatarUrl(profile, userInfo) || fallbackAvatar);
    setUserName((profile?.user_name || userInfo?.userName || '').slice(0, USER_NAME_MAX_LENGTH));
    setSignature((profile?.signature || '').slice(0, SIGNATURE_MAX_LENGTH));
  }, [open, profile, userInfo]);

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    if (file.size > AVATAR_MAX_SIZE) {
      toast.error('头像图片不能超过 5MB');
      return;
    }

    setAvatarUploading(true);
    try {
      const uploaded = await uploadFile(file);
      const nextUrl = getUploadedUrl(uploaded);

      if (!nextUrl) {
        toast.error('头像上传失败');
        return;
      }

      setAvatarUrl(nextUrl);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    const trimmedUserName = userName.trim();
    const trimmedSignature = signature.trim();
    const userId = userInfo?.id ?? profile?.user_id;

    if (!userId) {
      toast.error('用户信息缺失，请刷新后重试');
      return;
    }
    if (!trimmedUserName) {
      toast.error('请输入用户名');
      return;
    }
    if (trimmedUserName.length > USER_NAME_MAX_LENGTH) {
      toast.error(`用户名不能超过 ${USER_NAME_MAX_LENGTH} 个字`);
      return;
    }
    if (trimmedSignature.length > SIGNATURE_MAX_LENGTH) {
      toast.error(`个人简介不能超过 ${SIGNATURE_MAX_LENGTH} 个字`);
      return;
    }

    const params: UpdateUserParams = {
      avatarUrl,
      signature: trimmedSignature,
      id: Number(userId),
      userName: trimmedUserName,
    };

    setSaving(true);
    try {
      const response = (await updateUser(params)) as ApiResponse<unknown>;

      if (!isSuccessResponse(response)) {
        toast.error(response.msg || '保存失败，请重试');
        return;
      }

      onSaved({
        avatarUrl,
        userName: trimmedUserName,
        signature: trimmedSignature,
      });
      toast.success('保存成功');
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || avatarUploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName='bg-black/90 backdrop-blur-[12px]'
        className='w-[calc(100vw-32px)] max-w-[560px] gap-0 rounded-md border border-white/10 bg-[#242424] p-0 text-white shadow-[0_24px_90px_rgba(0,0,0,0.55)]'
      >
        <DialogTitle className='sr-only'>用户信息</DialogTitle>
        <div className='flex h-12 items-center justify-between px-5'>
          <h2 className='text-sm font-semibold text-white'>用户信息</h2>
          <button
            type='button'
            className='flex h-8 w-8 items-center justify-center rounded-md text-white/65 transition-colors hover:bg-white/10 hover:text-white'
            onClick={() => onOpenChange(false)}
            disabled={disabled}
            aria-label='关闭'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='px-5 pb-5'>
          <div className='flex justify-center pb-4 pt-1'>
            <div className='group relative h-24 w-24'>
              <Avatar className='h-24 w-24 border border-white/10 bg-white/10'>
                <AvatarImage src={compressImage(avatarUrl || fallbackAvatar, 128)} alt='用户头像' className='object-cover' />
                <AvatarFallback className='bg-white/15 text-2xl font-semibold text-white'>{userName.slice(0, 1) || 'U'}</AvatarFallback>
              </Avatar>
              <button
                type='button'
                className={`absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-black/45 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-wait ${
                  avatarUploading ? 'opacity-100' : ''
                }`}
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                aria-label='替换头像'
              >
                {avatarUploading ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <>
                    <Camera className='h-4 w-4' />
                    <span>点击替换</span>
                  </>
                )}
              </button>
              <span
                className='pointer-events-none absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-[#2c2c2c] text-white shadow-[0_6px_18px_rgba(0,0,0,0.35)]'
                aria-hidden='true'
              >
                <Camera className='h-3.5 w-3.5' />
              </span>
              <input ref={fileInputRef} type='file' accept='image/*' className='hidden' onChange={handleAvatarChange} />
            </div>
          </div>

          <div className='space-y-4'>
            <div>
              <label className='mb-2 flex items-center gap-1 text-xs font-semibold text-white/85'>
                <span className='text-[#ff3b30]'>*</span>
                用户名
              </label>
              <div className='relative'>
                <Input
                  value={userName}
                  onChange={event => setUserName(event.target.value.slice(0, USER_NAME_MAX_LENGTH))}
                  maxLength={USER_NAME_MAX_LENGTH}
                  disabled={disabled}
                  className='h-10 border-0 bg-white/10 pr-12 text-sm text-white shadow-none placeholder:text-white/25 focus-visible:ring-1 focus-visible:ring-white/25 focus-visible:ring-offset-0'
                  placeholder='请输入用户名'
                />
                <span className='pointer-events-none absolute bottom-2 right-3 text-[10px] text-white/25'>
                  {userName.length}/{USER_NAME_MAX_LENGTH}
                </span>
              </div>
            </div>

            <div>
              <label className='mb-2 block text-xs font-semibold text-white/85'>个人简介</label>
              <div className='relative'>
                <Textarea
                  value={signature}
                  onChange={event => setSignature(event.target.value.slice(0, SIGNATURE_MAX_LENGTH))}
                  maxLength={SIGNATURE_MAX_LENGTH}
                  disabled={disabled}
                  className='min-h-[92px] resize-none border-0 bg-white/10 pb-6 text-sm text-white shadow-none placeholder:text-white/25 focus-visible:ring-1 focus-visible:ring-white/25 focus-visible:ring-offset-0'
                  placeholder='请输入'
                />
                <span className='pointer-events-none absolute bottom-2 right-3 text-[10px] text-white/25'>
                  {signature.length}/{SIGNATURE_MAX_LENGTH}
                </span>
              </div>
            </div>

            <div className='flex items-center gap-3 text-xs'>
              <span className='font-semibold text-white/85'>手机号</span>
              <span className='text-white/65'>{userInfo?.phoneNo || '未设置'}</span>
            </div>
          </div>

          <div className='mt-8 flex justify-end'>
            <Button type='button' className='h-9 rounded-md bg-[#4257ff] px-5 text-sm text-white shadow-none hover:bg-[#5265ff]' onClick={handleSave} disabled={disabled}>
              {saving ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
              保存并确认
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
