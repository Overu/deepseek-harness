/**
 * 人性需求洞察技能 (Human Needs Insight Skill)
 * Version 3.1.0 - 标注格式对齐，优化信号检测与子需求匹配
 */

const crypto = require('crypto');

const HUMAN_NEEDS_TAXONOMY = {
  physiological: {
    name: '生理需求',
    subNeeds: ['水', '阳光', '空气', '食物', '营养', '能量', '温度', '休息', '防晒', '御寒', '住所', '性欲', '排泄', '运动', '休闲', '防噪', '护肤', '美妆', '抗衰', '降温', '保暖', '去火', '清新', '舒适', '速度', '稳定', '气味', '健康', '助听', '味道', '清洁', '空间', '出行', '愉悦', '解压', '治愈', '沉浸', '玩耍', '呐喊', '愤怒', '笑', '大哭', '哀愁', '恐惧', '解忧']
  },
  safety: {
    name: '安全需求',
    subNeeds: ['躯体健全', '生命安全', '身体健康', '心理健康', '金钱安全', '物品安全', '职位保障', '信息安全', '隐私安全', '住所安全', '国家安全', '家庭和谐', '环境卫生', '食物安全', '社会稳定', '自然保护', '制度安全', '物种安全', '资源安全', '信赖']
  },
  belonging: {
    name: '情感需求',
    subNeeds: ['亲人团圆', '亲人思念', '保护家人', '家庭责任', '亲人陪伴', '亲人关怀', '亲人庇护', '亲人交流', '亲人别离', '亲人祝福', '亲人回忆', '亲人理解', '友谊长青', '友人相聚', '友人信任', '友情关心', '友人相知', '友人陪伴', '友人思念', '友人交流', '友人别离', '友人合作', '友人祝福', '友人回忆', '好感', '暗恋', '表白', '热恋', '失恋', '亲密', '体贴', '专一', '承诺', '思念', '付出', '理解', '责任', '祝福', '坚守', '回忆', '喜爱物品', '珍藏物品', '失去 (宠) 物', '(宠) 物记忆', '喜爱宠物', '(宠) 物陪伴', '(宠) 物交流', '(宠) 物别离', '(宠) 物回忆', '宗教', '故土', '民族', '领域', '阶层', '家庭', '小团体', '工作单位', '学校', '年龄群体', '组织', '爱好者', '相聚', '地域', '国家']
  },
  esteem: {
    name: '尊重需求',
    subNeeds: ['信心', '形象', '素质', '成就', '身份', '独立', '力量感', '信誉', '地位', '名声', '气质', '有威望', '被崇拜', '被敬佩', '被关注', '被尊重', '被认同', '被优待', '被欣赏', '被重视', '被呵护', '被理解']
  },
  cognitive: {
    name: '认知需求',
    subNeeds: ['好奇', '提问', '教育', '训练', '经验', '工具使用', '研发', '效率', '便捷', '体验', '研究', '资讯', '八卦', '冒险', '百科知识', '发现', '惊喜', '乐趣']
  },
  aesthetic: {
    name: '审美需求',
    subNeeds: ['简洁', '多彩', '自然美', '艺术美', '规律美', '平衡美', '时尚美', '内心共鸣', '文化', '视觉', '舒服', '经典', '潮流', '优雅']
  },
  selfActualization: {
    name: '自我实现',
    subNeeds: ['自律', '博爱', '奉献', '人文关怀', '虔诚', '传承', '意志', '悟道', '心境', '激情', '热情', '追寻自我', '付出', '勇敢', '个性', '坚持', '极致', '从容', '专业', '进取', '自由', '超越', '挑战', '善良', '睿智', '良知', '奋斗', '尊重', '直率', '专注', '乐观', '坚韧', '追逐梦想', '事业成功', '精彩', '发挥潜能', '发明创造', '解决难题', '世界大同', '天人合一', '圆满']
  }
};

