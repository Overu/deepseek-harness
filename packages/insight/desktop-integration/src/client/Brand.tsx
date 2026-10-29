/** Insight branding occupants for the DSH brand slots. */
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import mark from './assets/brand-mark.svg'
import css from './Brand.module.css'

/** Render the Insight brand mark at the size and geometry requested by its host slot. */
export function InsightBrandMark({ size, className }: SidebarBrandMarkOwnerProps & Partial<HeroBrandMarkOwnerProps>) {
  return <span className={[css.mark, className].filter(Boolean).join(' ')} style={{ width: size, height: size }}><img src={mark} alt="" /></span>
}

/** Render the Insight wordmark beside the separately slotted product mark. */
export function InsightBrandName() {
  return <span className={css.name}>因赛AI</span>
}
