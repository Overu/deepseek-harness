import { request, type RequestConfig } from './request';
export interface ExternalTaskInput {
    type: string;
    canvasId: string;
    nodeId: string;
    data: Record<string, unknown>;
}
/** Shared native transport. Context/version reconciliation belongs to the explicit caller. */
export const submitExternalTask = (input: ExternalTaskInput, options?: RequestConfig) => request('game-ai-editor-center/api/v2/workflow/external-task', input, options);
export const readExternalTask = (taskId: string, options?: RequestConfig) => request('game-ai-editor-center/api/v2/workflow/external-task/result', { taskId }, options);