const CATEGORY_WEIGHTS = {
  '汽车': { esteem: 0.6, safety: 0.5, physiological: 0.4 },
  'default': { physiological: 0.3, safety: 0.3, belonging: 0.3, esteem: 0.3, cognitive: 0.3, aesthetic: 0.3, selfActualization: 0.3 }
};

function extractBriefInfo(brief) {
  const result = { targetAudience: null, coreSellingPoint: null, brandTone: null, keywords: [] };
  
  const audienceKeywords = ['针对', '面向', '目标用户', '目标人群'];
  const sellingKeywords = ['突出', '主打', '核心卖点', '优势', '卖点是'];
  const toneKeywords = ['调性', '风格', '基调'];
  
  // 提取目标人群
  for (const keyword of audienceKeywords) {
    const idx = brief.indexOf(keyword);
    if (idx !== -1) {
      const start = idx + keyword.length;
      const endChars = ['的', ',', '，', '.', '。', '突出', '主打', '希望'];
      let end = brief.length;
      for (const endChar of endChars) {
        const endIdx = brief.indexOf(endChar, start);
        if (endIdx !== -1 && endIdx < end) end = endIdx;
      }
      let extracted = brief.substring(start, end).trim();
      extracted = extracted.replace(/[，,。,.]+$/, '');
      if (extracted.length > 0 && extracted.length < 50) {
        result.targetAudience = extracted;
        break;
      }
    }
  }
  
  // 提取核心卖点
  for (const keyword of sellingKeywords) {
    const idx = brief.indexOf(keyword);
    if (idx !== -1) {
      let start = idx + keyword.length;
      // 跳过开头的"是"、冒号、空格
      while (start < brief.length && (brief[start] === '是' || brief[start] === ':' || brief[start] === '：' || brief[start] === ' ')) {
        start++;
      }
      // 检查是否以引号开头
      const hasQuote = start < brief.length && (brief[start] === '"' || brief[start] === '"');
      if (hasQuote) {
        // 找到最后一个闭引号（支持多个引号片段）
        let end = start + 1;
        while (end < brief.length) {
          if (brief[end] === '"' || brief[end] === '"') {
            const rest = brief.substring(end + 1).trimStart();
            if (rest.startsWith('和') || rest.startsWith('"') || rest.startsWith('"')) {
              end++; continue;
            }
          }
          if ((brief[end] === ',' || brief[end] === '，' || brief[end] === '.' || brief[end] === '。') && (brief[end-1] === '"' || brief[end-1] === '"')) {
            break;
          }
          end++;
        }
        let extracted = brief.substring(start, end).trim();
        if (extracted.length > 0 && extracted.length < 100) {
          result.coreSellingPoint = extracted;
          break;
        }
      }
    }
  }
  
  // 提取品牌调性
  for (const keyword of toneKeywords) {
    const idx = brief.indexOf(keyword);
    if (idx !== -1) {
      const start = idx + keyword.length;
      const toMatch = ['要', '是'];
      let actualStart = start;
      for (const m of toMatch) {
        if (brief.substring(start, start + m.length) === m) {
          actualStart = start + m.length;
          break;
        }
      }
      const endChars = ['，', ',', '.', '。', '追求', '希望'];
      let end = brief.length;
      for (const endChar of endChars) {
        const endIdx = brief.indexOf(endChar, actualStart);
        if (endIdx !== -1 && endIdx < end) end = endIdx;
      }
      let extracted = brief.substring(actualStart, end).trim();
      extracted = extracted.replace(/[，,。,.]+$/, '');
      if (extracted.length > 0 && extracted.length < 30) {
        result.brandTone = extracted;
        break;
      }
    }
  }
  
  // 提取关键词
  const keywordPatterns = ['年轻', '女性', '男性', '时尚', '健康', '智能', '高端', '性价比', '环保', '科技', '安全', '舒适', '便捷', '个性', '社交', '家庭', '商务', '运动', '美容', '护肤'];
  for (const pattern of keywordPatterns) {
    if (brief.includes(pattern)) {
      result.keywords.push(pattern);
    }
  }
  
  return result;
}

