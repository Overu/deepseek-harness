/** Hero and search form for the skill market. */
import type { FormEvent, ReactNode } from 'react'
import { Button, IconSearchOutlineRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { SkillHeroHands } from './SkillHeroHands.tsx'
import type { SkillCenterTranslate } from './types.ts'
import styles from './SkillCenterPage.module.css'

/** Inputs for the market hero. */
interface SkillMarketHeroProps {
  readonly t: SkillCenterTranslate
  readonly query: string
  readonly onQueryChange: (query: string) => void
  readonly onSearch: (event: FormEvent<HTMLFormElement>) => void
}

/**
 * Render the market heading, decoration, and catalogue search form.
 * @param props - Localized copy, the input value, and form actions.
 * @returns the hero section.
 */
export function SkillMarketHero({ t, query, onQueryChange, onSearch }: SkillMarketHeroProps): ReactNode {
  return (
    <div className={styles.hero}>
      <SkillHeroHands />
      <div className={styles.heroContent}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1 className={styles.title}>{t('heroTitlePrefix')} <span>{t('heroTitleAccent')}</span></h1>
        <form className={styles.search} role="search" onSubmit={onSearch}>
          <Input type="search" value={query} onChange={(event) => { onQueryChange(event.target.value) }} placeholder={t('searchPlaceholder')} icon={<IconSearchOutlineRegular size={16} />} aria-label={t('searchPlaceholder')} />
          <Button variant="ghost" type="submit">{t('search')}</Button>
        </form>
      </div>
    </div>
  )
}
