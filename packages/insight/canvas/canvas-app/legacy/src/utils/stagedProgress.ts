/** 各段占用总时长的比例（快 / 中 / 慢） */
export const STAGED_TIME_RATIOS = [0.15, 0.25, 0.6] as const;

export const STAGED_PROGRESS_MILESTONES = [30, 60] as const;

const STAGE_PROGRESS_STARTS = [0, 30, 60] as const;

/** 按已用时间映射进度 — 供 StatusOverlay 等固定总时长场景 */
export function getStagedProgressFromElapsed(elapsedMs: number, totalDurationMs: number, maxProgress = 99): number {
  if (totalDurationMs <= 0 || elapsedMs <= 0) return 0;

  const t = Math.min(1, elapsedMs / totalDurationMs);
  const progressEnds = [STAGED_PROGRESS_MILESTONES[0], STAGED_PROGRESS_MILESTONES[1], maxProgress];

  let cumulativeTime = 0;

  for (let i = 0; i < STAGED_TIME_RATIOS.length; i++) {
    const stageDuration = STAGED_TIME_RATIOS[i];
    const stageStart = STAGE_PROGRESS_STARTS[i];
    const stageEnd = progressEnds[i];

    if (t <= cumulativeTime + stageDuration) {
      const localT = stageDuration > 0 ? (t - cumulativeTime) / stageDuration : 1;
      const easedT = i === 1 ? 1 - (1 - localT) ** 2 : localT;
      const progress = stageStart + easedT * (stageEnd - stageStart);
      return Math.min(Math.floor(progress), maxProgress);
    }

    cumulativeTime += stageDuration;
  }

  return maxProgress;
}

/** 按当前进度计算下一步增量 — 供 useFileUpload 等不可预知完成时间的场景 */
export function getStagedProgressIncrement(currentProgress: number, maxProgress = 95): number {
  if (currentProgress >= maxProgress) return 0;

  if (currentProgress < STAGED_PROGRESS_MILESTONES[0]) {
    return Math.floor(Math.random() * 4) + 3;
  }

  if (currentProgress < STAGED_PROGRESS_MILESTONES[1]) {
    const decay = (STAGED_PROGRESS_MILESTONES[1] - currentProgress) / 30;
    const base = Math.floor(Math.random() * 3) + 1;
    return Math.max(1, Math.round(base * decay));
  }

  return Math.random() < 0.25 ? 1 : 0;
}
