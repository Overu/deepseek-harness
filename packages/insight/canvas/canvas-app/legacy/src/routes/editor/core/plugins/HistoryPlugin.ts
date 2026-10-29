/**
 * 历史记录插件 - 生产级实现
 *
 * 📚 参考: Vue Fabric Editor HistoryPlugin
 *
 * 🎯 核心设计:
 * 1. JSON快照式历史记录（简单可靠）
 * 2. 双重锁机制防止竞态条件
 * 3. 防抖优化减少高频操作的历史记录
 * 4. 智能事件过滤避免不必要的记录
 *
 * 🔧 关键改进:
 * - isLoading: 防止undo/redo时触发新历史
 * - isProcessing: 防止save时的递归调用
 * - 防抖: 拖拽等连续操作只记录最终状态
 * - workspace特殊处理: 确保工作区不可选中
 */

import type { IPlugin } from '../types';
import type { PluginContext } from './PluginContext';
import type { EditorEngine } from '../EditorEngine';
import { performanceMonitor } from '../utils/performance';
import { debounce } from 'lodash-es';
import { useEditorStore } from '../../store/editorStore';

interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
}

export class HistoryPlugin implements IPlugin {
  name = 'HistoryPlugin';

  private context?: PluginContext;
  private editor: EditorEngine;

  // 历史记录栈
  private stack: string[] = [];
  private currentIndex = 0;
  private readonly maxLength = 100;

  // 双重锁机制
  private isLoading = false; // 标记正在加载历史状态（undo/redo中）
  private isProcessing = false; // 标记正在保存状态
  private isPaused = false; // 标记是否暂停记录（用于抠图/裁剪等模式）

  // 状态通知回调
  private updateCallbacks: Set<(state: HistoryState) => void> = new Set();

  constructor(editor: EditorEngine) {
    this.editor = editor;
  }

  init(context?: PluginContext): void {
    this.context = context;
    this.bindEvents();
    this.bindEventBusEvents();

    // 延迟保存初始状态，确保 workspace 和其他插件已初始化
    setTimeout(() => {
      this.saveState();
      console.log('✅ HistoryPlugin 已初始化，初始状态已保存');
    }, 100);
  }

  /**
   * 绑定EventBus事件（用于外部控制）
   */
  private bindEventBusEvents(): void {
    if (!this.context) return;

    // 直接监听 eventBus（不使用 context.on，因为 context.on 会添加 plugin: 前缀）
    const eventBus = this.context.eventBus;

    eventBus.on('history:pause', () => {
      this.pause();
    });

    eventBus.on('history:resume', () => {
      this.resume();
    });

    eventBus.on('history:save', () => {
      this.saveState();
    });
  }

  /**
   * 绑定Canvas事件
   */
  private bindEvents(): void {
    const canvas = this.editor.canvasManager.getCanvas();
    if (!canvas) {
      console.warn('Canvas未初始化，无法绑定历史记录事件');
      return;
    }

    // 对象添加/删除 - 立即保存
    canvas.on('object:added', () => {
      console.log('🔵 object:added 事件触发');
      this.saveState();
    });
    canvas.on('object:removed', () => {
      console.log('🔴 object:removed 事件触发');
      this.saveState();
    });

    // 对象修改 - 防抖保存（拖拽等连续操作）
    // 缩短防抖时间从300ms到100ms，提高响应性
    const debouncedSave = debounce(() => {
      console.log('🟡 object:modified 防抖触发');
      this.saveState();
    }, 100);

    canvas.on('object:modified', debouncedSave);

    // 监听插件事件
    if (this.context) {
      this.context.on('layer:reordered', () => this.saveState());
    }

    console.log('📡 HistoryPlugin 事件已绑定');
  }