function detectSignals(brief, briefInfo) {
  const signals = {
    youngAudience: brief.includes('年轻') || brief.includes('青年') || brief.includes('学生') || brief.includes('Z 世代'),
    femaleAudience: brief.includes('女性') || brief.includes('女士') || brief.includes('妈妈') || brief.includes('女孩'),
    maleAudience: brief.includes('男性') || brief.includes('男士') || brief.includes('爸爸') || brief.includes('男孩'),
    socialViral: brief.includes('社交') || brief.includes('病毒') || brief.includes('传播') || brief.includes('分享') || brief.includes('网红'),
    coolTone: brief.includes('酷') || brief.includes('潮流') || brief.includes('时尚') || brief.includes('个性') || brief.includes('态度'),
    smartTech: brief.includes('智能') || brief.includes('科技') || brief.includes('AI') || brief.includes('数字化') || brief.includes('互联'),
    rangeAnxiety: brief.includes('续航') || brief.includes('里程') || brief.includes('充电') || brief.includes('焦虑'),
    fitness: brief.includes('健身') || brief.includes('运动') || brief.includes('减脂') || brief.includes('减肥') || brief.includes('塑形') || brief.includes('身材'),
    beauty: brief.includes('美容') || brief.includes('护肤') || brief.includes('美妆') || brief.includes('脱毛') || brief.includes('医美') || brief.includes('美丽'),
    selfImprovement: brief.includes('自律') || brief.includes('成长') || brief.includes('提升') || brief.includes('习惯') || brief.includes('坚持') || brief.includes('个性') || brief.includes('自我') || brief.includes('独特'),
    luxury: brief.includes('高端') || brief.includes('奢华') || brief.includes('奢侈') || brief.includes('尊贵'),
    familyOriented: brief.includes('家庭') || brief.includes('家人') || brief.includes('亲子') || brief.includes('团圆')
  };
  
  return signals;
}

function matchHumanNeeds(brief, briefInfo, signals) {
  const weights = { ...CATEGORY_WEIGHTS['default'] };
  
  const category = Object.keys(CATEGORY_WEIGHTS).find(cat => 
    cat !== 'default' && brief.includes(cat)
  );
  if (category) {
    Object.assign(weights, CATEGORY_WEIGHTS[category]);
  }
  
  if (signals.socialViral) {
    weights.esteem = Math.max(weights.esteem, 0.9);
    weights.belonging = Math.max(weights.belonging, 0.7);
  }
  if (signals.coolTone) {
    weights.esteem = Math.max(weights.esteem, 0.85);
    weights.aesthetic = Math.max(weights.aesthetic, 0.75);
  }
  if (signals.youngAudience) {
    weights.esteem = Math.max(weights.esteem, 0.8);
  }
  if (signals.smartTech) {
    weights.cognitive = Math.max(weights.cognitive, 0.7);
  }
  if (signals.rangeAnxiety && !signals.socialViral && !signals.coolTone) {
    weights.safety = Math.max(weights.safety, 0.6);
  }
  if (signals.fitness) {
    weights.physiological = Math.max(weights.physiological, 0.85);
    weights.selfActualization = Math.max(weights.selfActualization, 0.7);
  }
  if (signals.beauty) {
    weights.physiological = Math.max(weights.physiological, 0.75);
    weights.aesthetic = Math.max(weights.aesthetic, 0.7);
    weights.esteem = Math.max(weights.esteem, 0.7);
    weights.selfActualization = Math.max(weights.selfActualization, 0.75);
  }
  if (signals.selfImprovement) {
    weights.selfActualization = Math.max(weights.selfActualization, 0.9);
  }
  if (brief.includes('个性') && (signals.beauty || signals.femaleAudience)) {
    weights.selfActualization = Math.max(weights.selfActualization, 0.95);
  }
  if (signals.femaleAudience && (signals.beauty || signals.fitness)) {
    weights.esteem = Math.max(weights.esteem, 0.8);
  }
  if (signals.luxury) {
    weights.esteem = Math.max(weights.esteem, 0.85);
    weights.aesthetic = Math.max(weights.aesthetic, 0.7);
  }
  if (signals.familyOriented) {
    weights.belonging = Math.max(weights.belonging, 0.8);
    weights.safety = Math.max(weights.safety, 0.6);
  }
  
  const scoredNeeds = Object.entries(weights).map(([category, weight]) => {
    const taxonomyEntry = HUMAN_NEEDS_TAXONOMY[category];
    const score = Math.round(weight * 10);
    return {
      category: taxonomyEntry.name,
      categoryKey: category,
      score,
      subNeeds: taxonomyEntry.subNeeds
    };
  });
  
  scoredNeeds.sort((a, b) => b.score - a.score);
  
  return {
    coreNeed: scoredNeeds[0],
    secondaryNeed: scoredNeeds[1],
    allNeeds: scoredNeeds
  };
}

