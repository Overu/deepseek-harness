/**
 * 验证搜索功能：牛奶 + 夸张
 */

const { searchCases, getCreativeMethods, queryCases } = require('../index');

(async () => {
  console.log('🔍 验证搜索功能\n');
  console.log('条件：关键词="牛奶" + 创意手法="夸张"\n');
  
  // 1. 获取创意手法列表，找到'夸张'的 ID
  console.log('1️⃣  查找创意手法：夸张');
  const methods = await getCreativeMethods();
  const kuaZhang = methods.find(m => m.tagValue === '夸张');
  
  if (kuaZhang) {
    console.log(`   ✅ 找到：ID=${kuaZhang.id}, 名称="${kuaZhang.tagValue}"`);
  } else {
    console.log('   ⚠️  未找到精确匹配，查找相关手法...');
    const related = methods.filter(m => m.tagValue.includes('夸张') || m.tagValue.includes('夸大'));
    related.slice(0, 5).forEach(m => {
      console.log(`      - ID=${m.id}, 名称="${m.tagValue}"`);
    });
    if (related.length > 0) {
      kuaZhang = related[0];
    }
  }
  
  // 2. 搜索关键词'牛奶'
  console.log('\n2️⃣  搜索关键词：牛奶');
  const milkResults = await searchCases('牛奶', { page: 1, size: 20 });
  console.log(`   ✅ 找到 ${milkResults.total} 个相关案例`);
  
  // 3. 组合筛选：牛奶 + 夸张
  if (kuaZhang) {
    console.log(`\n3️⃣  组合筛选：牛奶 + ${kuaZhang.tagValue}`);
    const filtered = await queryCases({
      keyword: '牛奶',
      creativeMethods: [kuaZhang.id],
      page: 1,
      size: 20
    });
    console.log(`   ✅ 找到 ${filtered.total} 个匹配案例\n`);
    
    if (filtered.hits.length > 0) {
      console.log('📋 案例列表:\n');
      filtered.hits.forEach((hit, i) => {
        console.log(`${i+1}. 【ID:${hit.caseId}】${hit.title}`);
        console.log(`   行业：${hit.industry}`);
        console.log(`   创意手法：${hit.creativeMethods.join(', ')}`);
        console.log(`   人性需求：${hit.humanNeeds.join(', ')}`);
        console.log(`   封面：${hit.coverUrl?.substring(0, 80)}...`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  没有找到同时满足"牛奶"和"夸张"的案例');
      console.log('   建议：查看仅包含"牛奶"的案例，然后手动筛选创意手法\n');
      
      // 显示前 5 个牛奶案例的创意手法分布
      console.log('📊 牛奶案例的创意手法分布（前 20 个）:');
      const methodCount = {};
      milkResults.hits.forEach(hit => {
        hit.creativeMethods.forEach(m => {
          methodCount[m] = (methodCount[m] || 0) + 1;
        });
      });
      Object.entries(methodCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([method, count]) => {
          console.log(`   - ${method}: ${count}个`);
        });
    }
  } else {
    console.log('   ⚠️  无法进行组合筛选\n');
  }
  
  console.log('\n✅ 验证完成\n');
})();
