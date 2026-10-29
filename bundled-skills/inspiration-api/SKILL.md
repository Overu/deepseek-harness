---
name: inspiration-api
description: 调用后端 API 实现营销案例库的按需查询与素材解析，提供完整的营销案例库访问能力（案例检索/案例详情/标签查询）
---

## ⚙️ DSH 环境适配说明

本技能原为 OpenClaw 环境编写，在 DeepSeek Harness（DSH）中使用时按以下约定适配：

- **联网检索**：统一用 DSH 官方 `web_search` 工具（替代 OpenClaw 的 Tavily Search），无需外部 API Key
- **案例/标签检索**：用 DSH 的 `inspiration-api` 技能（`gapi-test.idealead.com/material-server`）
- **媒体生成**：用 DSH 的 `media-generator` 技能（网关 `http://59.37.128.50:52667/v1/proxy`）
- **文件交付**：用 DSH 的 `artifact_save` 归入 `output/` 交付物，或用 `de_channel_send` 发送到 IM 渠道（替代 OpenClaw 的 file-uploader）
- **输出位置**：产物写入当前工作区 `output/`（替代 OpenClaw 的 `/Users/insight/.openclaw/workspace/...`）
- **本地数据/群聊日志**：原 OpenClaw 的本地数据目录与群聊日志不在 DSH 环境存在，如需引用请另行提供数据文件或从当前会话上下文读取

# Inspiration API 技能

调用后端 API 实现案例数据的按需查询，提供完整的营销案例库访问能力。

## ⚠️ 调用前必读（重要！）

**API 基础 URL：** `http://gapi-test.idealead.com/material-server`

**禁止行为：**
- ❌ 不得使用 `http://59.37.128.50:52667`（这是 Media Generator 技能的接口）
- ❌ 调用前必须阅读本 SKILL.md 确认接口地址
- ❌ 不得凭记忆调用，必须查文档

**接口区分：**
| 技能 | 基础 URL | 用途 |
|------|---------|------|
| **Inspiration API** | `http://gapi-test.idealead.com/material-server` | 案例检索、案例详情、标签查询 |
| **Media Generator** | `http://59.37.128.50:52667/v1/proxy` | 图片/视频生成 |

---

## 🔴 统计分析核心原则（红线！）

**进行案例统计分析时，必须遵守两条核心原则：**

### 原则 1：检索结果相关性验证
> 确保检索出来的结果与检索条件或用户需求相关

**执行方法：**
1. 检索后检查第 1 条案例的 `product`/`brand` 字段是否包含关键词
2. 随机抽查 3-5 条案例验证相关性
3. 如果不相关 → 调整检索条件，重新检索

### 原则 2：统计数据一致性验证
> 人性需求总数 ≥ 案例总数；创意手法总数 ≥ 案例总数

**验证公式：**
```
人性需求总数 ÷ 案例总数 ≥ 1.0  ✓
创意手法总数 ÷ 案例总数 ≥ 1.0  ✓
```

**如果验证失败 → 统计数据有误，必须重新检查！**

---

## 📋 检查清单

**每次执行案例检索统计分析时，必须逐项检查：**

- [ ] 检索后验证第 1 条案例相关性
- [ ] 随机抽查 3-5 条案例
- [ ] 分页获取全部数据（`total > 10` 时）
- [ ] 验证 `allHits.length === total`
- [ ] 统计人性需求分布
- [ ] 统计创意手法分布
- [ ] 填写验证表（人性需求总数 ≥ 案例总数）
- [ ] 填写验证表（创意手法总数 ≥ 案例总数）

**详细清单：** `CASE_RETRIEVAL_CHECKLIST.md`

## 概述

该技能封装了 `http://gapi-test.idealead.com/material-server` 的后端 API，支持：

- ✅ **动态查询** - 按需调用 API，不依赖本地静态数据
- ✅ **多维度筛选** - 行业、创意手法、人性需求、奖项等
- ✅ **分页查询** - 支持大数据量分页获取
- ✅ **案例详情** - 获取完整的案例解析，包括分镜、OCR 等
- ✅ **标签映射** - 获取行业、创意手法、人性需求的完整映射表
- ✅ **案例解析** - 提交素材进行 AI 自动解析，生成结构化数据

### API 端点

- **基础 URL**: `http://gapi-test.idealead.com/material-server`
- **标签查询**: `GET /tag/getTag?category={category}`
- **案例列表**: `POST /case/query`
- **案例详情**: `GET /case/detail?caseId={id}`
- **案例解析**: `POST /case/parse`

### 标签映射表示例

