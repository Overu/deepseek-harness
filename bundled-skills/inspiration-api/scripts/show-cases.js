/**
 * 展示牛奶 + 夸张创意手法的案例列表及详情
 */

const { queryCases, getCaseDetail } = require('../index');

(async () => {
  console.log('📋 案例列表：牛奶 + 夸张创意手法\n');
  console.log('=' .repeat(80));
  
  // 查询案例列表（获取全部 10 个）
  const result = await queryCases({
    keyword: '牛奶',
    creativeMethods: [310],  // 夸张
    page: 1,
    size: 10
  });
  
  console.log(`\n共找到 ${result.total} 个案例，展示前 ${result.hits.length} 个:\n`);
  
  // 展示列表
  result.hits.forEach((hit, i) => {
    console.log(`${i+1}. 【ID:${hit.caseId}】${hit.title}`);
    console.log(`   行业：${hit.industry} | 创意手法：${hit.creativeMethods.join(', ')} | 需求：${hit.humanNeeds.join(', ')}`);
  });
  
  console.log('\n' + '=' .repeat(80));
  console.log('\n📖 案例详情:\n');
  
  // 获取每个案例的详情
  for (let i = 0; i < result.hits.length; i++) {
    const hit = result.hits[i];
    
    try {
      console.log(`${'='.repeat(80)}`);
      console.log(`案例 ${i+1}/10: ${hit.title}`);
      console.log(`${'='.repeat(80)}\n`);
      
      const detail = await getCaseDetail(hit.caseId);
      
      console.log(`📌 基本信息`);
      console.log(`   案例 ID: ${detail.caseId}`);
      console.log(`   品    牌：${detail.brand}`);
      console.log(`   产    品：${detail.product}`);
      console.log(`   行    业：${detail.industry}`);
      console.log(`   核心卖点：${detail.sellingPoint}`);
      console.log('');
      
      console.log(`🎯 目标受众`);
      console.log(`   ${Array.isArray(detail.targetAudience) ? detail.targetAudience.join('、') : detail.targetAudience}`);
      console.log('');
      
      console.log(`💡 创意策略`);
      console.log(`   消费者洞察：${detail.insight}`);
      console.log(`   创意概念：${detail.creativeConcept}`);
      console.log(`   创意手法：${detail.creativeMethods.join(', ')}`);
      console.log(`   人性需求：${detail.humanNeeds.join(', ')}`);
      console.log('');
      
      console.log(`📝 案例概述`);
      console.log(`   ${detail.summary}`);
      console.log('');
      
      console.log(`🔍 案例解读`);
      console.log(`   ${detail.interpret}`);
      console.log('');
      
      if (detail.awards && detail.awards.length > 0) {
        console.log(`🏆 获奖情况`);
        detail.awards.forEach(award => {
          console.log(`   - ${award.awardYear} ${award.awardName} ${award.awardCategory} ${award.awardResult}`);
        });
        console.log('');
      }
      
      if (detail.assets && detail.assets.length > 0) {
        console.log(`🎬 素材信息`);
        detail.assets.forEach((asset, j) => {
          console.log(`\n   素材 ${j+1}:`);
          console.log(`   类型：${asset.assetType}`);
          console.log(`   URL: ${asset.assetUrl?.substring(0, 100)}...`);
          
          if (asset.scenes && asset.scenes.length > 0) {
            console.log(`   分镜数量：${asset.scenes.length}`);
            console.log(`   分镜详情:`);
            asset.scenes.slice(0, 5).forEach(scene => {
              console.log(`     [${scene.startSec}s-${scene.endSec}s] ${scene.sceneDesc}`);
            });
            if (asset.scenes.length > 5) {
              console.log(`     ... 还有 ${asset.scenes.length - 5} 个分镜`);
            }
          }
        });
      }
      
      console.log('\n');
      
    } catch (error) {
      console.log(`❌ 获取案例详情失败：${error.message}\n`);
    }
  }
  
  console.log('✅ 展示完成\n');
})();
