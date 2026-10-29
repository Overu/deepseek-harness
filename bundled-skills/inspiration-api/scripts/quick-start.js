/**
 * Inspiration API 快速入门
 * 5 分钟上手案例查询 API
 */

const api = require('../index');

(async () => {
  console.log('🚀 Inspiration API 快速入门\n');
  console.log('='.repeat(50));

  // 1. 获取筛选选项
  console.log('\n1️⃣  获取筛选选项...');
  const options = await api.getFilterOptions();
  console.log(`   ✅ 行业：${options.industries.length} 个`);
  console.log(`   ✅ 创意手法：${options.creativeMethods.length} 个`);
  console.log(`   ✅ 人性需求：${options.humanNeeds.length} 个`);

  // 2. 查询案例列表
  console.log('\n2️⃣  查询案例列表...');
  const result = await api.queryCases({ page: 1, size: 3 });
  console.log(`   ✅ 总案例数：${result.total}`);
  console.log(`   ✅ 显示 ${result.hits.length} 条:\n`);
  result.hits.forEach((hit, i) => {
    console.log(`   ${i + 1}. ${hit.title}`);
    console.log(`      行业：${hit.industry}`);
  });

  // 3. 获取案例详情
  console.log('\n3️⃣  获取案例详情...');
  const detail = await api.getCaseDetail(result.hits[0].caseId);
  console.log(`   ✅ 品牌：${detail.brand}`);
  console.log(`   ✅ 产品：${detail.product}`);
  console.log(`   ✅ 创意概念：${detail.creativeConcept}`);
  console.log(`   ✅ 分镜数量：${detail.assets?.[0]?.scenes?.length || 0}`);

  // 4. 关键词搜索
  console.log('\n4️⃣  关键词搜索 "咖啡"...');
  const searchResult = await api.searchCases('咖啡', { size: 2 });
  console.log(`   ✅ 找到 ${searchResult.total} 个相关案例`);
  searchResult.hits.forEach(hit => {
    console.log(`      - ${hit.title}`);
  });

  // 5. 组合筛选
  console.log('\n5️⃣  组合筛选（2025 年 + 金奖）...');
  const filtered = await api.queryCases({
    awardYear: 2025,
    awardResult: '金奖',
    size: 2
  });
  console.log(`   ✅ 找到 ${filtered.total} 个金奖案例`);
  filtered.hits.forEach(hit => {
    console.log(`      - ${hit.title}`);
  });

  console.log('\n' + '='.repeat(50));
  console.log('✨ 快速入门完成！\n');
  console.log('📖 更多用法查看 SKILL.md 或运行 node scripts/api-demo.js');
  console.log();
})();