#### 行业分类
```
GET /tag/getTag?category=industry
```
```json
{
  "code": "SUCCESS",
  "msg": "操作成功",
  "data": [
    { "id": 1, "tagValue": "行业分类", "parentId": null, "depth": 1, "isLeaf": 0 },
    { "id": 2, "tagValue": "AI/互联网科技", "parentId": 1, "depth": 2, "isLeaf": 1 }
  ]
}
```

#### 创意手法
```
GET /tag/getTag?category=creative_method
```
```json
{
  "code": "SUCCESS",
  "msg": "操作成功",
  "data": [
    { "id": 274, "tagValue": "广告型创意", "parentId": null, "depth": 1, "isLeaf": 0 },
    { "id": 275, "tagValue": "消费者投射", "parentId": 274, "depth": 2, "isLeaf": 0 }
  ]
}
```

#### 人性需求
```
GET /tag/getTag?category=human_need
```
```json
{
  "code": "SUCCESS",
  "msg": "操作成功",
  "data": [
    { "id": 42, "tagValue": "生理需求", "parentId": null, "depth": 1, "isLeaf": 0 },
    { "id": 43, "tagValue": "水", "parentId": 42, "depth": 2, "isLeaf": 1 },
    { "id": 44, "tagValue": "阳光", "parentId": 42, "depth": 2, "isLeaf": 1 }
  ]
}
```

### 数据覆盖

- **行业分类**: AI/互联网科技、餐饮/食品、服装/运动、快消品、汽车/交通等
- **创意手法**: 广告型创意、消费者投射、意象化、比喻、产品示范等
- **人性需求**: 生理需求、归属感、自我实现、效率、营养等
- **奖项**: 金投赏、戛纳广告节、艾菲奖等

## 安装

```bash
cd ~/.agents/skills/inspiration-api
npm install
```

## 使用方法

### 基本用法

```javascript
const { 
  queryCases, 
  getCaseDetail, 
  getIndustries,
  getCreativeMethods,
  getHumanNeeds,
  searchCases,
  getAllCases 
} = require('./inspiration-api');

// 获取所有行业标签
const industries = await getIndustries();

// 查询案例列表（分页）
const result = await queryCases({ 
  page: 1, 
  size: 20 
});

// 获取案例详情
const detail = await getCaseDetail(123);

// 关键词搜索
const results = await searchCases('咖啡');

// 获取全部案例（自动分页，用于统计分析）
const allCases = await getAllCases({ keyword: '饼干' });
// 基于全量数据进行洞察分析
const insights = analyzeInsights(allCases);
```

### 📊 深度分析模式 - 分页获取全量数据

**重要：** API 的 `size` 参数最大值为 10，当 `total > 10` 时需要分页获取全部数据用于统计分析。

```javascript
/**
 * 分页获取全部案例（用于深度分析模式）
 * @param {Object} filters - 筛选条件（同 queryCases）
 * @returns {Promise<Array>} 全部案例列表
 */
async function getAllCases(filters = {}) {
  const pageSize = 10; // API 最大每页数量
  const firstPage = await queryCases({ ...filters, page: 1, size: pageSize });
  const total = firstPage.total;
  const allHits = [...firstPage.hits];
  
  // 计算需要获取的剩余页数
  const totalPages = Math.ceil(total / pageSize);
  
  // 分页获取剩余数据
  for (let page = 2; page <= totalPages; page++) {
    const nextPage = await queryCases({ ...filters, page, size: pageSize });
    allHits.push(...nextPage.hits);
  }
  
  return allHits;
}

/**
 * 基于全量案例数据进行洞察分析
 * @param {Array} cases - 案例列表
 * @returns {Object} 洞察统计结果
 */
function analyzeInsights(cases) {
  // 统计人性需求
  const needs = {};
  cases.forEach(c => {
    (c.humanNeeds || []).forEach(n => {
      needs[n] = (needs[n] || 0) + 1;
    });
  });
  
  // 统计创意手法
  const methods = {};
  cases.forEach(c => {
    (c.creativeMethods || []).forEach(m => {
      methods[m] = (methods[m] || 0) + 1;
    });
  });
  
  return {
    total: cases.length,
    needsDistribution: needs,
    methodsDistribution: methods
  };
}

// 使用示例：深度分析模式
const allCases = await getAllCases({ keyword: '饼干', industryId: 9 });
const insights = analyzeInsights(allCases);
console.log('总案例数:', insights.total);
console.log('人性需求分布:', insights.needsDistribution);
console.log('创意手法分布:', insights.methodsDistribution);

// 典型案例只展示前 5 条
const topCases = allCases.slice(0, 5);
for (const c of topCases) {
  const detail = await getCaseDetail(c.caseId);
  // 输出案例详情...
}
```

