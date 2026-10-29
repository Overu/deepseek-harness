/**
 * 性能监控工具 - P1优化
 * 用于监控编辑器操作性能,识别卡顿瓶颈
 */

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private isEnabled: boolean;
  private performanceThreshold = 16; // 16ms 阈值 (60fps)

  constructor() {
    this.isEnabled = process.env.NODE_ENV === 'development';
  }

  /**
   * 标记性能测量起始点
   */
  mark(label: string): void {
    if (!this.isEnabled || typeof performance === 'undefined') return;
    performance.mark(label);
  }

  /**
   * 测量两个标记点之间的时间
   */
  measure(name: string, startMark: string, endMark: string): void {
    if (!this.isEnabled || typeof performance === 'undefined') return;

    try {
      performance.measure(name, startMark, endMark);
      const measure = performance.getEntriesByName(name, 'measure')[0];

      if (measure) {
        const metric: PerformanceMetric = {
          name,
          duration: measure.duration,
          timestamp: Date.now(),
        };

        this.metrics.push(metric);

        // 超过阈值时警告
        if (measure.duration > this.performanceThreshold) {
          console.warn(`[Performance] ${name}: ${measure.duration.toFixed(2)}ms (>${this.performanceThreshold}ms)`);
        }

        // 清理 performance entries
        performance.clearMarks(startMark);
        performance.clearMarks(endMark);
        performance.clearMeasures(name);
      }
    } catch (error) {
      // 标记不存在等错误,静默处理
    }
  }

  /**
   * 包装函数自动测量性能
   */
  measureFunction<T extends (...args: any[]) => any>(name: string, fn: T): T {
    if (!this.isEnabled) return fn;

    return ((...args: any[]) => {
      const startMark = `${name}:start`;
      const endMark = `${name}:end`;

      this.mark(startMark);
      const result = fn(...args);

      // 处理异步函数
      if (result instanceof Promise) {
        return result.finally(() => {
          this.mark(endMark);
          this.measure(name, startMark, endMark);
        });
      }

      this.mark(endMark);
      this.measure(name, startMark, endMark);
      return result;
    }) as T;
  }

  /**
   * 获取所有性能指标
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * 获取平均执行时间
   */
  getAverageDuration(name: string): number {
    const filtered = this.metrics.filter(m => m.name === name);
    if (filtered.length === 0) return 0;

    const sum = filtered.reduce((acc, m) => acc + m.duration, 0);
    return sum / filtered.length;
  }

  /**
   * 清空指标记录
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * 生成性能报告
   */
  generateReport(): void {
    if (!this.isEnabled || this.metrics.length === 0) return;

    console.group('📊 Performance Report');

    // 按操作分组统计
    const grouped = this.metrics.reduce(
      (acc, metric) => {
        if (!acc[metric.name]) {
          acc[metric.name] = {
            count: 0,
            total: 0,
            min: Infinity,
            max: 0,
          };
        }

        const group = acc[metric.name];
        group.count++;
        group.total += metric.duration;
        group.min = Math.min(group.min, metric.duration);
        group.max = Math.max(group.max, metric.duration);

        return acc;
      },
      {} as Record<string, { count: number; total: number; min: number; max: number }>
    );

    Object.entries(grouped).forEach(([name, stats]) => {
      const avg = stats.total / stats.count;
      console.log(`${name}: avg=${avg.toFixed(2)}ms, min=${stats.min.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms, count=${stats.count}`);
    });

    console.groupEnd();
  }
}

// 单例导出
export const performanceMonitor = new PerformanceMonitor();

// 装饰器风格的便捷方法
export function measurePerformance(name: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = performanceMonitor.measureFunction(`${name || target.constructor.name}.${propertyKey}`, originalMethod);

    return descriptor;
  };
}
