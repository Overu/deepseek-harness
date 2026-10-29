/**
 * 调试信号检测
 */

const brief1 = '针对年轻人的新能源 SUV，突出"智能座舱"和"续航无焦虑"，调性要酷，追求社交病毒式传播';

console.log('测试 Brief:', brief1);
console.log('');

console.log('信号检测:');
console.log('  包含"社交":', brief1.includes('社交'));
console.log('  包含"病毒":', brief1.includes('病毒'));
console.log('  包含"传播":', brief1.includes('传播'));
console.log('  包含"酷":', brief1.includes('酷'));
console.log('  包含"年轻人":', brief1.includes('年轻人'));
console.log('');

console.log('socialViral 检测:', brief1.includes('社交') || brief1.includes('病毒') || brief1.includes('传播') || brief1.includes('分享'));
console.log('coolTone 检测:', brief1.includes('酷') || brief.includes('潮流') || brief.includes('时尚') || brief.includes('个性') || brief.includes('态度'));
console.log('youngAudience 检测:', brief1.includes('年轻人') || brief1.includes('青年') || brief1.includes('学生') || brief1.includes('白领') || brief1.includes('Z 世代') || brief1.includes('年轻'));