### 高级筛选

```javascript
// 按行业筛选
const techCases = await queryCases({ 
  industryId: 2,  // AI/互联网科技
  page: 1,
  size: 20 
});

// 按奖项筛选
const awardCases = await queryCases({
  awardName: '金投赏',
  awardResult: '金奖',
  awardYear: 2025
});

// 按创意手法筛选
const creativeCases = await queryCases({
  creativeMethods: [205],  // 创意手法 ID
  page: 1,
  size: 20
});

// 按人性需求筛选
const humanNeedCases = await queryCases({
  humanNeeds: [307],  // 人性需求 ID
  page: 1,
  size: 20
});

// 组合筛选
const filtered = await queryCases({
  industryId: 2,
  creativeMethods: [205, 206],
  humanNeeds: [307, 308],
  awardName: '戛纳广告节',
  awardYear: 2025,
  page: 1,
  size: 20
});

// 关键词搜索 + 筛选
const searchResults = await searchCases('品牌', {
  industryId: 2,
  awardYear: 2025
});
```

### 案例解析

```javascript
const { parseCase } = require('./inspiration-api');

// 提交案例素材进行解析
const result = await parseCase({
  case_id: 123,
  asset: [
    {
      asset_id: 111,
      asset_type: 'video',
      asset_url: 'http://example.com/video.mp4'
    },
    {
      asset_id: 222,
      asset_type: 'image',
      asset_url: 'http://example.com/image.png'
    }
  ]
});

// 解析结果包含：
// - case_id, industry_id, brand, product
// - selling_point, target_audience, human_needs
// - insight (消费者洞察), creative_concept, creative_methods
// - case_title, summary, interpret
// - asset[].scenes (分镜详情), asset[].ocr_text (OCR 文本)
```

### 获取筛选选项

```javascript
// 获取所有筛选选项
const options = await getFilterOptions();

console.log('行业列表:', options.industries);
console.log('创意手法:', options.creativeMethods);
console.log('人性需求:', options.humanNeeds);

// 输出格式:
// [
//   { id: 1, value: '行业分类' },
//   { id: 2, value: 'AI/互联网科技' },
//   ...
// ]
```

### 批量操作

```javascript
const { fetchAllCases, fetchCaseDetails } = require('./inspiration-api');

// 获取所有案例并保存到文件
await fetchAllCases('all-cases.json', {
  awardYear: 2025
});

// 批量获取案例详情
await fetchCaseDetails([123, 456, 789], 'case-details.json');
```

## API 参考

### 标签查询

#### `getTags(category)`

获取指定类别的标签列表。

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `category` | string | 标签类别：`industry` \| `creative_method` \| `human_need` |

**返回:** `Promise<Array>` 标签列表

**响应格式:**
```javascript
[
  {
    id: 1,
    tagValue: "行业分类",
    parentId: null,
    depth: 1,
    isLeaf: 0
  },
  {
    id: 2,
    tagValue: "AI/互联网科技",
    parentId: 1,
    depth: 2,
    isLeaf: 1
  }
]
```

#### `getIndustries()`

获取行业标签列表（叶节点）。

**返回:** `Promise<Array>` 行业列表

#### `getCreativeMethods()`

获取创意手法标签列表（叶节点）。

**返回:** `Promise<Array>` 创意手法列表

#### `getHumanNeeds()`

获取人性需求标签列表（叶节点）。

**返回:** `Promise<Array>` 人性需求列表

#### `getFilterOptions()`

获取所有筛选选项。

**返回:** `Promise<Object>`
```javascript
{
  industries: [{ id, value }, ...],
  creativeMethods: [{ id, value }, ...],
  humanNeeds: [{ id, value }, ...]
}
```

---

### 案例查询

#### `queryCases(filters)`

查询案例列表（支持分页）。

**接口:** `POST /case/query`

**请求体:**
```json
{
  "keyword": "xx",
  "industryId": 101,
  "creativeMethods": [205],
  "humanNeeds": [307],
  "awardName": "戛纳广告节",
  "awardResult": "银奖",
  "awardCategory": "xxx",
  "awardYear": 2025,
  "page": 1,
  "size": 20
}
```

