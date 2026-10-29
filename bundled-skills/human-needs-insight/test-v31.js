/**
 * V3.1 测试脚本 - 验证标注格式对齐
 * 测试人性需求、消费者洞察、创意概念的输出格式
 */

const skill = require('./index.js');

async function testV31() {
  console.log('=== Human Needs Insight V3.1 格式对齐测试 ===\n');
  
  // 测试用例 1：新能源 SUV（尊重需求 + 情感需求）
  const brief1 = '针对年轻人的新能源 SUV，突出"智能座舱"和"续航无焦虑"，调性要酷，追求社交病毒式传播';
  
  console.log('📝 测试用例 1：新能源 SUV');
  console.log('Brief:', brief1);
  console.log('');
  
  const result1 = await skill.analyze({
    client_brief: brief1,
    product_category: '汽车',
    generate_concepts: true,
    concept_count: 3
  });
  
  if (result1.status === 'Success') {
    console.log('✅ 人性需求（标注格式）:', result1.data.human_needs_text);
    console.log('✅ 消费者洞察（标注格式）:', result1.data.consumer_insight_text);
    console.log('');
    console.log('✅ 创意概念:');
    result1.data.creative_concepts.forEach((c, i) => {
      console.log(`   ${i + 1}. 【${c.concept_name}】${c.theme}`);
      console.log(`      ${c.concept.substring(0, 60)}...`);
    });
  } else {
    console.log('❌ 测试失败:', result1.clarification_questions);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // 测试用例 2：健身服务（生理需求 + 自我实现）- 参考 RIZAP 标注
  const brief2 = '针对对身材不满意、希望能有效减脂塑形的 25-40 岁女性，主打"显著的减肥效果"和"养成易瘦生活习惯"，调性要激励人心';
  
  console.log('📝 测试用例 2：健身服务（参考 RIZAP 标注）');
  console.log('Brief:', brief2);
  console.log('');
  
  const result2 = await skill.analyze({
    client_brief: brief2,
    product_category: '健身/减肥服务',
    generate_concepts: true,
    concept_count: 3
  });
  
  if (result2.status === 'Success') {
    console.log('✅ 人性需求（标注格式）:', result2.data.human_needs_text);
    console.log('✅ 消费者洞察（标注格式）:', result2.data.consumer_insight_text);
    console.log('');
    console.log('✅ 创意概念:');
    result2.data.creative_concepts.forEach((c, i) => {
      console.log(`   ${i + 1}. 【${c.concept_name}】${c.theme}`);
    });
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // 测试用例 3：医疗美容（生理需求 + 尊重需求）- 参考 Regina Clinic 标注
  const brief3 = '针对关注时尚、爱美、追求个性与自信的年轻女性，提供医疗脱毛服务，核心卖点是"通过脱毛改变自我，自信驾驭各种时尚风格"';
  
  console.log('📝 测试用例 3：医疗美容（参考 Regina Clinic 标注）');
  console.log('Brief:', brief3);
  console.log('');
  
  const result3 = await skill.analyze({
    client_brief: brief3,
    product_category: '医疗美容',
    generate_concepts: true,
    concept_count: 3
  });
  
  if (result3.status === 'Success') {
    console.log('✅ 人性需求（标注格式）:', result3.data.human_needs_text);
    console.log('✅ 消费者洞察（标注格式）:', result3.data.consumer_insight_text);
    console.log('');
    console.log('✅ 创意概念:');
    result3.data.creative_concepts.forEach((c, i) => {
      console.log(`   ${i + 1}. 【${c.concept_name}】${c.theme}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('测试完成！请检查输出是否符合标注格式：');
  console.log('- 人性需求：[大类别]：[子需求]；[大类别 2]：[子需求 2]');
  console.log('- 消费者洞察：一句话 20-60 字，描述深层动机/痛点');
  console.log('- 创意概念：简洁口号式名称（5-20 字）+ 执行方向');
}

testV31().catch(console.error);
