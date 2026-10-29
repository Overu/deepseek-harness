/**
 * Inspiration API 封装
 * 
 * 调用后端 API 实现案例数据的按需查询
 * API 基础 URL: http://gapi-test.idealead.com/material-server
 * 
 * 用法:
 * const { 
 *   queryCases, 
 *   getCaseDetail, 
 *   getIndustries,
 *   getCreativeMethods,
 *   getHumanNeeds,
 *   searchCases 
 * } = require('./inspiration-api');
 * 
 * // 查询案例列表
 * const result = await queryCases({ 
 *   industryId: 1, 
 *   awardYear: 2025,
 *   page: 1,
 *   size: 20 
 * });
 * 
 * // 获取案例详情
 * const detail = await getCaseDetail(123);
 * 
 * // 获取筛选选项
 * const options = await getFilterOptions();
 */

const api = require('./api-client');

module.exports = {
  // ========== 标签查询 ==========
  /**
   * 获取标签列表
   * @param {string} category - 标签类别 (industry|creative_method|human_need)
   */
  getTags: api.getTags,
  
  /**
   * 获取行业列表
   * @returns {Promise<Array>} 行业标签列表
   */
  getIndustries: api.getIndustries,
  
  /**
   * 获取创意手法列表
   * @returns {Promise<Array>} 创意手法标签列表
   */
  getCreativeMethods: api.getCreativeMethods,
  
  /**
   * 获取人性需求列表
   * @returns {Promise<Array>} 人性需求标签列表
   */
  getHumanNeeds: api.getHumanNeeds,
  
  /**
   * 获取筛选选项
   * @returns {Promise<Object>} 包含 industries, creativeMethods, humanNeeds
   */
  getFilterOptions: api.getFilterOptions,
  
  // ========== 案例查询 ==========
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
   * @returns {Promise<Object>} { total, page, size, totalPages, hits }
   */
  queryCases: api.queryCases,
  
  /**
   * 获取案例详情
   * @param {number} caseId - 案例 ID
   * @returns {Promise<Object>} 案例详情
   */
  getCaseDetail: api.getCaseDetail,
  
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
  parseCase: api.parseCase,
  
  /**
   * 搜索案例（关键词搜索）
   * @param {string} keyword - 搜索关键词
   * @param {Object} options - 其他筛选选项
   * @returns {Promise<Object>} 案例列表
   */
  searchCases: api.searchCases,
  
  /**
   * 获取所有案例（分页获取全部）
   * @param {Object} filters - 筛选条件
   * @param {number} batchSize - 每批获取数量
   * @returns {Promise<Array>} 所有案例列表
   */
  getAllCases: api.getAllCases,
  
  // ========== 批量操作 ==========
  /**
   * 获取所有案例并保存到文件
   * @param {string} outputFile - 输出文件名
   * @param {Object} filters - 筛选条件
   * @returns {Promise<Array>} 案例列表
   */
  fetchAllCases: api.fetchAllCases,
  
  /**
   * 获取多个案例详情并保存
   * @param {Array<number>} caseIds - 案例 ID 列表
   * @param {string} outputFile - 输出文件名
   * @returns {Promise<Array>} 案例详情列表
   */
  fetchCaseDetails: api.fetchCaseDetails,
  
  // ========== 工具方法 ==========
  /**
   * 保存数据到文件
   * @param {string} filename - 文件名
   * @param {any} data - 数据
   */
  saveToFile: api.saveToFile,
  
  // ========== 原始客户端 ==========
  /**
   * Axios 实例，可用于自定义 API 调用
   */
  apiClient: api.apiClient,
  
  /**
   * API 基础 URL
   */
  BASE_URL: api.BASE_URL
};
