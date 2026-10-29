/**
 * 方便面案例分析脚本
 */

const { queryCases, getCaseDetail, getAllCases } = require('../index');

(async () => {
  console.log('🔍 检索方便面相关案例...\n');
  
  try {
    // 检索案例
    const result = await queryCases({ keyword: '方便面', page: 1, size: 50 });
    
    console.log('检索结果:', {
      total: result.total,
      page: result.page,
      size: result.size
    });
    
    // 验证第 1 条相关性
    if (result.hits && result.hits.length > 0) {
      const firstCase = result.hits[0];
      console.log('\\n第 1 条案例:', {
        brand: firstCase.brand,
        product: firstCase.product,
        relevance: (firstCase.product && firstCase.product.includes('面')) || (firstCase.brand && firstCase.brand.includes('面')) ? '✓ 相关' : '✗ 不相关'
      });
    }
    
    // 分页获取全部案例（用于统计分析）
    console.log('\\n📊 获取全部案例用于统计分析...');
    const allCases = await getAllCases({ keyword: '方便面' });
    console.log('全部案例数:', allCases.length);
    
    // 统计人性需求分布
    const needsDist = {};
    allCases.forEach(c => {
      (c.humanNeeds || []).forEach(n => {
        needsDist[n] = (needsDist[n] || 0) + 1;
      });
    });
    
    // 统计创意手法分布
    const methodsDist = {};
    allCases.forEach(c => {
      (c.creativeMethods || []).forEach(m => {
        methodsDist[m] = (methodsDist[m] || 0) + 1;
      });
    });
    
    console.log('\\n📊 人性需求分布:', needsDist);
    console.log('📊 创意手法分布:', methodsDist);
    
    // 验证统计数据一致性
    const totalNeeds = Object.values(needsDist).reduce((a, b) => a + b, 0);
    const totalMethods = Object.values(methodsDist).reduce((a, b) => a + b, 0);
    
    console.log('\\n✅ 统计数据验证:');
    console.log('人性需求总数:', totalNeeds, '>= 案例总数:', allCases.length, '?', totalNeeds >= allCases.length ? '✓' : '✗');
    console.log('创意手法总数:', totalMethods, '>= 案例总数:', allCases.length, '?', totalMethods >= allCases.length ? '✓' : '✗');
    
    // 获取前 5 条典型案例详情
    console.log('\\n📋 典型案例详情:');
    const topCases = allCases.slice(0, 5);
    for (const c of topCases) {
      const detail = await getCaseDetail(c.caseId);
      console.log('\\n---');
      console.log('品牌:', detail.brand);
      console.log('产品:', detail.product);
      console.log('创意概念:', detail.creativeConcept);
      console.log('消费者洞察:', detail.insight);
      console.log('人性需求:', detail.humanNeeds);
      console.log('创意手法:', detail.creativeMethods);
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
  }
})();
