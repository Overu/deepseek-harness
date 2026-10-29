import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { EdgeLabelRenderer, useViewport } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import { useFlowStore } from '@/store/flowStore';

interface EdgeDeleteControlProps {
  id: string;
  edgePath: string;
  labelX: number;
  labelY: number;
  selected?: boolean;
  interactionWidth?: number;
  children: ReactNode;
}

let svgPoint: SVGPoint | null = null;

function closestOnPath(path: SVGPathElement, clientX: number, clientY: number) {
  const ctm = path.getScreenCTM();
  const svg = path.ownerSVGElement;
  if (!ctm || !svg) return null;

  if (!svgPoint) svgPoint = svg.createSVGPoint();
  svgPoint.x = clientX;
  svgPoint.y = clientY;
  const { x: mx, y: my } = svgPoint.matrixTransform(ctm.inverse());

  const len = path.getTotalLength();
  if (!len) return null;

  let bestD = 0;
  let minDist = Infinity;
  const step = len / 12;
  for (let d = 0; d <= len; d += step) {
    const p = path.getPointAtLength(d);
    const dist = (p.x - mx) ** 2 + (p.y - my) ** 2;
    if (dist < minDist) {
      minDist = dist;
      bestD = d;
    }
  }

  let best = path.getPointAtLength(bestD);
  const refine = step / 4;
  for (let d = Math.max(0, bestD - step); d <= Math.min(len, bestD + step); d += refine) {
    const p = path.getPointAtLength(d);
    const dist = (p.x - mx) ** 2 + (p.y - my) ** 2;
    if (dist < minDist) {
      minDist = dist;
      best = p;
    }
  }
  return { x: best.x, y: best.y };
}

const SHOW_DELAY_MS = 1000;
const HIDE_DELAY_MS = 80;
const DELETE_BTN_CLASS = 'nodrag nopan edge-delete-button w-8 h-8 rounded-full bg-[#1a1a1a] border border-white/20 flex items-center justify-center text-white cursor-pointer';

type TimerKey = 'show' | 'hide';

const EdgeDeleteControl = ({ id, edgePath, labelX, labelY, selected = false, interactionWidth = 20, children }: EdgeDeleteControlProps) => {
  const [showButton, setShowButton] = useState(false);
  const pathRef = useRef<SVGPathElement>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const posRef = useRef({ x: labelX, y: labelY });
  const rafRef = useRef(0);
  const timersRef = useRef<{ show: ReturnType<typeof setTimeout> | null; hide: ReturnType<typeof setTimeout> | null }>({
    show: null,
    hide: null,
  });
  const hoverSessionRef = useRef(0);
  const onButtonRef = useRef(false);
  const { zoom } = useViewport();

  const readOnly = useFlowStore(state => state.readOnly);
  const deleteEdges = useFlowStore(state => state.actions.deleteEdges);

  const paintButton = (btn: HTMLButtonElement | null = btnRef.current) => {
    if (!btn) return;
    const { x, y } = posRef.current;
    const z = 1 / Math.max(zoom, 0.1);
    btn.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${z})`;
  };

  const clearTimer = (key: TimerKey) => {
    const timer = timersRef.current[key];
    if (timer) {
      clearTimeout(timer);
      timersRef.current[key] = null;
    }
  };

  const clearAllTimers = () => {
    clearTimer('show');
    clearTimer('hide');
  };

  const isPointerOverControl = () => onButtonRef.current || !!pathRef.current?.matches(':hover') || !!btnRef.current?.matches(':hover');

  const hideButton = () => {
    hoverSessionRef.current += 1;
    clearAllTimers();
    setShowButton(false);
  };

  const scheduleHide = () => {
    if (onButtonRef.current) return;
    clearTimer('hide');
    timersRef.current.hide = setTimeout(() => {
      timersRef.current.hide = null;
      if (onButtonRef.current || isPointerOverControl()) return;
      hideButton();
    }, HIDE_DELAY_MS);
  };

  const updatePosition = (clientX: number, clientY: number, paint = false) => {
    const path = pathRef.current;
    if (!path) return;
    const point = closestOnPath(path, clientX, clientY);
    if (!point) return;

    if (paint) {
      const { x, y } = posRef.current;
      if (Math.abs(point.x - x) < 0.5 && Math.abs(point.y - y) < 0.5) return;
      posRef.current = point;
      paintButton();
    } else {
      posRef.current = point;
    }
  };

  const schedulePaintMove = (clientX: number, clientY: number) => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (btnRef.current) updatePosition(clientX, clientY, true);
    });
  };

  const scheduleShow = (session: number) => {
    clearTimer('show');
    if (selected) {
      if (session === hoverSessionRef.current) setShowButton(true);
      return;
    }
    timersRef.current.show = setTimeout(() => {
      timersRef.current.show = null;
      if (session !== hoverSessionRef.current) return;
      setShowButton(true);
    }, SHOW_DELAY_MS);
  };

  const handlePathEnter = (e: MouseEvent<SVGPathElement>) => {
    const session = ++hoverSessionRef.current;
    clearTimer('hide');
    updatePosition(e.clientX, e.clientY);
    scheduleShow(session);
  };

  const handlePathMove = (e: MouseEvent<SVGPathElement>) => {
    if (showButton) {
      schedulePaintMove(e.clientX, e.clientY);
    } else {
      updatePosition(e.clientX, e.clientY);
    }
    clearTimer('hide');
  };

  const handlePathLeave = (e: MouseEvent<SVGPathElement>) => {
    if (onButtonRef.current) return;
    const related = e.relatedTarget;
    if (related instanceof Element && related.closest('.edge-delete-button')) return;
    hoverSessionRef.current += 1;
    clearTimer('show');
    if (showButton) scheduleHide();
  };

  const handleButtonEnter = () => {
    onButtonRef.current = true;
    clearAllTimers();
  };

  const handleButtonLeave = (e: MouseEvent<HTMLButtonElement>) => {
    onButtonRef.current = false;
    const related = e.relatedTarget;
    if (related === pathRef.current || (related instanceof Node && pathRef.current?.contains(related))) return;
    scheduleHide();
  };

  useEffect(() => {
    if (!selected || showButton) return;
    if (!pathRef.current?.matches(':hover')) return;
    clearTimer('show');
    setShowButton(true);
  }, [selected, showButton]);

  useEffect(() => {
    if (showButton) paintButton();
  }, [zoom, showButton]);

  useEffect(
    () => () => {
      clearAllTimers();
      cancelAnimationFrame(rafRef.current);
    },
    []
  );

  if (readOnly) return <>{children}</>;

  return (
    <>
      {children}
      <path
        ref={pathRef}
        d={edgePath}
        fill='none'
        stroke='transparent'
        strokeWidth={interactionWidth}
        onMouseEnter={handlePathEnter}
        onMouseMove={handlePathMove}
        onMouseLeave={handlePathLeave}
      />
      {showButton && (
        <EdgeLabelRenderer>
          <button
            ref={el => {
              btnRef.current = el;
              if (el) paintButton(el);
            }}
            type='button'
            className={DELETE_BTN_CLASS}
            style={{ position: 'absolute', pointerEvents: 'all' }}
            onMouseEnter={handleButtonEnter}
            onMouseLeave={handleButtonLeave}
            onClick={e => {
              e.stopPropagation();
              deleteEdges([id]);
            }}
          >
            <Scissors size={16} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default EdgeDeleteControl;
