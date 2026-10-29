/**
 * 标注文件分析脚本
 * 读取 D:\0 因赛集团\人工审核 - 标注版本 中的标注文件
 * 提取人性需求、消费者洞察、创意概念数据
 */

const fs = require('fs');
const path = require('path');

// 使用 glob 模式查找文件
const { execSync } = require('child_process');

console.log('正在扫描标注文件...\n');

try {
  // 通过 dir 命令获取文件列表
  const dirOutput = execSync('dir "D:\\0*集团\\人*审核*" /b', { encoding: 'utf8', shell: 'cmd' });
  const files = dirOutput.split('\r\n').filter(f => f.endsWith('.md')).slice(0, 10);
  
  console.log(`找到 ${files.length} 个标注文件\n`);
  
  const annotations = [];
  
  for (const file of files) {
    try {
      const fullPath = path.join('D:\\0 因赛集团\\人工审核 - 标注版本', file);
      const content = fs.readFileSync(fullPath, 'utf8');
      
      // 提取关键信息
      const extract = (key) => {
        const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i');
        const match = content.match(regex);
        return match ? match[1] : null;
      };
      
      const annotation = {
        file,
        industry: extract('行业/品类'),
        brand: extract('品牌'),
        humanNeeds: extract('人性需求'),
        consumerInsight: extract('消费者洞察'),
        creativeConcept: extract('创意概念')
      };
      
      annotations.push(annotation);
      console.log(`✅ ${file}`);
      console.log(`   品类：${annotation.industry || 'N/A'}`);
      console.log(`   品牌：${annotation.brand || 'N/A'}`);
      console.log(`   需求：${annotation.humanNeeds || 'N/A'}`);
      console.log('');
      
    } catch (err) {
      console.log(`❌ ${file}: ${err.message}`);
    }
  }
  
  // 生成分析报告
  const report = `# 标注数据分析报告

生成时间：${new Date().toISOString()}

## 样本概览

共分析 ${annotations.length} 个标注样本

## 数据明细

| 文件名 | 品类 | 品牌 | 人性需求 | 消费者洞察 | 创意概念 |
|--------|------|------|----------|------------|----------|
${annotations.map(a => `| ${a.file} | ${a.industry || '-'} | ${a.brand || '-'} | ${a.humanNeeds || '-'} | ${a.consumerInsight ? a.consumerInsight.substring(0, 20) + '...' : '-'} | ${a.creativeConcept || '-'} |`).join('\n')}

## 需求类别统计

${annotations.reduce((acc, a) => {
  if (a.humanNeeds) {
    const needs = a.humanNeeds.split(/[;,]/).map(n => n.trim());
    needs.forEach(n => { acc[n] = (acc[n] || 0) + 1; });
  }
  return acc;
}, {})
}

## 优化建议

基于标注数据，技能输出需要：
1. 人性需求格式：[大类别]：[子需求]（如：生理需求：健康）
2. 消费者洞察：一句话描述消费者的深层动机/痛点
3. 创意概念：简洁的主题口号 + 执行方向

`;

  fs.writeFileSync('annotations-analysis.md', report, 'utf8');
  console.log('📄 分析报告已保存到：annotations-analysis.md');
  
} catch (err) {
  console.error('错误:', err.message);
}
