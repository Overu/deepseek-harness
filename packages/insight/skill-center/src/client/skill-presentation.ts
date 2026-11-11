/** Common read-only fields used by skill cards and detail dialogs. */

/** Text displayed for a skill from either directory. */
export interface SkillPresentation {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly descriptionMarkdown: string
  readonly version?: string
}
