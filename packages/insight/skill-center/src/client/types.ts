/** Shared local types for the skill center presentation. */
import type { zh } from './locales.ts'

/** A key from the skill center locale dictionary. */
export type SkillCenterLocaleKey = keyof typeof zh

/** Localized copy resolver supplied by the page's locale slot. */
export type SkillCenterTranslate = (key: SkillCenterLocaleKey) => string
