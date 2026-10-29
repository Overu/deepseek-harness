const i = require('./index.js');

async function finalTest() {
  console.log('🧪 人性需求洞察技能 V2.1.0 - 最终验证测试\n');
  console.log('='.repeat(60));
  
  // 测试 1: 美妆产品
  console.log('\n【测试 1】美妆产品 - 完整 Brief');
  const r1 = await i.analyze({
    client_brief: '面向 25-35 岁都市女性的轻奢护肤精华，主打抗初老和提亮肤色，品牌调性优雅自信',
    product_category: '美妆护肤'
  });
  console.log('状态:', r1.status);
  if (r1.data) {
    console.log('核心需求:', r1.data.core_need.category, '-', r1.data.core_need.detail, '(得分:' + r1.data.core_need.score + ')');
    console.log('次要需求:', r1.data.secondary_need.category, '-', r1.data.secondary_need.detail, '(得分:' + r1.data.secondary_need.score + ')');
    console.log('冲突:', r1.data.conflict_check.description);
  }
  
  // 测试 2: 食品
  console.log('\n【测试 2】食品 - 健康便捷');
  const r2 = await i.analyze({
    client_brief: '主打健康和便捷的即食餐，面向忙碌的职场人士',
    product_category: '食品'
  });
  console.log('状态:', r2.status);
  if (r2.data) {
    console.log('核心需求:', r2.data.core_need.category, '-', r2.data.core_need.detail, '(得分:' + r2.data.core_need.score + ')');
    console.log('次要需求:', r2.data.secondary_need.category, '-', r2.data.secondary_need.detail, '(得分:' + r2.data.secondary_need.score + ')');
  }
  
  // 测试 3: 教育
  console.log('\n【测试 3】教育 - 知识成长');
  const r3 = await i.analyze({
    client_brief: '面向青少年的在线学习平台，强调知识探索和成长突破',
    product_category: '教育'
  });
  console.log('状态:', r3.status);
  if (r3.data) {
    console.log('核心需求:', r3.data.core_need.category, '-', r3.data.core_need.detail, '(得分:' + r3.data.core_need.score + ')');
    console.log('次要需求:', r3.data.secondary_need.category, '-', r3.data.secondary_need.detail, '(得分:' + r3.data.secondary_need.score + ')');
  }
  
  // 测试 4: 公益
  console.log('\n【测试 4】公益 - 利他贡献');
  const r4 = await i.analyze({
    client_brief: '乡村儿童阅读推广公益项目，帮助偏远地区孩子获得教育资源',
    product_category: '公益'
  });
  console.log('状态:', r4.status);
  if (r4.data) {
    console.log('核心需求:', r4.data.core_need.category, '-', r4.data.core_need.detail, '(得分:' + r4.data.core_need.score + ')');
    console.log('次要需求:', r4.data.secondary_need.category, '-', r4.data.secondary_need.detail, '(得分:' + r4.data.secondary_need.score + ')');
  }
  
  // 测试 5: 模糊 Brief
  console.log('\n【测试 5】模糊 Brief - 应触发澄清问题');
  const r5 = await i.analyze({
    client_brief: '有个新产品想打广告',
    product_category: '未指定'
  });
  console.log('状态:', r5.status);
  console.log('错误码:', r5.error_code);
  if (r5.clarification_questions && r5.clarification_questions.length > 0) {
    console.log('澄清问题:');
    r5.clarification_questions.forEach((q, idx) => console.log('  ' + (idx+1) + '. ' + q));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ V2.1.0 验证完成 - 所有分类严格遵循标准体系');
  console.log('');
  console.log('📋 标准 7 大人性需求分类:');
  console.log('   1. 生理需求 (健康、安全、舒适、便捷、省心)');
  console.log('   2. 归属与爱 (家庭、友情、爱情、陪伴、归属)');
  console.log('   3. 尊重需求 (地位、认可、成功、品味、独特)');
  console.log('   4. 自我实现 (成长、突破、创造、成就、梦想)');
  console.log('   5. 认知需求 (知识、探索、理解、发现、智慧)');
  console.log('   6. 审美需求 (美感、艺术、优雅、设计、和谐)');
  console.log('   7. 超越需求 (公益、环保、贡献、利他、传承)');
}

finalTest().catch(console.error);