**参数:**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `keyword` | string | - | 搜索关键词 |
| `industryId` | number | - | 行业 ID |
| `creativeMethods` | Array\<number\> | - | 创意手法 ID 列表 |
| `humanNeeds` | Array\<number\> | - | 人性需求 ID 列表 |
| `awardName` | string | - | 奖项名称 |
| `awardResult` | string | - | 获奖等级（金奖/银奖/铜奖） |
| `awardCategory` | string | - | 奖项类别 |
| `awardYear` | number | - | 获奖年份 |
| `page` | number | 1 | 页码 |
| `size` | number | 10 | 每页数量 |

**返回:** `Promise<Object>`
```javascript
{
  code: "SUCCESS",
  msg: "操作成功",
  data: {
    total: 23,
    from: 0,
    size: 1,
    hits: [
      {
        caseId: 153,
        caseTitle: "FreshYo 儿童节系列：流动的营养，塑就无限未来",
        industry: "非酒精饮品",
        humanNeeds: ["营养"],
        creativeMethods: ["意象化", "比喻"],
        coverUrl: "https://..."
      }
    ]
  }
}
```

**标准化返回:**
```javascript
{
  total: 23,        // 总记录数
  page: 1,          // 当前页码
  size: 20,         // 每页数量
  totalPages: 2,    // 总页数
  hits: [           // 案例列表
    {
      caseId: 153,
      title: "FreshYo 儿童节系列：流动的营养，塑就无限未来",
      industry: "非酒精饮品",
      humanNeeds: ["营养"],
      creativeMethods: ["意象化", "比喻"],
      coverUrl: "https://..."
    }
  ]
}
```

#### `getCaseDetail(caseId)`

获取案例详情。

**接口:** `GET /case/detail?caseId={id}`

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `caseId` | number | 案例 ID（通过 URL 参数传递） |

**返回:** `Promise<Object>`
```javascript
{
  caseId: 1052,
  brand: "Samsung/三星",
  industry: "消费电子设备",
  product: "Galaxy Book 笔记本电脑",
  sellingPoint: "轻薄便携设计、多设备生态互联、高性能配置、长效续航与快速充电",
  targetAudience: ["商务人士", "移动办公族", "创意工作者", "大学生"],
  humanNeeds: ["效率"],
  insight: "在移动办公普及的当下，用户不再满足于单一的电脑工具，而是渴望一种能跨越设备界限、在任何场景下都能无缝切换且高效处理事务的全新 PC 体验。",
  creativeConcept: "The new way to PC",
  creativeMethods: ["产品示范", "意象化"],
  title: "三星 Galaxy Book：开启移动办公的新生态",
  summary: "本视频是三星 Galaxy Book 的官方宣传片，通过快节奏的转场和多场景的应用展示，全方位呈现了产品在轻薄度、多设备协同、音视频交互以及性能方面的卓越表现。",
  interpret: "广告采用了极具动感的音乐与流畅的 CG 动画结合实拍。核心策略在于"生态化"，通过展示手机 App 在 PC 端运行、平板作为第二屏幕以及文件秒传等功能，成功将 Galaxy Book 定位为不仅仅是电脑，更是连接三星移动生态的核心枢纽，精准击中追求高效协同工作的现代用户痛点。",
  awards: [
    {
      awardYear: 2025,
      awardName: "Cannes 戛纳广告节",
      awardCategory: "Film 影视类",
      awardResult: "金奖"
    },
    {
      awardYear: 2025,
      awardName: "Cannes 戛纳广告节",
      awardCategory: "ENTERTAINMENT 娱乐类",
      awardResult: "铜奖"
    }
  ],
  awardYear: null,
  awardName: null,
  awardCategory: null,
  awardResult: null,
  status: "SUCCESS",
  caseType: "VIDEO",
  assets: [
    {
      assetId: 1877,
      assetType: "VIDEO",
      assetSummary: "",
      ocrText: null,
      assetUrl: "https://...",
      coverUrl: "https://...",
      scenes: [
        {
          startSec: 0,
          endSec: 2,
          sceneDesc: "视频开始，手指轻触并展示笔记本边缘，随后出现"Introducing"字样。"
        },
        {
          startSec: 2,
          endSec: 9,
          sceneDesc: "展示机身侧面，强调 15.4mm 的超薄厚度。女生单手拿着笔记本走在楼梯上，字幕显示重量仅 1.55kg，极度轻便。"
        }
      ]
    }
  ]
}
```

#### `parseCase(caseData)`

提交案例素材进行解析。

**接口:** `POST /case/parse`

