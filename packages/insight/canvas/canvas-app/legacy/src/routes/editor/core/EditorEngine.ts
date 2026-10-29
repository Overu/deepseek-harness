import './fabric-extensions';
import { CanvasManager } from './CanvasManager';
import { EventBus } from './EventBus';
import { PluginManager } from './plugins/PluginManager';
import { PluginContext } from './plugins/PluginContext';
import { WorkspacePlugin } from './plugins/WorkspacePlugin';
import { HistoryPlugin } from './plugins/HistoryPlugin';
import { ShortcutPlugin } from './plugins/ShortcutPlugin';
import { AlignmentGuidesPlugin } from './plugins/AlignmentGuidesPlugin';
import { performanceMonitor } from './utils/performance';
import type { EditorConfig, ShapeKind } from './types';
import * as fabric from 'fabric';
import { Canvas } from 'fabric';

export class EditorEngine {
  private static instance: EditorEngine;
  public canvasManager: CanvasManager;
  public eventBus: EventBus;
  public pluginManager: PluginManager;
  public options: EditorConfig;

  private constructor(options: EditorConfig) {
    this.options = options;
    this.eventBus = new EventBus();
    this.canvasManager = new CanvasManager(options, this.eventBus);
    this.pluginManager = new PluginManager();

    // ✅ 提前注册插件
    this.pluginManager.register(new WorkspacePlugin(this));
    this.pluginManager.register(new AlignmentGuidesPlugin());
    this.pluginManager.register(new HistoryPlugin(this));
    this.pluginManager.register(new ShortcutPlugin(this));
  }

  public static getInstance(options?: EditorConfig): EditorEngine {
    if (!EditorEngine.instance) {
      if (!options) {
        throw new Error('EditorEngine not initialized. Pass options to getInstance first.');
      }
      EditorEngine.instance = new EditorEngine(options);
    }
    return EditorEngine.instance;
  }

  public init(canvasEl: HTMLCanvasElement): void {
    this.canvasManager.init(canvasEl);
    this.initPlugins();
  }

  private initPlugins(): void {
    // 创建并注入 PluginContext
    const context = new PluginContext(this, this.canvasManager.getCanvas(), this.eventBus);
    this.pluginManager.setContext(context);

    // ✅ 初始化已注册的插件
    this.pluginManager.initAll();
  }

  public getCanvas(): Canvas {
    return this.canvasManager.getCanvas();
  }

  public addText(options?: any): fabric.Textbox {
    return this.canvasManager.addText(options);
  }

  public addRect(options?: any): fabric.Rect {
    return this.canvasManager.addRect(options);
  }

  public addShape(kind: ShapeKind): fabric.Object {
    return this.canvasManager.addShape(kind);
  }

  public addImage(url: string): Promise<fabric.Image> {
    return this.canvasManager.addImage(url);
  }

  public deleteSelected(): void {
    this.canvasManager.deleteSelected();
  }

  public undo(): void {
    const historyPlugin = this.pluginManager.get('HistoryPlugin') as HistoryPlugin;
    historyPlugin?.undo();
  }

  public redo(): void {
    const historyPlugin = this.pluginManager.get('HistoryPlugin') as HistoryPlugin;
    historyPlugin?.redo();
  }

  // --- Performance Monitoring ---

  /**
   * 获取性能监控指标
   */
  public getPerformanceMetrics() {
    return performanceMonitor.getMetrics();
  }

  /**
   * 生成性能报告
   */
  public generatePerformanceReport() {
    performanceMonitor.generateReport();
  }

  /**
   * 清空性能指标
   */
  public clearPerformanceMetrics() {
    performanceMonitor.clear();
  }

  public setSelectionMode(enabled: boolean): void {
    // CanvasManager keeps compatibility, but we should prefer setToolMode
    this.canvasManager.setSelection(enabled);
  }

  public setToolMode(mode: 'select' | 'hand' | 'draw'): void {
    this.canvasManager.setMode(mode);
  }

  public setBrushSettings(settings: { color?: string; width?: number; hardness?: number }): void {
    this.canvasManager.setBrushSettings(settings);
  }

  public resizeWorkspace(width: number, height: number): void {
    const workspacePlugin = this.pluginManager.get('WorkspacePlugin') as WorkspacePlugin;
    workspacePlugin?.setSize(width, height);
  }

  public zoomToFit(): void {
    const workspacePlugin = this.pluginManager.get('WorkspacePlugin') as WorkspacePlugin;
    workspacePlugin?.autoFit();
  }

  public dispose(): void {
    this.canvasManager.dispose();
    this.pluginManager.destroyAll();
    this.eventBus.clear();
    performanceMonitor.clear();
    // Ideally we might want to clear the singleton instance if we want to allow re-creation,
    // but typically Singletons survive implementation.
    // For React HMR/Strict Mode, it might be safer to keep the instance but reset state via dispose.
  }

  // --- Layer Operations (代理 CanvasManager) ---

  public reorderLayer(id: string, newIndex: number): void {
    this.canvasManager.reorderLayer(id, newIndex);
  }

  public toggleLayerVisibility(id: string): void {
    this.canvasManager.toggleLayerVisibility(id);
  }

  public toggleLayerLock(id: string): void {
    this.canvasManager.toggleLayerLock(id);
  }

  public async duplicateObject(id: string): Promise<fabric.Object | null> {
    return this.canvasManager.duplicateObject(id);
  }

  public renameLayer(id: string, name: string): void {
    this.canvasManager.renameLayer(id, name);
  }

  public bringToFront(id: string): void {
    this.canvasManager.bringToFront(id);
  }

  public sendToBack(id: string): void {
    this.canvasManager.sendToBack(id);
  }

  public bringForward(id: string): void {
    this.canvasManager.bringForward(id);
  }

  public sendBackward(id: string): void {
    this.canvasManager.sendBackward(id);
  }

  // --- Property Updates (代理 CanvasManager) ---

  public updateObjectProps(id: string, props: Partial<fabric.Object>): void {
    this.canvasManager.updateObjectProps(id, props);
  }

  public alignObjects(ids: string[], alignment: string): void {
    this.canvasManager.alignObjects(ids, alignment);
  }

  public getActiveObject(): fabric.Object | null {
    return this.canvasManager.getActiveObject();
  }

  public getActiveObjects(): fabric.Object[] {
    return this.canvasManager.getActiveObjects();
  }

  public getObjectById(id: string): fabric.Object | undefined {
    return this.canvasManager.getObjectById(id);
  }

  // --- Zoom Operations ---

  public zoomIn(): void {
    this.canvasManager.zoomIn();
  }

  public zoomOut(): void {
    this.canvasManager.zoomOut();
  }

  public setZoom(value: number): void {
    this.canvasManager.setZoom(value);
  }

  public getZoom(): number {
    return this.canvasManager.getZoom();
  }

  // --- Grouping Operations ---

  public group(): void {
    this.canvasManager.group();
  }

  public ungroup(): void {
    this.canvasManager.ungroup();
  }

  public exportImage(options: { format: 'png' | 'jpeg'; quality: number; multiplier: number }): string {
    return this.canvasManager.exportImage(options);
  }

  // --- Shortcut Operations ---

  public disableShortcuts(): void {
    const shortcutPlugin = this.pluginManager.get('ShortcutPlugin') as ShortcutPlugin;
    shortcutPlugin?.pause();
  }

  public enableShortcuts(): void {
    const shortcutPlugin = this.pluginManager.get('ShortcutPlugin') as ShortcutPlugin;
    shortcutPlugin?.resume();
  }
}
