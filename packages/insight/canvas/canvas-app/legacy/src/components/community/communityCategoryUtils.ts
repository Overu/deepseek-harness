import type { CommunityCategory } from '@/api/community';

const COMMUNITY_WORK_CATEGORY_TYPE = 'COMMUNITY_WORK';

const isValidCommunityCategory = (value: unknown): value is CommunityCategory => {
  if (!value || typeof value !== 'object') return false;

  const category = value as Partial<CommunityCategory>;
  return typeof category.id === 'number' && typeof category.name === 'string' && typeof category.type === 'string';
};

export const getCommunityWorkCategories = (categories: CommunityCategory[]) => {
  const result: CommunityCategory[] = [];
  const seenIds = new Set<number>();

  categories.forEach(category => {
    if (!isValidCommunityCategory(category) || category.type !== COMMUNITY_WORK_CATEGORY_TYPE || !Array.isArray(category.children)) return;

    category.children.forEach(child => {
      if (!isValidCommunityCategory(child) || child.type !== COMMUNITY_WORK_CATEGORY_TYPE || seenIds.has(child.id)) return;

      seenIds.add(child.id);
      result.push(child);
    });
  });

  return result;
};
