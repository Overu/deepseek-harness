# 优化记录

## v3.1 - 2026-03-16：多素材链接完整展示修复

### 修复内容

修复简洁查询模式下多素材案例只显示 1 个链接的问题，现在**完整展示所有素材链接**。

**修复前：** 案例有 6 个素材，只展示第 1 个  
**修复后：** 案例有 6 个素材，完整展示全部 6 个链接

**表格内格式：** 使用 `<br />` 实现换行，确保所有链接在同一单元格内垂直排列

---

## v3.0 - 2026-03-16：智能意图识别

### 核心变更

新增**智能意图识别**功能，根据用户请求的措辞自动切换输出模式。

#### 双模式输出

**模式 A：简洁查询模式**
- 触发词："查询"、"检索"、"查找"、"搜索"、"找"、"给我看"、"列出"、"展示"
- 检索结果 > 10 条 → 展示前 10 条案例详情
- 检索结果 ≤ 10 条 → 展示全部案例详情
- 直接展示案例详情，无需洞察总结

**模式 B：深度分析模式**
- 触发词："推荐"、"分析"、"解读"、"洞察"、"总结"、"借鉴"、"趋势"、"怎么写"、"有什么"、"有哪些"
- 完整报告格式：洞察总结 + 典型案例（最多 5 条）+ 创意建议
- 洞察统计基于全部检索结果

#### 规范更新

- **素材链接：** 必须使用可点击文字标签（如 `[📹 观看完整视频](URL)`），禁止直接暴露 URL
- **数据真实性：** 所有数据必须基于 API 真实返回，禁止编造奖项、标签、链接等
- **消费者洞察：** 必填字段，不可省略
- **测试脚本：** 新增 `scripts/test-intent.js`（15 个测试用例，100% 通过）

#### 文件变更

- `SKILL.md` - 新增"智能意图识别与输出规范"章节
- `memory/case-retrieval-format.md` - 升级至 V2.0
- `MEMORY.md` - 更新案例检索规范至 V2.0
- `scripts/test-intent.js` - 新增意图识别测试脚本

---

# 优化记录 - 2026-03-13

## 优化内容

根据提供的接口文档，对 `inspiration-api` 技能进行了以下优化：

### 1. 新增案例解析接口

**新增方法**: `parseCase(caseData)`

- 支持提交视频/图片素材进行 AI 自动解析
- 返回完整的案例解析结果，包括：
  - 行业、品牌、产品、核心卖点
  - 目标人群、人性需求、消费者洞察
  - 创意概念、创意手法
  - 分镜详情（视频）、OCR 文本（图片）

**请求格式**:
```javascript
{
  case_id: 123,
  asset: [
    { asset_id: 111, asset_type: 'video', asset_url: 'http://...' },
    { asset_id: 222, asset_type: 'image', asset_url: 'http://...' }
  ]
}
```

### 2. 修正案例详情接口

- 从 `POST` 改为 `GET` 方法（实际 API 仅支持 GET）
- URL: `GET /case/detail?caseId={id}`

### 3. 完善数据结构

**案例详情响应** 新增字段:
- `assetSummary` - 素材概述
- `ocrText` - OCR 识别文本
- `coverUrl` - 封面图 URL
- `status` - 解析状态
- `caseType` - 案例类型

**分镜数据结构** 对齐接口规范:
- `startSec` / `endSec` - 时间戳（秒）
- `sceneDesc` - 分镜描述

**案例解析响应** 字段映射:
- `case_id` → `caseId`
- `industry_id` → `industryId`
- `selling_point` → `sellingPoint`
- `target_audience` → `targetAudience`
- `human_needs` → `humanNeeds`
- `creative_concept` → `creativeConcept`
- `creative_methods` → `creativeMethods`
- `case_title` → `title`
- `asset` → `assets`

### 4. 更新文档

- ✅ 更新 `SKILL.md` - 添加案例解析接口说明
- ✅ 更新 `README.md` - 添加快速开始示例
- ✅ 新增 `scripts/test-api.js` - API 测试脚本
- ✅ 新增 `scripts/examples.js` - 使用示例脚本

### 5. 测试验证

所有 API 接口测试通过：
- ✅ 获取行业标签 (41 个)
- ✅ 获取创意手法 (106 个)
- ✅ 获取人性需求 (232 个)
- ✅ 查询案例列表 (4956 个案例)
- ✅ 获取案例详情 (含分镜数据)
- ✅ 案例解析接口（需真实素材 URL）

## 版本

- **当前版本**: v2.1
- **更新日期**: 2026-03-13

## 文件变更

```
skills/inspiration-api/
├── api-client.js      # 新增 parseCase()，修正 getCaseDetail()
├── index.js           # 导出 parseCase()
├── SKILL.md           # 添加案例解析文档
├── README.md          # 更新快速开始示例
├── scripts/
│   ├── test-api.js    # 新增测试脚本
│   └── examples.js    # 新增示例脚本
└── CHANGELOG.md       # 新增更新记录（本文件）
```
