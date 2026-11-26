/** Deterministic API records for skill-center UI tests. */
export const CATALOG_FIXTURE = {
  'skills': [
    {
      'id': 1,
      'source': 'OFFICIAL',
      'sceneCodes': ['INFLUENCER', 'STRATEGY'],
      'skillId': 'influencer-integration',
      'name': '达人整合',
      'summary': '匹配合适的创作者，并整理可执行的达人合作方案。',
      'packageVersion': '1.2.0',
      'description': '根据品牌、目标人群和传播目标，梳理达人筛选、合作分层与内容方向。\n输出可继续完善的整合营销提案。',
      'packageUrl': 'https://example.com/skills/influencer-integration.zip',
      'enabled': 1,
      'sort': 10,
    },
    {
      'id': 2,
      'source': 'OFFICIAL',
      'sceneCodes': ['STRATEGY'],
      'skillId': 'insight-prestrategy-analysis',
      'name': '品牌策略分析',
      'summary': '从品类、竞品与用户洞察中形成清晰的品牌策略起点。',
      'packageVersion': '1.0.0',
      'description': '整理市场信息、竞品表现和目标用户需求。\n用结构化结论支持后续策略与创意工作。',
      'packageUrl': 'https://example.com/skills/insight-prestrategy-analysis.zip',
      'enabled': 1,
      'sort': 20,
    },
    {
      'id': 3,
      'source': 'OFFICIAL',
      'sceneCodes': ['INSIGHT'],
      'skillId': 'category-competitor-insight',
      'name': '品类竞品洞察',
      'summary': '快速归纳品类机会、竞品策略与值得关注的市场信号。',
      'packageVersion': '1.1.0',
      'description': '聚合竞品定位、沟通重点和可观察的内容趋势。\n适合在项目启动阶段建立共同的市场认知。',
      'packageUrl': 'https://example.com/skills/category-competitor-insight.zip',
      'enabled': 1,
      'sort': 30,
    },
    {
      'id': 4,
      'source': 'OFFICIAL',
      'sceneCodes': ['INFLUENCER'],
      'skillId': 'creator-recommendation',
      'name': '创作者推荐',
      'summary': '根据品牌调性和传播需求，推荐适合合作的创作者组合。',
      'packageVersion': '1.0.0',
      'description': '从内容风格、受众匹配度和合作场景出发说明推荐原因。\n提供可供讨论的创作者候选方向。',
      'packageUrl': 'https://example.com/skills/creator-recommendation.zip',
      'enabled': 1,
      'sort': 40,
    },
    {
      'id': 5,
      'source': 'OFFICIAL',
      'sceneCodes': ['CREATIVE'],
      'skillId': 'canvas-workflow-builder',
      'name': '创意工作流搭建与评估',
      'summary': '设计从需求拆解到创意交付的 AI 协作流程，并评估其效果。',
      'packageVersion': '1.3.0',
      'description': '识别工作流的输入、关键步骤和交付物。\n针对团队协作方式给出可测试、可迭代的流程建议。',
      'packageUrl': 'https://example.com/skills/canvas-workflow-builder.zip',
      'enabled': 1,
      'sort': 50,
    },
    {
      'id': 6,
      'source': 'OFFICIAL',
      'sceneCodes': ['COMMUNICATION'],
      'skillId': 'marketing-integrated',
      'name': '整合营销战役规划',
      'summary': '把品牌目标转化为跨渠道、可执行的整合营销战役规划。',
      'packageVersion': '1.0.0',
      'description': '围绕目标、受众、主题与渠道安排营销动作。\n帮助团队从策略衔接到节奏和内容执行。',
      'packageUrl': 'https://example.com/skills/marketing-integrated.zip',
      'enabled': 1,
      'sort': 60,
    },
  ],
}

/** Encode one successful paginated skill API response. */
export function catalogResponse(catalog: { readonly skills: readonly unknown[] }, total = catalog.skills.length) {
  return { code: 'SUCCESS', data: { records: catalog.skills, total, emptyFallback: [] } }
}

/** Reply only to list requests with published package metadata. */
export function catalogApiResponse(catalog: { readonly skills: readonly unknown[] }, url: string) {
  const path = new URL(url, 'http://localhost').pathname
  if (!path.endsWith('/skills')) throw new Error(`Unexpected catalogue request ${path}`)
  return catalogResponse(catalog)
}

/** Enabled A-line configuration in server order. */
export const CATEGORY_FIXTURE = [
  ['PRE_PLANNING', '前策'], ['CONSULTING', '咨询'], ['INSIGHT', '洞察'],
  ['STRATEGY', '策略'], ['CREATIVE', '创意'], ['INFLUENCER', '达人'],
  ['COMMUNICATION', '传播'], ['OFFICE', '办公'], ['OTHER', '其他'],
].map(([code, name], index) => ({
  id: index + 1, businessChannel: 'A', code, name, filters: { scene: code }, sort: (index + 1) * 10,
}))

/** Fetch a fresh response body for each list request. */
export function catalogTransport(catalog: { readonly skills: readonly unknown[] }): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (new URL(url, 'http://localhost').pathname === '/insight-skill-center/api/skill-categories') {
      return Response.json({ code: 'SUCCESS', data: { records: CATEGORY_FIXTURE } })
    }
    return Response.json(catalogApiResponse(catalog, url))
  }
}
