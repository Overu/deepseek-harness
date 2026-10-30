/** Visible user-explicit skill tokens in the editor's detect projection. */

/** Public skill-name grammar shared by explicit user invocation. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** A whitespace-bounded visible skill token. */
const SKILL_TOKEN = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/gu

/**
 * Return whether a name can be represented by one explicit `/name` token.
 * @param name - candidate skill name.
 * @returns whether the name follows the public skill-name grammar.
 */
export function isExplicitSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/**
 * Find every visible explicit token for one skill in detect coordinates.
 * @param detectText - live editor detect projection, where atomic nodes are opaque.
 * @param name - validated skill name.
 * @returns token ranges excluding their surrounding whitespace.
 */
export function explicitSkillTokenSpans(detectText: string, name: string): readonly { readonly start: number; readonly end: number }[] {
  if (!isExplicitSkillName(name)) return []
  const spans: { start: number; end: number }[] = []
  for (const match of detectText.matchAll(SKILL_TOKEN)) {
    if (match[2] !== name) continue
    const prefix = match[1]?.length ?? 0
    const start = match.index + prefix
    spans.push({ start, end: start + name.length + 1 })
  }
  return spans
}

/**
 * List selected skills in first-visible order without treating atomic nodes as text.
 * @param detectText - live editor detect projection, where atomic nodes are opaque.
 * @returns deduplicated visible skill names.
 */
export function selectedExplicitSkills(detectText: string): readonly string[] {
  const names: string[] = []
  for (const match of detectText.matchAll(SKILL_TOKEN)) {
    const name = match[2]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}