function selectSubNeed(category, brief, briefInfo, signals) {
  const subNeeds = HUMAN_NEEDS_TAXONOMY[category].subNeeds;
  
  if (category === 'esteem' && (signals.youngAudience || signals.coolTone || signals.socialViral)) return '被关注';
  if (category === 'esteem' && (brief.includes('形象') || brief.includes('气质') || brief.includes('自信') || brief.includes('身份'))) return '形象';
  if (category === 'esteem' && (brief.includes('信心') || brief.includes('认可') || brief.includes('认同'))) return '信心';
  
  if (category === 'cognitive' && signals.smartTech) return '体验';
  if (category === 'cognitive' && (brief.includes('便捷') || brief.includes('效率') || brief.includes('快速'))) return '便捷';
  if (category === 'cognitive' && (brief.includes('好奇') || brief.includes('探索') || brief.includes('发现'))) return '好奇';
  
  if (category === 'safety' && signals.rangeAnxiety) return '信赖';
  if (category === 'safety' && (brief.includes('健康') || brief.includes('身体'))) return '身体健康';
  if (category === 'safety' && (brief.includes('安全') || brief.includes('保障') || brief.includes('无忧'))) return '信赖';
  
  if (category === 'aesthetic' && signals.coolTone) return '潮流';
  if (category === 'aesthetic' && (brief.includes('时尚') || brief.includes('美学') || brief.includes('美感'))) return '时尚美';
  if (category === 'aesthetic' && (brief.includes('优雅') || brief.includes('精致'))) return '优雅';
  
  if (category === 'belonging' && signals.socialViral) return '相聚';
  if (category === 'belonging' && (brief.includes('国家') || brief.includes('民族') || brief.includes('自豪'))) return '国家';
  if (category === 'belonging' && (brief.includes('理解') || brief.includes('懂你') || brief.includes('关怀'))) return '理解';
  if (category === 'belonging' && (brief.includes('家人') || brief.includes('亲情') || brief.includes('团圆'))) return '亲人陪伴';
  
  if (category === 'selfActualization' && (brief.includes('自律') || brief.includes('习惯') || brief.includes('坚持'))) return '自律';
  if (category === 'selfActualization' && (brief.includes('个性') || brief.includes('自我') || brief.includes('独特'))) return '个性';
  if (category === 'selfActualization' && (brief.includes('挑战') || brief.includes('突破') || brief.includes('极限'))) return '挑战';
  if (category === 'selfActualization' && (brief.includes('成长') || brief.includes('更好') || brief.includes('蜕变'))) return '追逐梦想';
  
  if (category === 'physiological') {
    if (brief.includes('健康') || brief.includes('养生') || brief.includes('保健')) return '健康';
    if (brief.includes('运动') || brief.includes('健身') || brief.includes('锻炼') || brief.includes('减脂') || brief.includes('减肥') || brief.includes('塑形')) return '运动';
    if (brief.includes('护肤') || brief.includes('美妆') || brief.includes('美容') || brief.includes('脱毛')) return '护肤';
    if (brief.includes('出行') || brief.includes('代步') || brief.includes('交通') || brief.includes('机车') || brief.includes('摩托') || brief.includes('汽车')) return '出行';
    if (brief.includes('舒适') || brief.includes('放松') || brief.includes('解压') || brief.includes('治愈')) return '舒适';
    if (brief.includes('睡眠') || brief.includes('休息')) return '休息';
    if (brief.includes('食物') || brief.includes('营养') || brief.includes('能量') || brief.includes('吃')) return '食物';
  }
  
  return subNeeds[0];
}

