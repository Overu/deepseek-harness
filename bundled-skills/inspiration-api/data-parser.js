/**
 * 从前端 JS 文件中解析内嵌的案例数据
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://test-base-platform.insight-aigc.com';

/**
 * 从 JS 内容中提取案例数据
 */
function parseCasesFromJS(jsContent) {
  const cases = [];
  
  // 模式 1: 查找变量赋值中的数组
  // 例如：const cases = [...] 或 var t = [...]
  const arrayPatterns = [
    /cases\s*=\s*(\[[\s\S]*?\])(?:;|\n)/,
    /const\s+\w+\s*=\s*(\[[\s\S]*?\{[^}]*industry[^}]*\}[\s\S]*?\])/,
    /var\s+\w+\s*=\s*(\[[\s\S]*?\{[^}]*industry[^}]*\}[\s\S]*?\])/
  ];
  
  for (const pattern of arrayPatterns) {
    const match = jsContent.match(pattern);
    if (match) {
      try {
        // 清理 JavaScript 语法，转换为有效 JSON
        let jsonStr = match[1]
          .replace(/'/g, '"')  // 单引号转双引号
          .replace(/(\w+):/g, '"$1":')  // 键名加引号
          .replace(/,\s*]/g, ']')  // 移除末尾逗号
          .replace(/,\s*}/g, '}')
          .replace(/\/\/[^\n]*/g, '')  // 移除注释
          .trim();
        
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        console.log('JSON 解析失败，尝试其他方式...');
      }
    }
  }
  
  // 模式 2: 查找对象字面量
  const objectPattern = /\{[^{}]*"id"[^{}]*"industry"[^{}]*\}/g;
  const objects = jsContent.match(objectPattern);
  if (objects) {
    for (const objStr of objects) {
      try {
        const obj = JSON.parse(objStr);
        if (obj.id) {
          cases.push(obj);
        }
      } catch (e) {}
    }
  }
  
  return cases;
}

/**
 * 获取并解析案例数据
 */
async function fetchAndParseCases() {
  console.log('📥 获取前端资源...\n');
  
  try {
    // 1. 获取 HTML
    console.log('1. 获取 HTML 页面...');
    const htmlResponse = await axios.get(BASE_URL + '/inspiration', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html'
      },
      timeout: 15000
    });
    
    const html = htmlResponse.data;
    console.log(`   ✅ HTML 大小：${html.length} 字节`);
    
    // 2. 提取 JS 文件引用
    console.log('\n2. 提取 JS 文件...');
    const jsSrcMatches = html.match(/<script[^>]+src="([^"]+)"[^>]*>/g) || [];
    const jsFiles = [];
    
    jsSrcMatches.forEach(match => {
      const srcMatch = match.match(/src="([^"]+)"/);
      if (srcMatch) {
        const src = srcMatch[1];
        if (src.includes('.js')) {
          jsFiles.push(src.startsWith('http') ? src : BASE_URL + src);
        }
      }
    });
    
    console.log(`   ✅ 找到 ${jsFiles.length} 个 JS 文件`);
    jsFiles.forEach(f => console.log(`      - ${f}`));
    
    // 3. 获取每个 JS 文件并解析
    console.log('\n3. 解析 JS 文件中的数据...');
    let allCases = [];
    
    for (const jsUrl of jsFiles) {
      try {
        const jsResponse = await axios.get(jsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          },
          timeout: 10000
        });
        
        const jsContent = jsResponse.data;
        console.log(`\n   📄 ${jsUrl.split('/').pop()} (${jsContent.length} 字节)`);
        
        // 查找包含案例数据的模式
        const cases = parseCasesFromJS(jsContent);
        if (cases.length > 0) {
          console.log(`      ✅ 找到 ${cases.length} 个案例`);
          allCases = allCases.concat(cases);
        }
        
        // 备用：查找内联 JSON 数据
        const jsonMatch = jsContent.match(/window\.__INITIAL_DATA__\s*=\s*({[\s\S]*?});?/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            if (data.cases && Array.isArray(data.cases)) {
              console.log(`      ✅ 找到 __INITIAL_DATA__.cases: ${data.cases.length} 个`);
              allCases = allCases.concat(data.cases);
            }
          } catch (e) {}
        }
        
      } catch (error) {
        console.log(`   ❌ 获取失败：${error.message}`);
      }
    }
    
    // 4. 保存结果
    console.log('\n4. 保存数据...');
    const output = {
      extractedAt: new Date().toISOString(),
      source: BASE_URL + '/inspiration',
      totalCases: allCases.length,
      uniqueIndustries: [...new Set(allCases.map(c => c.industry).filter(Boolean))],
      uniqueAwardYears: [...new Set(allCases.map(c => c.awardYear).filter(Boolean))],
      data: allCases
    };
    
    const outputPath = path.join(__dirname, 'extracted-cases.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    
    console.log(`   ✅ 已保存到：${outputPath}`);
    console.log(`\n📊 统计:`);
    console.log(`   - 总案例数：${allCases.length}`);
    console.log(`   - 行业数：${output.uniqueIndustries.length}`);
    console.log(`   - 年份范围：${output.uniqueAwardYears.sort().join(', ') || '未知'}`);
    
    return allCases;
    
  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    throw error;
  }
}

// 运行
if (require.main === module) {
  fetchAndParseCases().catch(console.error);
}

module.exports = { parseCasesFromJS, fetchAndParseCases };
