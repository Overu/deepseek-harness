const i = require('./index.js');

async function test() {
  console.log('🧪 人性需求洞察技能测试\n');
  
  // 测试 1
  console.log('【测试 1】美妆产品');
  const r1 = await i.analyze({
    client_brief: '面向 25-35 岁都市女性的轻奢护肤精华，主打抗初老和提亮肤色',
    product_category: '美妆护肤'
  });
  console.log('状态:', r1.status);
  if (r1.data) {
    console.log('核心需求:', r1.data.core_need.category, r1.data.core_need.detail, '(得分:' + r1.data.core_need.score + ')');
    console.log('次要需求:', r1.data.secondary_need.category, r1.data.secondary_need.detail, '(得分:' + r1.data.secondary_need.score + ')');
    console.log('关键词:', r1.data.keywords.join(', '));
  } else if (r1.clarification_questions) {
    console.log('澄清问题:', r1.clarification_questions);
  }
  console.log('');
  
  // 测试 2
  console.log('【测试 2】数码产品');
  const r2 = await i.analyze({
    client_brief: '旗舰智能手机，搭载 AI 芯片，面向科技爱好者和商务人士，强调性能强大',
    product_category: '数码手机'
  });
  console.log('状态:', r2.status);
  if (r2.data) {
    console.log('核心需求:', r2.data.core_need.category, r2.data.core_need.detail, '(得分:' + r2.data.core_need.score + ')');
    console.log('次要需求:', r2.data.secondary_need.category, r2.data.secondary_need.detail, '(得分:' + r2.data.secondary_need.score + ')');
    console.log('冲突:', r2.data.conflict_check.description);
  }
  console.log('');
  
  // 测试 3
  console.log('【测试 3】模糊 Brief');
  const r3 = await i.analyze({
    client_brief: '有个新产品想打广告',
    product_category: '未指定'
  });
  console.log('状态:', r3.status);
  console.log('错误码:', r3.error_code);
  if (r3.clarification_questions && r3.clarification_questions.length > 0) {
    console.log('澄清问题:');
    r3.clarification_questions.forEach((q, idx) => console.log('  ' + (idx+1) + '. ' + q));
  }
  console.log('');
  console.log('✅ 测试完成');
}

test().catch(console.error);
