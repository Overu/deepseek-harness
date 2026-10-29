/**
 * Inspiration API Client
 * 调用后端 API 实现案例数据的按需查询
 * 
 * API 文档:
 * - 基础 URL: http://gapi-test.idealead.com/material-server
 * - 标签查询：GET /tag/getTag?category={category}
 * - 案例列表：POST /case/query
 * - 案例详情：POST /case/detail?caseId={id}
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// API 基础 URL
const BASE_URL = 'http://gapi-test.idealead.com/material-server';

// 加载静态数据作为 fallback
let staticData = null;
try {
  staticData = require('./static-data');
} catch (e) {
  console.warn('⚠️  静态数据未加载，将仅使用 API 调用');
}

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'OpenClaw-Inspiration-API/1.0'
  }
});

/**
 * 标准化 API 响应
 * @param {Object} response - API 原始响应
 * @returns {Object} 标准化后的数据
 */
function normalizeResponse(response) {
  const { code, msg, data } = response.data || {};
  
  if (code !== 'SUCCESS') {
    throw new Error(`API Error: ${code} - ${msg || 'Unknown error'}`);
  }
  
  return data;
}

/**
 * 获取标签列表
 * @param {string} category - 标签类别
 * @returns {Promise<Array>} 标签列表
 */
async function getTags(category) {
  try {
    const response = await apiClient.get('/tag/getTag', {
      params: { category }
    });
    return normalizeResponse(response);
  } catch (error) {
    console.error(`Failed to fetch tags for ${category}:`, error.message);
    throw error;
  }
}

/**
 * 获取行业列表
 * @returns {Promise<Array>} 行业标签列表
 */
async function getIndustries() {
  return getTags('industry');
}

/**
 * 获取创意手法列表
 * @returns {Promise<Array>} 创意手法标签列表
 */
async function getCreativeMethods() {
  return getTags('creative_method');
}

/**
 * 获取人性需求列表
 * @returns {Promise<Array>} 人性需求标签列表
 */
async function getHumanNeeds() {
  return getTags('human_need');
}

/**
 * 查询案例列表
 * @param {Object} filters - 筛选条件
 * @param {string} filters.keyword - 关键词
 * @param {number} filters.industryId - 行业 ID
 * @param {Array<number>} filters.creativeMethods - 创意手法 ID 列表
 * @param {Array<number>} filters.humanNeeds - 人性需求 ID 列表
 * @param {string} filters.awardName - 奖项名称
 * @param {string} filters.awardResult - 获奖等级
 * @param {string} filters.awardCategory - 奖项类别
 * @param {number} filters.awardYear - 获奖年份
 * @param {number} filters.page - 页码 (默认 1)
 * @param {number} filters.size - 每页数量 (默认 10)
 * @returns {Promise<Object>} 案例列表及分页信息
 */
async function queryCases(filters = {}) {
  const {
    keyword,
    industryId,
    creativeMethods,
    humanNeeds,
    awardName,
    awardResult,
    awardCategory,
    awardYear,
    page = 1,
    size = 10
  } = filters;

  const requestBody = {
    keyword: keyword || undefined,
    industryId: industryId || undefined,
    creativeMethods: creativeMethods || undefined,
    humanNeeds: humanNeeds || undefined,
    awardName: awardName || undefined,
    awardResult: awardResult || undefined,
    awardCategory: awardCategory || undefined,
    awardYear: awardYear || undefined,
    page,
    size
  };

  // 移除 undefined 字段
  Object.keys(requestBody).forEach(key => {
    if (requestBody[key] === undefined) {
      delete requestBody[key];
    }
  });

  try {
    // 使用 POST 方法
    const response = await apiClient.post('/case/query', requestBody);
    const data = normalizeResponse(response);
    
    // 标准化返回格式
    return {
      total: data.total || 0,
      page: Math.floor(data.from / size) + 1,
      size: data.size || size,
      totalPages: Math.ceil((data.total || 0) / size),
      hits: (data.hits || []).map(hit => ({
        caseId: hit.caseId,
        title: hit.caseTitle,
        industry: hit.industry,
        humanNeeds: hit.humanNeeds || [],
        creativeMethods: hit.creativeMethods || [],
        coverUrl: hit.coverUrl
      }))
    };
  } catch (error) {
    console.error('Failed to query cases:', error.message);
    throw error;
  }
}

