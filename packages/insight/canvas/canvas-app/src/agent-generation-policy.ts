import type { Node } from '@xyflow/react';
import { isNonGenerativeMedia } from '../legacy/src/components/canvasFlow/utils/type';
import { AudioModelType } from '../legacy/src/components/canvasFlow/customNode/audio/types';

export function canConfigureAgentGeneration(node: Node): boolean {
  return ['image', 'video', 'audio'].includes(node.type ?? '') && !isNonGenerativeMedia(String(node.data.type ?? ''));
}
export function canRunAgentGeneration(node: Node): boolean {
  return canConfigureAgentGeneration(node) && (node.type !== 'audio'
    || Object.values(AudioModelType).some(mode => mode === (node.data.params as { modelType?: string } | undefined)?.modelType));
}
