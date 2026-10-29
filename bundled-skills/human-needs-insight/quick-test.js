/**
 * 快速测试 - 人性需求洞察技能
 */

const insight = require('./index.js');

async function quickTest() {
  console.log('🧪 人性需求洞察技能 - 快速测试\n');
  
  // 测试 1: 完整的美妆产品 Brief
  console.log('📝 测试 1: 美妆产品 Brief');
  console.log('输入：面向 25-35 岁都市女性的轻奢护肤精华，主打抗初老和提亮肤色，采用进口植物萃取成分');
  console.log('');
  
  const result1 = await insight.analyze({
    client_brief: '这是一款面向 25-35 岁都市女性的轻奢护肤精华，主打抗初老和提亮肤色，采用进口植物萃取成分。品牌调性希望传达优雅、自信、独立的现代女性形象。',
    product_category: '美妆护肤'
  });
  
  console.log('状态:', result1.status);
  console.log('错误代码:', result1.error_code);
  
  if (result1.data) {
    console.log('\n✅ 洞察结果:');
    console.log('  核心需求:', result1.data.core_need.category, '-', result1.data.core_need.detail);
    console.log('  得分:', result1.data.core_need.score);
    console.log('  原因:', result1.data.core_need.reason);
    console.log('');
    console.log('  次要需求:', result1.data.secondary_need.category, '-', result1.data.secondary_need.detail);
    console.log('  得分:', result1.data.secondary_need.score);
    console.log('');
    console.log('  需求冲突:', result1.data.conflict_check.has_conflict ? '⚠️ 有' : '✅ 无');
    if (result1.data.conflict_check.has_conflict) {
      console.log('  冲突描述:', result1.data.conflict_check.description);
      console.log('  解决策略:', result1.data.conflict_check.solution);
    }
    console.log('');
    console.log('  关键词:', result1.data.keywords.join(', '));
  } else if (result1.clarification_questions && result1.clarification_questions.length > 0) {
    console.log('\n❓ 需要澄清的问题:');
    result1.clarification_questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // 测试 2: 模糊 Brief
  console.log('📝 测试 2: 模糊 Brief（应触发澄清问题）');
  console.log('输入：我们有个新产品，挺好的，想做个广告。');
  console.log('');
  
  const result2 = await insight.analyze({
    client_brief: '我们有个新产品，挺好的，想做个广告。',
    product_category: '未指定'
  });
  
  console.log('状态:', result2.status);
  console.log('错误代码:', result2.error_code);
  
  if (result2.clarification_questions && result2.clarification_questions.length > 0) {
    console.log('\n❓ 澄清问题:');
    result2.clarification_questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // 测试 3: 数码产品
  console.log('📝 测试 3: 数码产品 Brief');
  console.log('输入：旗舰智能手机，搭载最新 AI 芯片和专业级摄像头，面向科技爱好者和商务人士');
  console.log('');
  
  const result3 = await insight.analyze({
    client_brief: '这是一款旗舰智能手机，搭载最新 AI 芯片和专业级摄像头系统，面向科技爱好者和商务人士。强调性能强大、拍照出色、身份象征。',
    product_category: '数码手机'
  });
  
  console.log('状态:', result3.status);
  
  if (result3.data) {
    console.log('\n✅ 洞察结果:');
    console.log('  核心需求:', result3.data.core_need.category, '-', result3.data.core_need.detail, `(得分：${result3.data.core_need.score})`);
    console.log('  次要需求:', result3.data.secondary_need.category, '-', result3.data.secondary_need.detail, `(得分：${result3.data.secondary_need.score})`);
    console.log('  关键词:', result3.data.keywords.join(', '));
  }
  
  console.log('\n✅ 测试完成！');
}

quickTest().catch(console.error);
