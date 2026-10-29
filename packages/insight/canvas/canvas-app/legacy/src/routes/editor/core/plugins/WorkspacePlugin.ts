import { Canvas, Rect, type TPointerEventInfo, Point } from 'fabric';
import type { IPlugin } from '../types';
import type { EditorEngine } from '../EditorEngine';
import { DEFAULT_WORKSPACE_HEIGHT, DEFAULT_WORKSPACE_WIDTH, WORKSPACE_ID, ZOOM_RATIO, MIN_ZOOM, MAX_ZOOM } from '../constants';
import { throttle } from 'lodash-es';

const HANDLE_WIDTH = 8;
const HANDLE_LENGTH = 60;
const HANDLE_OFFSET = 20; // 手柄与workspace的间距
const HANDLE_COLOR = '#4b5563'; // gray-600
const HANDLE_HOVER_COLOR = '#9ca3af'; // gray-400

export class WorkspacePlugin implements IPlugin {
  name = 'WorkspacePlugin';
  private canvas!: Canvas;
  private editor: EditorEngine;
  private resizeObserver: ResizeObserver | null = null;
  private containerEl: HTMLElement | null = null;
  private boundHandleWheel: (opt: TPointerEventInfo) => void;

  // 拉伸手柄
  private handles: {
    top?: Rect;
    bottom?: Rect;
    left?: Rect;
    right?: Rect;
  } = {};

  // 拉伸状态
  private isResizing = false;
  private resizeDirection: 'n' | 's' | 'w' | 'e' | '' = '';
  private startPointer = { x: 0, y: 0 };
  private startDim = { width: 0, height: 0 };
  private startCenter = { x: 0, y: 0 };
  private autoFitTimeout: number | undefined;

  // ClipPath for workspace bounds
  private clipRect: Rect | null = null;

  private context?: any;

  constructor(editor: EditorEngine) {
    this.editor = editor;
    this.boundHandleWheel = this.handleWheel.bind(this);
  }

  init(context?: any): void {
    this.context = context;
    this.canvas = this.editor.canvasManager.getCanvas();
    if (!this.canvas) {
      console.error('WorkspacePlugin.init: Canvas 未初始化');
      return;
    }

    this.createWorkspace();
    this.createResizeHandles();
    this.initEvents();
    this.startAutoFit();

    // 监听历史记录变化，重新创建手柄
    if (this.context) {
      this.context.on('history:undo', (options?: { orderOnly?: boolean }) => {
        if (!options?.orderOnly) this.refreshHandles();
      });
      this.context.on('history:redo', (options?: { orderOnly?: boolean }) => {
        if (!options?.orderOnly) this.refreshHandles();
      });
      this.context.on('canvas:loaded', () => this.refreshHandles());
    }

    // 确保 React 组件挂载后能收到初始尺寸
    Promise.resolve().then(() => {
      const workspace = this.getWorkspace();
      if (workspace) {
        this.editor.eventBus.emit('workspace:change', {
          width: workspace.width,
          height: workspace.height,
        });

        // 发送初始颜色
        this.editor.eventBus.emit('workspace:color:change', (workspace.fill as string) || '#ffffff');
      }
    });

    console.log('WorkspacePlugin initialized');
  }

  // Undo/Redo 后刷新手柄
  private refreshHandles(): void {
    // 1. 清理旧引用
    this.handles = {};

    // 2. 尝试从Canvas中移除可能存在的残留手柄 (防御性清理)
    const objects = this.canvas.getObjects();
    objects.forEach(obj => {
      if (obj.id && obj.id.startsWith('workspace-handle-')) {
        this.canvas.remove(obj);
      }
    });

    // 3. 重新创建手柄
    this.createResizeHandles();

    // 4. 更新位置和裁剪路径 (裁剪路径必须与历史恢复的宽高对齐)
    setTimeout(() => {
      this.updateHandlePositions();
      this.updateClipPath();
    }, 0);

    // 5. 同步颜色 (Undo/Redo 可能改变了颜色)
    const workspace = this.getWorkspace();
    if (workspace) {
      this.editor.eventBus.emit('workspace:color:change', (workspace.fill as string) || '#ffffff');

      // 检查并在需要时重新注册底层渲染逻辑
      if (!(workspace as any)._hasMatrixRender) {
        this.injectDotMatrixRender(workspace);
        (workspace as any)._hasMatrixRender = true; // 打个标记防止重复注入
      }
    }
  }

