/**
 * 演示如何使用 Inspiration API
 */

const { getCases, getCaseDetail, searchCases } = require('../index');

(async () => {
  console.log('🎯 Inspiration API 演示\n');
  console.log('=' .repeat(50));
  
  try {
    // 1. 获取所有案例
    console.log('\n📋 1. 获取所有案例...');
    const allCases = await getCases();
    console.log(`   ✅ 共 ${allCases.length} 个案例`);
    
    if (allCases.length > 0) {
      console.log('\n   前 3 个案例:');
      allCases.slice(0, 3).forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.title || c.name || '无标题'} (${c.awardYear || '?'})`);
      });
    }
    
    // 2. 按年份筛选
    console.log('\n📋 2. 按年份筛选 (2024)...');
    const cases2024 = await getCases({ awardYear: '2024' });
    console.log(`   ✅ 2024 年案例：${cases2024.length} 个`);
    
    // 3. 搜索
    console.log('\n📋 3. 搜索关键词 "创意"...');
    const searchResults = await searchCases('创意');
    console.log(`   ✅ 搜索结果：${searchResults.length} 个`);
    
    // 4. 获取详情
    if (allCases.length > 0) {
      const firstCase = allCases[0];
      const caseId = firstCase.id || firstCase._id;
      if (caseId) {
        console.log(`\n📋 4. 获取案例详情 (ID: ${caseId})...`);
        const detail = await getCaseDetail(caseId);
        console.log('   ✅ 详情获取成功');
        console.log('   ', JSON.stringify(detail, null, 2).slice(0, 300));
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ 演示完成!\n');
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error('   请检查网络连接或 API 可用性');
  }
})();