**请求体:**
```json
{
  "case_id": 123,
  "asset": [
    {
      "asset_id": 111,
      "asset_type": "video",
      "asset_url": "http://erdgdfgdfg.mp4"
    },
    {
      "asset_id": 222,
      "asset_type": "image",
      "asset_url": "http://fghgjgh.png"
    }
  ]
}
```

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `caseData.case_id` | number | 案例 ID |
| `caseData.asset` | Array | 素材列表 |
| `caseData.asset[].asset_id` | number | 素材 ID |
| `caseData.asset[].asset_type` | string | 素材类型 (`video` \| `image`) |
| `caseData.asset[].asset_url` | string | 素材 URL |

**返回:** `Promise<Object>`
```javascript
{
  caseId: 123,
  industryId: 1,
  brand: "Maxim (麦馨)",
  product: "T.O.P 咖啡",
  sellingPoint: "优质的口感和体验值得人们牺牲个人空间",
  targetAudience: ["注重生活品质的都市年轻人", "经常出入酒吧社交的群体"],
  humanNeeds: [1, 2, 3],
  insight: "我们渴望在疲惫的日常中获得放松与能量，从而继续前行。",
  creativeConcept: "Worth it (Claustrobars/值得)",
  creativeMethods: [5, 6, 7],
  title: "efsdfsdfsdf",
  summary: "xxxx",
  interpret: "ghjkuyjkyukykyuk",
  assets: [
    {
      assetId: 111,
      assetType: "video",
      status: "SUCCESS",
      errMsg: "xxxx",
      scenes: [
        {
          sceneNum: 1,
          startSec: 0,
          endSec: 6,
          desc: "黑白画面。展示了职场中机械重复的生活片段，人们面无表情地在格子间工作、排队、行走，如同乐谱上的"反复记号"，被困在循环中"
        },
        {
          sceneNum: 2,
          startSec: 7,
          endSec: 11,
          desc: "主角（元斌）出现，抛起手中的咖啡罐。旁白响起："像反复记号一样的日常里""
        }
      ]
    },
    {
      assetId: 222,
      assetType: "image",
      status: "SUCCESS",
      ocrText: "Worth it；STELLA ARTOIS LOGO",
      scenes: [
        {
          desc: "黑白画面。展示了职场中机械重复的生活片段，人们面无表情地在格子间工作、排队、行走，如同乐谱上的"反复记号"，被困在循环中",
          startSec: 0,
          endSec: 0
        }
      ]
    }
  ]
}
```

#### `searchCases(keyword, options)`

关键词搜索案例。

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `keyword` | string | 搜索关键词 |
| `options` | Object | 其他筛选选项（同 `queryCases`） |

**返回:** `Promise<Object>` 案例列表（同 `queryCases`）

#### `getAllCases(filters, batchSize)`

获取所有符合条件的案例（自动分页）。

**参数:**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `filters` | Object | - | 筛选条件 |
| `batchSize` | number | 100 | 每批获取数量 |

**返回:** `Promise<Array>` 所有案例列表

---

### 批量操作

#### `fetchAllCases(outputFile, filters)`

获取所有案例并保存到文件。

**参数:**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `outputFile` | string | `'all-cases.json'` | 输出文件名 |
| `filters` | Object | `{}` | 筛选条件 |

**返回:** `Promise<Array>` 案例列表

#### `fetchCaseDetails(caseIds, outputFile)`

批量获取案例详情并保存。

**参数:**
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `caseIds` | Array\<number\> | 必填 | 案例 ID 列表 |
| `outputFile` | string | `'case-details.json'` | 输出文件名 |

**返回:** `Promise<Array>` 案例详情列表

#### `parseCase(caseData)`

提交案例素材进行解析（AI 自动解析）。

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `caseData.case_id` | number | 案例 ID |
| `caseData.asset` | Array | 素材列表 |
| `caseData.asset[].asset_id` | number | 素材 ID |
| `caseData.asset[].asset_type` | string | 素材类型 (`video` \| `image`) |
| `caseData.asset[].asset_url` | string | 素材 URL |

**返回:** `Promise<Object>` 解析结果（包含行业、品牌、卖点、洞察、创意概念、分镜等）

---

### 工具方法

#### `saveToFile(filename, data)`

保存数据到文件。

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `filename` | string | 文件名 |
| `data` | any | 数据 |

#### `getFilterOptions()`

获取筛选选项（从 API 拉取）。

**返回:** `Promise<Object>` 包含 `industries`, `creativeMethods`, `humanNeeds`

## 数据结构

### 案例对象（列表）

```javascript
{
  caseId: 153,
  title: "FreshYo 儿童节系列：流动的营养，塑就无限未来",
  industry: "非酒精饮品",
  humanNeeds: ["营养"],
  creativeMethods: ["意象化", "比喻"],
  coverUrl: "https://..."
}
```

