/**
 * 使用示例 - Inspiration API
 * 
 * 展示各种常见用法
 */

const {
  getIndustries,
  getCreativeMethods,
  getHumanNeeds,
  getFilterOptions,
  queryCases,
  getCaseDetail,
  searchCases,
  parseCase
} = require('../index');

async function examples() {
  console.log('📚 Inspiration API 使用示例\n');
  
  // ========== 示例 1: 获取所有筛选选项 ==========
  console.log('━━━ 示例 1: 获取筛选选项 ━━━');
  const options = await getFilterOptions();
  console.log(`行业数量：${options.industries.length}`);
  console.log(`创意手法数量：${options.creativeMethods.length}`);
  console.log(`人性需求数量：${options.humanNeeds.length}`);
  console.log('行业示例:', options.industries.slice(0, 3));
  
  // ========== 示例 2: 按行业筛选 ==========
  console.log('\n━━━ 示例 2: 按行业筛选 ━━━');
  const techCases = await queryCases({
    industryId: 2,  // AI/互联网科技
    page: 1,
    size: 5
  });
  console.log(`AI/互联网科技案例：${techCases.total} 个`);
  console.log('前 3 个:', techCases.hits.slice(0, 3).map(h => h.title));
  
  // ========== 示例 3: 按奖项筛选 ==========
  console.log('\n━━━ 示例 3: 按奖项筛选 ━━━');
  const awardCases = await queryCases({
    awardName: '戛纳广告节',
    awardYear: 2025,
    page: 1,
    size: 5
  });
  console.log(`2025 戛纳广告节案例：${awardCases.total} 个`);
  
  // ========== 示例 4: 组合筛选 ==========
  console.log('\n━━━ 示例 4: 组合筛选 ━━━');
  const filtered = await queryCases({
    industryId: 2,
    awardYear: 2025,
    page: 1,
    size: 10
  });
  console.log(`AI 科技 + 2025 戛纳奖：${filtered.total} 个`);
  
  // ========== 示例 5: 关键词搜索 ==========
  console.log('\n━━━ 示例 5: 关键词搜索 ━━━');
  const searchResults = await searchCases('咖啡', {
    page: 1,
    size: 5
  });
  console.log(`"咖啡"相关案例：${searchResults.total} 个`);
  console.log('结果:', searchResults.hits.map(h => h.title));
  
  // ========== 示例 6: 获取案例详情 ==========
  console.log('\n━━━ 示例 6: 获取案例详情 ━━━');
  if (searchResults.hits.length > 0) {
    const caseId = searchResults.hits[0].caseId;
    const detail = await getCaseDetail(caseId);
    console.log(`案例 ID: ${detail.caseId}`);
    console.log(`标题：${detail.title}`);
    console.log(`品牌：${detail.brand}`);
    console.log(`产品：${detail.product}`);
    console.log(`卖点：${detail.sellingPoint?.substring(0, 50)}...`);
    console.log(`洞察：${detail.insight?.substring(0, 50)}...`);
    console.log(`创意概念：${detail.creativeConcept}`);
    console.log(`资产数：${detail.assets.length}`);
    if (detail.assets.length > 0) {
      console.log(`分镜数：${detail.assets[0].scenes?.length || 0}`);
    }
  }
  
  // ========== 示例 7: 案例解析（需要真实素材） ==========
  console.log('\n━━━ 示例 7: 案例解析 ━━━');
  console.log('parseCase 用法:');
  console.log(`
  const result = await parseCase({
    case_id: 123,
    asset: [
      {
        asset_id: 111,
        asset_type: 'video',
        asset_url: 'http://example.com/video.mp4'
      },
      {
        asset_id: 222,
        asset_type: 'image',
        asset_url: 'http://example.com/image.png'
      }
    ]
  });
  
  // 返回解析结果：
  // - industryId, brand, product, sellingPoint
  // - targetAudience, humanNeeds, insight
  // - creativeConcept, creativeMethods
  // - assets[].scenes (分镜), assets[].ocrText (图片文字)
  `);
  
  console.log('\n✅ 示例执行完成\n');
}

examples().catch(console.error);
