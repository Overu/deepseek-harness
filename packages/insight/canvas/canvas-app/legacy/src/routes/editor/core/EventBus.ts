type EventHandler = (...args: any[]) => void;

export class EventBus {
  private events: Map<string, EventHandler[]> = new Map();

  on(event: string, callback: EventHandler): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)?.push(callback);

    // 返回取消订阅函数
    return () => this.off(event, callback);
  }

  off(event: string, callback: EventHandler): void {
    const callbacks = this.events.get(event);
    if (!callbacks) return;

    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
    }
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`Error in event handler for "${event}":`, error);
        }
      });
    }
  }

  once(event: string, callback: EventHandler): void {
    const wrapper = (...args: any[]) => {
      callback(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  clear(): void {
    this.events.clear();
  }
}
