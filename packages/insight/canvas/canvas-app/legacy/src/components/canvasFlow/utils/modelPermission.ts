import type { Node } from '@xyflow/react';
import { isDevToolAllowlisted } from './devToolAllowlist';

/** 与后端 test.json 一致，0/1 或缺省 */
export type Flag01 = 0 | 1;

export interface CustomParamChoice {
  label?: string;
  value: unknown;
  visible?: Flag01;
  enabled?: Flag01;
}

export interface CustomParamDef {
  type?: string;
  label?: string;
  default?: unknown;
  choices?: CustomParamChoice[];
}

export interface ModelNodeSettingRow {
  model_key: string;
  model_name?: string;
  model_category: string;
  visible: Flag01;
  enabled: Flag01;
  voice_customizable?: Flag01;
  custom_parameters?: Record<string, CustomParamDef>;
}

export interface ToolNodeSettingRow {
  tool_key: string;
  visible: Flag01;
  enabled: Flag01;
}

export interface NormalizedModelPermission {
  /** `${category}:${model_key}` */
  byCategoryAndKey: Map<string, EnrichedModelRow>;
  /** 扁平：类别、模型、字段、选项值 */
  choiceFlags: Map<string, ChoiceFlag>;
}

export interface ChoiceFlag {
  visible: boolean;
  enabled: boolean;
}

/** 不参与 custom_parameters choices 权限的字段（音色由 ToneLibrary 独立管理） */
export const PERMISSION_EXCLUDED_PARAM_FIELDS = new Set(['voiceId']);

export function isPermissionExcludedParamField(field: string): boolean {
  return PERMISSION_EXCLUDED_PARAM_FIELDS.has(field);
}

export interface EnrichedModelRow extends ModelNodeSettingRow {
  _visible: boolean;
  _enabled: boolean;
  /** 无字段时默认允许定制音色 */
  _voiceCustomizable: boolean;
}

