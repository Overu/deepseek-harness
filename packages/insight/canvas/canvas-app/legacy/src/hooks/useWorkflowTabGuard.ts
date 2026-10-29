import { useEffect, useState } from 'react';
import { createWorkflowTabOwnership, type WorkflowTabStatus } from './workflowTabOwnership';
import { useFlowStore } from '../store/flowStore';
import { defaultAgentEditGuard } from '../../../src/agent-edit-guard';

export function useWorkflowTabGuard(workflowId: string) {
  const [status, setStatus] = useState<WorkflowTabStatus>('checking');
  useEffect(() => {
    const owner = createWorkflowTabOwnership(workflowId, next => {
      if (next !== 'active') useFlowStore.getState().actions.setReadOnly(true);
      setStatus(next);
    }, false, () => {
      const state = useFlowStore.getState();
      if (state.actions.hasPendingMutations() || state.agentPersistenceIssue || state.versionConflict || defaultAgentEditGuard.isOperationBusy()) return false;
      try { defaultAgentEditGuard.assertOperationActive(); return true; } catch { return false; }
    });
    return owner.dispose;
  }, [workflowId]);
  return status;
}
