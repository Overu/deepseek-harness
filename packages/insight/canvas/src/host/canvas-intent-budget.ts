import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-user-questions';
import { CanvasAgentError, type GenerationCounts } from '../shared/canvas-agent-protocol.ts';
interface Usage {
    sequence: number;
    generation: GenerationCounts;
}
export interface CanvasIntentBudget {
    latestUser: WeakMap<object, number>;
    usages: WeakMap<object, Usage>;
    owners: WeakMap<object, Promise<void>>;
    busy: Map<string, string>;
    roots: WeakMap<object, Map<string, {
        turn: number;
        seq: number;
    }>>;
    observe(session: object, event: any): void;
}
const budgets = new WeakMap<object, CanvasIntentBudget>();
export function canvasIntentBudget(ctx: Context): CanvasIntentBudget {
    let value = budgets.get(ctx);
    if (value) {
        return value;
    }
    const latestUser = new WeakMap<object, number>(), usages = new WeakMap<object, Usage>(), owners = new WeakMap<object, Promise<void>>();
    const roots = new WeakMap<object, Map<string, {
        turn: number;
        seq: number;
    }>>();
    value = { latestUser, usages, owners, roots, busy: new Map(), observe(session, event) {
            if (event.type === 'user/message' && event.data.source.kind === 'user') {
                latestUser.set(session, Number(event.seq));
            }
            if (event.type === 'tool/call') {
                let entries = roots.get(session);
                if (!entries) {
                    entries = new Map();
                    roots.set(session, entries);
                }
                entries.set(String(event.data.callId), { turn: event.data.turn, seq: Number(event.seq) });
            }
            if (event.type === 'tool/result') {
                roots.get(session)?.delete(String(event.data.message.source.callId));
            }
        } };
    budgets.set(ctx, value);
    return value;
}
export async function confirmCanvasVolume(ctx: Context, exec: ToolRunContext, generation: GenerationCounts, total: GenerationCounts): Promise<void> {
    if (total.images <= 30 && total.videos <= 6) {
        return;
    }
    const questions = ctx.get('userQuestions');
    if (!questions || !exec.agent) {
        throw new CanvasAgentError('CONFIRMATION_UNAVAILABLE', '需要用户确认生成数量，当前尚未提交');
    }
    let answer;
    try {
        answer = await questions.ask({ agent: exec.agent, signal: exec.signal, questions: [{ id: 'canvas-generation-volume', header: '确认生成数量',
                    question: `本次将产出${generation.images}张图片、${generation.videos}条视频${generation.audios ? `、${generation.audios}条音频` : ''}；当前需求累计将达到${total.images}张图片、${total.videos}条视频${total.audios ? `、${total.audios}条音频` : ''}。是否继续？`, options: [{ label: '确认生成' }, { label: '暂不生成' }] }] });
    }
    catch {
        throw new CanvasAgentError('CONFIRMATION_UNAVAILABLE', '未取得用户的数量确认，尚未提交');
    }
    const selected = answer.answers.find(item => item.id === 'canvas-generation-volume')?.selected;
    if (selected?.length !== 1 || selected[0] !== '确认生成') {
        throw new CanvasAgentError('CONFIRMATION_DECLINED', '用户未确认本次处理，尚未提交');
    }
}
