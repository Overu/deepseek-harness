type DebouncedFunction<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => ReturnType<T> | undefined) & {
  cancel: () => void;
  flush: (...args: Parameters<T>) => ReturnType<T> | undefined;
};

export function debounce<T extends (...args: any[]) => any>(func: T, wait: number, immediate: boolean = false): DebouncedFunction<T> {
  let timeout: number | null;
  let result: ReturnType<T> | undefined;

  const debouncedFunction = function (this: any, ...args: Parameters<T>): ReturnType<T> | undefined {
    // 清除之前的定时器
    if (timeout !== null) {
      clearTimeout(timeout);
    }

    // 如果设置立即执行
    if (immediate) {
      // 如果没有待执行的定时器，则立即执行
      const callNow = timeout === null;
      timeout = window.setTimeout(() => {
        timeout = null;
      }, wait);

      if (callNow) {
        result = func.apply(this, args);
      }
    } else {
      // 否则延后执行
      timeout = window.setTimeout(() => {
        result = func.apply(this, args);
      }, wait);
    }

    return result;
  };

  // 添加取消功能
  debouncedFunction.cancel = function () {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  // 添加立即执行功能
  debouncedFunction.flush = function (...args: Parameters<T>): ReturnType<T> | undefined {
    debouncedFunction.cancel();
    result = func.apply(this, args);
    return result;
  };

  return debouncedFunction;
}

// get 请求特殊字符[、]接口查询异常
