import type { MessageCategory } from '@/api/message';

export const SYSTEM_CATEGORY_CODE = 'SYSTEM';
export const INTERACTION_CATEGORY_CODE = 'INTERACTION';

export const REQUIRED_MESSAGE_CATEGORIES: MessageCategory[] = [
  {
    categoryCode: SYSTEM_CATEGORY_CODE,
    categoryName: '官方公告',
  },
  {
    categoryCode: INTERACTION_CATEGORY_CODE,
    categoryName: '互动消息',
  },
];

export const FALLBACK_AVATAR_URL = 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/png/20260731-113037-3fb3f4def4432a80.png';

export function normalizeMessageCategories(categories: MessageCategory[] | null | undefined) {
  const categoryMap = new Map<string, MessageCategory>();

  for (const category of REQUIRED_MESSAGE_CATEGORIES) {
    categoryMap.set(category.categoryCode, category);
  }

  for (const category of categories || []) {
    if (!category?.categoryCode) continue;
    categoryMap.set(category.categoryCode, {
      ...categoryMap.get(category.categoryCode),
      ...category,
    });
  }

  const requiredCategoryCodes = new Set(REQUIRED_MESSAGE_CATEGORIES.map(category => category.categoryCode));
  const extraCategories = Array.from(categoryMap.values()).filter(category => !requiredCategoryCodes.has(category.categoryCode));

  return [...REQUIRED_MESSAGE_CATEGORIES.map(category => categoryMap.get(category.categoryCode) || category), ...extraCategories];
}
