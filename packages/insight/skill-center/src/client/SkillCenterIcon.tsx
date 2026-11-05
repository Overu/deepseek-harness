/** Sidebar glyph for the skill center; the sidebar owns navigation and selection. */
import type { ReactNode } from 'react'
import { IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the existing skill glyph at the sidebar's requested size.
 * @param props - Sidebar icon presentation.
 * @returns The skill glyph.
 */
export function SkillCenterIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconSkillOutlineRegular size={size} />
}