  private createWorkspace(): void {
    // 使用 EditorEngine 传入的初始尺寸，而非 constants 中的 window 尺寸
    const initialWidth = Math.round(this.editor.options.workspaceWidth || 1000);
    const initialHeight = Math.round(this.editor.options.workspaceHeight || 1000);

    const workspace = new Rect({
      id: WORKSPACE_ID,
      width: initialWidth,
      height: initialHeight,
      fill: '#ffffff',
      selectable: false,
      evented: false,
      hoverCursor: 'default',
      hasControls: false,
      hasBorders: false,
      stroke: '#ffffff',
      strokeWidth: 2,
      strokeUniform: true,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      originX: 'center',
      originY: 'center',
    });

    // 注入自定义底层渲染逻辑 (点阵)
    this.injectDotMatrixRender(workspace);
    (workspace as any)._hasMatrixRender = true;

    this.canvas.add(workspace);
    this.canvas.sendObjectToBack(workspace);

    // 启用工作区裁剪
    this.enableClipping(workspace);

    // 触发初始尺寸事件，确保 UI 能立即获取到正确的尺寸
    this.editor.eventBus.emit('workspace:change', {
      width: DEFAULT_WORKSPACE_WIDTH,
      height: DEFAULT_WORKSPACE_HEIGHT,
    });
  }

