/**
 * 人性需求洞察技能 V3.0.0 测试脚本
 * 测试新功能：消费者洞察、创意概念生成、创意概念打磨
 */

const insight = require('./index.js');

async function testV3() {
  console.log('=== 人性需求洞察技能 V3.0.0 测试 ===\n');
  
  const testBrief = {
    client_brief: '针对年轻人的新能源 SUV，突出"智能座舱"和"续航无焦虑"，调性要酷，追求社交病毒式传播',
    product_category: '汽车',
    generate_concepts: true,
    concept_count: 3
  };
  
  console.log('输入 Brief:');
  console.log(testBrief.client_brief);
  console.log('');
  
  const result = await insight.analyze(testBrief);
  
  if (result.status === 'Success') {
    console.log('✅ 分析成功\n');
    
    console.log('--- 核心需求 ---');
    console.log(`${result.data.core_need.category} - ${result.data.core_need.detail} (得分：${result.data.core_need.score})`);
    console.log(`理由：${result.data.core_need.reason}\n`);
    
    console.log('--- 次要需求 ---');
    console.log(`${result.data.secondary_need.category} - ${result.data.secondary_need.detail} (得分：${result.data.secondary_need.score})`);
    console.log(`理由：${result.data.secondary_need.reason}\n`);
    
    console.log('--- 消费者洞察 ---');
    console.log(`核心洞察：${result.data.consumer_insight.core_insight}\n`);
    console.log(`次要洞察：${result.data.consumer_insight.secondary_insight}\n`);
    console.log(`总结：${result.data.consumer_insight.insight_summary}\n`);
    
    console.log(`--- 创意概念 (共${result.data.creative_concepts.length}条) ---\n`);
    result.data.creative_concepts.forEach((concept, index) => {
      console.log(`【创意 ${index + 1}】${concept.theme}`);
      console.log(`概念：${concept.concept}`);
      console.log('执行创意:');
      concept.execution_ideas.forEach((idea, i) => {
        console.log(`  ${i + 1}. ${idea}`);
      });
      console.log(`状态：${concept.status}`);
      console.log('');
    });
    
    console.log('--- 测试创意概念打磨 ---\n');
    const firstConceptId = result.data.creative_concepts[0].concept_id;
    const feedback = '这个创意太保守了，需要更大胆一些，目标人群是 Z 世代';
    
    const refineResult = insight.utils.refineCreativeConcept(
      result.data.creative_concepts,
      firstConceptId,
      feedback,
      { target_audience: 'Z 世代', brand_tone: '大胆前卫' }
    );
    
    if (refineResult.success) {
      console.log('✅ 打磨成功');
      console.log(`优化建议数量：${refineResult.refined_concept.refinement_suggestions.length}`);
      refineResult.refined_concept.refinement_suggestions.forEach((suggestion, i) => {
        console.log(`  ${i + 1}. [${suggestion.priority}] ${suggestion.type}: ${suggestion.suggestion}`);
      });
      console.log(`打磨后状态：${refineResult.refined_concept.status}`);
      console.log(`反馈历史条数：${refineResult.refined_concept.feedback_history.length}\n`);
    } else {
      console.log('❌ 打磨失败:', refineResult.error);
    }
    
    console.log('=== 测试完成 ===');
  } else {
    console.log('❌ 分析失败');
    console.log(`错误码：${result.error_code}`);
    console.log(`澄清问题：${result.clarification_questions.join(', ')}`);
  }
}

testV3().catch(console.error);
