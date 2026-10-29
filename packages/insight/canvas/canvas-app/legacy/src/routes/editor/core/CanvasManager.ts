import * as fabric from 'fabric';
import { type CanvasOptions, Canvas } from 'fabric';
import type { EditorConfig, LayerMeta, ShapeKind } from './types';
import { generateId } from './utils/uuid';
import { colorWithOpacity, createRegularPolygonPoints, createStarPoints, DEFAULT_SHAPE_STYLE, SHAPE_LABELS } from './utils/shapeUtils';
import { EventBus } from './EventBus';
import { throttle } from 'lodash-es';
import { useLayerStore } from '../store/layerStore';
import { useEditorStore } from '../store/editorStore';
import { performanceMonitor } from './utils/performance';

export class CanvasManager {
  private canvas!: Canvas;
  private config: EditorConfig;
  private eventBus: EventBus;
  // 添加加载锁,防止并发操作
  private isLoading = false;

  constructor(config: EditorConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
  }

  init(el: HTMLCanvasElement): void {
    const options: Partial<CanvasOptions> = {
      width: this.config.workspaceWidth,
      height: this.config.workspaceHeight,
      backgroundColor: '#000', // 暗黑主题背景
      preserveObjectStacking: true,
      selection: true,
    };

    this.canvas = new Canvas(el, options);
    this.bindEvents();
  }

  // --- Mode Management ---

  private currentMode: 'select' | 'hand' | 'draw' = 'select';
  private isPanning = false;
  private lastPosX = 0;
  private lastPosY = 0;
  // 临时抓手模式：当鼠标在工作区外时自动启用
  private isTemporaryHandMode = false;

  public setMode(mode: 'select' | 'hand' | 'draw'): void {
    this.currentMode = mode;
    useEditorStore.getState().setActiveTool(mode);

    if (!this.canvas) return;

    if (mode === 'hand') {
      this.canvas.selection = false;
      this.canvas.isDrawingMode = false;
      this.canvas.defaultCursor = 'grab';
      this.canvas.hoverCursor = 'grab';
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
      this.canvas.forEachObject(obj => {
        if (obj.id && obj.id.startsWith('workspace-handle-')) {
          obj.set('evented', true);
        } else {
          obj.set('evented', false);
        }
      });
    } else if (mode === 'draw') {
      this.canvas.selection = false;
      this.canvas.isDrawingMode = true;
      this.canvas.defaultCursor = 'crosshair';
      this.canvas.hoverCursor = 'crosshair';
      this.canvas.discardActiveObject();
      this.updateBrush();
    } else {
      // Select mode
      this.canvas.selection = true;
      this.canvas.isDrawingMode = false;
      this.canvas.defaultCursor = 'default';
      this.canvas.hoverCursor = 'move';
      this.canvas.forEachObject(obj => {
        if (obj.id === 'workspace') {
          // pass
        } else {
          obj.set('evented', true);
        }
      });
    }
    this.canvas.requestRenderAll();
  }

  // --- Brush Configuration ---
  private brushState = {
    color: '#000000',
    width: 5,
    hardness: 100, // 1-100
  };

  public setBrushSettings(settings: { color?: string; width?: number; hardness?: number }) {
    if (settings.color !== undefined) this.brushState.color = settings.color;
    if (settings.width !== undefined) this.brushState.width = settings.width;
    if (settings.hardness !== undefined) this.brushState.hardness = settings.hardness;

    if (this.currentMode === 'draw') {
      this.updateBrush();
    }
  }

  private updateBrush() {
    if (!this.canvas) return;

    // Use PencilBrush for drawing
    const brushInstance = new fabric.PencilBrush(this.canvas);
    brushInstance.color = this.brushState.color;
    brushInstance.width = this.brushState.width;

    // Simulate Hardness via Shadow
    if (this.brushState.hardness < 100) {
      const blur = (100 - this.brushState.hardness) / 2;
      brushInstance.shadow = new fabric.Shadow({
        blur: blur,
        color: this.brushState.color,
        affectStroke: true,
      });
    } else {
      brushInstance.shadow = null;
    }

    this.canvas.freeDrawingBrush = brushInstance;
  }