### 案例对象（详情）

```javascript
{
  caseId: 1052,
  brand: "Samsung/三星",
  industry: "消费电子设备",
  product: "Galaxy Book 笔记本电脑",
  sellingPoint: "轻薄便携设计、多设备生态互联、高性能配置、长效续航与快速充电",
  targetAudience: ["商务人士", "移动办公族", "创意工作者", "大学生"],
  humanNeeds: ["效率"],
  insight: "在移动办公普及的当下，用户不再满足于单一的电脑工具，而是渴望一种能跨越设备界限、在任何场景下都能无缝切换且高效处理事务的全新 PC 体验。",
  creativeConcept: "The new way to PC",
  creativeMethods: ["产品示范", "意象化"],
  title: "三星 Galaxy Book：开启移动办公的新生态",
  summary: "本视频是三星 Galaxy Book 的官方宣传片，通过快节奏的转场和多场景的应用展示，全方位呈现了产品在轻薄度、多设备协同、音视频交互以及性能方面的卓越表现。",
  interpret: "广告采用了极具动感的音乐与流畅的 CG 动画结合实拍。核心策略在于"生态化"，通过展示手机 App 在 PC 端运行、平板作为第二屏幕以及文件秒传等功能，成功将 Galaxy Book 定位为不仅仅是电脑，更是连接三星移动生态的核心枢纽，精准击中追求高效协同工作的现代用户痛点。",
  awards: [
    {
      awardYear: 2025,
      awardName: "Cannes 戛纳广告节",
      awardCategory: "Film 影视类",
      awardResult: "金奖"
    }
  ],
  awardYear: null,
  awardName: null,
  awardCategory: null,
  awardResult: null,
  status: "SUCCESS",
  caseType: "VIDEO",
  assets: [
    {
      assetId: 1877,
      assetType: "VIDEO",
      assetSummary: "",
      ocrText: null,
      assetUrl: "https://...",
      coverUrl: "https://...",
      scenes: [
        {
          startSec: 0,
          endSec: 2,
          sceneDesc: "视频开始，手指轻触并展示笔记本边缘，随后出现"Introducing"字样。"
        },
        {
          startSec: 2,
          endSec: 9,
          sceneDesc: "展示机身侧面，强调 15.4mm 的超薄厚度。女生单手拿着笔记本走在楼梯上，字幕显示重量仅 1.55kg，极度轻便。"
        }
      ]
    }
  ]
}
```

### 案例解析结果

```javascript
{
  caseId: 123,
  industryId: 1,
  brand: "Maxim (麦馨)",
  product: "T.O.P 咖啡",
  sellingPoint: "优质的口感和体验值得人们牺牲个人空间",
  targetAudience: ["注重生活品质的都市年轻人", "经常出入酒吧社交的群体"],
  humanNeeds: [1, 2, 3],  // 人性需求 ID 列表
  insight: "我们渴望在疲惫的日常中获得放松与能量，从而继续前行。",
  creativeConcept: "Worth it (Claustrobars/值得)",
  creativeMethods: [5, 6, 7],  // 创意手法 ID 列表
  title: "efsdfsdfsdf",
  summary: "xxxx",
  interpret: "ghjkuyjkyukykyuk",
  assets: [
    {
      assetId: 111,
      assetType: "video",
      status: "SUCCESS",
      errMsg: "xxxx",
      scenes: [
        {
          sceneNum: 1,
          startSec: 0,
          endSec: 6,
          desc: "黑白画面。展示了职场中机械重复的生活片段，人们面无表情地在格子间工作、排队、行走，如同乐谱上的"反复记号"，被困在循环中"
        },
        {
          sceneNum: 2,
          startSec: 7,
          endSec: 11,
          desc: "主角（元斌）出现，抛起手中的咖啡罐。旁白响起："像反复记号一样的日常里""
        }
      ]
    },
    {
      assetId: 222,
      assetType: "image",
      status: "SUCCESS",
      ocrText: "Worth it；STELLA ARTOIS LOGO",
      scenes: [
        {
          desc: "黑白画面。展示了职场中机械重复的生活片段，人们面无表情地在格子间工作、排队、行走，如同乐谱上的"反复记号"，被困在循环中",
          startSec: 0,
          endSec: 0
        }
      ]
    }
  ]
}
```

### 标签对象

```javascript
{
  id: 2,
  tagValue: "AI/互联网科技",
  parentId: 1,
  depth: 2,
  isLeaf: 1  // 1=叶节点，可直接使用
}
```

## 示例脚本

### 演示用法