  private injectDotMatrixRender(workspace: Rect): void {
    // 缓存原始渲染方法
    const originalRender = workspace._render.bind(workspace);

    // 重写 render 钩子
    workspace._render = function (ctx: CanvasRenderingContext2D) {
      if ((this as any)._isExporting) {
        // 当处于导出状态时，只绘制基本的颜色填充，不绘制点阵和强制 2px 白色外边框
        originalRender(ctx);
        return;
      }

      // 保存上下文以绘制底层
      ctx.save();

      const width = this.width || 0;
      const height = this.height || 0;
      const left = -width / 2;
      const top = -height / 2;

      // 第0步：设置裁剪区域，使得底部的点阵绝对不会超长/超出工作区边界
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip(); // 限制后续绘制都在该矩形内

      // Dot 配置
      const dotSize = 5; // 圆点直径
      const gap = 30; // 间距

      // 圆点颜色 (确保不与透明颜色融合，使用灰色)
      const dotColor = 'rgba(128, 128, 128, 0.8)';

      ctx.beginPath();
      ctx.fillStyle = dotColor;

      // 绘制点阵矩阵
      for (let x = left; x < width / 2; x += gap) {
        for (let y = top; y < height / 2; y += gap) {
          ctx.moveTo(x, y);
          ctx.arc(x, y, dotSize / 2, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      ctx.restore(); // 恢复裁剪之前的状态，以便原生方法进行完整的边界（包含边框）等渲染

      // 执行原本的渲染逻辑 (内部会处理自身的 fill、stroke 和 opacity)
      originalRender(ctx);

      // 手动强制再绘制一层 2px 的外部描边，确保不论底层对象如何都被覆盖
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.strokeStyle = '#ffffff';

      // Fabric zoom factor affects strokeWidth. To keep it visually 2px constant
      // regardless of canvas scale, divide by the current zoom.
      const zoom = this.canvas?.getZoom() || 1;
      ctx.lineWidth = 2 / zoom;

      ctx.stroke();
      ctx.restore();
    };
  }

  private createResizeHandles(): void {
    const workspace = this.getWorkspace();
    if (!workspace) return;

    ['top', 'bottom', 'left', 'right'].forEach(key => {
      const type = key as 'top' | 'bottom' | 'left' | 'right';
      const config = this.getHandleConfig(workspace, type);

      const handle = new Rect({
        ...config,
        fill: HANDLE_COLOR,
        rx: 4 / this.canvas.getZoom(), // 保持圆角视觉大小
        ry: 4 / this.canvas.getZoom(),
        selectable: false,
        evented: true,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hoverCursor: key === 'top' || key === 'bottom' ? 'ns-resize' : 'ew-resize',
        excludeFromExport: true,
        clipPath: undefined, // 手柄不受 canvas clipPath 影响
      } as any);

      this.handles[type] = handle;
      this.canvas.add(handle);
    });

    // 手柄创建完成后，立即置顶，确保高于所有既有对象
    this.bringHandlesToFront();
  }

  /** 将四个拖拽手柄置于 Canvas 对象栈的最顶层，确保不会被任何内容对象遮盖 */
  private bringHandlesToFront(): void {
    (['top', 'bottom', 'left', 'right'] as const).forEach(key => {
      const handle = this.handles[key];
      if (handle) {
        this.canvas.bringObjectToFront(handle);
      }
    });
  }

  private getHandleConfig(workspace: Rect, type: 'top' | 'bottom' | 'left' | 'right') {
    const center = workspace.getCenterPoint();
    const halfW = workspace.width / 2;
    const halfH = workspace.height / 2;
    const zoom = this.canvas.getZoom();

    const offset = HANDLE_OFFSET / zoom;
    const width = type === 'top' || type === 'bottom' ? HANDLE_LENGTH / zoom : HANDLE_WIDTH / zoom;
    const height = type === 'top' || type === 'bottom' ? HANDLE_WIDTH / zoom : HANDLE_LENGTH / zoom;

    let left = center.x;
    let top = center.y;

    if (type === 'top') {
      top = center.y - halfH - offset;
    } else if (type === 'bottom') {
      top = center.y + halfH + offset;
    } else if (type === 'left') {
      left = center.x - halfW - offset;
    } else if (type === 'right') {
      left = center.x + halfW + offset;
    }

    return {
      id: `workspace-handle-${type}`,
      width,
      height,
      left,
      top,
      originX: 'center' as const,
      originY: 'center' as const,
    };
  }

  private updateHandlePositions(): void {
    const workspace = this.getWorkspace();
    if (!workspace) return;

    const zoom = this.canvas.getZoom();

    (['top', 'bottom', 'left', 'right'] as const).forEach(key => {
      const handle = this.handles[key];
      if (handle) {
        const config = this.getHandleConfig(workspace, key);
        handle.set({
          left: config.left,
          top: config.top,
          width: config.width,
          height: config.height,
          rx: 4 / zoom,
          ry: 4 / zoom,
        });
        handle.setCoords();
      }
    });

    this.canvas.requestRenderAll();
  }

  private initEvents(): void {
    // 滚轮缩放
    this.canvas.on('mouse:wheel', this.boundHandleWheel);

    // 鼠标按下事件
    this.canvas.on('mouse:down', (opt: TPointerEventInfo) => {
      const target = opt.target;
      if (!target || !target.id) return;

      // 检查是否点击了拉伸手柄
      if (target.id.startsWith('workspace-handle-')) {
        this.startResize(target.id, opt);
      }
    });

    // 鼠标移动事件
    this.canvas.on('mouse:move', (opt: TPointerEventInfo) => {
      if (this.isResizing) {
        this.performResize(opt);
      }
    });

    // 鼠标释放事件
    this.canvas.on('mouse:up', () => {
      if (this.isResizing) {
        this.endResize();
      }
    });

    // 鼠标悬停事件 - 高亮手柄
    this.canvas.on('mouse:over', (opt: any) => {
      const target = opt.target;
      if (target && target.id && target.id.startsWith('workspace-handle-')) {
        target.set({ fill: HANDLE_HOVER_COLOR });
        this.canvas.requestRenderAll();
      }
    });

    this.canvas.on('mouse:out', (opt: any) => {
      const target = opt.target;
      if (target && target.id && target.id.startsWith('workspace-handle-')) {
        target.set({ fill: HANDLE_COLOR });
        this.canvas.requestRenderAll();
      }
    });

    // 监听对象添加，确保workspace和手柄始终不可选中
    this.canvas.on('object:added', (e: any) => {
      const obj = e.target;
      if (!obj || !obj.id) return;

      if (obj.id === WORKSPACE_ID || obj.id.startsWith('workspace-handle-')) {
        const isHandle = obj.id.startsWith('workspace-handle-');

        obj.set({
          selectable: false,
          evented: isHandle,
          hasControls: false,
          hasBorders: false,
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
        });

        if (obj.id === WORKSPACE_ID) {
          this.canvas.sendObjectToBack(obj);
        }
      } else {
        // 新的内容对象加入后，将手柄重新置顶，防止其遮盖手柄
        this.bringHandlesToFront();
      }
    });
  }

  private startResize(handleId: string, opt: TPointerEventInfo): void {
    if (handleId.includes('top')) this.resizeDirection = 'n';
    else if (handleId.includes('bottom')) this.resizeDirection = 's';
    else if (handleId.includes('left')) this.resizeDirection = 'w';
    else if (handleId.includes('right')) this.resizeDirection = 'e';
    else return;

    this.isResizing = true;
    this.editor.canvasManager.disableSelection();

    const e = opt.e as MouseEvent;
    this.startPointer = { x: e.clientX, y: e.clientY };

    const workspace = this.getWorkspace();
    if (workspace) {
      const center = workspace.getCenterPoint();
      this.startDim = {
        width: workspace.width || 0,
        height: workspace.height || 0,
      };
      this.startCenter = { x: center.x, y: center.y };
    }

    opt.e.preventDefault();
    opt.e.stopPropagation();
  }

  private performResize(opt: TPointerEventInfo): void {
    const workspace = this.getWorkspace();
    if (!workspace) return;

    const e = opt.e as MouseEvent;
    const zoom = this.canvas.getZoom();
    const deltaX = (e.clientX - this.startPointer.x) / zoom;
    const deltaY = (e.clientY - this.startPointer.y) / zoom;

    let newWidth = this.startDim.width;
    let newHeight = this.startDim.height;
    let newCenterX = this.startCenter.x;
    let newCenterY = this.startCenter.y;

    switch (this.resizeDirection) {
      case 'e':
        newWidth = this.startDim.width + deltaX;
        newCenterX = this.startCenter.x + deltaX / 2;
        break;
      case 'w':
        newWidth = this.startDim.width - deltaX;
        newCenterX = this.startCenter.x + deltaX / 2;
        break;
      case 's':
        newHeight = this.startDim.height + deltaY;
        newCenterY = this.startCenter.y + deltaY / 2;
        break;
      case 'n':
        newHeight = this.startDim.height - deltaY;
        newCenterY = this.startCenter.y + deltaY / 2;
        break;
    }

    newWidth = Math.max(100, newWidth);
    newHeight = Math.max(100, newHeight);

    const roundedWidth = Math.round(newWidth);
    const roundedHeight = Math.round(newHeight);

    workspace.set({
      width: roundedWidth,
      height: roundedHeight,
      left: newCenterX,
      top: newCenterY,
    });
    workspace.setCoords();

    this.updateHandlePositions();
    this.updateClipPath();

    this.canvas.requestRenderAll();

    this.editor.eventBus.emit('workspace:change', {
      width: newWidth,
      height: newHeight,
    });
  }

  private endResize(): void {
    this.isResizing = false;
    this.resizeDirection = '';
    this.editor.canvasManager.enableSelection();

    const workspace = this.getWorkspace();
    if (workspace) {
      const historyPlugin = this.editor.pluginManager.get('HistoryPlugin');
      if (historyPlugin && 'saveState' in historyPlugin) {
        setTimeout(() => {
          this.canvas.fire('object:modified', { target: workspace });
        }, 50);
      }
    }
  }

  // 启用工作区裁剪 - 超出工作区的对象将被隐藏
  // 使用对象级别的 clipPath，而非 canvas 级别，这样手柄不会被裁剪
  private enableClipping(workspace: Rect): void {
    // 创建与 workspace 同尺寸的 clipPath
    this.clipRect = new Rect({
      left: workspace.left,
      top: workspace.top,
      width: workspace.width,
      height: workspace.height,
      originX: 'center',
      originY: 'center',
      absolutePositioned: true, // 使用画布绝对坐标
    });

    // 不设置 canvas.clipPath，而是监听对象添加事件
    // 为每个需要裁剪的对象单独设置 clipPath
    this.canvas.on('object:added', (e: any) => {
      this.applyClipPathToObject(e.target);
    });

    // 为现有对象应用 clipPath
    this.applyClipPathToAllObjects();

    this.canvas.requestRenderAll();
  }

  // 为单个对象应用 clipPath（排除 workspace 和手柄）
  private applyClipPathToObject(obj: any): void {
    if (!obj || !this.clipRect) return;

    // 排除 workspace 和手柄
    if (obj.id === WORKSPACE_ID || (obj.id && obj.id.startsWith('workspace-handle-'))) {
      return;
    }

    // 为对象设置 clipPath
    obj.clipPath = this.clipRect;
  }

  // 为所有现有对象应用 clipPath
  private applyClipPathToAllObjects(): void {
    this.canvas.getObjects().forEach(obj => {
      this.applyClipPathToObject(obj);
    });
  }

  // 更新裁剪区域位置和尺寸
  private updateClipPath(): void {
    const workspace = this.getWorkspace();
    if (!workspace || !this.clipRect) return;

    this.clipRect.set({
      left: workspace.left,
      top: workspace.top,
      width: workspace.width,
      height: workspace.height,
    });

    // 重新应用 clipPath 到所有对象（因为 clipRect 引用已更新）
    this.applyClipPathToAllObjects();
    this.canvas.requestRenderAll();
  }

  private getWorkspace(): Rect | undefined {
    if (!this.canvas) return undefined;
    return this.canvas.getObjects().find(obj => obj.id === WORKSPACE_ID) as Rect | undefined;
  }

  private handleWheel(opt: TPointerEventInfo): void {
    const e = opt.e as WheelEvent;

    // Ctrl/Cmd + Wheel = Zoom
    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl) {
      // Zoom Logic
      const delta = e.deltaY;
      let zoom = this.canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > MAX_ZOOM) zoom = MAX_ZOOM;
      if (zoom < MIN_ZOOM) zoom = MIN_ZOOM;

      this.canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom);

      this.updateHandlePositions();
      this.editor.eventBus.emit('canvas:zoom', { zoom });
    } else {
      // Pan Logic (Standard trackpad/wheel panning)
      // 如果按下了 Shift，将纵向滚动转化为横向滚动（Windows / Linux 常见交互）
      let panX = e.deltaX;
      let panY = e.deltaY;

      if (e.shiftKey && e.deltaX === 0) {
        panX = e.deltaY;
        panY = 0;
      }

      // Use relativePan for better compatibility with Fabric's rendering loop and controls
      this.canvas.relativePan(new Point(-panX, -panY));

      // relativePan automatically requests render and updates controls positions
      // Explicitly calling requestRenderAll for safety
      this.canvas.requestRenderAll();
    }

    e.preventDefault();
    e.stopPropagation();
  }