  private bindEvents(): void {
    // Selection Events
    const handleSelection = () => {
      const activeObjects = this.canvas.getActiveObjects();
      const ids = activeObjects.map(obj => obj.id || '').filter(Boolean);
      this.eventBus.emit('selection:change', ids);

      // P1优化: 直接更新 Store
      useLayerStore.getState().setActiveIds(ids);
    };

    this.canvas.on('selection:created', handleSelection);
    this.canvas.on('selection:updated', handleSelection);
    this.canvas.on('selection:cleared', () => {
      this.eventBus.emit('selection:change', []);
      useLayerStore.getState().setActiveIds([]);
    });

    // Object Events (Throttled)
    const handleModification = throttle(() => {
      this.emitLayersChange();
    }, 100);

    this.canvas.on('object:added', e => {
      const obj = e.target;
      if (obj && !obj.id) {
        obj.set('id', generateId());
        if (obj.type === 'path') {
          obj.set('name', 'Path');
        }
      }

      this.emitLayersChange();
      this.markDocumentChanged(obj);
      // 在 hand mode 下新加物体，也要禁用 evented
      if (this.currentMode === 'hand') {
        // 注意：object:added 可能在 loadFromJSON 时触发，也可能在 adding primitive 时触发
        // 若是 addText 主动调用，可能希望即使在 hand mode 也能选中？
        // 按照需求：抓手模式下无法选中。
        // 所以保持 consistent
        const lastObj = this.canvas.getObjects().at(-1);
        if (lastObj) lastObj.set('evented', false);
      }
    });
    this.canvas.on('object:removed', e => {
      this.emitLayersChange();
      this.markDocumentChanged(e.target);
    });
    this.canvas.on('object:modified', e => {
      this.markDocumentChanged(e.target);
      handleModification();
    });

    // --- Panning Logic ---

    // 检测点是否在工作区内
    const isInsideWorkspace = (pointer: { x: number; y: number }): boolean => {
      const workspace = this.getObjectById('workspace');
      if (!workspace) return true; // 没有工作区时默认允许

      const wsLeft = (workspace.left || 0) - (workspace.width || 0) / 2;
      const wsTop = (workspace.top || 0) - (workspace.height || 0) / 2;
      const wsRight = wsLeft + (workspace.width || 0);
      const wsBottom = wsTop + (workspace.height || 0);

      return pointer.x >= wsLeft && pointer.x <= wsRight && pointer.y >= wsTop && pointer.y <= wsBottom;
    };

    // 启用临时抓手模式
    const enableTemporaryHandMode = () => {
      if (this.isTemporaryHandMode) return;
      this.isTemporaryHandMode = true;
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
      this.canvas.defaultCursor = 'grab';
      this.canvas.hoverCursor = 'grab';
    };

    // 恢复原始模式
    const restoreOriginalMode = () => {
      if (!this.isTemporaryHandMode) return;
      this.isTemporaryHandMode = false;

      if (this.currentMode === 'draw') {
        this.canvas.isDrawingMode = true;
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.hoverCursor = 'crosshair';
      } else if (this.currentMode === 'select') {
        this.canvas.selection = true;
        this.canvas.defaultCursor = 'default';
        this.canvas.hoverCursor = 'move';
      }
    };

    this.canvas.on('mouse:down', opt => {
      // 如果点击的是工作区手柄，不触发抓手拖拽
      if (opt.target && opt.target.id?.startsWith('workspace-handle-')) {
        return;
      }

      // 临时抓手模式或正式抓手模式下启用拖拽
      if (this.currentMode === 'hand' || this.isTemporaryHandMode) {
        const e = opt.e as MouseEvent;
        this.isPanning = true;
        this.canvas.setCursor('grabbing');
        this.lastPosX = e.clientX;
        this.lastPosY = e.clientY;
        this.canvas.selection = false;
        e.preventDefault();
        e.stopPropagation();
      }
    });

    this.canvas.on('mouse:move', opt => {
      const pointer = this.canvas.getPointer(opt.e);

      // 非抓手模式下，检测是否需要临时切换
      if (this.currentMode !== 'hand') {
        const hasActiveSelection = this.canvas.getActiveObjects().length > 0;

        // 如果点在工作区内，或者当前有选中对象（正处于编辑态），则不启用临时抓手
        if (isInsideWorkspace(pointer) || hasActiveSelection) {
          restoreOriginalMode();
        } else {
          enableTemporaryHandMode();
        }
      }

      // 处理拖拽
      if (this.isPanning && (this.currentMode === 'hand' || this.isTemporaryHandMode)) {
        const e = opt.e as MouseEvent;
        const vpt = this.canvas.viewportTransform;
        if (vpt) {
          vpt[4] += e.clientX - this.lastPosX;
          vpt[5] += e.clientY - this.lastPosY;
          this.canvas.requestRenderAll();
          this.lastPosX = e.clientX;
          this.lastPosY = e.clientY;
        }
      }
    });

    this.canvas.on('mouse:up', () => {
      if (this.currentMode === 'hand' || this.isTemporaryHandMode) {
        this.isPanning = false;
        if (this.currentMode === 'hand') {
          this.canvas.setCursor('grab');
        } else if (this.isTemporaryHandMode) {
          this.canvas.setCursor('grab');
        }
      }
    });
  }

