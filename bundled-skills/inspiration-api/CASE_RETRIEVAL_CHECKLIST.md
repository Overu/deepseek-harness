# 案例检索统计分析检查清单

**每次执行案例检索和统计分析时，必须逐项检查！**

---

## 阶段 1：检索前准备

- [ ] 明确检索关键词（如"饼干"）
- [ ] 确认检索字段（product/brand/creativeConcept 等）
- [ ] 确认返回字段（humanNeeds, creativeMethods 等）

---

## 阶段 2：检索后验证（原则 1：相关性）

- [ ] **第 1 条验证**：检查 `hits[0].product` 或 `hits[0].brand` 是否包含关键词
  - 如果不相关 → 调整检索条件，重新检索
- [ ] **随机抽查**：检查 3-5 条案例的 `product`/`brand` 字段
  - 如果部分不相关 → 增加筛选条件（如 industryId）
- [ ] **确认总数**：记录 `total` 值（如 54 条）

---

## 阶段 3：分页获取全部数据（灵活去重版）

**方法 A：简单去重（推荐）**
```javascript
const allHits = [];
const seen = new Set();
const totalPages = Math.ceil(firstPage.total / 10) + 1; // 多获取 1 页保险

for (let page = 1; page <= totalPages; page++) {
  const result = await queryCases({ keyword, page, size: 10 });
  result.hits.forEach(h => {
    if (!seen.has(h.caseId)) {
      seen.add(h.caseId);
      allHits.push(h);
    }
  });
  if (result.hits.length === 0) break; // 没有数据了
}

console.log('去重后案例数:', allHits.length);
```

**方法 B：精确计算（备选）**
```javascript
const total = firstPage.total;
const totalPages = Math.ceil(total / 10);
const allHits = [...firstPage.hits];

for (let page = 2; page <= totalPages; page++) {
  const result = await queryCases({ keyword, page, size: 10 });
  const remaining = total - allHits.length;
  const toTake = Math.min(remaining, result.hits.length);
  allHits.push(...result.hits.slice(0, toTake));
}
```

- [ ] 分页获取全部数据
- [ ] 去重验证（如果用方法 A）
- [ ] 验证 `allHits.length >= total`（允许略多，后续会去重）

---

## 阶段 4：统计分析

```javascript
const needs = {};
const methods = {};

allHits.forEach(h => {
  (h.humanNeeds || []).forEach(n => { needs[n] = (needs[n] || 0) + 1; });
  (h.creativeMethods || []).forEach(m => { methods[m] = (methods[m] || 0) + 1; });
});

const needsTotal = Object.values(needs).reduce((a,b) => a+b, 0);
const methodsTotal = Object.values(methods).reduce((a,b) => a+b, 0);
```

- [ ] 统计人性需求分布
- [ ] 统计创意手法分布
- [ ] 计算人性需求总数
- [ ] 计算创意手法总数

---

## 阶段 5：数据验证（原则 2：一致性）

**填写验证表：**

| 验证项 | 数值 | 验证规则 | 通过 |
|--------|------|----------|------|
| 案例总数 | 54 条 | - | - |
| 人性需求总数 | 54 次 | ≥ 54 | ✓ / ✗ |
| 创意手法总数 | 108 次 | ≥ 54 | ✓ / ✗ |

- [ ] 人性需求总数 ≥ 案例总数
- [ ] 创意手法总数 ≥ 案例总数
- [ ] 如果任一验证失败 → 重新检查统计逻辑

---

## 阶段 6：输出报告

- [ ] 明确标注"基于 X 条案例统计"（不是"API 返回 total: Y"）
- [ ] 列出验证表，证明数据正确
- [ ] 多素材案例完整展示所有链接
- [ ] 如果案例 > 5 条，优先生成 HTML 报告

---

## 快速验证命令

```bash
cd ~/.agents/skills/inspiration-api
node -e "
const { queryCases } = require('./index');
(async () => {
  const r = await queryCases({ keyword: '饼干', page: 1, size: 10 });
  console.log('Total:', r.total);
  console.log('验证：人性需求总数应该 ≥', r.total);
})();
"
```

---

**红线原则：**
1. 检索结果必须与检索条件相关
2. 人性需求总数 ≥ 案例总数
3. 创意手法总数 ≥ 案例总数

**违反任一原则 → 统计数据无效，必须重新检查！**
