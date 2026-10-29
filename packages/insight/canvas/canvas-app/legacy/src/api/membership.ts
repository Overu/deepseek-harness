import { getHomeBannerByScene, getHomeBannerDetail, MEMBERSHIP_PURCHASE_AD, MEMBERSHIP_PURCHASE_FAQ, type HomeBannerItem } from './public';

/**
 * 会员购买页 - 顶部促销活动 Banner
 */
export interface MembershipPromoBanner {
  /** 活动主标题（大标题，如：因赛AI 618活动） */
  title: string;
  /** 活动副标题 / 口号（如：首月大优惠 限时领好礼） */
  subtitle: string;
  /** 背景图 URL（可选，不填则使用组件默认渐变） */
  backgroundImage?: string;
  /** 活动结束时间戳（毫秒，倒计时以此为基准） */
  endAt: number;
  /** 跳转链接（可选，点击 Banner 跳转；不填不渲染可点击态；不影响右侧倒计时显示/隐藏） */
  jumpUrl?: string;
  /** 角标文案（可选） */
  badge?: string;
}

/**
 * 会员购买页 - 常见问题单项（恢复为「每条 banner = 一条 FAQ」，列表手风琴展示）
 *  - faq_id = banner.id
 *  - question = banner.mainTitle（列表已展示为问题标题）
 *  - answer = 通过 getHomeBannerDetail(banner.id) 详情接口获取的 banner.content（优先级最高；失败兜底用 banner.content）
 *  - sort_order = banner.weight（数值越大越靠前，由后端接口约定）
 */
export interface MembershipFaqItem {
  /** FAQ ID（用于手风琴展开的稳定 key） */
  faq_id: number;
  /** 问题标题（常见问题列表中每条问题的标题，来源于 banner.mainTitle） */
  question: string;
  /** 答案内容，支持纯文本分段 或 HTML（FAQ 组件内根据 < 标签自动判别渲染方式） */
  answer: string;
  /** 排序，越大越靠前（来源于 banner.weight） */
  sort_order?: number;
}

/**
 * ISO 时间字符串 → 毫秒时间戳；解析失败返回 0（Banner 组件里会当作已结束兜底）
 */
const parseIsoToMs = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

/* =========================================================================
 * 一、顶部促销 Banner 接口
 *   实际复用 game-ai-editor-center/api/banner?sceneCode=MEMBERSHIP_PURCHASE_AD
 *   取列表中 weight 最大的第一条（若未返回则退化为空，Banner 组件自动隐藏）
 *   倒计时基准：取 list[0].endTime → 转换为毫秒时间戳
 * ========================================================================= */
export const getMembershipPromoBanner = async (): Promise<MembershipPromoBanner> => {
  const list = await getHomeBannerByScene(MEMBERSHIP_PURCHASE_AD);
  // 兼容两种返回形态：① request 直接返回数组；② 外层被 { code, msg, data } 包裹（真实后端返回）
  const unwrapped = Array.isArray(list) ? list : (list as any)?.data;
  const safeList = Array.isArray(unwrapped) ? unwrapped : [];

  // 按 weight 降序（越大越靠前，由后端接口约定；相同 weight 则 id 大的靠前）
  const sorted = safeList.slice().sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.id ?? 0) - (a.id ?? 0));
  const first: HomeBannerItem | undefined = sorted[0];

  if (!first) {
    // 后端未配置：返回 endAt=0 的占位，Banner 组件里会自动隐藏
    return { title: '', subtitle: '', endAt: 0 };
  }

  // 需求变更：Banner 广告不再请求详情接口，只用列表层 mainTitle/subTitle 渲染；content 字段不再作为广告内容
  return {
    title: first.mainTitle?.trim() || '',
    subtitle: first.subTitle?.trim() || '',
    backgroundImage: first.imageUrl || first.mediaItems?.find(m => m.type === 'IMAGE')?.url,
    // 倒计时基准：endTime → 毫秒（明确按照用户要求）
    endAt: parseIsoToMs(first.endTime),
    jumpUrl: first.jumpUrl,
    // 角标：优先用 banner 自身的 bottoms/bottomButtons 第一条 button 文案；否则可留空
    badge: first.bottoms?.[0]?.text || first.bottomButtons?.[0]?.text,
  };
};

/* =========================================================================
 * 二、常见问题 FAQ 列表接口
 *   列表：game-ai-editor-center/api/banner?sceneCode=MEMBERSHIP_PURCHASE_FAQ
 *       （每一条 banner 相当于一个问题：mainTitle=question, weight=sort_order, id=faq_id）
 *   答案：对每条 banner.id 并发调用 getHomeBannerDetail(id)，获取详情的 content=answer
 * ========================================================================= */
export const getMembershipFaqList = async (): Promise<MembershipFaqItem[]> => {
  const list = await getHomeBannerByScene(MEMBERSHIP_PURCHASE_FAQ);
  // 兼容两种返回形态：① request 直接返回数组；② 外层被 { code, msg, data } 包裹（真实后端返回）
  const unwrapped = Array.isArray(list) ? list : (list as any)?.data;
  const safeList = Array.isArray(unwrapped) ? unwrapped : [];

  // 列表层按 weight 降序（越大越靠前，由后端接口约定）
  const ordered = safeList.slice().sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));

  // 并发获取每条详情，拿到 content → answer（与 Banner content 取数链路完全一致：都走 getHomeBannerDetail）
  const detailPromises = ordered.map(async (item): Promise<MembershipFaqItem> => {
    let answer = '';
    try {
      const detail = await getHomeBannerDetail(Number(item.id));
      // 详情接口同样兼容 wrapper 对象（真实后端返回 {code,msg,data}）或直接是详情对象
      const detailObj = (detail as any)?.data ?? detail;
      // content 可能是 HTML 字符串 或纯文本，FAQ 组件内会兼容
      answer = String((detailObj?.content ?? item.content ?? '') as string).trim();
    } catch (err) {
      console.warn(`[getMembershipFaqList] 拉取 FAQ 详情失败（id=${item.id}）：`, err);
      answer = String(item.content || '').trim();
    }

    return {
      faq_id: item.id,
      question: item.mainTitle?.trim() || item.subTitle?.trim() || `问题 ${item.id}`,
      answer,
      sort_order: item.weight ?? 0,
    };
  });

  const result = await Promise.all(detailPromises);
  // 最终按 sort_order 降序再做一次兜底排序，保证组件里拿到的顺序稳定
  return result.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (b.faq_id ?? 0) - (a.faq_id ?? 0));
};