  private emitLayersChange(): void {
    if (!this.canvas) return;
    const objects = this.canvas.getObjects();
    const layers: LayerMeta[] = objects
      .filter(obj => obj.id !== 'workspace' && !obj.id?.startsWith('workspace-handle-'))
      .map(obj => ({
        id: obj.id || '',
        name: obj.name || obj.type,
        type: obj.type,
        visible: obj.visible !== false,
        locked: !!obj.lockMovementX,
      }))
      .reverse();

    // P1优化: 同时更新 EventBus 和直接更新 Store
    this.eventBus.emit('layer:change', layers);

    // 直接更新 layerStore (高频优化)
    useLayerStore.getState().setLayers(layers);
  }

  private markDocumentChanged(target?: fabric.Object): void {
    if (this.isLoading || target?.id?.startsWith('workspace-handle-')) return;
    useEditorStore.getState().markDocumentChanged();
  }

  private commitObjectModification(target: fabric.Object): void {
    this.canvas.fire('object:modified', { target });
  }

  getCanvas(): Canvas {
    return this.canvas;
  }

  resize(width: number, height: number): void {
    if (!this.canvas) return;
    this.canvas.setDimensions({ width, height });

    // 强制检查和更新高清屏 DPI 渲染
    this.updateDevicePixelRatio();
  }