/**
 * 获取案例详情
 * @param {number} caseId - 案例 ID
 * @returns {Promise<Object>} 案例详情
 */
async function getCaseDetail(caseId) {
  if (!caseId) {
    throw new Error('caseId is required');
  }

  try {
    // 使用 GET 方法，caseId 通过 URL 参数传递
    const response = await apiClient.get('/case/detail', {
      params: { caseId }
    });
    
    const data = normalizeResponse(response);
    
    if (!data.hits || data.hits.length === 0) {
      throw new Error(`Case ${caseId} not found`);
    }

    const hit = data.hits[0];
    
    // 标准化返回格式（与接口文档对齐）
    return {
      caseId: hit.caseId,
      brand: hit.brand,
      industry: hit.industry,
      product: hit.product,
      sellingPoint: hit.sellingPoint,
      targetAudience: Array.isArray(hit.targetAudience) 
        ? hit.targetAudience 
        : (hit.targetAudience || '').split(',').map(s => s.trim()).filter(Boolean),
      humanNeeds: hit.humanNeeds || [],
      insight: hit.insight,
      creativeConcept: hit.creativeConcept,
      creativeMethods: hit.creativeMethods || [],
      title: hit.caseTitle,
      summary: hit.caseSummary,
      interpret: hit.caseInterpret,
      awards: hit.awards || [],
      awardYear: hit.awardYear,
      awardName: hit.awardName,
      awardCategory: hit.awardCategory,
      awardResult: hit.awardResult,
      status: hit.status,
      caseType: hit.caseType,
      assets: (hit.assets || []).map(asset => ({
        assetId: asset.assetId,
        assetType: asset.assetType,
        assetSummary: asset.assetSummary,
        ocrText: asset.ocrText,
        assetUrl: asset.assetUrl,
        coverUrl: asset.coverUrl,
        scenes: (asset.scenes || []).map(scene => ({
          startSec: scene.startSec,
          endSec: scene.endSec,
          sceneDesc: scene.sceneDesc
        }))
      }))
    };
  } catch (error) {
    console.error(`Failed to fetch case detail for ${caseId}:`, error.message);
    throw error;
  }
}

/**
 * 搜索案例（关键词搜索）
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 其他筛选选项
 * @returns {Promise<Object>} 案例列表
 */
async function searchCases(keyword, options = {}) {
  return queryCases({ ...options, keyword });
}

/**
 * 获取所有案例（分页获取全部）
 * @param {Object} filters - 筛选条件
 * @param {number} batchSize - 每批获取数量
 * @returns {Promise<Array>} 所有案例列表
 */
async function getAllCases(filters = {}, batchSize = 100) {
  const allCases = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await queryCases({ ...filters, page, size: batchSize });
    allCases.push(...result.hits);
    
    if (allCases.length >= result.total || result.hits.length < batchSize) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allCases;
}

/**
 * 提交案例解析（上传素材并解析）
 * @param {Object} caseData - 案例数据
 * @param {number} caseData.case_id - 案例 ID
 * @param {Array} caseData.asset - 素材列表
 * @param {number} caseData.asset[].asset_id - 素材 ID
 * @param {string} caseData.asset[].asset_type - 素材类型 (video|image)
 * @param {string} caseData.asset[].asset_url - 素材 URL
 * @returns {Promise<Object>} 解析结果
 */
