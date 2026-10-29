/**
 * 人性需求洞察技能 - 测试脚本
 */

const insight = require('./index.js');

async function runTests() {
  console.log('='.repeat(60));
  console.log('人性需求洞察技能 - 测试用例');
  console.log('='.repeat(60));
  console.log();

  // 测试用例 1: 完整 Brief - 美妆产品
  console.log('测试 1: 美妆产品 Brief（完整信息）');
  console.log('-'.repeat(40));
  const test1 = await insight.analyze({
    client_brief: '这是一款面向 25-35 岁都市女性的轻奢护肤精华，主打抗初老和提亮肤色，采用进口植物萃取成分。品牌调性希望传达优雅、自信、独立的现代女性形象。',
    product_category: '美妆护肤',
    brand_guidelines: '优雅、自信、独立'
  });
  console.log('状态:', test1.status);
  if (test1.data) {
    console.log('核心需求:', test1.data.core_need.category, '-', test1.data.core_need.detail, `(得分：${test1.data.core_need.score})`);
    console.log('次要需求:', test1.data.secondary_need.category, '-', test1.data.secondary_need.detail, `(得分：${test1.data.secondary_need.score})`);
    console.log('需求冲突:', test1.data.conflict_check.has_conflict ? '有' : '无');
    console.log('关键词:', test1.data.keywords.join(', '));
  }
  console.log();

  // 测试用例 2: 模糊 Brief - 应触发澄清问题
  console.log('测试 2: 模糊 Brief（信息缺失）');
  console.log('-'.repeat(40));
  const test2 = await insight.analyze({
    client_brief: '我们有个新产品，挺好的，想做个广告。',
    product_category: '未指定'
  });
  console.log('状态:', test2.status);
  console.log('错误代码:', test2.error_code);
  if (test2.clarification_questions && test2.clarification_questions.length > 0) {
    console.log('澄清问题:');
    test2.clarification_questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  }
  console.log();

  // 测试用例 3: 数码产品
  console.log('测试 3: 数码产品 Brief');
  console.log('-'.repeat(40));
  const test3 = await insight.analyze({
    client_brief: '这是一款旗舰智能手机，搭载最新 AI 芯片和专业级摄像头系统，面向科技爱好者和商务人士。强调性能强大、拍照出色、身份象征。',
    product_category: '数码手机',
    brand_guidelines: '创新、专业、高端'
  });
  console.log('状态:', test3.status);
  if (test3.data) {
    console.log('核心需求:', test3.data.core_need.category, '-', test3.data.core_need.detail, `(得分：${test3.data.core_need.score})`);
    console.log('次要需求:', test3.data.secondary_need.category, '-', test3.data.secondary_need.detail, `(得分：${test3.data.secondary_need.score})`);
    console.log('需求冲突:', test3.data.conflict_check.has_conflict ? '有' : '无');
    console.log('关键词:', test3.data.keywords.join(', '));
  }
  console.log();

  // 测试用例 4: 公益项目
  console.log('测试 4: 公益项目 Brief');
  console.log('-'.repeat(40));
  const test4 = await insight.analyze({
    client_brief: '这是一个乡村儿童阅读推广公益项目，希望通过捐赠图书和建设阅读空间，帮助偏远地区孩子获得更好的教育资源。倡导人人平等、知识改变命运的理念。',
    product_category: '公益教育',
    brand_guidelines: '温暖、希望、平等'
  });
  console.log('状态:', test4.status);
  if (test4.data) {
    console.log('核心需求:', test4.data.core_need.category, '-', test4.data.core_need.detail, `(得分：${test4.data.core_need.score})`);
    console.log('次要需求:', test4.data.secondary_need.category, '-', test4.data.secondary_need.detail, `(得分：${test4.data.secondary_need.score})`);
    console.log('需求冲突:', test4.data.conflict_check.has_conflict ? '有' : '无');
    console.log('关键词:', test4.data.keywords.join(', '));
  }
  console.log();

  // 测试用例 5: 工具函数测试
  console.log('测试 5: 工具函数 - 提取 Brief 信息');
  console.log('-'.repeat(40));
  const briefInfo = insight.utils.extractBriefInfo('面向年轻人的运动饮料，核心卖点是快速补充电解质，品牌调性活力四射');
  console.log('目标人群:', briefInfo.targetAudience || '未检测到');
  console.log('核心卖点:', briefInfo.coreSellingPoint || '未检测到');
  console.log('品牌调性:', briefInfo.brandTone || '未检测到');
  console.log('提取关键词:', briefInfo.keywords.slice(0, 5).join(', '));
  console.log();

  // 汇总
  console.log('='.repeat(60));
  console.log('测试完成');
  console.log('='.repeat(60));
}

runTests().catch(console.error);