```bash
cd ~/.agents/skills/inspiration-api
node scripts/demo.js
```

### 获取所有案例

```bash
node -e "require('./inspiration-api').fetchAllCases('cases-2025.json', { awardYear: 2025 })"
```

### 查询案例详情

```bash
node -e "require('./inspiration-api').getCaseDetail(123).then(console.log)"
```

## 文件结构

```
inspiration-api/
├── index.js              # 主入口
├── api-client.js         # API 客户端（真实 API 调用）
├── static-data.js        # 静态案例数据（fallback）
├── package.json
├── README.md
├── SKILL.md              # 本文件
└── scripts/
    ├── demo.js           # 演示脚本
    ├── examples.js       # 使用示例
    └── ...
```

## 注意事项

1. **API 调用**: 默认调用后端 API，无需本地数据
2. **无 Token 校验**: API 已取消 token 校验，可直接调用
3. **分页查询**: 大数据量时使用 `page`/`size` 分页
4. **错误处理**: API 调用失败时抛出异常，建议用 try-catch 包裹
5. **超时设置**: 默认 30 秒超时，可根据需要调整
6. **网络依赖**: 需要网络连接才能调用 API

## 错误处理

```javascript
const { queryCases, getCaseDetail } = require('./inspiration-api');

try {
  const result = await queryCases({ page: 1, size: 20 });
  console.log('查询成功:', result);
} catch (error) {
  console.error('查询失败:', error.message);
  
  if (error.code === 'ECONNREFUSED') {
    console.log('API 服务不可用，请检查网络连接');
  } else if (error.message.includes('timeout')) {
    console.log('请求超时，请稍后重试');
  }
}
```

## 更新日志

### v2.2 (2026-03-16)
- ✅ 更新案例详情接口文档为 POST 方法 (`/case/detail?caseId={id}`)
- ✅ 完善案例详情响应格式，对齐接口文档（`caseTitle`/`caseSummary`/`caseInterpret`）
- ✅ 完善案例解析响应格式，对齐接口文档（snake_case 字段名）
- ✅ 更新分镜数据结构示例，匹配接口规范（`scene_num`/`start_sec`/`end_sec`/`desc`）
- ✅ 更新奖项数据结构示例，支持多奖项数组
- ✅ 更新文档示例数据与接口文档完全一致

### v2.1 (2026-03-13)
- ✅ 新增案例解析接口 `parseCase()`
- ✅ 修正案例详情接口为 POST 方法
- ✅ 完善资产（assets）数据结构，支持 `assetSummary`、`ocrText`、`coverUrl`
- ✅ 分镜数据结构对齐接口规范（`startSec`/`endSec`/`sceneDesc`）
- ✅ 更新文档与接口规范完全一致

### v2.0 (2026-03-13)
- ✅ 重构为真实 API 调用
- ✅ 支持案例列表分页查询
- ✅ 支持案例详情查询
- ✅ 支持标签映射查询
- ✅ 保留静态数据作为 fallback

### v1.0 (2026-03-13)
- 初始版本，基于静态数据

## 许可证

MIT

---

## 🧠 智能意图识别与输出规范

### 意图识别规则

根据用户请求的措辞和语义，自动判断输出模式：

#### 模式 A：简洁查询模式（"查询/检索"意图）

**触发关键词：**
- "查询"、"检索"、"查找"、"搜索"、"找"、"给我看"、"列出"
- 示例："为我查询新能源案例"、"检索咖啡行业的案例"、"找一些幽默创意的案例"

**输出规则：**
1. **直接展示案例详情**，无需洞察总结报告
2. **展示数量：**
   - 检索结果 **> 10 条** → 展示前 **10 条** 案例详情
   - 检索结果 **≤ 10 条** → 展示 **全部** 案例详情
3. **每个案例包含：**
   - 品牌、产品、创意概念、核心卖点、目标人群
   - **消费者洞察**（必填！）
   - 人性需求、创意手法、案例类型
   - **素材链接**（可点击文字标签，禁止直接 URL）
4. **禁止输出：** 洞察总结、创意手法分布表、创意借鉴建议等分析性内容

**输出模板：**
```markdown
## 🔍 [关键词] 案例检索结果

**总计：** X 条 | **展示：** Y 条

---

### 📹 案例 1：案例名称

| 字段 | 详情 |
|------|------|
| **品牌** | 品牌名 |
| **产品** | 产品名 |
| **创意概念** | 创意概念文字 |
| **核心卖点** | 卖点描述 |
| **目标人群** | 人群描述 |
| **消费者洞察** | 洞察文字（必填！） |
| **人性需求** | 需求类型 |
| **创意手法** | 手法列表 |
| **案例类型** | IMAGE/VIDEO/MIX |
| **📎 素材链接** | [📹 观看完整视频](URL) 或 [🖼️ 查看图片素材](URL) |

---

（继续展示其他案例...）
```