function generateReason(category, detail, brief, briefInfo) {
  const reasons = {
    esteem: (briefInfo.targetAudience || '目标用户') + '追求' + detail + '，' + (briefInfo.brandTone || '品牌调性') + '强化身份表达',
    cognitive: (briefInfo.coreSellingPoint || '产品卖点') + '提供' + detail + '体验',
    safety: (briefInfo.coreSellingPoint || '产品卖点') + '建立' + detail + '感',
    aesthetic: (briefInfo.brandTone || '品牌调性') + '体现' + detail + '美学',
    belonging: (brief.includes('社交') ? '社交传播' : '情感连接') + '需求促进' + detail,
    physiological: (briefInfo.coreSellingPoint || '产品功能') + '满足' + detail + '需求',
    selfActualization: (briefInfo.targetAudience || '目标用户') + '通过产品实现' + detail
  };
  return reasons[category] || (detail + '是核心需求');
}

function detectConflict(coreNeed, secondaryNeed) {
  const conflictPairs = [
    { pair: ['奢侈', '简约'], solution: '强调"低调奢华"或"精致简约"' },
    { pair: ['传统', '潮流'], solution: '强调"经典与现代的融合"' },
    { pair: ['个性', '归属'], solution: '强调"在群体中保持独特"' }
  ];
  
  for (const conflict of conflictPairs) {
    if ((conflict.pair.includes(coreNeed.detail) && conflict.pair.includes(secondaryNeed?.detail)) ||
        (conflict.pair.includes(secondaryNeed?.detail) && conflict.pair.includes(coreNeed.detail))) {
      return {
        has_conflict: true,
        description: `${coreNeed.detail}与${secondaryNeed.detail}存在潜在冲突`,
        solution: conflict.solution
      };
    }
  }
  
  return {
    has_conflict: false,
    description: '无明显冲突',
    solution: '保持现有策略'
  };
}

function formatHumanNeeds(coreNeed, secondaryNeed) {
  return `${coreNeed.category}：${coreNeed.detail}；${secondaryNeed.category}：${secondaryNeed.detail}`;
}