  private startAutoFit(): void {
    this.containerEl = this.canvas.getElement().parentElement;
    if (!this.containerEl) return;

    this.resizeObserver = new ResizeObserver(
      throttle(() => {
        this.autoFit();
      }, 50)
    );
    this.resizeObserver.observe(this.containerEl);

    this.autoFitTimeout = window.setTimeout(() => this.autoFit(), 0);
  }

  autoFit(): void {
    if (!this.containerEl) return;

    const workspace = this.getWorkspace();
    if (!workspace) return;

    const containerWidth = this.containerEl.clientWidth;
    const containerHeight = this.containerEl.clientHeight;

    // 更新 canvas 容器尺寸
    this.editor.canvasManager.resize(containerWidth, containerHeight);

    // 根据 **实际工作区尺寸** 计算 zoom，确保工作区完整可见
    const workspaceWidth = workspace.width || 1000;
    const workspaceHeight = workspace.height || 1000;

    const scaleX = (containerWidth * ZOOM_RATIO) / workspaceWidth;
    const scaleY = (containerHeight * ZOOM_RATIO) / workspaceHeight;
    const zoom = Math.min(scaleX, scaleY);

    // 重置视口并应用 zoom
    const center = this.canvas.getCenter();
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.canvas.zoomToPoint(new Point(center.left, center.top), zoom);

    // 将工作区居中
    workspace.set({
      left: center.left,
      top: center.top,
    });
    workspace.setCoords();

    this.editor.eventBus.emit('workspace:change', {
      width: workspace.width,
      height: workspace.height,
    });

    this.updateHandlePositions();
    this.updateClipPath();
    this.canvas.requestRenderAll();
  }