  /**
   * 检查和更新 Canvas 的设备像素比（解决浏览器缩放到 150%、200% 时页面模糊的问题）
   */
  public updateDevicePixelRatio(): void {
    if (!this.canvas) return;
    const currentRatio = fabric.getEnv().window.devicePixelRatio || 1;
    // 如果 Fabric 记录的 Retina 缩放倍率和当前浏览器物理倍率不符，强制刷新画布 backing store
    if (this.canvas.getRetinaScaling() !== currentRatio) {
      // 获取其实际样式大小
      const width = this.canvas.getWidth();
      const height = this.canvas.getHeight();

      // 在 Fabric v6 中，只需强制设置不同的尺寸触发内部重排，然后再设回来，
      // 因为 setDimensions 只有在发现尺寸真的“改变”时才会更新底层的 retinaScaling
      this.canvas.setDimensions({ width: width + 1, height });
      this.canvas.setDimensions({ width, height });

      // 触发布局和重绘
      this.canvas.requestRenderAll();
    }
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = undefined as any;
    }
  }

  toJSON(): any {
    return this.canvas.toObject(['id', 'name']);
  }

  async loadFromJSON(json: any): Promise<void> {
    // 🔧 防止并发加载导致状态混乱
    if (this.isLoading) {
      throw new Error('Canvas is currently loading, please wait');
    }

    performanceMonitor.mark('loadJSON:start');
    this.isLoading = true;
    try {
      await this.canvas.loadFromJSON(json);

      // ⭐⭐⭐ 加载后确保workspace和handles的状态正确
      this.canvas.forEachObject(obj => {
        if (!obj.id) return;

        // Workspace必须完全锁定不可选中
        if (obj.id === 'workspace') {
          obj.set({
            selectable: false,
            evented: false,
            hoverCursor: 'default',
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
          });
          this.canvas.sendObjectToBack(obj);
          console.log('🔒 Workspace已锁定（loadFromJSON）');
        }
        // Workspace handles必须可交互
        else if (obj.id.startsWith('workspace-handle-')) {
          obj.set({
            selectable: false,
            evented: true, // 手柄必须可交互
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
          });
          console.log(`🔓 Handle ${obj.id} 已设置为可交互`);
        }
        // 普通对象根据当前模式设置
        else {
          if (this.currentMode === 'hand') {
            obj.set({ evented: false });
          } else {
            obj.set({ evented: true });
          }
        }
      });

      this.canvas.requestRenderAll();
      this.emitLayersChange();
    } catch (error) {
      console.error('Failed to load JSON:', error);
      throw error;
    } finally {
      this.isLoading = false;
      performanceMonitor.mark('loadJSON:end');
      performanceMonitor.measure('loadJSON', 'loadJSON:start', 'loadJSON:end');
    }
  }

  // --- Primitives ---

  /**
   * 获取工作区中心坐标（场景坐标系）
   * @returns 工作区中心点的 {left, top} 坐标
   */
  private getWorkspaceCenter(): { left: number; top: number } {
    const workspace = this.getObjectById('workspace');
    if (workspace) {
      // 工作区使用 originX/Y: 'center'，所以 left/top 就是中心点坐标
      return {
        left: workspace.left || 0,
        top: workspace.top || 0,
      };
    }

    // 工作区不存在时，回退到画布可视区域中心
    if (this.canvas) {
      const vpt = this.canvas.viewportTransform;
      const center = this.canvas.getCenter();
      const centerPoint = new fabric.Point(center.left, center.top);
      const scenePoint = fabric.util.transformPoint(centerPoint, fabric.util.invertTransform(vpt || [1, 0, 0, 1, 0, 0]));
      return {
        left: scenePoint.x,
        top: scenePoint.y,
      };
    }

    // 默认值
    return { left: 100, top: 100 };
  }

  public addText(options?: any): fabric.Textbox {
    // 如果当前是抓手模式，临时切换回选择模式，以便用户可以编辑新文本
    if (this.currentMode === 'hand') {
      this.setMode('select');
    }

    performanceMonitor.mark('addText:start');
    // 使用工作区中心作为插入位置
    const { left: centerLeft, top: centerTop } = this.getWorkspaceCenter();

    const text = new fabric.Textbox('我的文本', {
      id: generateId(),
      left: centerLeft,
      top: centerTop,
      fontSize: 40,
      fontFamily: 'Arial',
      fill: '#000000',
      ...options,
    });
    // 居中 origin
    text.set({ originX: 'center', originY: 'center' });

    this.addToCanvas(text);
    performanceMonitor.mark('addText:end');
    performanceMonitor.measure('addText', 'addText:start', 'addText:end');
    return text;
  }

  public addRect(options?: any): fabric.Rect {
    if (this.currentMode === 'hand') {
      this.setMode('select');
    }
    // 使用工作区中心作为插入位置
    const { left: centerLeft, top: centerTop } = this.getWorkspaceCenter();

    const rect = new fabric.Rect({
      id: generateId(),
      left: centerLeft,
      top: centerTop,
      width: 100,
      height: 100,
      fill: '#cccccc',
      originX: 'center',
      originY: 'center',
      ...options,
    });
    this.addToCanvas(rect);
    return rect;
  }

  public addShape(kind: ShapeKind): fabric.Object {
    if (this.currentMode !== 'select') {
      this.setMode('select');
    }

    const { left, top } = this.getWorkspaceCenter();
    const commonOptions = {
      id: generateId(),
      name: SHAPE_LABELS[kind],
      shapeKind: kind,
      left,
      top,
      originX: 'center' as const,
      originY: 'center' as const,
      fillColor: DEFAULT_SHAPE_STYLE.fillColor,
      fillOpacity: DEFAULT_SHAPE_STYLE.fillOpacity,
      strokeColor: DEFAULT_SHAPE_STYLE.strokeColor,
      strokeOpacity: DEFAULT_SHAPE_STYLE.strokeOpacity,
      fill: colorWithOpacity(DEFAULT_SHAPE_STYLE.fillColor, DEFAULT_SHAPE_STYLE.fillOpacity),
      stroke: colorWithOpacity(DEFAULT_SHAPE_STYLE.strokeColor, DEFAULT_SHAPE_STYLE.strokeOpacity),
      strokeWidth: DEFAULT_SHAPE_STYLE.strokeWidth,
      opacity: DEFAULT_SHAPE_STYLE.opacity / 100,
    };

    let shape: fabric.Object;
    switch (kind) {
      case 'circle':
        shape = new fabric.Circle({ ...commonOptions, radius: 80 });
        break;
      case 'triangle':
        shape = new fabric.Triangle({ ...commonOptions, width: 160, height: 160 });
        break;
      case 'square':
        shape = new fabric.Rect({ ...commonOptions, width: 160, height: 160 });
        break;
      case 'rectangle':
        shape = new fabric.Rect({ ...commonOptions, width: 240, height: 160 });
        break;
      case 'star':
        shape = new fabric.Polygon(createStarPoints(5, 80, 34), commonOptions);
        break;
      case 'hexagon':
        shape = new fabric.Polygon(createRegularPolygonPoints(6, 80), commonOptions);
        break;
    }

    this.addToCanvas(shape);
    return shape;
  }

  /**
   * 添加图片到画布
   * @param url 图片URL
   * @returns Promise<fabric.Image>
   */
  public async addImage(url: string): Promise<fabric.Image> {
    // 如果当前是抓手模式，临时切换回选择模式
    if (this.currentMode === 'hand') {
      this.setMode('select');
    }

    performanceMonitor.mark('addImage:start');

    // 加载图片（追加 x-cors 参数避免浏览器复用无 CORS 头的缓存）
    const corsUrl = !url || url.startsWith('data:') || url.startsWith('blob:') ? url : url + (url.includes('?') ? '&' : '?') + 'x-cors=1';
    const img = await fabric.Image.fromURL(corsUrl, {
      crossOrigin: 'anonymous',
    });

    // 使用工作区中心作为插入位置
    const { left: centerLeft, top: centerTop } = this.getWorkspaceCenter();

    // 设置图片属性：分配ID、居中、保持原比例
    img.set({
      id: generateId(),
      left: centerLeft,
      top: centerTop,
      originX: 'center',
      originY: 'center',
    });

    this.addToCanvas(img);

    performanceMonitor.mark('addImage:end');
    performanceMonitor.measure('addImage', 'addImage:start', 'addImage:end');

    return img;
  }

  public deleteSelected(): void {
    const activeObjects = this.canvas.getActiveObjects();
    if (!activeObjects.length) return;

    this.canvas.discardActiveObject();
    activeObjects.forEach(obj => {
      this.canvas.remove(obj);
    });
    this.canvas.requestRenderAll();
  }

  public getObjectById(id: string): fabric.Object | undefined {
    return this.canvas.getObjects().find(obj => obj.id === id);
  }

  private addToCanvas(obj: fabric.Object): void {
    this.canvas.add(obj);
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
  }

  public setSelection(enabled: boolean): void {
    if (this.canvas) {
      // Deprecated: use setMode instead.
      // Keeping for compatibility with EditorEngine's current wrapper,
      // but we will update EditorEngine to use setMode too.
      if (enabled) this.setMode('select');
      else this.canvas.selection = false;
    }
  }

  public disableSelection(): void {
    // Used by resize handles
    this.canvas.selection = false;
  }

  public enableSelection(): void {
    if (this.currentMode === 'select') {
      this.canvas.selection = true;
    }
  }

  // --- Layer Operations ---

  public restoreObjectOrder(ids: string[]): boolean {
    // 历史快照不包含 excludeFromExport 的运行时对象（如 workspace resize handles）。
    // 顺序恢复必须使用与快照相同的对象集合，否则会误判数量不一致并退回完整反序列化。
    const objects = this.canvas.getObjects().filter(object => !object.excludeFromExport);
    if (objects.length !== ids.length) return false;

    const currentIds = objects.map(object => object.id);
    if (currentIds.some(id => !id) || new Set(currentIds).size !== currentIds.length || new Set(ids).size !== ids.length) return false;
    if (ids.some(id => !currentIds.includes(id))) return false;

    const firstMismatch = ids.findIndex((id, index) => currentIds[index] !== id);
    if (firstMismatch === -1) return true;

    const candidates: Array<[number, number]> = [
      [currentIds.indexOf(ids[firstMismatch]), firstMismatch],
      [firstMismatch, ids.indexOf(currentIds[firstMismatch]!)],
    ];
    const move = candidates.find(([fromIndex, toIndex]) => {
      if (fromIndex < 0 || toIndex < 0) return false;
      const reorderedIds = [...currentIds];
      const [movedId] = reorderedIds.splice(fromIndex, 1);
      if (!movedId) return false;
      reorderedIds.splice(toIndex, 0, movedId);
      return reorderedIds.every((id, index) => id === ids[index]);
    });
    if (!move) return false;

    const [fromIndex, toIndex] = move;
    const allObjects = this.canvas.getObjects();
    const targetCanvasIndex = allObjects.indexOf(objects[toIndex]);
    if (targetCanvasIndex === -1 || !this.canvas.moveObjectTo(objects[fromIndex], targetCanvasIndex)) return false;

    this.canvas.requestRenderAll();
    this.emitLayersChange();
    return true;
  }

  /**
   * 重新排序图层
   * @param id 被拖拽对象的 ID
   * @param newIndex 目标位置在面板中的索引（面板顺序：顶层=0）
   */
  public reorderLayer(id: string, newIndex: number): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    // 获取 canvas 中的所有对象（按 Fabric 顺序：底层在前）
    const allObjects = this.canvas.getObjects();

    // 获取可排序的对象列表（排除 workspace 和 workspace-handle）
    const sortableObjects = allObjects.filter(o => o.id !== 'workspace' && !o.id?.startsWith('workspace-handle-'));

    // 当前对象在 sortableObjects 中的索引
    const currentSortableIndex = sortableObjects.indexOf(obj);
    if (currentSortableIndex === -1) return;

    // 面板显示是 reversed 的（顶层在前）
    // 面板中的 newIndex 对应 sortableObjects 中的 (length - 1 - newIndex)
    const targetSortableIndex = sortableObjects.length - 1 - newIndex;

    // 如果位置没有变化，不做任何操作
    if (currentSortableIndex === targetSortableIndex) {
      return;
    }

    // 通过 EventBus 暂停历史记录
    this.eventBus.emit('history:pause');

    try {
      // 计算在 allObjects 中的当前位置
      const currentCanvasIndex = allObjects.indexOf(obj);

      // 计算在 allObjects 中的目标位置
      // 目标对象是 sortableObjects[targetSortableIndex]
      const targetObject = sortableObjects[targetSortableIndex];
      let targetCanvasIndex = allObjects.indexOf(targetObject);

      // 关键修正：当从低索引移到高索引时（在 Fabric 中往上移），
      // 需要插入到目标对象的后面（+1），因为我们要"取代"目标的位置
      if (currentSortableIndex < targetSortableIndex) {
        targetCanvasIndex += 1;
      }

      // moveObjectTo 内部会先移除对象再插入，因此向高索引移动时目标位置要减 1。
      if (currentCanvasIndex < targetCanvasIndex) {
        targetCanvasIndex -= 1;
      }

      this.canvas.moveObjectTo(obj, targetCanvasIndex);
      this.canvas.requestRenderAll();
      this.emitLayersChange();
      this.markDocumentChanged(obj);
    } finally {
      // 恢复历史记录并保存
      this.eventBus.emit('history:resume');
      this.eventBus.emit('history:save');
    }
  }

  /**
   * 切换图层可见性
   */
  public toggleLayerVisibility(id: string): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    obj.set('visible', !obj.visible);
    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  /**
   * 切换图层锁定状态
   */
  public toggleLayerLock(id: string): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    const isLocked = !!obj.lockMovementX;
    obj.set({
      lockMovementX: !isLocked,
      lockMovementY: !isLocked,
      lockScalingX: !isLocked,
      lockScalingY: !isLocked,
      lockRotation: !isLocked,
      selectable: isLocked, // 锁定时不可选中
    });
    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  public async duplicateObject(id: string): Promise<fabric.Object | null> {
    const obj = this.getObjectById(id);
    if (!obj) return null;

    try {
      const cloned = await obj.clone();

      // 遍历克隆对象（及其子对象，如果是 Group）重新生成唯一 ID
      const resetId = (object: fabric.Object) => {
        object.set('id', generateId());
        // 如果是组，递归处理子对象
        if (object.type === 'group' || object.type === 'activeSelection') {
          const group = object as fabric.Group;
          group.getObjects().forEach(resetId);
        }
      };

      resetId(cloned);

      cloned.set({
        left: (cloned.left || 0) + 20,
        top: (cloned.top || 0) + 20,
      });

      this.canvas.discardActiveObject();
      this.canvas.add(cloned);
      this.canvas.setActiveObject(cloned);
      this.canvas.requestRenderAll();
      // 移除手动的 fire('object:added')，因为 canvas.add 内部已经触发了 object:added 会被 HistoryPlugin 收集
      return cloned;
    } catch (error) {
      console.error('Failed to duplicate object:', error);
      return null;
    }
  }

  /**
   * 重命名图层
   */
  public renameLayer(id: string, name: string): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    obj.set('name', name);
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  private getSortableObjectsInfo() {
    const allObjects = this.canvas.getObjects();
    const sortableObjects = allObjects.filter(o => o.id !== 'workspace' && !o.id?.startsWith('workspace-handle-'));
    return { allObjects, sortableObjects };
  }

  /**
   * 移到顶层
   */
  public bringToFront(id: string): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    const { allObjects, sortableObjects } = this.getSortableObjectsInfo();
    if (sortableObjects.length <= 1) return;

    const currentSortableIndex = sortableObjects.indexOf(obj);
    if (currentSortableIndex === -1 || currentSortableIndex === sortableObjects.length - 1) return;

    // The top-most sortable object
    const topSortableObj = sortableObjects[sortableObjects.length - 1];
    const targetCanvasIndex = allObjects.indexOf(topSortableObj);

    this.canvas.moveObjectTo(obj, targetCanvasIndex);
    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  /**
   * 移到底层 (但必须在 workspace 及 handles 之上)
   */
  public sendToBack(id: string): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    const { allObjects, sortableObjects } = this.getSortableObjectsInfo();
    if (sortableObjects.length <= 1) return;

    const currentSortableIndex = sortableObjects.indexOf(obj);
    if (currentSortableIndex <= 0) return;

    // The bottom-most sortable object
    const bottomSortableObj = sortableObjects[0];
    const targetCanvasIndex = allObjects.indexOf(bottomSortableObj);

    this.canvas.moveObjectTo(obj, targetCanvasIndex);
    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  /**
   * 上移一层
   */
  public bringForward(id: string): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    const { allObjects, sortableObjects } = this.getSortableObjectsInfo();
    const currentSortableIndex = sortableObjects.indexOf(obj);

    // 如果不在可排序列表里，或者是最高层，则直接返回
    if (currentSortableIndex === -1 || currentSortableIndex === sortableObjects.length - 1) return;

    // 获取它上方的那个可排序对象
    const objectAbove = sortableObjects[currentSortableIndex + 1];
    const targetCanvasIndex = allObjects.indexOf(objectAbove);

    this.canvas.moveObjectTo(obj, targetCanvasIndex);
    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  /**
   * 下移一层 (不能移到 workspace 及 handles 之下)
   */
  public sendBackward(id: string): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    const { allObjects, sortableObjects } = this.getSortableObjectsInfo();
    const currentSortableIndex = sortableObjects.indexOf(obj);

    // 如果不在可排序列表里，或者是最低层，则直接返回
    if (currentSortableIndex <= 0) return;

    // 获取它下方的那个可排序对象
    const objectBelow = sortableObjects[currentSortableIndex - 1];
    const targetCanvasIndex = allObjects.indexOf(objectBelow);

    this.canvas.moveObjectTo(obj, targetCanvasIndex);
    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  // --- Property Updates ---

  /**
   * 更新对象属性
   */
  public updateObjectProps(id: string, props: any): void {
    const obj = this.getObjectById(id);
    if (!obj) return;

    obj.set(props);
    obj.setCoords();
    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(obj);
  }

  /**
   * 对齐对象
   */
  public alignObjects(ids: string[], alignment: string): void {
    if (ids.length === 0) return;

    const objects = ids.map(id => this.getObjectById(id)).filter(Boolean) as fabric.Object[];
    if (objects.length === 0) return;

    // 获取工作区作为参考
    const workspace = this.getObjectById('workspace');
    if (!workspace) return;

    const workspaceBounds = workspace.getBoundingRect();

    objects.forEach(obj => {
      const objBounds = obj.getBoundingRect();

      switch (alignment) {
        case 'left':
          obj.set('left', workspaceBounds.left + (obj.left || 0) - objBounds.left);
          break;
        case 'center':
          obj.set('left', workspaceBounds.left + workspaceBounds.width / 2 - objBounds.width / 2 + (obj.left || 0) - objBounds.left);
          break;
        case 'right':
          obj.set('left', workspaceBounds.left + workspaceBounds.width - objBounds.width + (obj.left || 0) - objBounds.left);
          break;
        case 'top':
          obj.set('top', workspaceBounds.top + (obj.top || 0) - objBounds.top);
          break;
        case 'middle':
          obj.set('top', workspaceBounds.top + workspaceBounds.height / 2 - objBounds.height / 2 + (obj.top || 0) - objBounds.top);
          break;
        case 'bottom':
          obj.set('top', workspaceBounds.top + workspaceBounds.height - objBounds.height + (obj.top || 0) - objBounds.top);
          break;
      }

      obj.setCoords();
    });

    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.commitObjectModification(objects[0]);
  }

  /**
   * 获取当前选中的对象
   */
  public getActiveObject(): fabric.Object | null {
    return this.canvas.getActiveObject() || null;
  }

  /**
   * 获取所有选中的对象
   */
  public getActiveObjects(): fabric.Object[] {
    return this.canvas.getActiveObjects();
  }

  // --- Zoom Operations ---

  public zoomIn(): void {
    let zoom = this.canvas.getZoom();
    zoom *= 1.1; // +10%
    if (zoom > 20) zoom = 20; // Max zoom
    this.setZoom(zoom);
  }

  public zoomOut(): void {
    let zoom = this.canvas.getZoom();
    zoom /= 1.1; // -10%
    if (zoom < 0.01) zoom = 0.01; // Min zoom
    this.setZoom(zoom);
  }

  public setZoom(value: number): void {
    const center = this.canvas.getCenter();
    const centerPoint = new fabric.Point(center.left, center.top);
    this.canvas.zoomToPoint(centerPoint, value);
    this.canvas.requestRenderAll();
    // Emit event for WorkspacePlugin to update handles
    this.eventBus.emit('canvas:zoom', { zoom: value });
  }

  public getZoom(): number {
    return this.canvas.getZoom();
  }

  // --- Grouping Operations ---

  public group(): void {
    const activeObject = this.canvas.getActiveObject();
    if (!activeObject || activeObject.type !== 'activeSelection') {
      return;
    }

    const activeSelection = activeObject as fabric.ActiveSelection;
    const objects = activeSelection.getObjects();

    // Clear current selection
    activeSelection.removeAll();
    this.canvas.discardActiveObject();

    // Remove objects from canvas (to be moved into group)
    objects.forEach(obj => {
      this.canvas.remove(obj);
    });

    // Create Group
    const group = new fabric.Group(objects);

    this.canvas.add(group);
    this.canvas.setActiveObject(group);

    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.canvas.fire('object:modified');
  }

  public ungroup(): void {
    const activeObject = this.canvas.getActiveObject();
    if (!activeObject || activeObject.type !== 'group') {
      return;
    }

    const group = activeObject as fabric.Group;
    const objects = group.getObjects();

    // Destroy group
    this.canvas.remove(group);
    this.canvas.discardActiveObject();

    // Add objects back to canvas
    objects.forEach(obj => {
      this.canvas.add(obj);
    });

    // Select ungrouped objects
    const selection = new fabric.ActiveSelection(objects, {
      canvas: this.canvas,
    });
    this.canvas.setActiveObject(selection);

    this.canvas.requestRenderAll();
    this.emitLayersChange();
    this.canvas.fire('object:modified');
  }

  // --- Export Operations ---

  public exportImage(options: { format: 'png' | 'jpeg'; quality: number; multiplier: number }): string {
    if (!this.canvas) return '';

    const workspace = this.getObjectById('workspace');
    if (!workspace) {
      console.error('Workspace object not found');
      return '';
    }

    // 1. 保存当前状态
    const vpt = [...(this.canvas.viewportTransform || [1, 0, 0, 1, 0, 0])];
    const activeObjects = this.canvas.getActiveObjects();
    this.canvas.discardActiveObject();

    // 隐藏手柄和辅助线
    const hiddenObjects: fabric.Object[] = [];
    this.canvas.forEachObject(obj => {
      if (obj.id?.startsWith('workspace-handle-') && obj.visible) {
        obj.visible = false;
        hiddenObjects.push(obj);
      }
    });

    // 标记导出状态（用于点阵渲染等）
    (workspace as any)._isExporting = true;
    workspace.dirty = true;

    // 临时背景处理 (Fabric 导出默认会合并 canvas.backgroundColor)
    const savedBgColor = this.canvas.backgroundColor;
    this.canvas.backgroundColor = '';

    // --- 核心修复：临时重置视口到标准 1:1 状态并对齐工作区 ---
    // 这解决了“下载整个画布”的问题，因为 left/top 现在相对于视口绝对安全 (0,0)
    // 同时也消除了 zoom 导致的 1px 浮点数精度偏差
    const wsWidth = workspace.width;
    const wsHeight = workspace.height;
    // 计算场景坐标中的左上角
    const wsLeft = workspace.left - wsWidth / 2;
    const wsTop = workspace.top - wsHeight / 2;

    // 设置视口：缩放为 1，且将工作区左上角平移到 (0,0)
    this.canvas.setViewportTransform([1, 0, 0, 1, -wsLeft, -wsTop]);
    this.canvas.renderAll();

    // 2. 导出
    const dataUrl = this.canvas.toDataURL({
      format: options.format,
      quality: options.quality,
      multiplier: options.multiplier,
      left: 0,
      top: 0,
      width: wsWidth,
      height: wsHeight,
      enableRetinaScaling: false,
    });

    // 3. 恢复状态
    (workspace as any)._isExporting = false;
    workspace.dirty = true;
    this.canvas.backgroundColor = savedBgColor;
    hiddenObjects.forEach(obj => {
      obj.visible = true;
    });

    // 恢复原来的视口变换
    this.canvas.setViewportTransform(vpt as any);

    if (activeObjects.length > 0) {
      const selection = new fabric.ActiveSelection(activeObjects, {
        canvas: this.canvas,
      });
      this.canvas.setActiveObject(selection);
    }
    this.canvas.requestRenderAll();

    return dataUrl;
  }
}
