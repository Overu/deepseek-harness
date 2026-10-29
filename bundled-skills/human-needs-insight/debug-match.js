/**
 * 调试脚本 - 检查信号检测和子需求选择
 */

const skill = require('./index.js');

async function debugMatch() {
  const brief2 = '针对对身材不满意、希望能有效减脂塑形的 25-40 岁女性，主打"显著的减肥效果"和"养成易瘦生活习惯"，调性要激励人心';
  
  console.log('测试 Brief:', brief2);
  console.log('');
  
  // 检查关键词匹配
  console.log('关键词匹配检查:');
  console.log('  包含"减脂":', brief2.includes('减脂'));
  console.log('  包含"塑形":', brief2.includes('塑形'));
  console.log('  包含"减肥":', brief2.includes('减肥'));
  console.log('  包含"健身":', brief2.includes('健身'));
  console.log('  包含"运动":', brief2.includes('运动'));
  console.log('');
  
  // 正则匹配检查
  console.log('正则匹配检查:');
  console.log('  /运动 | 健身 | 锻炼 | 减脂 | 减肥 | 塑形/.test(brief):', /运动 | 健身 | 锻炼 | 减脂 | 减肥 | 塑形/.test(brief2));
  console.log('');
  
  // 运行完整分析
  const result = await skill.analyze({
    client_brief: brief2,
    product_category: '健身/减肥服务',
    generate_concepts: true
  });
  
  console.log('分析结果:');
  console.log('  核心需求:', result.data.core_need);
  console.log('  次要需求:', result.data.secondary_need);
  console.log('  人性需求文本:', result.data.human_needs_text);
}

debugMatch().catch(console.error);
