/**
 * 完整提取页面中的案例数据
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('🎯 完整提取案例数据...\n');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-web-security', '--no-sandbox']
  });
  
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  console.log('正在加载页面...');
  await page.goto('https://test-base-platform.insight-aigc.com/inspiration', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  
  await page.waitForTimeout(5000);
  
  console.log('提取案例数据...\n');
  
  // 提取所有案例卡片
  const cases = await page.evaluate(() => {
    const cases = [];
    
    // 查找所有可能的卡片容器
    const allElements = document.querySelectorAll('*');
    
    allElements.forEach(el => {
      const text = el.innerText;
      const className = el.className || '';
      
      // 查找包含案例信息的卡片
      if (text.includes('行业') || text.includes('奖项') || text.includes('人性需求')) {
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        
        // 提取结构化数据
        const caseData = {
          title: lines[0] || '',
          industry: '',
          need: '',
          technique: '',
          awardName: '',
          awardResult: '',
          awardYear: '',
          awardCategory: '',
          rawText: text.slice(0, 500)
        };
        
        lines.forEach(line => {
          if (line.includes('行业：')) caseData.industry = line.split('：')[1] || line.split(':')[1] || '';
          if (line.includes('人性需求：')) caseData.need = line.split('：')[1] || line.split(':')[1] || '';
          if (line.includes('创意手法：')) caseData.technique = line.split('：')[1] || line.split(':')[1] || '';
          if (line.includes('奖项：')) caseData.awardName = line.split('：')[1] || line.split(':')[1] || '';
          if (line.includes('获奖等级：')) caseData.awardResult = line.split('：')[1] || line.split(':')[1] || '';
          if (line.includes('获奖年份：')) caseData.awardYear = line.split('：')[1] || line.split(':')[1] || '';
          if (line.includes('奖项类别：')) caseData.awardCategory = line.split('：')[1] || line.split(':')[1] || '';
        });
        
        // 只添加有实际数据的卡片
        if (caseData.industry || caseData.awardName || caseData.need) {
          // 避免重复
          const exists = cases.some(c => c.rawText === caseData.rawText);
          if (!exists) {
            cases.push(caseData);
          }
        }
      }
    });
    
    return cases;
  });
  
  console.log(`✅ 提取到 ${cases.length} 个案例\n`);
  
  // 显示前几个案例
  console.log('案例预览:');
  cases.slice(0, 3).forEach((c, i) => {
    console.log(`\n${i + 1}. ${c.title}`);
    console.log(`   行业：${c.industry}`);
    console.log(`   人性需求：${c.need}`);
    console.log(`   创意手法：${c.technique}`);
    console.log(`   奖项：${c.awardName} ${c.awardResult} ${c.awardYear}`);
  });
  
  // 保存数据
  const output = {
    extractedAt: new Date().toISOString(),
    source: 'https://test-base-platform.insight-aigc.com/inspiration',
    totalCases: cases.length,
    data: cases
  };
  
  const outputPath = path.join(__dirname, '..', 'cases-data.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  
  console.log(`\n✅ 数据已保存到：${outputPath}`);
  
  // 统计数据
  const industries = [...new Set(cases.map(c => c.industry).filter(Boolean))];
  const years = [...new Set(cases.map(c => c.awardYear).filter(Boolean))];
  const awards = [...new Set(cases.map(c => c.awardName).filter(Boolean))];
  
  console.log('\n📊 统计:');
  console.log(`   行业 (${industries.length}): ${industries.join(', ')}`);
  console.log(`   年份 (${years.length}): ${years.sort().join(', ')}`);
  console.log(`   奖项 (${awards.length}): ${awards.join(', ')}`);
  
  await browser.close();
})();
