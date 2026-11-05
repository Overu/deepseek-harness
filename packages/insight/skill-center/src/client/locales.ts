/** Typed copy for the Insight skill center. */
export const zh = {
  title: '技能中心',
  eyebrow: '以专业为引擎，让团队与 AI 共成长',
  heroTitlePrefix: '找到适合你的',
  heroTitleAccent: 'AI 技能',
  searchPlaceholder: '搜索技能名称或简介',
  search: '搜索',
  directoryEyebrow: '技能目录',
  directoryTitle: '全部技能',
  resultCount: '共 {count} 个技能',
  catalogLoading: '正在加载技能目录',
  catalogLoadFailed: '暂时无法加载技能目录，请重试',
  retry: '重试',
  catalogEmpty: '暂时还没有已上架技能',
  noResults: '没有找到匹配“{query}”的技能',
  detail: '查看详情',
  download: '下载 ZIP',
  copy: '复制安装指令',
  versionValue: 'v{version}',
  skillId: '技能 ID', version: '版本', description: '技能描述', noDescription: '暂无技能描述', close: '关闭',
  copySuccess: '演示安装指令已复制',
  copyFailure: '复制失败，请允许浏览器访问剪贴板后重试',
  downloadNotice: '下载功能尚未接入，当前仅提供演示',
  installInstruction: '这是技能中心演示请求：请介绍因赛 AI 技能「{name}」（{id}）可以做什么，并给出 3 个示例提问。本次仅演示，请不要下载或安装。',
} as const

/** English copy; other languages use the locale registry's English fallback. */
export const en: Record<keyof typeof zh, string> = {
  versionValue: 'v{version}',
  title: 'Skill center', eyebrow: 'Put expertise at the heart of how teams work with AI', heroTitlePrefix: 'Find the right', heroTitleAccent: 'AI skill', searchPlaceholder: 'Search skill names or summaries', search: 'Search', directoryEyebrow: 'Skill directory', directoryTitle: 'All skills', resultCount: '{count} skills', catalogLoading: 'Loading skill directory', catalogLoadFailed: 'The skill directory is unavailable. Try again', retry: 'Retry', catalogEmpty: 'No skills have been published yet', noResults: 'No skills match “{query}”', detail: 'View details', download: 'Download ZIP', copy: 'Copy install instruction', skillId: 'Skill ID', version: 'Version', description: 'Description', noDescription: 'No skill description is available', close: 'Close', copySuccess: 'Demo instruction copied', copyFailure: 'Copy failed. Allow clipboard access and try again', downloadNotice: 'Downloads are a demonstration; package downloading is not connected', installInstruction: 'This is a skill center demo request: explain what the Insight AI skill “{name}” ({id}) can do and give 3 example prompts. This is a demonstration; do not download or install the skill.',
}
