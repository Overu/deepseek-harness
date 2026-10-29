import { Point, type BasicTransformEvent, type Canvas, type FabricObject, type TPointerEvent } from 'fabric';
import type { IPlugin } from '../types';
import { WORKSPACE_ID } from '../constants';
import type { PluginContext } from './PluginContext';
import { calculateAlignment, type AlignmentBounds, type AlignmentReference, type AlignmentResult } from '../utils/alignmentGuides';

const ALIGNMENT_THRESHOLD_PX = 5;
const GUIDE_COLOR = '#FF6A3B';
const GUIDE_OPACITY = 0.35;
const GUIDE_HIGHLIGHT_OPACITY = 0.6;
const GUIDE_HIGHLIGHT_DURATION_MS = 160;
const GUIDE_LINE_WIDTH_PX = 1;
const GUIDE_DASH_PX = 4;

type MovingEvent = BasicTransformEvent<TPointerEvent> & { target: FabricObject };

export class AlignmentGuidesPlugin implements IPlugin {
  name = 'AlignmentGuidesPlugin';

  private canvas?: Canvas;
  private alignment: AlignmentResult = {};
  private targetBounds?: AlignmentBounds;
  private snapKey = '';
  private highlightUntil = 0;
  private highlightTimer?: number;
  private cachedReferences?: AlignmentReference[];

  init(context?: PluginContext): void {
    if (!context) return;

    this.canvas = context.canvas;
    this.canvas.on('object:moving', this.handleMoving);
    this.canvas.on('before:render', this.handleBeforeRender);
    this.canvas.on('after:render', this.handleAfterRender);
    this.canvas.on('mouse:up', this.handleMouseUp);
  }

  destroy(): void {
    if (!this.canvas) return;

    this.canvas.off('object:moving', this.handleMoving);
    this.canvas.off('before:render', this.handleBeforeRender);
    this.canvas.off('after:render', this.handleAfterRender);
    this.canvas.off('mouse:up', this.handleMouseUp);
    this.clearHighlightTimer();
    this.clearAlignment();
    this.canvas = undefined;
  }

  private readonly handleMoving = (event: MovingEvent): void => {
    if (!this.canvas || this.isEditorObject(event.target)) {
      this.clearAlignment();
      return;
    }

    const references = this.getReferences(event.target);
    if (references.length === 0) {
      this.clearAlignment();
      return;
    }

    const target = event.target;
    target.setCoords();
    this.alignment = calculateAlignment(target.getBoundingRect(), references, ALIGNMENT_THRESHOLD_PX, this.canvas.getZoom());

    const x = target.getXY();
    target.setXY(new Point(x.x + (this.alignment.x?.delta ?? 0), x.y + (this.alignment.y?.delta ?? 0)));
    target.setCoords();
    this.targetBounds = target.getBoundingRect();

    const nextSnapKey = [this.alignment.x, this.alignment.y].map(match => (match ? `${match.reference.key}:${match.targetAnchor}:${match.referenceAnchor}` : '')).join('|');
    if (nextSnapKey === '|') {
      this.snapKey = '';
      return;
    }

    if (nextSnapKey !== this.snapKey) {
      this.snapKey = nextSnapKey;
      this.highlightUntil = Date.now() + GUIDE_HIGHLIGHT_DURATION_MS;
      this.scheduleHighlightEnd();
    }
  };

  private readonly handleBeforeRender = (): void => {
    if (!this.canvas) return;
    const context = this.canvas.getSelectionContext();
    if (!context) return;
    this.canvas.clearContext(context);
  };

  private readonly handleAfterRender = (): void => {
    if (!this.canvas || !this.targetBounds || (!this.alignment.x && !this.alignment.y)) return;

    const context = this.canvas.getSelectionContext();
    if (!context) return;
    const zoom = this.canvas.getZoom();

    context.save();
    context.transform(...this.canvas.viewportTransform);
    context.strokeStyle = GUIDE_COLOR;
    context.globalAlpha = Date.now() < this.highlightUntil ? GUIDE_HIGHLIGHT_OPACITY : GUIDE_OPACITY;
    context.lineWidth = GUIDE_LINE_WIDTH_PX / zoom;
    context.setLineDash([GUIDE_DASH_PX / zoom, GUIDE_DASH_PX / zoom]);
    context.beginPath();

    if (this.alignment.x) {
      const referenceBounds = this.alignment.x.reference.bounds;
      context.moveTo(this.alignment.x.position, Math.min(this.targetBounds.top, referenceBounds.top));
      context.lineTo(this.alignment.x.position, Math.max(this.targetBounds.top + this.targetBounds.height, referenceBounds.top + referenceBounds.height));
    }
    if (this.alignment.y) {
      const referenceBounds = this.alignment.y.reference.bounds;
      context.moveTo(Math.min(this.targetBounds.left, referenceBounds.left), this.alignment.y.position);
      context.lineTo(Math.max(this.targetBounds.left + this.targetBounds.width, referenceBounds.left + referenceBounds.width), this.alignment.y.position);
    }

    context.stroke();
    context.restore();
  };

  private readonly handleMouseUp = (): void => {
    this.clearAlignment();
    this.canvas?.requestRenderAll();
  };

  private getReferences(target: FabricObject): AlignmentReference[] {
    if (this.cachedReferences) {
      return this.cachedReferences;
    }
    if (!this.canvas) return [];

    const objects = this.canvas.getObjects();
    const workspace = objects.find(object => object.id === WORKSPACE_ID);
    if (!workspace) return [];

    const selectedObjects = new Set(this.canvas.getActiveObjects());
    selectedObjects.add(target);

    this.cachedReferences = [
      { key: WORKSPACE_ID, bounds: workspace.getBoundingRect() },
      ...objects
        .filter(object => object.visible && !selectedObjects.has(object) && !this.isEditorObject(object))
        .map((object, index) => ({
          key: object.id || `layer-${index}`,
          bounds: object.getBoundingRect(),
        })),
    ];

    return this.cachedReferences;
  }

  private isEditorObject(target: FabricObject): boolean {
    return target.id === WORKSPACE_ID || target.id?.startsWith('workspace-handle-') === true;
  }

  private scheduleHighlightEnd(): void {
    this.clearHighlightTimer();
    this.highlightTimer = window.setTimeout(() => {
      this.highlightTimer = undefined;
      this.canvas?.requestRenderAll();
    }, GUIDE_HIGHLIGHT_DURATION_MS);
  }

  private clearHighlightTimer(): void {
    if (this.highlightTimer === undefined) return;
    window.clearTimeout(this.highlightTimer);
    this.highlightTimer = undefined;
  }

  private clearAlignment(): void {
    this.alignment = {};
    this.targetBounds = undefined;
    this.snapKey = '';
    this.highlightUntil = 0;
    this.cachedReferences = undefined;
    this.clearHighlightTimer();
  }
}
