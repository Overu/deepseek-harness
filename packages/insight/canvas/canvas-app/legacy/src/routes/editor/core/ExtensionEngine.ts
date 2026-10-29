import * as fabric from 'fabric';

export interface ExtensionResult {
  canvasSize: {
    width: number;
    height: number;
  };
  imageLayout: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
}

export class ExtensionEngine {
  public canvas: fabric.Canvas | null = null;
  public image: fabric.Image | null = null;
  public mask: fabric.Rect | null = null;

  private onMaskChangeCallback?: (width: number, height: number) => void;
  private onTooltipChangeCallback?: (info: { visible: boolean; x: number; y: number; text: string }) => void;
  private tooltipTimeout: any = null;
  
  private lockedRatio: number | null = null;
  private preScaleData: any = null;

  public init(canvasEl: HTMLCanvasElement): void {
    this.canvas = new fabric.Canvas(canvasEl, {
      backgroundColor: '#1C1C1E',
      selection: false,
      preserveObjectStacking: true,
      uniformScaling: false,
    });

    this.setupCanvasPanZoom();
  }

  public setOnMaskChange(cb: (width: number, height: number) => void) {
    this.onMaskChangeCallback = cb;
  }

  public setOnTooltipChange(cb: (info: { visible: boolean; x: number; y: number; text: string }) => void) {
    this.onTooltipChangeCallback = cb;
  }

  public applyRatio(ratioStr: string) {
    if (!this.mask || !this.image || !this.canvas) return;
    
    if (ratioStr === 'custom') {
      this.lockedRatio = null;
      this.mask.set({ lockUniScaling: false });
      this.canvas.requestRenderAll();
      return;
    }

    let ratio = 1;
    if (ratioStr === 'original') {
      ratio = this.image.getScaledWidth() / this.image.getScaledHeight();
    } else {
      const parts = ratioStr.split(':');
      if (parts.length !== 2) return;
      ratio = parseFloat(parts[0]) / parseFloat(parts[1]);
    }

    const imgW = this.image.getScaledWidth();
    const imgH = this.image.getScaledHeight();

    // 严密贴合原始图片：求出恰好包含原图边界的最紧致指定比例外框
    const finalW = Math.max(imgW, imgH * ratio);
    const finalH = Math.max(imgH, imgW / ratio);

    this.lockedRatio = ratio;

    this.mask.set({
      scaleX: finalW / this.mask.width,
      scaleY: finalH / this.mask.height,
      lockUniScaling: true, // 重要：锁定宽高比等比例拉伸
    });

    const newW = this.mask.getScaledWidth();
    const newH = this.mask.getScaledHeight();

    // 依照原图中心点对齐
    const imgCx = this.image.left + imgW / 2;
    const imgCy = this.image.top + imgH / 2;

    this.mask.set({
      left: imgCx - newW / 2,
      top: imgCy - newH / 2,
    });

    this.mask.setCoords();
    this.canvas.requestRenderAll();
    this.triggerMaskChange();

    // 当横图切到 9:16 这类极端比例时，遮罩尺寸会瞬间大幅变化。
    // 这里主动重算视口，让完整遮罩重新进入可视区；同时适当减小留白，让主体不要缩得过小。
    this.zoomToFit(0.12);
  }

  private triggerTooltipChange(e: MouseEvent | null, visible: boolean) {
    if (!this.onTooltipChangeCallback || !this.mask) return;

    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = null;
    }

    if (!visible) {
      this.tooltipTimeout = setTimeout(() => {
        if (this.onTooltipChangeCallback) {
          this.onTooltipChangeCallback({ visible: false, x: 0, y: 0, text: '' });
        }
      }, 1000);
      return;
    }

    if (!e) return;

    const w = Math.round(this.mask.width * this.mask.scaleX!);
    const h = Math.round(this.mask.height * this.mask.scaleY!);
    const text = `${w} x ${h}`;

