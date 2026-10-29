/**
 * 使用浏览器提取页面中的数据
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('🎯 使用浏览器提取数据...\n');
  
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
  
  await page.waitForTimeout(3000);
  
  console.log('页面加载完成，提取数据...\n');
  
  // 1. 获取页面中的所有文本内容
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log(`页面文本长度：${pageText.length}`);
  
  // 2. 获取所有 script 标签内容
  const scripts = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script');
    const contents = [];
    scripts.forEach(s => {
      if (s.textContent.length > 100) {
        contents.push({
          src: s.src,
          content: s.textContent.slice(0, 2000)
        });
      }
    });
    return contents;
  });
  
  console.log(`找到 ${scripts.length} 个有内容的 script 标签\n`);
  
  // 3. 查找数据模式
  const allCases = [];
  
  for (const script of scripts) {
    const content = script.content;
    
    // 查找数组模式
    const arrayMatch = content.match(/\[\s*\{[^}]*"id"[^}]*\}(?:\s*,\s*\{[^}]*\})*\s*\]/);
    if (arrayMatch) {
      try {
        const data = JSON.parse(arrayMatch[0]);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`✅ 从 ${script.src || 'inline'} 找到 ${data.length} 条数据`);
          allCases.push(...data);
        }
      } catch (e) {}
    }
  }
  
  // 4. 获取页面中渲染的卡片内容
  const cards = await page.evaluate(() => {
    const cards = [];
    // 查找可能的卡片元素
    const selectors = [
      '.inspiration-card',
      '.case-card', 
      '.card',
      '[class*="card"]',
      '[class*="case"]',
      '[class*="inspiration"]'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const text = el.innerText;
        if (text.length > 10 && text.length < 500) {
          cards.push(text.split('\n').slice(0, 5).join(' | '));
        }
      });
      if (cards.length > 0) break;
    }
    
    return cards.slice(0, 10);
  });
  
  if (cards.length > 0) {
    console.log(`\n📋 页面中的案例卡片 (${cards.length}):`);
    cards.forEach((c, i) => console.log(`   ${i + 1}. ${c.slice(0, 80)}...`));
  }
  
  // 5. 保存所有提取的数据
  const output = {
    extractedAt: new Date().toISOString(),
    url: 'https://test-base-platform.insight-aigc.com/inspiration',
    pageTextLength: pageText.length,
    scriptsCount: scripts.length,
    casesFound: allCases.length,
    cardsPreview: cards,
    scripts: scripts.map(s => ({ src: s.src, length: s.content.length })),
    data: allCases
  };
  
  const outputPath = path.join(__dirname, '..', 'browser-extract.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  
  console.log(`\n✅ 数据已保存到：${outputPath}`);
  console.log(`   - 找到 ${allCases.length} 条结构化数据`);
  console.log(`   - 找到 ${cards.length} 个卡片预览`);
  
  await browser.close();
})();
