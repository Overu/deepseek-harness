/**
 * 意图识别测试脚本
 * 测试智能意图识别功能是否正确区分"查询"和"分析"意图
 */

/**
 * 判断用户意图类型
 * @param {string} userInput - 用户输入文本
 * @returns {'query' | 'analysis'} - 'query'=简洁查询，'analysis'=深度分析
 */
function detectIntent(userInput) {
  const queryKeywords = ['查询', '检索', '查找', '搜索', '找', '给我看', '列出', '展示'];
  const analysisKeywords = ['推荐', '分析', '解读', '洞察', '总结', '借鉴', '趋势', '怎么写', '有什么', '有哪些'];
  
  const input = userInput.toLowerCase();
  
  // 优先匹配分析意图（更具体）
  for (const keyword of analysisKeywords) {
    if (input.includes(keyword)) return 'analysis';
  }
  
  // 其次匹配查询意图
  for (const keyword of queryKeywords) {
    if (input.includes(keyword)) return 'query';
  }
  
  // 默认返回简洁查询模式
  return 'query';
}

// 测试用例
const testCases = [
  // 查询意图
  { input: '为我查询新能源案例', expected: 'query' },
  { input: '检索咖啡行业的案例', expected: 'query' },
  { input: '找一些幽默创意的案例给我看', expected: 'query' },
  { input: '列出汽车行业的案例', expected: 'query' },
  { input: '展示最近的获奖案例', expected: 'query' },
  { input: '查找食品行业的案例', expected: 'query' },
  { input: '搜索包含比喻手法的案例', expected: 'query' },
  
  // 分析意图
  { input: '为我推荐新能源案例', expected: 'analysis' },
  { input: '分析咖啡行业的创意手法', expected: 'analysis' },
  { input: '有哪些值得借鉴的创意', expected: 'analysis' },
  { input: '总结一下这个品类的创意趋势', expected: 'analysis' },
  { input: '这个品类有什么创意手法', expected: 'analysis' },
  { input: '解读这些案例的消费者洞察', expected: 'analysis' },
  
  // 默认（查询）
  { input: '新能源案例', expected: 'query' },
  { input: '看看咖啡的案例', expected: 'query' },
];

console.log('🧪 意图识别测试\n');
console.log('=' .repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach(({ input, expected }, index) => {
  const result = detectIntent(input);
  const status = result === expected ? '✅' : '❌';
  
  if (result === expected) {
    passed++;
  } else {
    failed++;
  }
  
  console.log(`${status} 测试 ${index + 1}: "${input}"`);
  console.log(`   期望：${expected} | 结果：${result}`);
  console.log('');
});

console.log('=' .repeat(60));
console.log(`\n📊 测试结果：${passed} 通过 | ${failed} 失败 | 总计：${testCases.length}`);

if (failed === 0) {
  console.log('\n🎉 所有测试通过！');
  process.exit(0);
} else {
  console.log('\n⚠️  有测试失败，请检查意图识别逻辑');
  process.exit(1);
}
