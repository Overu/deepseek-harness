import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import type { CommunityCategory, CommunityPublishResult, CommunityWorkDetail, CommunityWorkType } from '@/api/community';
import { editCommunityWork, getCommunityWorkDetail, publishCommunityWork, queryCommunityCategories } from '@/api/community';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { getCommunityWorkCategories } from '@/components/community/communityCategoryUtils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkInfoForm } from './WorkInfoForm';
import { WorkTypeSegment } from './WorkTypeSegment';
import { UploadPanel } from './UploadPanel';
import type { PublishWorkDialogProps, PublishWorkDraft, PublishWorkDrafts } from './types';
import { createDraftsFromWorkDetail, createInitialDrafts, toCommunityWorkPayload, validateDraft } from './utils';

type CommunityApiResponse<T> = {
  code?: string | number;
  msg?: string;
  data?: T;
  body?: T;
  success?: boolean;
};

const favoriteToastActionStyle = {
  backgroundColor: '#10B981',
  color: '#ffffff',
  border: '1px solid rgba(255,255,255,0.14)',
  paddding: '4px 12px',
};

const isSuccessResponse = <T,>(response: CommunityApiResponse<T>) => {
  return response.success === true || response.code === 'SUCCESS' || response.code === 200 || String(response.code) === '0';
};

const getResponseData = <T,>(response: CommunityApiResponse<T>) => response.data || response.body;

const serializeDrafts = (value: PublishWorkDrafts) => JSON.stringify(value);

const getWorkTypeFromDetail = (detail: CommunityWorkDetail): CommunityWorkType => (detail.work_type === 'IMAGE' ? 'IMAGE' : 'VIDEO');

const isNestedPublishDialogEvent = (event: Event) => {
  const target = event.target;
  return target instanceof HTMLElement && Boolean(target.closest('[data-community-publish-nested-dialog="true"]'));
};

function PublishWorkSkeleton() {
  return (
    <>
      <div className='shrink-0 px-6 pb-5'>
        <Skeleton className='mx-auto h-9 w-full max-w-[600px] bg-white/10' />
      </div>

      <div className='grid min-h-0 flex-1 gap-8 overflow-hidden px-6 pb-6 md:grid-cols-[340px_minmax(0,1fr)]'>
        <div className='space-y-6'>
          <section className='space-y-3'>
            <Skeleton className='h-4 w-20 bg-white/10' />
            <Skeleton className='aspect-video w-full bg-white/10' />
          </section>
          <section className='space-y-3'>
            <Skeleton className='h-4 w-20 bg-white/10' />
            <Skeleton className='aspect-video w-full bg-white/10' />
          </section>
        </div>

        <section className='min-w-0 space-y-5'>
          <Skeleton className='h-4 w-20 bg-white/10' />
          <Skeleton className='h-10 w-full bg-white/10' />
          <Skeleton className='h-10 w-full bg-white/10' />
          <Skeleton className='h-10 w-full bg-white/10' />
          <Skeleton className='h-[126px] w-full bg-white/10' />
          <Skeleton className='h-12 w-full bg-white/10' />
        </section>
      </div>
    </>
  );
}

