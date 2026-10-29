/**
 * 插件上下文 - P1优化
 * 提供插件间通信和共享资源访问
 */
import type { Canvas } from 'fabric';
import type { EditorEngine } from '../EditorEngine';
import type { EventBus } from '../EventBus';

export class PluginContext {
  constructor(
    public engine: EditorEngine,
    public canvas: Canvas,
    public eventBus: EventBus
  ) {}

  /**
   * 发布插件事件 (命名空间隔离)
   */
  emit(event: string, ...args: any[]): void {
    this.eventBus.emit(`plugin:${event}`, ...args);
  }

  /**
   * 订阅插件事件
   */
  on(event: string, callback: (...args: any[]) => void): () => void {
    const namespacedEvent = `plugin:${event}`;
    this.eventBus.on(namespacedEvent, callback);

    // 返回取消订阅函数
    return () => this.eventBus.off(namespacedEvent, callback);
  }

  /**
   * 一次性订阅插件事件
   */
  once(event: string, callback: (...args: any[]) => void): void {
    this.eventBus.once(`plugin:${event}`, callback);
  }

  /**
   * 获取其他插件实例 (用于插件间调用)
   */
  getPlugin<T>(name: string): T | undefined {
    return this.engine.pluginManager.get(name) as T | undefined;
  }
}
