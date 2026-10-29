/**
 * 从前端 JS 文件中提取内嵌的案例数据
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://test-base-platform.insight-aigc.com';

async function extractCasesFromJS() {
  console.log('📥 正在获取前端 JS 文件...\n');
  
  try {
    // 获取主页 HTML
    const htmlResponse = await axios.get(BASE_URL + '/inspiration', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    const html = htmlResponse.data;
    
    // 提取 JS 文件引用
    const jsMatches = html.match(/<script[^>]+src="([^"]+\.js)"[^>]*>/g);
    const jsFiles = [];
    
    if (jsMatches) {
      jsMatches.forEach(match => {
        const srcMatch = match.match(/src="([^"]+)"/);
        if (srcMatch) {
          jsFiles.push(srcMatch[1]);
        }
      });
    }
    
    console.log(`找到 ${jsFiles.length} 个 JS 文件:`);
    jsFiles.forEach(f => console.log(`  - ${f}`));
    
    // 获取每个 JS 文件并查找数据
    let allCases = [];
    
    for (const jsFile of jsFiles) {
      try {
        const jsUrl = jsFile.startsWith('http') ? jsFile : BASE_URL + jsFile;
        console.log(`\n📄 分析：${jsFile}`);
        
        const jsResponse = await axios.get(jsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        });
        
        const jsContent = jsResponse.data;
        
        // 查找可能的数据结构
        // 模式 1: cases:[...] 或 cases:[{...}]
        const casesMatch = jsContent.match(/cases\s*:\s*\[([\s\S]*?)\]/);
        if (casesMatch) {
          console.log('  ✅ 找到 cases 数组');
          try {
            // 尝试解析为 JSON
            const casesStr = '[' + casesMatch[1] + ']';
            const cases = JSON.parse(casesStr.replace(/'/g, '"'));
            allCases = allCases.concat(cases);
          } catch (e) {
            console.log('  ⚠️ 无法直接解析，保存原始数据');
            fs.writeFileSync(
              path.join(__dirname, '..', 'raw-cases.txt'),
              casesMatch[0]
            );
          }
        }
        
        // 模式 2: 查找对象数组
        const arrayMatch = jsContent.match(/\[\s*\{[^}]*"id"[^}]*\}(?:\s*,\s*\{[^}]*\})*\s*\]/);
        if (arrayMatch && allCases.length === 0) {
          console.log('  ✅ 找到对象数组');
          try {
            const cases = JSON.parse(arrayMatch[0]);
            if (Array.isArray(cases) && cases.length > 0) {
              allCases = cases;
            }
          } catch (e) {
            console.log('  ⚠️ 解析失败');
          }
        }
        
      } catch (error) {
        console.log(`  ❌ 获取失败：${error.message}`);
      }
    }
    
    // 保存结果
    const output = {
      extractedAt: new Date().toISOString(),
      source: BASE_URL + '/inspiration',
      totalCases: allCases.length,
      data: allCases
    };
    
    fs.writeFileSync(
      path.join(__dirname, '..', 'extracted-cases.json'),
      JSON.stringify(output, null, 2)
    );
    
    console.log(`\n✅ 提取完成！共 ${allCases.length} 个案例`);
    console.log('📁 已保存到：extracted-cases.json');
    
    return allCases;
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    throw error;
  }
}

// 运行
extractCasesFromJS().catch(console.error);
