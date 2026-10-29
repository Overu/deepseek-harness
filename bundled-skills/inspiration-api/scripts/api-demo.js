/**
 * Inspiration API 演示脚本
 * 演示如何调用后端 API 查询案例数据
 */

const {
  queryCases,
  getCaseDetail,
  getIndustries,
  getCreativeMethods,
  getHumanNeeds,
  getFilterOptions,
  searchCases,
  getAllCases
} = require('../index');

(async () => {
  console.log('='.repeat(70));
  console.log('Inspiration API 演示 - 后端 API 调用');
  console.log('='.repeat(70));
  console.log();

  try {
    // ========== 示例 1: 获取筛选选项 ==========
    console.log('📋 示例 1: 获取筛选选项\n');
    
    const options = await getFilterOptions();
    console.log(`行业数量：${options.industries.length}`);
    console.log(`创意手法数量：${options.creativeMethods.length}`);
    console.log(`人性需求数量：${options.humanNeeds.length}`);
    
    console.log('\n行业列表（前 5 个）:');
    options.industries.slice(0, 5).forEach(ind => {
      console.log(`  - ${ind.value} (ID: ${ind.id})`);
    });
    
    console.log('\n人性需求（前 5 个）:');
    options.humanNeeds.slice(0, 5).forEach(need => {
      console.log(`  - ${need.value} (ID: ${need.id})`);
    });

    // ========== 示例 2: 查询案例列表 ==========
    console.log('\n\n📋 示例 2: 查询案例列表（第 1 页，每页 10 条）\n');
    
    const listResult = await queryCases({ page: 1, size: 10 });
    console.log(`总记录数：${listResult.total}`);
    console.log(`总页数：${listResult.totalPages}`);
    console.log(`当前页：${listResult.page}`);
    console.log(`\n案例列表:`);
    
    listResult.hits.forEach((hit, i) => {
      console.log(`\n${i + 1}. ${hit.title}`);
      console.log(`   行业：${hit.industry}`);
      console.log(`   人性需求：${hit.humanNeeds.join(', ')}`);
      console.log(`   创意手法：${hit.creativeMethods.join(', ')}`);
    });

    // ========== 示例 3: 按行业筛选 ==========
    console.log('\n\n📋 示例 3: 筛选"AI/互联网科技"行业案例\n');
    
    // 先获取行业 ID
    const techIndustry = options.industries.find(ind => 
      ind.value.includes('互联网') || ind.value.includes('AI')
    );
    
    if (techIndustry) {
      console.log(`使用行业 ID: ${techIndustry.id} (${techIndustry.value})`);
      
      const techCases = await queryCases({
        industryId: techIndustry.id,
        page: 1,
        size: 5
      });
      
      console.log(`找到 ${techCases.total} 个案例，显示前 5 个:\n`);
      techCases.hits.forEach(hit => {
        console.log(`- ${hit.title}`);
      });
    }

    // ========== 示例 4: 按奖项筛选 ==========
    console.log('\n\n📋 示例 4: 筛选 2025 年金奖案例\n');
    
    const goldCases = await queryCases({
      awardName: '金投赏',
      awardResult: '金奖',
      awardYear: 2025,
      page: 1,
      size: 5
    });
    
    console.log(`找到 ${goldCases.total} 个金奖案例:\n`);
    goldCases.hits.forEach(hit => {
      console.log(`- ${hit.title}`);
    });

    // ========== 示例 5: 关键词搜索 ==========
    console.log('\n\n📋 示例 5: 搜索关键词"咖啡"\n');
    
    const searchResult = await searchCases('咖啡', { page: 1, size: 5 });
    console.log(`找到 ${searchResult.total} 个相关案例:\n`);
    searchResult.hits.forEach(hit => {
      console.log(`- ${hit.title}`);
      console.log(`  行业：${hit.industry}`);
    });

    // ========== 示例 6: 获取案例详情 ==========
    console.log('\n\n📋 示例 6: 获取案例详情\n');
    
    if (listResult.hits.length > 0) {
      const firstCaseId = listResult.hits[0].caseId;
      console.log(`获取案例 ID ${firstCaseId} 的详情...\n`);
      
      const detail = await getCaseDetail(firstCaseId);
      
      console.log(`品牌：${detail.brand}`);
      console.log(`产品：${detail.product}`);
      console.log(`标题：${detail.title}`);
      console.log(`\n核心卖点:`);
      console.log(`  ${detail.sellingPoint}`);
      console.log(`\n消费者洞察:`);
      console.log(`  ${detail.insight}`);
      console.log(`\n创意概念:`);
      console.log(`  ${detail.creativeConcept}`);
      console.log(`\n目标人群:`);
      detail.targetAudience.forEach(audience => {
        console.log(`  - ${audience}`);
      });
      
      if (detail.awards && detail.awards.length > 0) {
        console.log(`\n获奖情况:`);
        detail.awards.forEach(award => {
          console.log(`  - ${award.awardName} ${award.awardResult} (${award.awardCategory})`);
        });
      }
      
      if (detail.assets && detail.assets.length > 0) {
        console.log(`\n素材资源:`);
        detail.assets.forEach(asset => {
          console.log(`  - ${asset.assetType}: ${asset.assetUrl.substring(0, 80)}...`);
          if (asset.scenes && asset.scenes.length > 0) {
            console.log(`    分镜数量：${asset.scenes.length}`);
            console.log(`    第 1 分镜：${asset.scenes[0].sceneDesc?.substring(0, 50)}...`);
          }
        });
      }
    }

    // ========== 示例 7: 组合筛选 ==========
    console.log('\n\n📋 示例 7: 组合筛选（行业 + 创意手法 + 人性需求）\n');
    
    // 使用第一个创意手法和人性需求 ID
    const firstMethod = options.creativeMethods[0];
    const firstNeed = options.humanNeeds[0];
    
    if (firstMethod && firstNeed) {
      console.log(`筛选条件:`);
      console.log(`  创意手法：${firstMethod.value} (ID: ${firstMethod.id})`);
      console.log(`  人性需求：${firstNeed.value} (ID: ${firstNeed.id})`);
      
      const combinedResult = await queryCases({
        creativeMethods: [firstMethod.id],
        humanNeeds: [firstNeed.id],
        page: 1,
        size: 5
      });
      
      console.log(`\n找到 ${combinedResult.total} 个匹配案例`);
      if (combinedResult.hits.length > 0) {
        console.log('案例:');
        combinedResult.hits.forEach(hit => {
          console.log(`  - ${hit.title}`);
        });
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ 演示完成!');
    console.log('='.repeat(70));
    console.log();

  } catch (error) {
    console.error('\n❌ 演示过程中发生错误:');
    console.error(error.message);
    console.error();
    
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 提示：API 服务不可用，请检查网络连接或 API 地址');
    } else if (error.message.includes('timeout')) {
      console.log('💡 提示：请求超时，请稍后重试');
    }
    
    process.exit(1);
  }
})();