async function parseCase(caseData) {
  const { case_id, asset } = caseData;
  
  if (!case_id || !Array.isArray(asset)) {
    throw new Error('case_id and asset array are required');
  }

  try {
    const response = await apiClient.post('/case/parse', {
      case_id,
      asset: asset.map(a => ({
        asset_id: a.asset_id,
        asset_type: a.asset_type,
        asset_url: a.asset_url
      }))
    });
    
    const data = normalizeResponse(response);
    
    // 标准化返回格式（与接口文档对齐）
    return {
      caseId: data.case_id,
      industryId: data.industry_id,
      brand: data.brand,
      product: data.product,
      sellingPoint: data.selling_point,
      targetAudience: data.target_audience || [],
      humanNeeds: data.human_needs || [],
      insight: data.insight,
      creativeConcept: data.creative_concept,
      creativeMethods: data.creative_methods || [],
      title: data.case_title,
      summary: data.summary,
      interpret: data.interpret,
      assets: (data.asset || []).map(a => ({
        assetId: a.asset_id,
        assetType: a.asset_type,
        status: a.status,
        errMsg: a.err_msg,
        ocrText: a.ocr_text,
        scenes: (a.scenes || []).map(s => ({
          sceneNum: s.scene_num,
          startSec: s.start_sec,
          endSec: s.end_sec,
          desc: s.desc
        }))
      }))
    };
  } catch (error) {
    console.error('Failed to parse case:', error.message);
    throw error;
  }
}

/**
 * 保存数据到文件
 * @param {string} filename - 文件名
 * @param {any} data - 数据
 */
function saveToFile(filename, data) {
  const filePath = path.join(__dirname, '..', filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`✅ 数据已保存到：${filePath}`);
}

/**
 * 获取所有案例并保存
 * @param {string} outputFile - 输出文件名
 * @param {Object} filters - 筛选条件
 */
async function fetchAllCases(outputFile = 'all-cases.json', filters = {}) {
  try {
    console.log('📥 正在获取所有案例...');
    const cases = await getAllCases(filters);
    console.log(`✅ 获取到 ${cases.length} 个案例`);
    
    saveToFile(outputFile, {
      fetchedAt: new Date().toISOString(),
      apiBase: BASE_URL,
      total: cases.length,
      filters,
      data: cases
    });
    
    return cases;
  } catch (error) {
    console.error('Failed to fetch all cases:', error.message);
    throw error;
  }
}

/**
 * 获取多个案例详情并保存
 * @param {Array<number>} caseIds - 案例 ID 列表
 * @param {string} outputFile - 输出文件名
 */
async function fetchCaseDetails(caseIds, outputFile = 'case-details.json') {
  try {
    console.log(`📥 正在获取 ${caseIds.length} 个案例详情...`);
    
    const details = [];
    for (const id of caseIds) {
      try {
        const detail = await getCaseDetail(id);
        details.push(detail);
        console.log(`  ✅ ${id}: ${detail.title}`);
      } catch (error) {
        console.log(`  ❌ ${id}: ${error.message}`);
        details.push({ caseId: id, error: error.message });
      }
    }
    
    saveToFile(outputFile, {
      fetchedAt: new Date().toISOString(),
      apiBase: BASE_URL,
      total: details.length,
      data: details
    });
    
    return details;
  } catch (error) {
    console.error('Failed to fetch case details:', error.message);
    throw error;
  }
}

/**
 * 获取筛选选项（从 API 拉取）
 * @returns {Promise<Object>} 筛选选项
 */
async function getFilterOptions() {
  try {
    const [industries, creativeMethods, humanNeeds] = await Promise.all([
      getIndustries(),
      getCreativeMethods(),
      getHumanNeeds()
    ]);

    // 提取叶节点作为可选值
    const extractLeafValues = (items) => {
      return items
        .filter(item => item.isLeaf === 1)
        .map(item => ({
          id: item.id,
          value: item.tagValue
        }));
    };

    return {
      industries: extractLeafValues(industries),
      creativeMethods: extractLeafValues(creativeMethods),
      humanNeeds: extractLeafValues(humanNeeds)
    };
  } catch (error) {
    console.error('Failed to fetch filter options:', error.message);
    // Fallback 到静态数据
    if (staticData) {
      return {
        industries: [],
        creativeMethods: [],
        humanNeeds: [],
        note: 'API 调用失败，返回空选项'
      };
    }
    throw error;
  }
}

module.exports = {
  // 核心 API 方法
  getTags,
  getIndustries,
  getCreativeMethods,
  getHumanNeeds,
  queryCases,
  getCaseDetail,
  searchCases,
  getAllCases,
  
  // 批量方法
  fetchAllCases,
  fetchCaseDetails,
  
  // 工具方法
  saveToFile,
  getFilterOptions,
  
  // 原始客户端
  apiClient,
  
  // 常量
  BASE_URL
};
