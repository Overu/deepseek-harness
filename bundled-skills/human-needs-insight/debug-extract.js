const skill = require('./index.js');

const brief3 = '针对关注时尚、爱美、追求个性与自信的年轻女性，提供医疗脱毛服务，核心卖点是"通过脱毛改变自我，自信驾驭各种时尚风格"';

console.log('测试 Brief:', brief3);
console.log('');

// 手动测试 extractBriefInfo 逻辑
const sellingKeywords = ['突出', '主打', '核心卖点', '优势', '卖点是'];

for (const keyword of sellingKeywords) {
  const idx = brief3.indexOf(keyword);
  console.log(`关键词 "${keyword}": 位置 = ${idx}`);
  if (idx !== -1) {
    const start = idx + keyword.length;
    console.log(`  提取起点：${start}`);
    console.log(`  提取内容："${brief3.substring(start, start + 50)}"`);
  }
}
