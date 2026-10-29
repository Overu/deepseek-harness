/**
 * 本地开发工具白名单：绕过 listToolNodeSetting 后台权限，仅 `import.meta.env.DEV` 生效。
 *
 * 在 `.env.development.local`（推荐，已被 gitignore）或 `.env.development` 中配置：
 * VITE_CANVAS_DEV_TOOLS=poseTransVideoTool,otherTool
 *
 * 多个工具 type 用英文逗号分隔，修改后需重启 dev server。
 */

const parseEnvDevTools = (): Set<string> => {
  if (!import.meta.env.DEV) return new Set();
  const raw = import.meta.env.VITE_CANVAS_DEV_TOOLS;
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  );
};

const DEV_TOOL_ALLOWLIST = parseEnvDevTools();

export function isDevToolAllowlisted(toolType: string): boolean {
  return DEV_TOOL_ALLOWLIST.has(toolType);
}

/** 将开发白名单合并进接口下发的工具权限表 */
export function mergeDevToolAllowlist(toolPerm: Record<string, { visible: boolean; enabled: boolean }> | null): Record<string, { visible: boolean; enabled: boolean }> | null {
  if (!import.meta.env.DEV || DEV_TOOL_ALLOWLIST.size === 0) {
    return toolPerm;
  }

  const merged = { ...(toolPerm || {}) };
  for (const toolType of DEV_TOOL_ALLOWLIST) {
    merged[toolType] = { visible: true, enabled: true };
  }
  return merged;
}