function generateConsumerInsight(needs, briefInfo, productCategory) {
  const coreNeed = needs.coreNeed;
  const secondaryNeed = needs.secondaryNeed;
  
  let targetAudience = briefInfo.targetAudience || '消费者';
  if (targetAudience.length > 10) {
    const simpleMatch = targetAudience.match(/(年轻)?(女性 | 男性 | 妈妈 | 爸爸 | 学生 | 白领 | 人群 | 用户)/);
    if (simpleMatch) {
      targetAudience = simpleMatch[0];
    } else {
      const ageMatch = targetAudience.match(/(\d+-?\d* 岁)/);
      if (ageMatch) {
        targetAudience = ageMatch[0] + '人群';
      } else {
        targetAudience = '目标用户';
      }
    }
  }
  const sellingPoint = briefInfo.coreSellingPoint || '本产品';
  
  const insightTemplates = {
    '尊重需求': {
      '被关注': `${targetAudience}渴望在社交场景中获得关注与认可，${sellingPoint}可以成为他们的"社交货币"。`,
      '被认同': `${targetAudience}希望自己的选择被他人认同，${sellingPoint}可以成为他们表达品味与态度的载体。`,
      '身份': `${targetAudience}通过消费选择定义自我身份，${productCategory || '本产品'}是他们身份表达的一部分。`,
      '形象': `${targetAudience}注重外在形象与他人评价，${sellingPoint}可以帮助他们塑造理想中的自我形象。`,
      '信心': `${targetAudience}渴望通过外在改变获得内在自信，${sellingPoint}可以成为他们自信的来源。`,
      'default': `${targetAudience}追求社会认可与自我价值实现，${sellingPoint}可以满足他们对${coreNeed.detail}的渴望。`
    },
    '认知需求': {
      '体验': `${targetAudience}不仅追求功能满足，更追求使用过程中的惊喜与愉悦，${sellingPoint}可以创造独特的体验记忆点。`,
      '便捷': `${targetAudience}在快节奏生活中追求效率最大化，${sellingPoint}可以让他们感受到"时间被尊重"。`,
      '好奇': `${targetAudience}对新鲜事物保持开放态度，${sellingPoint}可以激发他们的探索欲。`,
      'default': `${targetAudience}渴望通过产品获得新知与体验，${sellingPoint}可以满足他们对${coreNeed.detail}的追求。`
    },
    '安全需求': {
      '信赖': `${targetAudience}在面对${productCategory || '产品'}时存在担忧，${sellingPoint}可以建立可信赖的品牌形象。`,
      '身体健康': `${targetAudience}越来越重视健康生活方式，${sellingPoint}可以让他们感受到对健康的掌控感。`,
      'default': `${targetAudience}对${productCategory || '产品'}存在安全顾虑，${sellingPoint}可以提供${coreNeed.detail}保障。`
    },
    '情感需求': {
      '相聚': `${targetAudience}渴望与亲友建立情感连接，${productCategory || '本产品'}可以成为他们情感交流的媒介。`,
      '理解': `${targetAudience}希望被理解与关怀，${sellingPoint}可以传递"我懂你"的情感信号。`,
      '国家': `${targetAudience}将品牌视为国家身份的象征，${productCategory || '本产品'}承载着民族自豪感。`,
      'default': `${targetAudience}渴望情感归属与连接，${sellingPoint}可以满足他们对${coreNeed.detail}的需求。`
    },
    '审美需求': {
      '潮流': `${targetAudience}追求前沿审美与个性化表达，${sellingPoint}可以成为他们时尚态度的外显符号。`,
      '优雅': `${targetAudience}追求精致生活美学，${sellingPoint}可以满足他们对${coreNeed.detail}的追求。`,
      '时尚美': `${targetAudience}不仅需要实用工具，更需要能彰显自身审美与气质的时尚单品。`,
      'default': `${targetAudience}追求视觉与感官的美感体验，${sellingPoint}可以满足他们对${coreNeed.detail}的追求。`
    },
    '自我实现': {
      '个性': `${targetAudience}渴望表达独特自我，${sellingPoint}可以成为他们个性主张的载体。`,
      '挑战': `${targetAudience}追求突破自我极限，${sellingPoint}可以支持他们的挑战精神。`,
      '自律': `${targetAudience}渴望通过自律实现自我蜕变，${sellingPoint}可以帮助他们养成理想的习惯。`,
      'default': `${targetAudience}追求个人成长与潜能发挥，${sellingPoint}可以帮助他们实现${coreNeed.detail}。`
    },
    '生理需求': {
      '舒适': `${targetAudience}在快节奏生活中渴望身心放松，${sellingPoint}可以提供${coreNeed.detail}的即时满足。`,
      '健康': `${targetAudience}越来越重视身心健康，${sellingPoint}可以满足他们对${coreNeed.detail}的需求。`,
      '运动': `${targetAudience}渴望通过运动改善身体状态，${sellingPoint}可以支持他们的运动目标。`,
      '出行': `${targetAudience}需要便捷舒适的出行方式，${sellingPoint}可以满足他们对${coreNeed.detail}的需求。`,
      '护肤': `${targetAudience}追求美丽与自信，${sellingPoint}可以帮助他们实现理想中的肌肤状态。`,
      'default': `${targetAudience}追求基础生活品质的提升，${sellingPoint}可以满足他们对${coreNeed.detail}的需求。`
    }
  };
  
  const categoryInsights = insightTemplates[coreNeed.category] || insightTemplates['生理需求'];
  const insight = categoryInsights[coreNeed.detail] || categoryInsights['default'];
  
  const conciseInsight = insight.length > 60 ? insight.substring(0, 57) + '...' : insight;
  
  return {
    core_insight: conciseInsight,
    secondary_insight: secondaryNeed ? `同时，${secondaryNeed.category}中的"${secondaryNeed.detail}"表明消费者也关注${secondaryNeed.detail}层面的满足。` : '',
    insight_summary: `${coreNeed.category}（${coreNeed.detail}，得分${coreNeed.score}）是核心驱动力，${secondaryNeed ? `${secondaryNeed.category}（${secondaryNeed.detail}）作为次要需求形成补充` : '无明显次要需求'}`,
    insight_text: conciseInsight
  };
}

