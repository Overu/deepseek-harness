import type { IPlugin } from '../types';
import type { PluginContext } from './PluginContext';

export class PluginManager {
  private plugins: Map<string, IPlugin> = new Map();
  private context?: PluginContext;

  /**
   * 设置插件上下文 (由 EditorEngine 调用)
   */
  setContext(context: PluginContext): void {
    this.context = context;
  }

  register(plugin: IPlugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin ${plugin.name} is already registered.`);
      return;
    }
    this.plugins.set(plugin.name, plugin);
    console.log(`✅ Plugin ${plugin.name} 已注册`);
  }

  // 初始化所有已注册的插件
  initAll(): void {
    if (!this.context) {
      console.warn('⚠️ PluginContext 未设置，无法初始化插件');
      return;
    }

    this.plugins.forEach(plugin => {
      try {
        plugin.init(this.context);
        console.log(`✅ Plugin ${plugin.name} 已初始化`);
      } catch (error) {
        console.error(`❌ Plugin ${plugin.name} 初始化失败:`, error);
      }
    });
  }

  get(name: string): IPlugin | undefined {
    return this.plugins.get(name);
  }

  destroyAll(): void {
    this.plugins.forEach(plugin => plugin.destroy());
    this.plugins.clear();
  }

  getAll(): IPlugin[] {
    return Array.from(this.plugins.values());
  }
}
