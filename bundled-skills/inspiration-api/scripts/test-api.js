/**
 * 测试 API 接口
 * 
 * 用法:
 * node scripts/test-api.js
 */

const {
  getIndustries,
  getCreativeMethods,
  getHumanNeeds,
  queryCases,
  getCaseDetail,
  parseCase
} = require('../index');

async function runTests() {
  console.log('🧪 开始测试 Inspiration API\n');
  
  // ========== 测试 1: 获取行业标签 ==========
  console.log('1️⃣  测试：获取行业标签');
  try {
    const industries = await getIndustries();
    console.log(`   ✅ 成功获取 ${industries.length} 个行业标签`);
    console.log(`   示例：`, industries.slice(0, 3));
  } catch (error) {
    console.log(`   ❌ 失败：${error.message}`);
  }
  
  // ========== 测试 2: 获取创意手法 ==========
  console.log('\n2️⃣  测试：获取创意手法');
  try {
    const methods = await getCreativeMethods();
    console.log(`   ✅ 成功获取 ${methods.length} 个创意手法`);
    console.log(`   示例：`, methods.slice(0, 3));
  } catch (error) {
    console.log(`   ❌ 失败：${error.message}`);
  }
  
  // ========== 测试 3: 获取人性需求 ==========
  console.log('\n3️⃣  测试：获取人性需求');
  try {
    const needs = await getHumanNeeds();
    console.log(`   ✅ 成功获取 ${needs.length} 个人性需求`);
    console.log(`   示例：`, needs.slice(0, 3));
  } catch (error) {
    console.log(`   ❌ 失败：${error.message}`);
  }
  
  // ========== 测试 4: 查询案例列表 ==========
  console.log('\n4️⃣  测试：查询案例列表');
  try {
    const result = await queryCases({ page: 1, size: 5 });
    console.log(`   ✅ 成功查询，总计 ${result.total} 个案例`);
    console.log(`   当前页：${result.page}/${result.totalPages}`);
    console.log(`   示例：`, result.hits.slice(0, 2).map(h => ({
      caseId: h.caseId,
      title: h.title
    })));
  } catch (error) {
    console.log(`   ❌ 失败：${error.message}`);
  }
  
  // ========== 测试 5: 获取案例详情 ==========
  console.log('\n5️⃣  测试：获取案例详情');
  try {
    // 先查询一个案例 ID
    const listResult = await queryCases({ page: 1, size: 1 });
    if (listResult.hits.length > 0) {
      const caseId = listResult.hits[0].caseId;
      const detail = await getCaseDetail(caseId);
      console.log(`   ✅ 成功获取案例详情 (ID: ${caseId})`);
      console.log(`   标题：${detail.title}`);
      console.log(`   品牌：${detail.brand}`);
      console.log(`   资产数：${detail.assets?.length || 0}`);
      if (detail.assets?.length > 0) {
        console.log(`   第一个资产场景数：${detail.assets[0].scenes?.length || 0}`);
      }
    } else {
      console.log(`   ⚠️  无案例可查询`);
    }
  } catch (error) {
    console.log(`   ❌ 失败：${error.message}`);
  }
  
  // ========== 测试 6: 案例解析（示例） ==========
  console.log('\n6️⃣  测试：案例解析（示例请求）');
  console.log(`   ℹ️  案例解析需要提供真实的素材 URL`);
  console.log(`   示例请求格式：`);
  console.log(`   {
     case_id: 123,
     asset: [
       { asset_id: 111, asset_type: 'video', asset_url: 'http://...' },
       { asset_id: 222, asset_type: 'image', asset_url: 'http://...' }
     ]
   }`);
  
  console.log('\n✅ 测试完成\n');
}

runTests().catch(console.error);
