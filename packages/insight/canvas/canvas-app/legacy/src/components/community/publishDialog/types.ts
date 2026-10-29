import type { CommunityPublishResult, CommunityWorkDetail, CommunityWorkMedia, CommunityWorkType } from '@/api/community';

export type PublishWorkMode = 'publish' | 'edit';

export interface PublishWorkDraft {
  workId: number;
  title: string;
  description: string;
  categoryIds: number[];
  tags: string[];
  tagInput: string;
  canvasShareUrl: string;
  canvasShareTitle: string;
  canvasShareCoverUrl: string;
  canvasShareTime: string;
  coverUrl: string;
  mediaList: CommunityWorkMedia[];
  usePrimaryMediaAsCover: boolean;
}

export type PublishWorkDrafts = Record<CommunityWorkType, PublishWorkDraft>;

export interface PublishWorkInitialValue extends Partial<Omit<PublishWorkDraft, 'categoryIds' | 'mediaList'>> {
  categoryIds?: number[];
  mediaList?: CommunityWorkMedia[];
}

export interface PublishWorkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvasId?: number | string;
  defaultWorkType?: CommunityWorkType;
  mode?: PublishWorkMode;
  workId?: number | string;
  initialValue?: Partial<Record<CommunityWorkType, PublishWorkInitialValue>>;
  onPublished?: (result: CommunityPublishResult) => void;
  onEdited?: (result: CommunityWorkDetail) => void;
}

export interface PublishWorkValidation {
  valid: boolean;
  message: string;
}
