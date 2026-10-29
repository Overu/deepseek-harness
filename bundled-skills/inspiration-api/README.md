# Inspiration API 封装

调用后端 API 实现营销案例库的按需查询、素材解析。

## 安装

```bash
cd ~/.agents/skills/inspiration-api
npm install
```

## 快速开始

```javascript
const { 
  queryCases, 
  getCaseDetail, 
  getIndustries,
  getCreativeMethods,
  getHumanNeeds,
  parseCase,
  searchCases 
} = require('./inspiration-api');

// 获取筛选选项
const options = await getFilterOptions();

// 查询案例（按行业筛选）
const result = await queryCases({
  industryId: 2,  // AI/互联网科技
  awardYear: 2025,
  page: 1,
  size: 20
});

// 获取详情
const detail = await getCaseDetail(result.hits[0].caseId);

// 搜索
const results = await searchCases('咖啡');

// 案例解析（提交素材进行 AI 解析）
const parsed = await parseCase({
  case_id: 123,
  asset: [
    { asset_id: 111, asset_type: 'video', asset_url: 'http://...' },
    { asset_id: 222, asset_type: 'image', asset_url: 'http://...' }
  ]
});
```

## API 方法

### 标签查询

- `getTags(category)` - 获取标签列表
- `getIndustries()` - 获取行业列表
- `getCreativeMethods()` - 获取创意手法列表
- `getHumanNeeds()` - 获取人性需求列表
- `getFilterOptions()` - 获取所有筛选选项

### 案例查询

- `queryCases(filters)` - 查询案例列表（分页）
- `getCaseDetail(caseId)` - 获取案例详情
- `searchCases(keyword, options)` - 关键词搜索
- `getAllCases(filters, batchSize)` - 获取所有案例

### 案例解析

- `parseCase(caseData)` - 提交素材进行 AI 解析

### 批量操作

- `fetchAllCases(outputFile, filters)` - 获取所有案例并保存
- `fetchCaseDetails(caseIds, outputFile)` - 批量获取详情

## 筛选参数

```javascript
{
  keyword: "xx",           // 关键词
  industryId: 101,         // 行业 ID
  creativeMethods: [205],  // 创意手法 ID 列表
  humanNeeds: [307],       // 人性需求 ID 列表
  awardName: "戛纳广告节",  // 奖项名称
  awardResult: "银奖",     // 获奖等级
  awardCategory: "xxx",    // 奖项类别
  awardYear: 2025,         // 获奖年份
  page: 1,                 // 页码
  size: 20                 // 每页数量
}
```

## 案例解析参数

```javascript
{
  case_id: 123,
  asset: [
    {
      asset_id: 111,
      asset_type: 'video',  // 或 'image'
      asset_url: 'http://example.com/video.mp4'
    }
  ]
}
```

## API 端点

- 基础 URL: `http://gapi-test.idealead.com/material-server`
- 标签查询：`GET /tag/getTag?category={category}`
- 案例列表：`POST /case/query`
- 案例详情：`GET /case/detail?caseId={id}`
- 案例解析：`POST /case/parse`

## 测试与示例

```bash
# 运行 API 测试
node scripts/test-api.js

# 运行使用示例
node scripts/examples.js
```

## 注意事项

1. API 已取消 token 校验，可直接调用
2. 需要网络连接
3. 建议处理异常情况

## 完整文档

详见 [SKILL.md](./SKILL.md)