const conceptNameTemplates = {
  esteem: ['身份宣言', '圈层认同', '成就展示', '态度表达', '品味证明'],
  cognitive: ['体验升级', '知识赋能', '探索发现', '效率革命', '智能生活'],
  safety: ['信任建立', '风险消除', '陪伴守护', '安心承诺', '专业背书'],
  aesthetic: ['视觉冲击', '潮流引领', '个性表达', '时尚美学', '艺术共鸣'],
  belonging: ['情感连接', '社群归属', '理解关怀', '国家自豪', '友情相聚'],
  selfActualization: ['潜能激发', '价值共鸣', '极致追求', '自律成长', '挑战极限'],
  physiological: ['即时满足', '日常仪式', '品质生活', '健康守护', '运动活力', '出行自由', '舒适体验']
};

function generateCreativeConcepts(needs, consumerInsight, briefInfo, conceptCount = 3) {
  const coreNeed = needs.coreNeed;
  const secondaryNeed = needs.secondaryNeed;
  
  const categoryKey = Object.keys(HUMAN_NEEDS_TAXONOMY).find(key => 
    HUMAN_NEEDS_TAXONOMY[key].name === coreNeed.category
  ) || 'physiological';
  
  const conceptNames = conceptNameTemplates[categoryKey] || conceptNameTemplates.physiological;
  
  const concepts = [];
  for (let i = 0; i < Math.min(conceptCount, conceptNames.length); i++) {
    const conceptName = conceptNames[i];
    const concept = {
      concept_id: `CC-${Date.now()}-${i + 1}`,
      concept_name: conceptName,
      theme: `${coreNeed.detail} - ${conceptName}`,
      concept: `围绕"${coreNeed.detail}"需求，通过${conceptName}的方式，${consumerInsight.core_insight.substring(0, 30)}...`,
      execution_ideas: [
        `创意表现 1：通过${briefInfo.targetAudience || '目标用户'}的日常场景，展现${coreNeed.detail}的满足`,
        `创意表现 2：使用视觉/文案强化"${conceptName}"主题`,
        `创意表现 3：结合${briefInfo.coreSellingPoint || '产品卖点'}创造记忆点`
      ],
      alignment: {
        core_need: `${coreNeed.category}(${coreNeed.detail})`,
        secondary_need: secondaryNeed ? `${secondaryNeed.category}(${secondaryNeed.detail})` : '无',
        consumer_insight: consumerInsight.core_insight.substring(0, 50) + '...'
      },
      status: 'draft',
      feedback_history: []
    };
    concepts.push(concept);
  }
  
  return concepts;
}

function refineCreativeConcept(concept, feedback) {
  const refinedConcept = { ...concept };
  refinedConcept.status = 'refined';
  refinedConcept.feedback_history = [
    ...concept.feedback_history,
    {
      timestamp: new Date().toISOString(),
      feedback: feedback,
      action: 'refined'
    }
  ];
  
  refinedConcept.concept = `【优化版】${concept.concept}`;
  refinedConcept.execution_ideas = concept.execution_ideas.map((idea, idx) => 
    `【优化${idx + 1}】${idea}`
  );
  
  return refinedConcept;
}

