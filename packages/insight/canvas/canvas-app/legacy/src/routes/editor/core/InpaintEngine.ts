import * as fabric from 'fabric';

const MIN_IMAGE_DISPLAY_SIZE = 200;
const MAX_IMAGE_DISPLAY_SIZE = 2048;
const MIN_VIEWPORT_INTERSECTION = 100;

export interface InpaintImageInfo {
  editWidth: number;
  editHeight: number;
  screenRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export class InpaintEngine {
  public canvas: fabric.Canvas | null = null;
  public image: fabric.Image | null = null;

  private imageEditSize = { width: 0, height: 0 };

  public init(canvasEl: HTMLCanvasElement): void {
    this.canvas = new fabric.Canvas(canvasEl, {
      backgroundColor: '#050505',
      selection: false,
      preserveObjectStacking: true,
    });
  }

  public resize(width: number, height: number): void {
    if (!this.canvas || width <= 0 || height <= 0) return;
    if (this.canvas.getWidth() !== width) this.canvas.setWidth(width);
    if (this.canvas.getHeight() !== height) this.canvas.setHeight(height);
    this.zoomToFit();
  }

  public async loadImage(url: string): Promise<void> {
    if (!this.canvas) return;

    const img = await fabric.FabricImage.fromURL(url, {
      crossOrigin: 'anonymous',
    });

    const element = img.getElement() as HTMLImageElement;
    const naturalWidth = element.naturalWidth || img.width || 0;
    const naturalHeight = element.naturalHeight || img.height || 0;
    const editScale = Math.min(1, 1024 / Math.max(naturalWidth, naturalHeight, 1));
    this.imageEditSize = {
      width: Math.max(1, Math.round(naturalWidth * editScale)),
      height: Math.max(1, Math.round(naturalHeight * editScale)),
    };

    img.set({
      left: 0,
      top: 0,
      scaleX: editScale,
      scaleY: editScale,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
    });

    this.image = img;
    this.canvas.clear();
    this.canvas.add(img);
    this.zoomToFit();
  }

  public zoomToFit(paddingRatio = 0.16): void {
    if (!this.canvas || !this.image) return;

    const cw = this.canvas.getWidth();
    const ch = this.canvas.getHeight();
    const imgW = this.image.getScaledWidth() || 1;
    const imgH = this.image.getScaledHeight() || 1;
    const paddingX = cw * paddingRatio;
    const paddingY = ch * paddingRatio;
    const zoom = Math.min((cw - paddingX * 2) / imgW, (ch - paddingY * 2) / imgH);
    this.centerAtZoom(this.clampZoom(zoom));
  }

  public getImageInfo(): InpaintImageInfo | null {
    if (!this.canvas || !this.image) return null;

    const vpt = this.canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const width = this.image.getScaledWidth() * vpt[0];
    const height = this.image.getScaledHeight() * vpt[3];

    return {
      editWidth: this.imageEditSize.width,
      editHeight: this.imageEditSize.height,
      screenRect: {
        left: vpt[4],
        top: vpt[5],
        width,
        height,
      },
    };
  }

  public zoomAt(_clientX: number, _clientY: number, factor: number): void {
    this.zoomBy(factor);
  }

  public zoomBy(factor: number): void {
    if (!this.canvas || !this.image) return;
    const zoom = this.clampZoom(this.canvas.getZoom() * factor);
    this.centerAtZoom(zoom);
  }

  public panBy(deltaX: number, deltaY: number): void {
    if (!this.canvas || !this.image) return;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    const vpt = this.canvas.viewportTransform || [this.canvas.getZoom(), 0, 0, this.canvas.getZoom(), 0, 0];
    const zoom = vpt[0] || this.canvas.getZoom();
    const next = this.clampViewportPosition(vpt[4] + deltaX, vpt[5] + deltaY, zoom);
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, next.x, next.y]);
    this.canvas.renderAll();
  }

  private clampZoom(zoom: number): number {
    if (!this.image) return Math.max(0.05, Math.min(zoom, 10));

    const imgW = this.image.getScaledWidth() || 1;
    const imgH = this.image.getScaledHeight() || 1;
    const imageMaxSide = Math.max(imgW, imgH, 1);
    const minZoom = MIN_IMAGE_DISPLAY_SIZE / imageMaxSide;
    const maxZoom = MAX_IMAGE_DISPLAY_SIZE / imageMaxSide;
    return Math.max(minZoom, Math.min(zoom, maxZoom));
  }

  private centerAtZoom(zoom: number): void {
    if (!this.canvas || !this.image) return;

    const cw = this.canvas.getWidth();
    const ch = this.canvas.getHeight();
    const imgW = this.image.getScaledWidth() || 1;
    const imgH = this.image.getScaledHeight() || 1;
    const centered = this.clampViewportPosition(cw / 2 - (imgW * zoom) / 2, ch / 2 - (imgH * zoom) / 2, zoom);
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, centered.x, centered.y]);
    this.canvas.renderAll();
  }

  private clampViewportPosition(left: number, top: number, zoom: number): { x: number; y: number } {
    if (!this.canvas || !this.image) return { x: left, y: top };

    const canvasWidth = this.canvas.getWidth();
    const canvasHeight = this.canvas.getHeight();
    const imageWidth = (this.image.getScaledWidth() || 1) * zoom;
    const imageHeight = (this.image.getScaledHeight() || 1) * zoom;

    return {
      x: this.clampAxis(left, imageWidth, canvasWidth),
      y: this.clampAxis(top, imageHeight, canvasHeight),
    };
  }

  private clampAxis(position: number, contentSize: number, viewportSize: number): number {
    const minVisible = Math.min(MIN_VIEWPORT_INTERSECTION, contentSize, viewportSize);
    const minPosition = minVisible - contentSize;
    const maxPosition = viewportSize - minVisible;
    return Math.max(minPosition, Math.min(position, maxPosition));
  }

  public dispose(): void {
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
  }
}