function toBool01(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

/** choices 项未下发 visible/enabled 时视为放开（与模型级缺省一致） */
function choiceFlagFromChoiceItem(choice: CustomParamChoice): ChoiceFlag {
  return {
    visible: choice.visible === undefined || choice.visible === null ? true : toBool01(choice.visible),
    enabled: choice.enabled === undefined || choice.enabled === null ? true : toBool01(choice.enabled),
  };
}

/** 仅用于 choiceFlags / optionMeta 等索引键；不用于改写 params 中的业务 value */
export function paramValueLookupKey(v: unknown): string {
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

/** 比较两个选项 value 是否相同（严格类型，不把 1 与 "1" 视为相等） */
export function paramValuesEqual(a: unknown, b: unknown): boolean {
  return Object.is(a, b);
}

export type OptionPermissionMetaMap = Record<string, { hidden?: boolean; disabled?: boolean }>;

/**
 * 下拉是否展示该选项：hidden 的项不展示（当前已选值除外）。
 * 参数 choices 以 OSS 全量为基准，由 buildFieldChoiceMeta 为每项写入 meta；
 * 字段未在 custom_parameters 下发时 meta 均为可见，字段已下发 choices 时未声明项为 hidden。
 * 模型下拉仍应对全量 model value 构建 meta；不在白名单的项会显式 hidden。
 */
export function shouldShowOptionInDropdown(optionMeta: OptionPermissionMetaMap | undefined, optionValue: unknown, currentValue: unknown): boolean {
  if (!optionMeta) return true;
  const m = optionMeta[paramValueLookupKey(optionValue)];
  if (!m) return true;
  if (!m.hidden) return true;
  return paramValuesEqual(currentValue, optionValue);
}

/** @deprecated 使用 paramValueLookupKey */
export const serializeParamValue = paramValueLookupKey;

/** `${category}:${modelKey}:${field}:${value}` */
export function choiceFlagKey(category: string, modelKey: string, field: string, value: unknown): string {
  return `${category}:${modelKey}:${field}:${paramValueLookupKey(value)}`;
}

export function normalizeModelNodeSettings(rows: ModelNodeSettingRow[]): NormalizedModelPermission {
  const byCategoryAndKey = new Map<string, EnrichedModelRow>();
  const choiceFlags = new Map<string, ChoiceFlag>();

  for (const row of rows || []) {
    const cat = row.model_category;
    const modelKey = row.model_key;
    const compositeKey = `${cat}:${modelKey}`;
    const enriched: EnrichedModelRow = {
      ...row,
      _visible: toBool01(row.visible),
      _enabled: toBool01(row.enabled),
      _voiceCustomizable: row.voice_customizable === undefined ? true : toBool01(row.voice_customizable),
    };
    byCategoryAndKey.set(compositeKey, enriched);

    const customParameters = row.custom_parameters || {};
    for (const [field, fieldDef] of Object.entries(customParameters)) {
      if (!fieldDef || typeof fieldDef !== 'object') continue;
      if (isPermissionExcludedParamField(field)) continue;

      fieldDef.choices?.forEach(choice => {
        const key = choiceFlagKey(cat, modelKey, field, choice.value);
        choiceFlags.set(key, choiceFlagFromChoiceItem(choice));
      });
    }
  }

  return { byCategoryAndKey, choiceFlags };
}

export function normalizeToolNodeSettings(rows: ToolNodeSettingRow[]): Record<string, { visible: boolean; enabled: boolean }> {
  const map: Record<string, { visible: boolean; enabled: boolean }> = {};
  for (const r of rows || []) {
    map[r.tool_key] = {
      visible: toBool01(r.visible),
      enabled: toBool01(r.enabled),
    };
  }
  return map;
}

export function getModelRow(perm: NormalizedModelPermission | null, category: string, modelKey: string): EnrichedModelRow | undefined {
  if (!perm) return undefined;
  return perm.byCategoryAndKey.get(`${category}:${modelKey}`);
}

/**
 * `listModelNodeSetting` / `listToolNodeSetting` 的 data 为**白名单**：
 * 仅数组中出现的 model_key / tool_key 才读取其 visible、enabled、custom_parameters；
 * OSS/配置里的其余模型或工具视为 visible=0、enabled=0（不可见且不可用）。
 * 模型：接口未成功下发时不启用白名单（`modelNodePermission` 为 null）。
 * 工具：`listToolNodeSetting` 成功即启用白名单（含 data 为空数组，则全部工具不可用）。
 */
export function isModelPermissionEnforced(perm: NormalizedModelPermission | null): boolean {
  return perm != null && perm.byCategoryAndKey.size > 0;
}

export type ToolNodePermissionMap = Record<string, { visible: boolean; enabled: boolean }>;

/** 接口已成功返回（含 data 为空数组）后启用工具白名单；null 表示尚未加载 */
export function isToolPermissionEnforced(toolPerm: ToolNodePermissionMap | null): boolean {
  return toolPerm != null;
}

function getToolPermissionEntry(toolPerm: ToolNodePermissionMap | null, toolType: string): { visible: boolean; enabled: boolean } | null {
  if (!toolPerm) return null;
  return toolPerm[toolType] ?? null;
}

/** 工具是否可在画布内执行；不在白名单内等同不可用 */
export function isToolUsable(toolPerm: ToolNodePermissionMap | null, toolType: string): boolean {
  if (isDevToolAllowlisted(toolType)) return true;
  if (!isToolPermissionEnforced(toolPerm)) return true;
  const toolPermission = getToolPermissionEntry(toolPerm, toolType);
  if (!toolPermission) return false;
  return toolPermission.visible && toolPermission.enabled;
}

/** 工具是否出现在左侧工具列表 */
export function isToolVisibleInList(toolPerm: ToolNodePermissionMap | null, toolType: string): boolean {
  if (isDevToolAllowlisted(toolType)) return true;
  if (!isToolPermissionEnforced(toolPerm)) return true;
  const toolPermission = getToolPermissionEntry(toolPerm, toolType);
  if (!toolPermission) return false;
  return toolPermission.visible;
}

/** 解析模型级 visible/enabled；不在白名单内等同 visible=0、enabled=0 */
export function resolveModelPermissionFlag(perm: NormalizedModelPermission | null, category: string, modelKey: string): ChoiceFlag {
  if (!isModelPermissionEnforced(perm)) return { visible: true, enabled: true };
  const modelRow = getModelRow(perm, category, modelKey);
  if (!modelRow) return { visible: false, enabled: false };
  return { visible: modelRow._visible, enabled: modelRow._enabled };
}

/**
 * 白名单模型下的选项权限（以 OSS 全量 choices 为展示/校验基准）：
 * - 字段未在 custom_parameters 中 → 默认全部开放
 * - 字段已下发 choices：权限 choices 里**已声明**的 value 按 visible/enabled 限制
 * - 字段已下发 choices 但 value 不在权限 choices 列表（仅 OSS 有）→ 默认不可见不可用
 * - 已声明项未带 visible/enabled → 默认放开（choiceFlagFromChoiceItem）
 */
export function getChoiceFlag(perm: NormalizedModelPermission | null, category: string, modelKey: string, field: string, value: unknown): ChoiceFlag {
  if (isPermissionExcludedParamField(field)) return { visible: true, enabled: true };
  const enforced = isModelPermissionEnforced(perm);
  if (!enforced) return { visible: true, enabled: true };
  const modelRow = getModelRow(perm, category, modelKey);
  if (!modelRow) return { visible: false, enabled: false };
  // 模型内参数若无配置（custom_parameters 不含该字段），则默认全部开放
  const fieldDef = modelRow.custom_parameters?.[field];
  if (!fieldDef) return { visible: true, enabled: true };
  // 字段存在但未提供 choices（例如纯输入框类参数），默认开放
  if (!fieldDef.choices?.length) return { visible: true, enabled: true };
  const choiceKey = choiceFlagKey(category, modelKey, field, value);
  const stored = perm!.choiceFlags.get(choiceKey);
  if (stored) return stored;
  // 字段已在权限中声明 choices，但该 value 未单独声明 → 默认不可见不可用
  return { visible: false, enabled: false };
}

/** 模型本身可选：在权限表中且可见、启用 */
export function isModelSelectable(perm: NormalizedModelPermission | null, category: string, modelKey: string): boolean {
  const fl = resolveModelPermissionFlag(perm, category, modelKey);
  return fl.visible && fl.enabled;
}

/** 选项可选：可见且启用（用于执行校验） */
export function isChoiceUsable(flag: ChoiceFlag): boolean {
  return flag.visible && flag.enabled;
}

function pickFirstUsableChoice(fieldDef: CustomParamDef, perm: NormalizedModelPermission, category: string, modelKey: string, field: string): unknown {
  if (!fieldDef.choices?.length) return undefined;
  for (const c of fieldDef.choices) {
    const f = getChoiceFlag(perm, category, modelKey, field, c.value);
    if (f.visible) return c.value;
  }
  return fieldDef.default ?? fieldDef.choices[0]?.value;
}

const BASIC_NODE_TYPES = new Set(['image', 'video', 'text', 'audio']);

function getBasicNodeContext(node: Node): { nodeType: string; params: any; modelKey: string } | null {
  const nodeType = String(node.type || '');
  if (!BASIC_NODE_TYPES.has(nodeType)) return null;
  const params = (node as any)?.data?.params ?? null;
  if (!params) return null;
  const modelKey = String(params?.model || '');
  if (!modelKey) return null;
  return { nodeType, params, modelKey };
}

export interface PermissionMigrationResult {
  nodes: Node[];
  replacedSubscriptionModel: boolean;
  migratedInvisibleParams: boolean;
}

/** 深度克隆节点数组 */
export function cloneNodes(nodes: Node[]): Node[] {
  return JSON.parse(JSON.stringify(nodes)) as Node[];
}

/**
 * 订阅映射：当 model 为 JSON 的 key，且权限模型不可见或置灰时，替换为 value。
 */
export function applySubscriptionModelFallback(nodes: Node[], perm: NormalizedModelPermission | null, fallbackMap: Record<string, string>): { nodes: Node[]; replaced: boolean } {
  const next = cloneNodes(nodes);
  let replaced = false;

  for (const node of next) {
    const ctx = getBasicNodeContext(node);
    if (!ctx) continue;
    const { nodeType, params, modelKey } = ctx;
    const target = fallbackMap[modelKey];
    if (!target) continue;

    const modelRow = getModelRow(perm, nodeType, modelKey);
    const bad = isModelPermissionEnforced(perm) && (!modelRow || !modelRow._visible || !modelRow._enabled);
    if (bad) {
      params.model = target;
      replaced = true;
    }
  }

  return { nodes: next, replaced };
}

function migrateInvisibleParamChoices(node: Node, perm: NormalizedModelPermission): boolean {
  const ctx = getBasicNodeContext(node);
  if (!ctx) return false;
  const { nodeType, params, modelKey } = ctx;
  const modelRow = getModelRow(perm, nodeType, modelKey);
  if (!modelRow?.custom_parameters) return false;

  let changed = false;
  const customParameters = modelRow.custom_parameters;

  for (const [field, fieldDef] of Object.entries(customParameters)) {
    if (!fieldDef || typeof fieldDef !== 'object') continue;
    if (field === 'model') continue;

    const cur = params[field];
    if (cur === undefined || cur === null) continue;

    if (fieldDef.choices?.length) {
      const choiceFlag = getChoiceFlag(perm, nodeType, modelKey, field, cur);
      if (!choiceFlag.visible) {
        const firstUsableValue = pickFirstUsableChoice(fieldDef, perm, nodeType, modelKey, field);
        if (firstUsableValue !== undefined && !paramValuesEqual(firstUsableValue, cur)) {
          params[field] = firstUsableValue;
          changed = true;
        }
      }
    }
  }

  return changed;
}

/** 顺序：先 OSS 模型替换，再不可见选项迁移 */
export function applyCanvasPermissionMigration(nodes: Node[], perm: NormalizedModelPermission | null, fallbackMap: Record<string, string>): PermissionMigrationResult {
  let replacedSubscriptionModel = false;
  let migratedInvisibleParams = false;

  const step1 = applySubscriptionModelFallback(nodes, perm, fallbackMap);
  replacedSubscriptionModel = step1.replaced;
  const working = step1.nodes;

  if (perm) {
    // working 已是 step1 的深拷贝，此处原地迁移即可，避免二次 JSON 全图克隆
    for (const n of working) {
      if (migrateInvisibleParamChoices(n, perm)) migratedInvisibleParams = true;
    }
  }

  return {
    nodes: working,
    replacedSubscriptionModel,
    migratedInvisibleParams,
  };
}

/** 执行前校验基础节点参数是否在权限内可用 */
export function validateBasicNodesParamsForRun(nodes: Node[], perm: NormalizedModelPermission | null): boolean {
  if (!perm || perm.byCategoryAndKey.size === 0) return true;

  for (const node of nodes) {
    const ctx = getBasicNodeContext(node);
    if (!ctx) continue;
    const { nodeType, params, modelKey } = ctx;

    const modelRow = getModelRow(perm, nodeType, modelKey);
    if (!modelRow || !modelRow._visible || !modelRow._enabled) return false;

    if (!modelRow?.custom_parameters) continue;

    for (const [field, fieldDef] of Object.entries(modelRow.custom_parameters)) {
      if (!fieldDef || typeof fieldDef !== 'object') continue;
      const cur = params[field];
      if (cur === undefined || cur === null) continue;

      if (fieldDef.choices?.length) {
        const flag = getChoiceFlag(perm, nodeType, modelKey, field, cur);
        if (!isChoiceUsable(flag)) return false;
      }
    }
  }

  return true;
}

export const SUBSCRIPTION_MODEL_MAP_URL = '//web-gpt-assets-cdn.idealead.com/base-platform/test/json/model.json';

export async function fetchSubscriptionModelMap(options?: { signal?: AbortSignal }): Promise<Record<string, string>> {
  const url = SUBSCRIPTION_MODEL_MAP_URL.startsWith('//') ? `https:${SUBSCRIPTION_MODEL_MAP_URL}` : SUBSCRIPTION_MODEL_MAP_URL;
  const res = await fetch(url, options?.signal ? { signal: options.signal } : undefined);
  if (!res.ok) throw new Error(`fetch model map failed: ${res.status}`);
  const json = (await res.json()) as Record<string, string>;
  return json && typeof json === 'object' ? json : {};
}

/** 模型下拉：OSS 全量 model value + 白名单；不在 data 数组里的项 hidden/disabled（key 与 Selection 的 paramValueLookupKey 一致） */
export function buildModelOptionMeta(perm: NormalizedModelPermission | null, category: string, modelValues: Array<string | number>): OptionPermissionMetaMap {
  const meta: OptionPermissionMetaMap = {};
  for (const v of modelValues) {
    const optionKey = paramValueLookupKey(v);
    const modelPermissionFlag = resolveModelPermissionFlag(perm, category, String(v));
    meta[optionKey] = { hidden: !modelPermissionFlag.visible, disabled: !modelPermissionFlag.enabled };
  }
  return meta;
}

export function buildFieldChoiceMeta(
  perm: NormalizedModelPermission | null,
  category: string,
  modelKey: string,
  field: string,
  optionValues: Array<string | number | boolean>
): OptionPermissionMetaMap {
  const meta: OptionPermissionMetaMap = {};
  for (const v of optionValues) {
    const optionKey = paramValueLookupKey(v);
    const choiceFlag = getChoiceFlag(perm, category, modelKey, field, v);
    meta[optionKey] = { hidden: !choiceFlag.visible, disabled: !choiceFlag.enabled };
  }
  return meta;
}

/** 当前选择是否因权限不可发送（与 isAllowRun 中基础节点规则一致） */
export function isBasicNodePermissionBlocked(perm: NormalizedModelPermission | null, nodeType: string, params: Record<string, unknown> | null | undefined): boolean {
  if (!isModelPermissionEnforced(perm)) return false;
  if (!params?.model) return false;
  const category = String(nodeType || '');
  const modelKey = String(params.model);
  const modelRow = getModelRow(perm, category, modelKey);
  if (!modelRow || !modelRow._visible || !modelRow._enabled) return true;

  const customParameters = modelRow?.custom_parameters;
  if (!customParameters) return false;

  for (const [field, fieldDef] of Object.entries(customParameters)) {
    if (!fieldDef || typeof fieldDef !== 'object') continue;
    const cur = params[field];
    if (cur === undefined || cur === null) continue;
    if (fieldDef.choices?.length) {
      const choiceFlag = getChoiceFlag(perm, category, modelKey, field, cur);
      if (!isChoiceUsable(choiceFlag)) return true;
    }
  }

  return false;
}