  /**
   * 保存当前状态到历史栈
   */
  private saveState(): void {
    // 🔒 关键防护：防止在加载、处理过程中或暂停时触发保存
    if (this.isLoading || this.isProcessing || this.isPaused) {
      console.log('⏸️  跳过保存：', {
        isLoading: this.isLoading,
        isProcessing: this.isProcessing,
        isPaused: this.isPaused,
      });
      return;
    }

    try {
      this.isProcessing = true;
      performanceMonitor.mark('history:save:start');

      const canvas = this.editor.canvasManager.getCanvas();
      if (!canvas) return;

      // 获取当前Canvas JSON
      const canvasState = canvas.toObject(['id', 'name']);
      const currentState = JSON.stringify(canvasState);
      console.log('🔍 保存的状态currentState:', JSON.parse(currentState).objects[0]);

      // 清除当前索引后的所有记录（分支覆盖）
      this.stack.splice(this.currentIndex);

      // 添加新状态
      this.stack.push(currentState);

      // 维护最大长度
      if (this.stack.length > this.maxLength) {
        this.stack.shift();
      } else {
        this.currentIndex++;
      }

      console.log(`💾 历史已保存 (${this.currentIndex}/${this.stack.length})`);

      // 通知UI更新
      this.notifyUpdate();

      performanceMonitor.mark('history:save:end');
      performanceMonitor.measure('history:save', 'history:save:start', 'history:save:end');
    } catch (error) {
      console.error('❌ 保存历史状态失败:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 加载指定状态
   */
  private getOrderOnlyTargetIds(parsedState: any): string[] | null {
    const targetObjects = parsedState?.objects;
    const canvas = this.editor.canvasManager.getCanvas();
    if (!canvas || !Array.isArray(targetObjects)) return null;

    const currentObjects = canvas.toObject(['id', 'name']).objects;
    if (!Array.isArray(currentObjects) || currentObjects.length !== targetObjects.length) return null;

    const currentStateById = new Map<string, string>();
    for (const object of currentObjects) {
      if (typeof object.id !== 'string' || currentStateById.has(object.id)) return null;
      currentStateById.set(object.id, JSON.stringify(object));
    }

    const targetIds: string[] = [];
    for (const object of targetObjects) {
      if (typeof object.id !== 'string' || targetIds.includes(object.id)) return null;
      if (currentStateById.get(object.id) !== JSON.stringify(object)) return null;
      targetIds.push(object.id);
    }

    return targetIds;
  }

  private async loadState(state: string, eventName: 'history:undo' | 'history:redo'): Promise<void> {
    this.isLoading = true;
    this.isProcessing = true;

    try {
      performanceMonitor.mark(`${eventName}:start`);

      // 解析JSON并在JSON层面设置workspace属性（防御性措施1）
      const parsedState = JSON.parse(state);
      const orderOnlyTargetIds = this.getOrderOnlyTargetIds(parsedState);
      const workspaceData = parsedState.objects?.find((item: any) => item.id === 'workspace');

      if (workspaceData) {
        // 在JSON层面设置workspace属性
        workspaceData.selectable = false;
        workspaceData.evented = false;
        workspaceData.hasControls = false;
        workspaceData.hasBorders = false;
        workspaceData.lockMovementX = true;
        workspaceData.lockMovementY = true;
        workspaceData.lockScalingX = true;
        workspaceData.lockScalingY = true;
        workspaceData.lockRotation = true;
      }

      // 纯图层顺序变化直接原地恢复，避免为撤销排序重新加载全部图片。
      const orderRestored = orderOnlyTargetIds ? this.editor.canvasManager.restoreObjectOrder(orderOnlyTargetIds) : false;
      if (!orderRestored) {
        await this.editor.canvasManager.loadFromJSON(parsedState);
      }

      // loadFromJSON完成后，再次强制设置workspace属性
      // 因为loadFromJSON可能会重新创建对象，导致JSON中的设置失效
      const canvas = this.editor.canvasManager.getCanvas();
      if (canvas) {
        const workspaceObj = canvas.getObjects().find(obj => obj.id === 'workspace');
        if (workspaceObj) {
          workspaceObj.set({
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            hoverCursor: 'default',
          });
          canvas.sendObjectToBack(workspaceObj);
          console.log('✅ Workspace属性已重置为不可选中');
        }
      }

      // 触发事件通知
      this.context?.emit(eventName, { orderOnly: orderRestored });
      useEditorStore.getState().markDocumentChanged();

      performanceMonitor.mark(`${eventName}:end`);
      performanceMonitor.measure(eventName, `${eventName}:start`, `${eventName}:end`);
    } catch (error) {
      console.error(`❌ 加载历史状态失败 (${eventName}):`, error);
      throw error;
    } finally {
      // 释放锁（顺序很重要：先释放processing，再释放loading）
      this.isProcessing = false;
      this.isLoading = false;
    }
  }

  /**
   * 撤销
   */
  public async undo(): Promise<void> {
    if (this.isLoading || this.currentIndex <= 1) {
      console.warn('⚠️  无法撤销：', {
        isLoading: this.isLoading,
        currentIndex: this.currentIndex,
      });
      return;
    }

    try {
      this.currentIndex--;
      const state = this.stack[this.currentIndex - 1];

      if (state) {
        await this.loadState(state, 'history:undo');
        this.notifyUpdate();
        console.log(`↩️  撤销成功 (${this.currentIndex}/${this.stack.length})`);
      }
    } catch (error) {
      // 撤销失败，回滚索引
      this.currentIndex++;
      console.error('❌ 撤销失败:', error);
    }
  }

  /**
   * 重做
   */
  public async redo(): Promise<void> {
    if (this.isLoading || this.currentIndex >= this.stack.length) {
      console.warn('⚠️  无法重做：', {
        isLoading: this.isLoading,
        currentIndex: this.currentIndex,
        stackLength: this.stack.length,
      });
      return;
    }

    try {
      const state = this.stack[this.currentIndex];

      if (state) {
        await this.loadState(state, 'history:redo');
        this.currentIndex++;
        this.notifyUpdate();
        console.log(`↪️  重做成功 (${this.currentIndex}/${this.stack.length})`);
      }
    } catch (error) {
      console.error('❌ 重做失败:', error);
    }
  }

  /**
   * 清空历史记录
   */
  public clear(): void {
    this.stack = [];
    this.currentIndex = 0;
    this.notifyUpdate();
    console.log('🗑️  历史记录已清空');
  }

  /**
   * 暂停历史记录（用于抠图/裁剪等模式，避免记录临时操作）
   */
  public pause(): void {
    this.isPaused = true;
    console.log('⏸️  历史记录已暂停');
  }

  /**
   * 恢复历史记录
   */
  public resume(): void {
    this.isPaused = false;
    console.log('▶️  历史记录已恢复');
  }

  /**
   * 清空并保存当前状态（用于导入JSON后）
   */
  public clearAndSaveState(): void {
    const canvas = this.editor.canvasManager.getCanvas();
    if (!canvas) return;

    const currentState = JSON.stringify(canvas.toJSON());
    this.stack = [currentState];
    this.currentIndex = 1;
    this.notifyUpdate();
    console.log('🔄 历史记录已重置为当前状态');
  }

  /**
   * 获取历史状态
   */
  public getState(): HistoryState {
    const undoCount = this.currentIndex - 1;
    const redoCount = this.stack.length - this.currentIndex;

    return {
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
      undoCount,
      redoCount,
    };
  }

  /**
   * 订阅历史状态更新
   */
  public subscribe(callback: (state: HistoryState) => void): () => void {
    this.updateCallbacks.add(callback);

    // 立即调用一次
    callback(this.getState());

    // 返回取消订阅函数
    return () => {
      this.updateCallbacks.delete(callback);
    };
  }

  /**
   * 通知所有订阅者
   */
  private notifyUpdate(): void {
    const state = this.getState();
    this.updateCallbacks.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('历史状态回调执行失败:', error);
      }
    });

    // 同时通过EventBus发送事件（兼容旧代码）
    this.context?.emit('history:update', state);
  }

  /**
   * 获取调试信息
   */
  public getDebugInfo() {
    return {
      stackSize: this.stack.length,
      currentIndex: this.currentIndex,
      maxLength: this.maxLength,
      isLoading: this.isLoading,
      isProcessing: this.isProcessing,
      ...this.getState(),
    };
  }

  destroy(): void {
    try {
      const canvas = this.editor?.canvasManager?.getCanvas();
      if (canvas) {
        canvas.off('object:added');
        canvas.off('object:removed');
        canvas.off('object:modified');
      }

      this.updateCallbacks.clear();
      this.stack = [];

      console.log('🔌 HistoryPlugin 已销毁');
    } catch (error) {
      console.warn('HistoryPlugin 销毁时出错:', error);
    }
  }
}
