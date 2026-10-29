import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { parseCanvasId } from '../shared/protocol.ts';
import { requestCanvasJson } from './canvas-api.ts';
import { desktopServiceProfile } from './service-environment.ts';
import { desktopToken } from './desktop-token.ts';
import { isPublicAddress } from './remote-image-reader.ts';
const PATH = '/desktop-canvas/api/legacy/game-ai-editor-center/api/desktop/matting';
interface Connection {
    requestRejection(request: IncomingMessage): 401 | 403 | undefined;
}
const validUrl = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length > 4096) {
        return false;
    }
    try {
        const u = new URL(value), host = u.hostname.replace(/^\[|\]$/g, '');
        return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.port && host !== 'localhost' && !host.endsWith('.localhost') && (!isIP(host) || isPublicAddress(host));
    }
    catch {
        return false;
    }
};
export function authorizedMattingSource(envelope: any, nodeId: string, outputIndex: number, expected: string): string {
    if (envelope?.code !== 'SUCCESS' || !envelope.data) {
        throw new Error('source_denied');
    }
    const graph = typeof envelope.data.data === 'string' ? JSON.parse(envelope.data.data) : envelope.data.data;
    const node = graph?.nodes?.find((n: any) => n.id === nodeId && n.type === 'image');
    if (!node) {
        throw new Error('source_denied');
    }
    const urls = [...new Set([node.data?.value, ...(Array.isArray(node.data?.product) ? node.data.product.map((p: any) => p?.value) : [])].filter((value: unknown) => {
        if (typeof value !== 'string') return false;
        try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && ![...u.searchParams.keys()].some(k => /^(token|access_token|authorization|bridgekey)$/i.test(k)); } catch { return false; }
    }))];
    if (!validUrl(urls[outputIndex]) || urls[outputIndex] !== expected) {
        throw new Error('source_changed');
    }
    return urls[outputIndex] as string;
}
export function mattingHandler(connection: Connection, deps = { read: requestCanvasJson, token: desktopToken, transport: fetch }) {
    return async (req: IncomingMessage, res: ServerResponse) => {
        const answer = (status: number, value: object) => {
            if (res.destroyed) {
                return;
            }
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
            res.end(JSON.stringify(value));
        };
        const rejected = connection.requestRejection(req);
        if (rejected) {
            answer(rejected, { code: 'AUTH_REQUIRED', msg: 'browser session required' });
            return;
        }
        if (req.url !== PATH || req.method !== 'POST') {
            answer(405, { code: 'INVALID_ARGUMENT', msg: '仅支持固定抠图POST入口' });
            return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) {
            answer(415, { code: 'INVALID_ARGUMENT', msg: '仅支持JSON' });
            return;
        }
        const controller = new AbortController();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
        res.once('close', () => {
            if (!res.writableEnded) {
                controller.abort();
            }
        });
        let submitted = false;
        try {
            let bytes = 0;
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > 12000) {
                    throw new Error('invalid');
                }
                chunks.push(Buffer.from(chunk));
            }
            const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'canvasId,expectedSourceUrl,outputIndex,sourceNodeId' || !parseCanvasId(input.canvasId) || typeof input.sourceNodeId !== 'string' || !input.sourceNodeId.trim() || input.sourceNodeId.length > 100 || !Number.isInteger(input.outputIndex) || input.outputIndex < 0 || input.outputIndex >= 20 || !validUrl(input.expectedSourceUrl)) {
                throw new Error('invalid');
            }
            const source = authorizedMattingSource(await deps.read('get', { id: input.canvasId }, signal), input.sourceNodeId, input.outputIndex, input.expectedSourceUrl);
            const profile = desktopServiceProfile(), token = await deps.token(signal);
            signal.throwIfAborted();
            submitted = true;
            const response = await deps.transport(profile.matting + '/image/matting', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', token, origin: profile.web, referer: profile.web + '/' }, body: JSON.stringify({ inputImageUrl: source, clickCount: 1 }), signal, redirect: 'error' });
            const text = await response.text();
            if (text.length > 1000000) {
                throw new Error('unknown');
            }
            const result = JSON.parse(text);
            if (response.status >= 400 && response.status < 500 && response.status !== 408) {
                answer(response.status, { code: 'RUN_REJECTED', msg: '抠图服务拒绝请求' });
                return;
            }
            if (!response.ok || !['SUCCESS', 200, 0, '0'].includes(result?.code) || !validUrl(result?.data?.mattingImageUrl)) {
                throw new Error('unknown');
            }
            answer(200, { code: 'SUCCESS', data: { mattingImageUrl: result.data.mattingImageUrl } });
        }
        catch (error: any) {
            if (submitted) {
                answer(502, { code: 'SUBMISSION_UNKNOWN', msg: '抠图处理结果未确认，请勿重复提交' });
                return;
            }
            const changed = error?.message === 'source_changed', denied = error?.message === 'source_denied';
            answer(changed ? 409 : denied ? 403 : error?.message === 'invalid' ? 400 : 502, { code: changed ? 'VERSION_CONFLICT' : denied ? 'READ_ONLY' : 'INVALID_ARGUMENT', msg: changed ? '抠图来源已变化，请重新读取' : denied ? '无法确认画布图片来源权限' : '抠图前置检查未完成，尚未提交' });
        }
    };
}
export function registerMattingRoute(ctx: Context): void {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PATH, handler: mattingHandler(Reflect.get(ctx, 'connection') as Connection) }), 'desktop-canvas: fixed matting route');
}
