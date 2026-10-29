import type { KeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';

import type { CommunityCategory } from '@/api/community';
import defaultFlowCover from '@/assets/images/default_flow.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { compressImage } from '@/utils';
import { DESCRIPTION_MAX_LENGTH, TAG_MAX_COUNT, TAG_MAX_LENGTH, TITLE_MAX_LENGTH } from './constants';
import type { PublishWorkDraft } from './types';
import { normalizeTag } from './utils';
import { WorkflowPickerDialog } from './WorkflowPickerDialog';

interface WorkInfoFormProps {
  draft: PublishWorkDraft;
  categories: CommunityCategory[];
  categoriesLoading: boolean;
  workflowLocked?: boolean;
  onDraftChange: (patch: Partial<PublishWorkDraft>) => void;
}

function FieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  return (
    <div className='mb-2 text-sm font-semibold text-white'>
      {required && <span className='mr-1 text-[#ff4d4f]'>*</span>}
      {children}
    </div>
  );
}

const formatWorkflowTime = (value: string) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export function WorkInfoForm({ draft, categories, categoriesLoading, workflowLocked = false, onDraftChange }: WorkInfoFormProps) {
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false);
  const selectedCategoryValue = draft.categoryIds.length > 0 && Number.isFinite(draft.categoryIds[0]) ? String(draft.categoryIds[0]) : '';
  const workflowSelected = Boolean(draft.canvasShareUrl);
  const workflowCover = draft.canvasShareCoverUrl ? compressImage(draft.canvasShareCoverUrl, 96) : defaultFlowCover;
  const workflowTime = formatWorkflowTime(draft.canvasShareTime);

  const addTag = () => {
    const nextTag = normalizeTag(draft.tagInput);
    if (!nextTag || draft.tags.includes(nextTag) || draft.tags.length >= TAG_MAX_COUNT) {
      onDraftChange({ tagInput: '' });
      return;
    }

    onDraftChange({ tags: [...draft.tags, nextTag], tagInput: '' });
  };

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTag();
  };

  const removeTag = (tag: string) => {
    onDraftChange({ tags: draft.tags.filter(item => item !== tag) });
  };

  const handleCategoryChange = (value: string) => {
    const categoryId = Number(value);
    if (!Number.isFinite(categoryId)) return;

    onDraftChange({ categoryIds: [categoryId] });
  };

  return (
    <div className='space-y-5'>
      <section>
        <FieldLabel required>作品标题</FieldLabel>
        <div className='relative'>
          <Input
            value={draft.title}
            maxLength={TITLE_MAX_LENGTH}
            placeholder='请输入'
            className='h-10 border-0 bg-[#3f3f3f] pr-12 text-white placeholder:text-white/25 focus-visible:ring-1 focus-visible:ring-[#6f7cff]'
            onChange={event => onDraftChange({ title: event.target.value })}
          />
          <span className='absolute bottom-2 right-3 text-xs text-white/25'>
            {draft.title.length}/{TITLE_MAX_LENGTH}
          </span>
        </div>
      </section>

      <section>
        <FieldLabel required>选择分区</FieldLabel>
        <Select value={selectedCategoryValue} disabled={categoriesLoading || categories.length === 0} onValueChange={handleCategoryChange}>
          <SelectTrigger className='h-10 border-0 bg-[#3f3f3f] text-white focus:ring-[#6f7cff] focus:ring-offset-0'>
            <SelectValue placeholder={categoriesLoading ? '分区加载中' : '请选择分区'} />
          </SelectTrigger>
          <SelectContent className='border-white/10 bg-[#2b2b2b] text-white'>
            {categories.map(option => (
              <SelectItem key={option.id} value={String(option.id)}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section>
        <FieldLabel>
          作品标签（{draft.tags.length}/{TAG_MAX_COUNT}）
        </FieldLabel>
        {draft.tags.length > 0 && (
          <div className='mb-2 flex flex-wrap gap-2'>
            {draft.tags.map(tag => (
              <span key={tag} className='inline-flex h-8 items-center gap-1 rounded-md bg-[#4b4b4b] px-3 text-sm text-white/88'>
                {tag}
                <button type='button' className='text-white/55 hover:text-white' onClick={() => removeTag(tag)}>
                  <X className='h-3.5 w-3.5' />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className='relative'>
          <Input
            value={draft.tagInput}
            maxLength={TAG_MAX_LENGTH}
            placeholder='输入文本按Enter创建标签'
            className='h-10 border-0 bg-[#3f3f3f] pr-12 text-white placeholder:text-white/25 focus-visible:ring-1 focus-visible:ring-[#6f7cff]'
            disabled={draft.tags.length >= TAG_MAX_COUNT}
            onChange={event => onDraftChange({ tagInput: event.target.value })}
            onKeyDown={handleTagKeyDown}
          />
          <span className='absolute bottom-2 right-3 text-xs text-white/25'>
            {draft.tagInput.length}/{TAG_MAX_LENGTH}
          </span>
        </div>
      </section>

      <section>
        <FieldLabel required>作品简介</FieldLabel>
        <div className='relative'>
          <Textarea
            value={draft.description}
            maxLength={DESCRIPTION_MAX_LENGTH}
            placeholder='请输入'
            className='h-[126px] resize-none border-0 bg-[#3f3f3f] pb-8 text-white placeholder:text-white/25 focus-visible:ring-1 focus-visible:ring-[#6f7cff] focus-visible:ring-offset-0'
            onChange={event => onDraftChange({ description: event.target.value })}
          />
          <span className='absolute bottom-2 right-3 text-xs text-white/25'>
            {draft.description.length}/{DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
      </section>

      <section>
        <FieldLabel required>工作流分享链接</FieldLabel>
        <Button
          type='button'
          variant='ghost'
          className={`w-full rounded-md bg-[#3f3f3f] px-3 text-left text-white/75 shadow-none hover:bg-[#484848] hover:text-white disabled:cursor-not-allowed disabled:opacity-70 ${
            workflowSelected ? 'h-14 justify-between' : 'h-14 justify-center'
          }`}
          disabled={workflowLocked}
          onClick={() => {
            if (!workflowLocked) {
              setWorkflowPickerOpen(true);
            }
          }}
        >
          {workflowSelected ? (
            <>
              <span className='flex min-w-0 items-center gap-3'>
                <img src={workflowCover} alt='工作流封面' className='h-11 w-11 shrink-0 rounded-md object-cover' />
                <span className='min-w-0'>
                  <span className='block truncate text-sm font-semibold text-white'>{draft.canvasShareTitle || '已选择工作流'}</span>
                  <span className='mt-0.5 block truncate text-xs text-white/55'>{workflowTime || '已生成分享链接'}</span>
                </span>
              </span>
              {!workflowLocked && <RotateCcw className='h-4 w-4 shrink-0 text-white/55' />}
            </>
          ) : (
            <Plus className='h-5 w-5 text-white/70' />
          )}
        </Button>
        <WorkflowPickerDialog
          open={workflowPickerOpen}
          value={{ title: draft.canvasShareTitle, url: draft.canvasShareUrl }}
          onOpenChange={setWorkflowPickerOpen}
          onConfirm={value =>
            onDraftChange({
              canvasShareTitle: value.title,
              canvasShareUrl: value.url,
              canvasShareCoverUrl: value.coverUrl || '',
              canvasShareTime: value.time || '',
            })
          }
        />
      </section>
    </div>
  );
}
