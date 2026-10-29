/** Extracted unchanged from the native UI; both callers accept the same legacy result shapes. */
export function parseChildNodeInfoFromPollData(data: any): Record<string, string> | null {
    if (!data) return null;
    let result = data.result;
    if (typeof result === 'string') {
        try { result = JSON.parse(result); } catch { /* Top-level childNodeInfo can still be valid. */ }
    }
    const info = data.childNodeInfo || result?.childNodeInfo;
    return info && typeof info === 'object' ? info as Record<string, string> : null;
}
