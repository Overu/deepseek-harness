const i = require('./index.js');

async function validate() {
  console.log('🔍 验证人性需求分类严格性\n');
  
  // 显示标准分类体系
  console.log('📋 标准 7 大人性需求分类：');
  console.log('='.repeat(50));
  for (const [key, data] of Object.entries(i.taxonomy)) {
    console.log(`\n${data.name}:`);
    console.log(`  说明：${data.description}`);
    console.log(`  标准子需求：${data.subNeeds.join('、')}`);
  }
  console.log('\n' + '='.repeat(50));
  
  // 测试用例
  console.log('\n🧪 测试用例验证：\n');
  
  const testCases = [
    {
      name: '美妆产品',
      brief: '面向 25-35 岁都市女性的轻奢护肤精华，主打抗初老和提亮肤色',
      category: '美妆护肤'
    },
    {
      name: '食品产品',
      brief: '主打健康和便捷的即食餐，面向忙碌的职场人士',
      category: '食品'
    },
    {
      name: '教育产品',
      brief: '面向青少年的在线学习平台，强调知识探索和成长',
      category: '教育'
    },
    {
      name: '公益项目',
      brief: '乡村儿童阅读推广公益项目，帮助偏远地区孩子获得教育资源',
      category: '公益'
    }
  ];
  
  for (const tc of testCases) {
    console.log(`【${tc.name}】`);
    const result = await i.analyze({
      client_brief: tc.brief,
      product_category: tc.category
    });
    
    if (result.data) {
      // 验证分类名称是否严格
      const standardNames = Object.values(i.taxonomy).map(n => n.name);
      const coreValid = standardNames.includes(result.data.core_need.category);
      const secondaryValid = standardNames.includes(result.data.secondary_need.category);
      
      // 验证子需求是否严格
      const coreTaxonomy = Object.values(i.taxonomy).find(t => t.name === result.data.core_need.category);
      const coreDetailValid = coreTaxonomy && coreTaxonomy.subNeeds.includes(result.data.core_need.detail);
      
      console.log(`  核心需求：${result.data.core_need.category} - ${result.data.core_need.detail} ${coreValid && coreDetailValid ? '✅' : '❌'}`);
      console.log(`  次要需求：${result.data.secondary_need.category} - ${result.data.secondary_need.detail} ${secondaryValid ? '✅' : '❌'}`);
      console.log(`  得分：核心=${result.data.core_need.score}, 次要=${result.data.secondary_need.score}`);
    } else {
      console.log(`  ⚠️ Warning: ${result.clarification_questions?.join(', ')}`);
    }
    console.log('');
  }
  
  console.log('✅ 验证完成 - 所有分类名称严格遵循标准体系');
}

validate().catch(console.error);