function generateKeywords(brief, briefInfo, needs) {
  const keywords = new Set();
  
  briefInfo.keywords.forEach(k => keywords.add(k));
  
  keywords.add(needs.coreNeed.detail);
  if (needs.secondaryNeed) {
    keywords.add(needs.secondaryNeed.detail);
  }
  
  if (brief.includes('年轻')) keywords.add('年轻化');
  if (brief.includes('高端')) keywords.add('高端化');
  if (brief.includes('智能')) keywords.add('智能化');
  
  return Array.from(keywords).slice(0, 10);
}

async function analyze({ client_brief, product_category, brand_guidelines, generate_concepts = true, concept_count = 3 }) {
  try {
    if (!client_brief || client_brief.trim().length < 10) {
      return {
        status: 'Error',
        error_code: 'ERR_INSIGHT_INVALID_BRIEF',
        message: '客户 Brief 过短或为空，请提供至少 10 个字符的描述'
      };
    }
    
    const briefInfo = extractBriefInfo(client_brief);
    const signals = detectSignals(client_brief, briefInfo);
    const needs = matchHumanNeeds(client_brief, briefInfo, signals);
    
    const coreDetail = selectSubNeed(needs.coreNeed.categoryKey, client_brief, briefInfo, signals);
    const secondaryDetail = selectSubNeed(needs.secondaryNeed.categoryKey, client_brief, briefInfo, signals);
    
    needs.coreNeed.detail = coreDetail;
    needs.coreNeed.reason = generateReason(needs.coreNeed.categoryKey, coreDetail, client_brief, briefInfo);
    
    needs.secondaryNeed.detail = secondaryDetail;
    needs.secondaryNeed.reason = generateReason(needs.secondaryNeed.categoryKey, secondaryDetail, client_brief, briefInfo);
    
    const conflictCheck = detectConflict(needs.coreNeed, needs.secondaryNeed);
    const keywords = generateKeywords(client_brief, briefInfo, needs);
    const consumerInsight = generateConsumerInsight(needs, briefInfo, product_category);
    
    const result = {
      status: 'Success',
      error_code: null,
      clarification_questions: [],
      data: {
        core_need: {
          category: needs.coreNeed.category,
          detail: needs.coreNeed.detail,
          score: needs.coreNeed.score,
          reason: needs.coreNeed.reason
        },
        secondary_need: {
          category: needs.secondaryNeed.category,
          detail: needs.secondaryNeed.detail,
          score: needs.secondaryNeed.score,
          reason: needs.secondaryNeed.reason
        },
        conflict_check: conflictCheck,
        keywords: keywords,
        consumer_insight: consumerInsight,
        human_needs_text: formatHumanNeeds(needs.coreNeed, needs.secondaryNeed),
        consumer_insight_text: consumerInsight.insight_text
      },
      metadata: {
        insight_id: `INS-${crypto.randomBytes(8).toString('hex')}`,
        needs_mapped: [needs.coreNeed.category, needs.secondaryNeed.category],
        timestamp: new Date().toISOString(),
        version: '3.1.0',
        features: ['consumer_insight', 'creative_concepts', 'iterative_refinement', 'format_alignment']
      }
    };
    
    if (generate_concepts) {
      result.data.creative_concepts = generateCreativeConcepts(needs, consumerInsight, briefInfo, concept_count);
      result.metadata.features.push('creative_concepts_generated');
    }
    
    return result;
  } catch (error) {
    return {
      status: 'Error',
      error_code: 'ERR_INSIGHT_ANALYSIS_FAILED',
      message: `分析失败：${error.message}`,
      data: null
    };
  }
}

module.exports = {
  analyze,
  analyzeHumanNeeds: analyze,
  generateConsumerInsight,
  generateCreativeConcepts,
  refineCreativeConcept,
  detectSignals,
  matchHumanNeeds,
  selectSubNeed,
  formatHumanNeeds,
  HUMAN_NEEDS_TAXONOMY,
  VERSION: '3.1.0'
};