---

#### 模式 B：深度分析模式（"推荐/分析"意图）

**触发关键词：**
- "推荐"、"分析"、"解读"、"洞察"、"总结"、"有什么创意手法"、"怎么写"
- 示例："为我推荐新能源案例"、"分析咖啡行业的创意手法"、"有哪些值得借鉴的创意"

**输出规则：**
1. **完整报告格式**，包含洞察总结 + 典型案例 + 创意建议
2. **展示数量：**
   - 检索结果 **> 5 条** → 展示前 **5 条** 典型案例详情
   - 检索结果 **≤ 5 条** → 展示 **全部** 案例详情
3. **输出结构：**
   - 报告标题（含检索条件 + 总计案例数）
   - **案例洞察总结**（前置）- 创意手法分布、人性需求分布、创意概念模式、核心消费者洞察
   - **典型案例详情**（后置）- 完整案例信息
   - **创意借鉴建议**（可选）- 手法应用、品类创意方向

**输出模板：** 参考技能内 `CASE_RETRIEVAL_CHECKLIST.md` 完整规范

---

### 通用规范（所有模式适用）

#### 素材链接展示规则
- **单个素材** → 展示 1 个链接
- **多个素材** → **必须完整展示所有素材链接**，不可省略
- **格式：**
  ```
  - [📹 观看完整视频](URL)
  - [🖼️ 查看主视觉海报](URL)
  - [🖼️ 查看系列海报 2](URL)
  ```
- **表格内格式**（使用 `<br />` 换行）：
  ```markdown
  | **📎 素材链接** | <br />- [🖼️ 查看图片素材](URL1)<br />- [📹 观看完整视频](URL2)<br /> |
  ```
- **图标：** 视频用📹，图片用🖼️
- **禁止：** 直接暴露原始 URL 地址

#### 数据真实性规范
- **所有数据必须基于 API 真实返回**
- **禁止自行拓展：** 标签内容、素材地址、案例字段等必须严格使用 API 返回数据
- **禁止无中生有：** 不得编造 API 未返回的奖项、标签、链接等信息
- **字段缺失处理：** 如 API 未返回某字段（如无奖项），直接省略该字段，不显示"暂无"等占位文字

#### 案例类型筛选规则
- 用户指定"图片"→ 优先展示 `caseType="IMAGE"` 的案例
- 用户指定"视频"→ 优先展示 `caseType="VIDEO"` 的案例
- **结果少于 3 条时** → 可扩展包含混合类型（MIX）案例

---

### 意图判断示例

| 用户请求 | 意图模式 | 输出方式 |
|----------|----------|----------|
| "为我查询新能源案例" | 查询/检索 | 简洁模式，直接展示案例详情 |
| "检索咖啡行业的创意案例" | 查询/检索 | 简洁模式，直接展示案例详情 |
| "找一些幽默创意的案例给我看" | 查询/检索 | 简洁模式，直接展示案例详情 |
| "列出汽车行业的案例" | 查询/检索 | 简洁模式，直接展示案例详情 |
| "展示最近的获奖案例" | 查询/检索 | 简洁模式，直接展示案例详情 |
| "为我推荐新能源案例" | 推荐/分析 | 深度模式，含洞察总结 |
| "分析咖啡行业的创意手法" | 推荐/分析 | 深度模式，含洞察总结 |
| "有哪些值得借鉴的创意" | 推荐/分析 | 深度模式，含创意建议 |
| "这个品类有什么创意手法" | 推荐/分析 | 深度模式，含洞察总结 |
| "总结一下这个品类的创意趋势" | 推荐/分析 | 深度模式，含洞察总结 |
| "解读这些案例的消费者洞察" | 推荐/分析 | 深度模式，含洞察总结 |

---

### 代码示例（意图识别）

```javascript
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

// 使用示例
const intent = detectIntent('为我查询新能源案例');
if (intent === 'query') {
  // 简洁模式：直接展示案例详情
  const result = await searchCases('新能源', { size: 50 });
  const displayCases = result.total > 10 ? result.hits.slice(0, 10) : result.hits;
  // 输出案例详情...
} else {
  // 深度模式：完整报告格式
  const result = await searchCases('新能源', { size: 50 });
  // 输出洞察总结 + 典型案例（最多 5 条）+ 创意建议...
}
```