export function PublishWorkDialog({
  open,
  onOpenChange,
  canvasId,
  defaultWorkType = 'VIDEO',
  mode = 'publish',
  workId,
  initialValue,
  onPublished,
  onEdited,
}: PublishWorkDialogProps) {
  const wasOpenRef = useRef(false);
  const navigate = useNavigate();
  const [activeWorkType, setActiveWorkType] = useState<CommunityWorkType>(defaultWorkType);
  const [drafts, setDrafts] = useState<PublishWorkDrafts>(() => createInitialDrafts(initialValue));
  const initialSnapshotRef = useRef(serializeDrafts(drafts));
  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setConfirmCloseOpen(false);
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;
    let cancelled = false;

    const resetDrafts = (nextDrafts: PublishWorkDrafts, nextWorkType: CommunityWorkType) => {
      setActiveWorkType(nextWorkType);
      setDrafts(nextDrafts);
      initialSnapshotRef.current = serializeDrafts(nextDrafts);
    };

    const initialDrafts = createInitialDrafts(initialValue);
    resetDrafts(initialDrafts, defaultWorkType);
    setConfirmCloseOpen(false);
    setSubmitting(false);
    setDetailLoading(mode === 'edit');
    setCategories([]);
    setCategoriesLoading(true);

    const loadCategories = async () => {
      try {
        const response = (await queryCommunityCategories()) as CommunityApiResponse<CommunityCategory[]>;
        const data = getResponseData(response);
        if (!isSuccessResponse(response) || !Array.isArray(data)) {
          toast.error(response.msg || '分区加载失败');
          if (!cancelled) {
            setCategories([]);
          }
          return;
        }

        if (!cancelled) {
          setCategories(getCommunityWorkCategories(data));
        }
      } catch (error) {
        if (!cancelled) {
          const message = error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string' ? error.msg : '分区加载失败';
          toast.error(message);
          setCategories([]);
        }
      } finally {
        if (!cancelled) {
          setCategoriesLoading(false);
        }
      }
    };

    const loadWorkDetail = async () => {
      if (mode !== 'edit') {
        setDetailLoading(false);
        return;
      }

      if (!workId) {
        toast.error('缺少作品ID，无法编辑');
        setDetailLoading(false);
        return;
      }

      try {
        const response = (await getCommunityWorkDetail(workId)) as CommunityApiResponse<CommunityWorkDetail>;
        const detail = getResponseData(response);
        if (!isSuccessResponse(response) || !detail) {
          toast.error(response.msg || '作品详情加载失败');
          return;
        }

        if (!cancelled) {
          resetDrafts(createDraftsFromWorkDetail(detail), getWorkTypeFromDetail(detail));
        }
      } catch (error) {
        if (!cancelled) {
          const message = error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string' ? error.msg : '作品详情加载失败';
          toast.error(message);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadCategories();
    void loadWorkDetail();

    return () => {
      cancelled = true;
    };
  }, [defaultWorkType, initialValue, mode, open, workId]);

  const activeDraft = useMemo(() => drafts[activeWorkType], [activeWorkType, drafts]);
  const validation = useMemo(() => validateDraft(drafts[activeWorkType]), [activeWorkType, drafts]);
  const isDirty = useMemo(() => serializeDrafts(drafts) !== initialSnapshotRef.current, [drafts]);
  const showSkeleton = categoriesLoading || detailLoading;
  const editing = mode === 'edit';
  const publishDisabled = submitting || categoriesLoading || detailLoading || !validation.valid;

  const updateActiveDraft = (patch: Partial<PublishWorkDraft>) => {
    setDrafts(prev => ({
      ...prev,
      [activeWorkType]: {
        ...prev[activeWorkType],
        ...patch,
      },
    }));
  };

  const requestClose = () => {
    if (submitting) return;

    if (isDirty) {
      setConfirmCloseOpen(true);
      return;
    }

    onOpenChange(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    requestClose();
  };

  const handleConfirmClose = () => {
    setConfirmCloseOpen(false);
    onOpenChange(false);
  };

  const handleOutsideDialogEvent = (event: { detail: { originalEvent: Event }; preventDefault: () => void }) => {
    if (isNestedPublishDialogEvent(event.detail.originalEvent)) {
      return;
    }

    event.preventDefault();
  };

  const handleSubmit = async () => {
    const submitWorkType = activeWorkType;
    const submitDraft = drafts[submitWorkType];
    const latestValidation = validateDraft(submitDraft);
    if (!latestValidation.valid) {
      toast.error(latestValidation.message);
      return;
    }

    const payload = toCommunityWorkPayload(submitWorkType, submitDraft);

    setSubmitting(true);
    try {
      if (mode === 'edit') {
        const targetWorkId = workId || payload.work_id;
        if (!targetWorkId) {
          toast.error('缺少作品ID，无法编辑');
          return;
        }

        const response = (await editCommunityWork(targetWorkId, payload)) as CommunityApiResponse<CommunityWorkDetail>;
        if (!isSuccessResponse(response) || !getResponseData(response)) {
          toast.error(response.msg || '编辑作品失败');
          return;
        }

        onEdited?.(getResponseData(response)!);
        toast.success('作品已更新');
      } else {
        const response = (await publishCommunityWork(payload)) as CommunityApiResponse<CommunityPublishResult>;
        if (!isSuccessResponse(response) || !getResponseData(response)) {
          toast.error(response.msg || '发布作品失败');
          return;
        }

        onPublished?.(getResponseData(response)!);
        toast.success('作品已发布审核，您可在“个人主页”进行查看', {
          action: {
            label: '去查看',
            onClick: () => {
              navigate({ to: '/usercenter' });
            },
          },
          actionButtonStyle: favoriteToastActionStyle,
        });
      }

      onOpenChange(false);
    } catch (error) {
      const fallbackMessage = mode === 'edit' ? '编辑作品失败，请稍后重试' : '发布作品失败，请稍后重试';
      const message = error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string' ? error.msg : fallbackMessage;
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        data-source-canvas-id={canvasId == null ? undefined : String(canvasId)}
        className='max-h-[90vh] w-[min(1080px,calc(100vw-32px))] max-w-none gap-0 border-white/10 bg-[#242424] p-0 text-white shadow-2xl sm:rounded-lg'
        overlayClassName='bg-black/90 backdrop-blur-[12px]'
        showCloseButton={false}
        onEscapeKeyDown={event => event.preventDefault()}
        onInteractOutside={handleOutsideDialogEvent}
        onPointerDownOutside={handleOutsideDialogEvent}
      >
        <div className='flex h-full max-h-[90vh] flex-col'>
          <header className='flex h-[72px] shrink-0 items-center justify-between px-6'>
            <DialogTitle className='text-base font-semibold text-white'>{editing ? '重新编辑' : '发布作品'}</DialogTitle>
            <button type='button' className='rounded-md p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white' onClick={requestClose}>
              <X className='h-5 w-5' />
              <span className='sr-only'>关闭</span>
            </button>
          </header>

          {showSkeleton ? (
            <PublishWorkSkeleton />
          ) : (
            <>
              {!editing && (
                <div className='shrink-0 px-6 pb-5'>
                  <WorkTypeSegment value={activeWorkType} onChange={setActiveWorkType} />
                </div>
              )}

              <div className='grid min-h-0 flex-1 gap-8 overflow-y-auto px-6 pb-6 md:grid-cols-[340px_minmax(0,1fr)] md:overflow-hidden'>
                <UploadPanel key={`upload-${activeWorkType}`} workType={activeWorkType} draft={activeDraft} mediaLocked={editing} onDraftChange={updateActiveDraft} />
                <section className='min-w-0 overflow-visible px-[2px] pb-[45px] md:overflow-y-auto'>
                  <h3 className='mb-4 text-sm font-semibold text-white'>作品信息</h3>
                  <WorkInfoForm
                    key={`info-${activeWorkType}`}
                    draft={activeDraft}
                    categories={categories}
                    categoriesLoading={categoriesLoading}
                    workflowLocked={editing}
                    onDraftChange={updateActiveDraft}
                  />
                </section>
              </div>
            </>
          )}

          <footer className='flex h-[64px] shrink-0 bg-[#242424] z-20 items-center justify-end gap-3 border-t border-white/5 px-6'>
            {!showSkeleton && !validation.valid && <span className='mr-auto hidden text-xs text-white/35 md:inline'>{validation.message}</span>}
            <Button type='button' variant='ghost' className='h-9 min-w-[72px] bg-white/10 text-white/80 hover:bg-white/15 hover:text-white' onClick={requestClose}>
              取消
            </Button>
            <Button type='button' className='h-9 min-w-[92px] bg-[#364cff] text-white hover:bg-[#455aff]' disabled={publishDisabled} onClick={handleSubmit}>
              {submitting && <Loader2 className='h-4 w-4 animate-spin' />}
              {mode === 'edit' ? '保存修改' : '立即发布'}
            </Button>
          </footer>
        </div>
      </DialogContent>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent
          data-community-publish-nested-dialog='true'
          className='w-[min(420px,calc(100vw-32px))] border-white/10 bg-[#2b2b2b] text-white'
          overlayClassName='bg-black/50 backdrop-blur-[4px]'
        >
          <AlertDialogHeader>
            <AlertDialogTitle className='text-base text-white'>是否关闭发布作品弹窗？</AlertDialogTitle>
            <AlertDialogDescription className='text-sm text-white/60'>您当前填写的内容均未保存，关闭后将无法恢复</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className='h-9 border-0 bg-white/10 px-5 text-white/80 hover:bg-white/15 hover:text-white'>取消</AlertDialogCancel>
            <AlertDialogAction className='h-9 bg-[#364cff] px-5 text-white hover:bg-[#455aff]' onClick={handleConfirmClose}>
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
