export interface AlignmentBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AlignmentName = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface AlignmentReference {
  key: string;
  bounds: AlignmentBounds;
}

export interface AlignmentMatch {
  axis: 'x' | 'y';
  targetAnchor: AlignmentName;
  referenceAnchor: AlignmentName;
  position: number;
  delta: number;
  reference: AlignmentReference;
}

export interface AlignmentResult {
  x?: AlignmentMatch;
  y?: AlignmentMatch;
}

interface AlignmentCandidate {
  name: AlignmentName;
  value: number;
}

function getAxisCandidates(bounds: AlignmentBounds, axis: 'x' | 'y'): AlignmentCandidate[] {
  if (axis === 'x') {
    return [
      { name: 'center', value: bounds.left + bounds.width / 2 },
      { name: 'left', value: bounds.left },
      { name: 'right', value: bounds.left + bounds.width },
    ];
  }

  return [
    { name: 'middle', value: bounds.top + bounds.height / 2 },
    { name: 'top', value: bounds.top },
    { name: 'bottom', value: bounds.top + bounds.height },
  ];
}

function findClosestMatch(axis: 'x' | 'y', target: AlignmentBounds, references: AlignmentReference[], threshold: number): AlignmentMatch | undefined {
  let closest: AlignmentMatch | undefined;
  const targetCandidates = getAxisCandidates(target, axis);

  for (const reference of references) {
    const referenceCandidates = getAxisCandidates(reference.bounds, axis);

    for (const targetCandidate of targetCandidates) {
      for (const referenceCandidate of referenceCandidates) {
        const delta = referenceCandidate.value - targetCandidate.value;
        if (Math.abs(delta) > threshold || (closest && Math.abs(delta) >= Math.abs(closest.delta))) continue;

        closest = {
          axis,
          targetAnchor: targetCandidate.name,
          referenceAnchor: referenceCandidate.name,
          position: referenceCandidate.value,
          delta,
          reference,
        };
      }
    }
  }

  return closest;
}

export function calculateAlignment(target: AlignmentBounds, references: AlignmentReference[], thresholdPx: number, zoom: number): AlignmentResult {
  const safeZoom = zoom > 0 ? zoom : 1;
  const threshold = thresholdPx / safeZoom;

  return {
    x: findClosestMatch('x', target, references, threshold),
    y: findClosestMatch('y', target, references, threshold),
  };
}