    this.onTooltipChangeCallback({ visible: true, x: e.clientX, y: e.clientY, text });
  }

  public async loadImage(url: string): Promise<void> {
    if (!this.canvas) return;

    return new Promise((resolve, reject) => {
      const imgEl = new Image();
      imgEl.crossOrigin = 'anonymous';
      imgEl.onload = () => {
        this.image = new fabric.Image(imgEl, {
          left: 0,
          top: 0,
          selectable: false,
          evented: false,
          hasControls: false,
        });

        this.canvas?.add(this.image);
        this.createMask();
        this.zoomToFit();
        resolve();
      };
      imgEl.onerror = () => reject(new Error('图片加载失败'));
      imgEl.src = url;
    });
  }

  private createMask() {
    if (!this.canvas || !this.image) return;

    const imgWidth = this.image.width * this.image.scaleX;
    const imgHeight = this.image.height * this.image.scaleY;
    const imgLeft = this.image.left;
    const imgTop = this.image.top;

    this.mask = new fabric.Rect({
      left: imgLeft,
      top: imgTop,
      width: imgWidth,
      height: imgHeight,
      fill: 'rgba(255, 255, 255, 0.1)', // 听取建议，改为直接增加细微色块提升辨识度
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: true,
      hasBorders: true,
      hasControls: true,
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#00a8ff',
      cornerSize: 12,
      lockRotation: true,
      objectCaching: false,
    });

    this.mask.setControlsVisibility({
      mtr: false,
    });

    // 废除多余的全屏 setupOverlayRender，直接将九宫格写入 mask._render 生命周期，极致性能与绑定
    const originalRender = (this.mask as any)._render.bind(this.mask);
    (this.mask as any)._render = function (ctx: CanvasRenderingContext2D) {
      originalRender(ctx);

      ctx.save();
      const w = this.width;
      const h = this.height;
      const stepX = w / 3;
      const stepY = h / 3;

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      // 抵消本身的缩放，让内部画线也视觉统一
      ctx.lineWidth = 1 / Math.max(this.scaleX, this.scaleY);

      ctx.moveTo(-w / 2 + stepX, -h / 2);
      ctx.lineTo(-w / 2 + stepX, h / 2);
      ctx.moveTo(-w / 2 + stepX * 2, -h / 2);
      ctx.lineTo(-w / 2 + stepX * 2, h / 2);

      ctx.moveTo(-w / 2, -h / 2 + stepY);
      ctx.lineTo(w / 2, -h / 2 + stepY);
      ctx.moveTo(-w / 2, -h / 2 + stepY * 2);
      ctx.lineTo(w / 2, -h / 2 + stepY * 2);

      ctx.stroke();

      // 绘制外部主边框，替代原生 strokeWidth，只为视觉展示，绝不仅入真实的 getScaledWidth 几何运算导致长胖！
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / Math.max(this.scaleX, this.scaleY);
      ctx.strokeRect(-w / 2, -h / 2, w, h);

      ctx.restore();
    };

    this.canvas.add(this.mask);
    this.canvas.setActiveObject(this.mask);

    this.setupMaskConstraints();
    this.triggerMaskChange();
  }

  public zoomToFit(paddingRatio = 0.25) {
    // 采用稳定下刷机制，避免读取空高宽
    requestAnimationFrame(() => {
      if (!this.canvas || !this.mask || !this.image) return;

      const cw = this.canvas.getWidth();
      const ch = this.canvas.getHeight();

      if (cw === 0 || ch === 0) return;

      // 默认保留较安全的外边距；某些场景（如比例切换后）可传入更小留白，让主体占比更大。
      const safePaddingRatio = Math.max(0.05, Math.min(paddingRatio, 0.4));
      const paddingX = cw * safePaddingRatio;
      const paddingY = ch * safePaddingRatio;

      const maskW = this.mask.getScaledWidth();
      const maskH = this.mask.getScaledHeight();

      const scaleX = (cw - paddingX * 2) / maskW;
      const scaleY = (ch - paddingY * 2) / maskH;
      const zoom = Math.min(scaleX, scaleY);

      // 安全计算纯几何中心点，杜绝 getCenterPoint API 可能受对象原点突变引起的计算偏离
      const maskCx = this.mask.left + maskW / 2;
      const maskCy = this.mask.top + maskH / 2;

      const tx = cw / 2 - maskCx * zoom;
      const ty = ch / 2 - maskCy * zoom;

      // 强制使用纯净矩阵赋值：[scaleX, skew, skew, scaleY, tx, ty]
      this.canvas.setViewportTransform([zoom, 0, 0, zoom, tx, ty]);
      this.canvas.requestRenderAll();
    });
  }

  private setupMaskConstraints() {
    if (!this.canvas || !this.mask || !this.image) return;

    this.mask.on('mousedown', () => {
      if (this.mask) {
        this.preScaleData = {
          left: this.mask.left,
          top: this.mask.top,
          width: this.mask.getScaledWidth(),
          height: this.mask.getScaledHeight(),
          cx: this.mask.left + this.mask.getScaledWidth() / 2,
          cy: this.mask.top + this.mask.getScaledHeight() / 2,
        };
      }
    });

    this.mask.on('scaling', (e: any) => {
      if (!this.mask || !this.image) return;

      const imgL = this.image.left;
      const imgT = this.image.top;
      const imgR = imgL + this.image.getScaledWidth();
      const imgB = imgT + this.image.getScaledHeight();

      let maskL = this.mask.left;
      let maskT = this.mask.top;
      let maskW = this.mask.getScaledWidth();
      let maskH = this.mask.getScaledHeight();

      let changed = false;

      // Extract viewport constraints once
      const vpt = this.canvas!.viewportTransform;
      let visL = -Infinity, visT = -Infinity, visR = Infinity, visB = Infinity;
      if (vpt) {
        const cw = this.canvas!.getWidth();
        const ch = this.canvas!.getHeight();
        const padding = 1 / vpt[0];
        visL = (-vpt[4] / vpt[0]) + padding;
        visT = (-vpt[5] / vpt[0]) + padding;
        visR = ((cw - vpt[4]) / vpt[0]) - padding;
        visB = ((ch - vpt[5]) / vpt[0]) - padding;
      }

      if (this.lockedRatio !== null && this.preScaleData) {
        // ============================================
        // 锁定比例模式 (Locked Ratio Mode)
        // ============================================
        const transform = e.transform;
        const corner = transform ? transform.corner : '';
        const prev = this.preScaleData;

        // 1. 初步等比拉伸
        if (['ml', 'mr'].includes(corner)) {
          maskH = maskW / this.lockedRatio;
          maskT = prev.cy - maskH / 2;
          if (corner === 'ml') maskL = prev.left + prev.width - maskW;
          else maskL = prev.left;
        } else if (['mt', 'mb'].includes(corner)) {
          maskW = maskH * this.lockedRatio;
          maskL = prev.cx - maskW / 2;
          if (corner === 'mt') maskT = prev.top + prev.height - maskH;
          else maskT = prev.top;
        } else {
          // corners natively scale both uniformly in Fabric, but we enforce strictly
          maskH = maskW / this.lockedRatio;
        }

        // 2. 计算安全尺寸极值
        // 最小尺寸必须能够包下图片（长和宽至少都得大于等于图片的长和宽）
        const minW = Math.max(imgR - imgL, (imgB - imgT) * this.lockedRatio);
        // 最大尺寸不能超过可视窗口
        let maxW = Infinity;
        if (vpt) {
            maxW = Math.min(visR - visL, (visB - visT) * this.lockedRatio);
        }

        // 3. 截断尺寸（如果非法则回弹）
        // 尺寸限制绝对不会改变比例
        if (maskW < minW) { maskW = minW; changed = true; }
        if (maskW > maxW) { maskW = maxW; changed = true; }
        
        maskH = maskW / this.lockedRatio;

        // 如果尺寸被强行限制回弹了，此时坐标也要按照用户拖拽的把手方向修正
        // 例如拉右边受阻，只能左边不动，右边退回去。
        if (changed) {
            if (['ml', 'tl', 'bl'].includes(corner)) maskL = prev.left + prev.width - maskW;
            else if (['mt', 'mb'].includes(corner)) maskL = prev.cx - maskW / 2;
            else maskL = prev.left;

            if (['mt', 'tl', 'tr'].includes(corner)) maskT = prev.top + prev.height - maskH;
            else if (['ml', 'mr'].includes(corner)) maskT = prev.cy - maskH / 2;
            else maskT = prev.top;
        }

        // 4. 定位限制检查 (仅在已锁定的安全尺寸下游动)
        // 绝不可内切入图片内部
        if (maskL > imgL) maskL = imgL;
        if (maskT > imgT) maskT = imgT;
        if (maskL + maskW < imgR) maskL = imgR - maskW;
        if (maskT + maskH < imgB) maskT = imgB - maskH;

        // 绝不可越过可视窗口边缘 (Viewport limits)
        if (vpt) {
            if (maskL < visL) maskL = visL;
            if (maskT < visT) maskT = visT;
            if (maskL + maskW > visR) maskL = visR - maskW;
            if (maskT + maskH > visB) maskT = visB - maskH;
        }
        
        // 此时强制更新属性触发重染
        changed = true;

      } else {
        // ============================================
        // 自由尺寸模式 (Freeform Custom Mode)
        // ============================================

        // 挤压锁定算法 1：绝不小於原圖，不可切入原图内
        if (maskL > imgL) { maskW += (maskL - imgL); maskL = imgL; changed = true; }
        if (maskT > imgT) { maskH += (maskT - imgT); maskT = imgT; changed = true; }
        if (maskL + maskW < imgR) { maskW = imgR - maskL; changed = true; }
        if (maskT + maskH < imgB) { maskH = imgB - maskT; changed = true; }

        // 挤压锁定算法 2：控制遮罩仅在可视窗口内拉伸
        if (vpt) {
          if (maskL < visL) { maskW -= (visL - maskL); maskL = visL; changed = true; }
          if (maskT < visT) { maskH -= (visT - maskT); maskT = visT; changed = true; }
          if (maskL + maskW > visR) { maskW = visR - maskL; changed = true; }
          if (maskT + maskH > visB) { maskH = visB - maskT; changed = true; }
        }
      }

      if (changed) {
        this.mask.set({
          left: maskL,
          top: maskT,
          scaleX: maskW / this.mask.width,
          scaleY: maskH / this.mask.height,
        });
        this.mask.setCoords();
      }

      this.triggerTooltipChange(e.e as MouseEvent, true);
      this.triggerMaskChange();
    });

    this.mask.on('moving', () => {
      if (!this.mask || !this.image) return;

      const imgL = this.image.left;
      const imgT = this.image.top;
      const imgR = imgL + this.image.getScaledWidth();
      const imgB = imgT + this.image.getScaledHeight();

      let maskL = this.mask.left;
      let maskT = this.mask.top;
      const maskW = this.mask.getScaledWidth();
      const maskH = this.mask.getScaledHeight();

      // 不可移出原圖框
      if (maskL > imgL) maskL = imgL;
      if (maskT > imgT) maskT = imgT;
      if (maskL + maskW < imgR) maskL = imgR - maskW;
      if (maskT + maskH < imgB) maskT = imgB - maskH;

      // 控制遮罩仅在可视窗口内移动
      const vpt = this.canvas.viewportTransform;
      if (vpt) {
        const cw = this.canvas.getWidth();
        const ch = this.canvas.getHeight();
        const padding = 1 / vpt[0];
        const visL = (-vpt[4] / vpt[0]) + padding;
        const visT = (-vpt[5] / vpt[0]) + padding;
        const visR = ((cw - vpt[4]) / vpt[0]) - padding;
        const visB = ((ch - vpt[5]) / vpt[0]) - padding;

        if (maskL < visL) maskL = visL;
        if (maskT < visT) maskT = visT;
        if (maskL + maskW > visR) maskL = visR - maskW;
        if (maskT + maskH > visB) maskT = visB - maskH;
      }

      this.mask.set({ left: maskL, top: maskT });
      this.mask.setCoords(); // 位移也须更新把手圈
    });

    this.canvas.on('selection:cleared', () => {
      if (this.mask && this.canvas) {
        this.canvas.setActiveObject(this.mask);
      }
    });
  }

  public resizeMask(targetWidth: number, targetHeight: number) {
    if (!this.mask || !this.image || !this.canvas) return;

    // 我们自主通过几何推算纯净中心，不再依赖可能波动的 API 转换
    const cx = this.mask.left + this.mask.getScaledWidth() / 2;
    const cy = this.mask.top + this.mask.getScaledHeight() / 2;

    const finalW = Math.max(targetWidth, this.image.getScaledWidth());
    const finalH = Math.max(targetHeight, this.image.getScaledHeight());

    this.mask.set({
      scaleX: finalW / this.mask.width,
      scaleY: finalH / this.mask.height,
      fill: 'rgba(255, 255, 255, 0.1)',
    });

    const newW = this.mask.getScaledWidth();
    const newH = this.mask.getScaledHeight();

    // 强迫中心点维持在之前位置
    this.mask.set({
      left: cx - newW / 2,
      top: cy - newH / 2,
    });

    this.mask.setCoords();

    this.canvas.requestRenderAll();
    this.triggerMaskChange();
    // 故意不再阻断用户自己选择好的缩放距离！保持当前的缩放视角
  }

  private triggerMaskChange() {
    if (this.mask && this.onMaskChangeCallback) {
      this.onMaskChangeCallback(Math.round(this.mask.getScaledWidth()), Math.round(this.mask.getScaledHeight()));
    }
  }

  public getResult(): ExtensionResult | null {
    if (!this.mask || !this.image) return null;

    const maskW = this.mask.getScaledWidth();
    const maskH = this.mask.getScaledHeight();

    const result: ExtensionResult = {
      canvasSize: {
        width: Math.round(maskW),
        height: Math.round(maskH),
      },
      imageLayout: [
        {
          left: Math.round(this.image.left - this.mask.left),
          top: Math.round(this.image.top - this.mask.top),
          width: Math.round(this.image.getScaledWidth()),
          height: Math.round(this.image.getScaledHeight()),
        },
      ],
    };

    return result;
  }

  private setupCanvasPanZoom() {
    if (!this.canvas) return;

    this.canvas.on('mouse:wheel', opt => {
      if (!this.canvas || !this.image) return;
      const delta = opt.e.deltaY;
      let zoom = this.canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 10) zoom = 10;
      if (zoom < 0.05) zoom = 0.05;

      // 将编辑器的zoom始终锁定在【图片中心点】，而非鼠标点
      const imgCx = this.image.left + this.image.getScaledWidth() / 2;
      const imgCy = this.image.top + this.image.getScaledHeight() / 2;

      const vpt = this.canvas.viewportTransform;
      if (!vpt) return;

      // 换算为屏幕点位给 zoomToPoint 使用
      const screenPoint = new fabric.Point(imgCx * vpt[0] + vpt[4], imgCy * vpt[3] + vpt[5]);

      this.canvas.zoomToPoint(screenPoint, zoom);

      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    let isDragging = false;
    let lastPosX = 0;
    let lastPosY = 0;

    this.canvas.on('mouse:down', opt => {
      const evt = opt.e as MouseEvent;
      if (evt.button === 1 || evt.altKey) {
        isDragging = true;
        this.canvas!.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
      }
    });

    this.canvas.on('mouse:move', opt => {
      if (isDragging && this.canvas) {
        const e = opt.e as MouseEvent;
        const vpt = this.canvas.viewportTransform;
        if (!vpt) return;
        vpt[4] += e.clientX - lastPosX;
        vpt[5] += e.clientY - lastPosY;
        this.canvas.setViewportTransform(vpt);
        this.canvas.requestRenderAll();
        lastPosX = e.clientX;
        lastPosY = e.clientY;
      }
    });

    this.canvas.on('mouse:up', () => {
      this.triggerTooltipChange(null, false);
      if (this.canvas) {
        this.canvas.setViewportTransform(this.canvas.viewportTransform!);
        isDragging = false;
      }
    });
  }

  public dispose() {
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
  }
}