  // 公共API
  setSize(width: number, height: number): void {
    const workspace = this.getWorkspace();
    if (workspace) {
      const roundedW = Math.round(width);
      const roundedH = Math.round(height);
      workspace.set({ width: roundedW, height: roundedH });
      workspace.setCoords();
      this.updateHandlePositions();
      this.updateClipPath();
      this.canvas.requestRenderAll();

      this.editor.eventBus.emit('workspace:change', {
        width: roundedW,
        height: roundedH,
      });

      setTimeout(() => {
        this.canvas.fire('object:modified', { target: workspace });
      }, 50);
    }
  }

  setBackgroundColor(color: string): void {
    const workspace = this.getWorkspace();
    if (workspace) {
      workspace.set({ fill: color });
      this.canvas.requestRenderAll();

      this.editor.eventBus.emit('workspace:color:change', color);

      setTimeout(() => {
        this.canvas.fire('object:modified', { target: workspace });
      }, 50);
    }
  }

  getBackgroundColor(): string {
    const workspace = this.getWorkspace();
    return (workspace?.fill as string) || '#ffffff';
  }

  destroy(): void {
    if (!this.canvas) {
      console.warn('WorkspacePlugin.destroy: canvas 未初始化，跳过清理');
      return;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.autoFitTimeout) {
      clearTimeout(this.autoFitTimeout);
    }

    this.canvas.off('mouse:wheel', this.boundHandleWheel);
    this.canvas.off('mouse:down');
    this.canvas.off('mouse:move');
    this.canvas.off('mouse:up');
    this.canvas.off('mouse:over');
    this.canvas.off('mouse:out');
    this.canvas.off('object:added');

    const workspace = this.getWorkspace();
    if (workspace) {
      this.canvas.remove(workspace);
    }

    Object.values(this.handles).forEach(handle => {
      if (handle) {
        this.canvas.remove(handle);
      }
    });

    console.log('🔌 WorkspacePlugin 已销毁');
  }
}
