import dayjs from 'dayjs';
import { parseCanvasId } from '../../../../src/shared/protocol';

export { debounce } from './debounce';

export const encodeReplace = (data: any) => {
  for (const key in data) {
    if (typeof data[key] === 'string') {
      data[key] = data[key].replace(/\[|]/g, '');
    }
  }

  return data;
};

export const isDesktopCanvas = () => typeof document !== 'undefined' && !!document.querySelector('meta[name="desktop-canvas-web-origin"]');

export class ResourceDownloadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// Desktop CSP allows same-origin requests only; the Host authorizes the saved canvas resource.
export async function downloadBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const desktop = isDesktopCanvas();
  let response: Response;
  if (desktop && !url.startsWith('blob:') && !url.startsWith('data:')) {
    const canvasId = parseCanvasId(new URLSearchParams(location.search).get('id'));
    if (!canvasId) throw new Error('请从当前画布下载资源');
    response = await fetch('/desktop-canvas/api/download', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvasId, url }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]) : AbortSignal.timeout(5 * 60_000),
    });
  } else {
    response = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-cache', ...(signal ? { signal } : {}) });
  }
  if (!response.ok) {
    let message = `资源下载失败（HTTP ${response.status}）`;
    if (desktop) {
      const body = await response.json().catch(() => null);
      if (typeof body?.error === 'string') message = body.error;
    }
    throw new ResourceDownloadError(message, response.status);
  }
  return response.blob();
}

/**
 * 下载文件函数
 * @param {string} url - 文件URL
 * @param {string} [filename] - 可选，自定义文件名
 */
export const downloadFile = async (url: string, filename?: string) => {
  const { toast } = await import('sonner');
  const desktop = isDesktopCanvas();
  if (desktop) toast.info('正在下载');
  else toast.success('文件下载中');
  try {
    const blob = await downloadBlob(url);
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;

    const finalFilename = filename || url.split('/')?.pop()?.split('?')[0] || 'download';
    link.download = finalFilename;

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    if (desktop) toast.error(error instanceof Error ? error.message : '下载失败，请稍后重试');
    else {
      console.error('下载失败:', error);
      window.open(url, '_blank');
    }
  }
};

export type DownloadZipFileItem = {
  url: string;
  filename: string;
};

const uniquifyFilenames = (files: DownloadZipFileItem[]): DownloadZipFileItem[] => {
  const used = new Map<string, number>();
  return files.map(file => {
    const raw = file.filename?.trim() || 'download';
    const lastDot = raw.lastIndexOf('.');
    const base = lastDot > 0 ? raw.slice(0, lastDot) : raw;
    const ext = lastDot > 0 ? raw.slice(lastDot) : '';
    const count = used.get(raw) ?? 0;
    used.set(raw, count + 1);
    if (count === 0) return { ...file, filename: raw };
    return { ...file, filename: `${base}_${count}${ext}` };
  });
};

/**
 * 将多个文件打包为 zip 后统一下载
 * 失败项会跳过；全部失败则不下载空 zip
 */
export const downloadFilesAsZip = async (files: DownloadZipFileItem[], zipName?: string) => {
  if (!files.length) return;

  const { toast } = await import('sonner');
  if (isDesktopCanvas()) toast.info('正在打包下载');
  else toast.success('打包下载中');

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const uniqueFiles = uniquifyFilenames(files);
  const resolvedZipName = zipName || `canvas_${dayjs().format('YYYYMMDD')}.zip`;

  const results = await Promise.allSettled(
    uniqueFiles.map(async file => {
      const blob = await downloadBlob(file.url);
      zip.file(file.filename, blob);
      return file.filename;
    })
  );

  const failedCount = results.filter(r => r.status === 'rejected').length;
  const successCount = results.length - failedCount;

  if (successCount === 0) {
    toast.error('打包下载失败，请稍后重试');
    return;
  }

  if (failedCount > 0) {
    toast.warning(`已跳过 ${failedCount} 个下载失败的文件`);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const blobUrl = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = resolvedZipName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
};
// 下载ppt、pdf文件时使用直接下载的方式避免等待
export const downloadPptFile = async (url: string, filename?: string) => {
  if (isDesktopCanvas()) return downloadFile(url, filename);
  const link = document.createElement('a');
  link.href = url;
  if (filename) {
    link.download = filename;
  }
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
export async function copyToClipboard(text: string) {
  const manualCopy = () => {
    window.prompt('当前浏览器限制了自动复制，请手动复制以下内容：', text);
  };

  const fallbackCopy = () => {
    const onCopy = (event: ClipboardEvent) => {
      event.preventDefault();
      event.clipboardData?.setData('text/plain', text);
    };

    try {
      document.addEventListener('copy', onCopy);
      const successful = document.execCommand('copy');
      if (!successful) {
        throw new Error('Failed to copy using copy event fallback');
      }
      return;
    } catch {
      const selection = window.getSelection();
      const previousRanges: Range[] = [];
      if (selection) {
        for (let i = 0; i < selection.rangeCount; i++) {
          previousRanges.push(selection.getRangeAt(i).cloneRange());
        }
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const copyNode = document.createElement('div');
      copyNode.textContent = text;
      copyNode.setAttribute('contenteditable', 'true');
      copyNode.style.position = 'fixed';
      copyNode.style.top = '0';
      copyNode.style.left = '-9999px';
      copyNode.style.opacity = '0';
      copyNode.style.whiteSpace = 'pre-wrap';
      copyNode.style.webkitUserSelect = 'text';
      copyNode.style.userSelect = 'text';

      document.body.appendChild(copyNode);

      const range = document.createRange();
      range.selectNodeContents(copyNode);
      selection?.removeAllRanges();
      selection?.addRange(range);
      copyNode.focus();

      try {
        const successful = document.execCommand('copy');
        if (!successful) {
          throw new Error('Failed to copy using selection fallback');
        }
      } finally {
        selection?.removeAllRanges();
        previousRanges.forEach(savedRange => selection?.addRange(savedRange));
        document.body.removeChild(copyNode);
        activeElement?.focus?.();
      }
    } finally {
      document.removeEventListener('copy', onCopy);
    }
  };

  try {
    if (!window.isSecureContext || !navigator.clipboard?.writeText) {
      fallbackCopy();
      return;
    }

    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy text to clipboard:', err);
    try {
      fallbackCopy();
    } catch (fallbackError) {
      console.error('Fallback copy method also failed:', fallbackError);
      manualCopy();
    }
  }
}

export function generateRandomString(length: number = 10) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}

export const formatFileSize = (bytes: number, decimals: number = 2) => {
  if (bytes === 0) return '0 B';
  if (!bytes) return '';

  // 定义单位数组和转换系数
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;

  // 计算最合适的单位索引
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  // 计算转换后的值并保留指定的小数位数
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals));

  // 返回带单位的结果
  return `${size} ${units[i]}`;
};

/**
 * 格式化视频时长
 * @param {number} seconds - 视频时长（秒）
 * @returns {string} - 格式化后的时长 (mm:ss)
 */
export const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(remainingSeconds).padStart(2, '0');

  return `${formattedMinutes}:${formattedSeconds}`;
};

/**
 * 格式化会话时间 (Day.js 版)
 * @param time - 时间戳/Date对象/字符串
 */
export function formatChatTime(time: string | number | Date): string {
  const target = dayjs(time);
  const now = dayjs();

  // 0. 安全性检查
  if (!target.isValid()) return '';

  // 1. 刚刚：判断是否在 2 分钟内 (diff 默认单位是毫秒，也可以指定 'minute')
  const diffMinutes = now.diff(target, 'minute');
  if (diffMinutes < 2 && diffMinutes >= 0) {
    return '刚刚';
  }

  // 2. 今天：判断是否是同一天
  if (target.isSame(now, 'day')) {
    return target.format('HH:mm');
  }

  // 3. 昨天：判断是否是今天的前一天
  if (target.isSame(now.subtract(1, 'day'), 'day')) {
    return `昨天 ${target.format('HH:mm')}`;
  }

  if (target.isSame(now, 'year')) {
    return target.format('M-D HH:mm');
  }

  return target.format('YYYY-M-D HH:mm');
}

/**
 **
 * 根据文件名判断文件类型是否为视频
 * @param filename - 文件名
 * @returns boolean - true表示是视频文件，false表示不是
 */
export const isVideoFile = (filename: string): boolean => {
  const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.3gp', '.3g2', '.mpg', '.mpeg'];

  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return videoExtensions.includes(ext);
};

/**
 * 根据文件名判断文件类型是否为图片
 * @param filename - 文件名
 * @returns boolean - true表示是图片文件，false表示不是
 */
export const isImageFile = (filename: string): boolean => {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico'];

  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return imageExtensions.includes(ext);
};

/**
 * 根据文件名判断文件类型是否为音频
 * @param filename - 文件名
 * @returns boolean - true表示是音频文件，false表示不是
 */
export const isAudioFile = (filename: string): boolean => {
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.opus'];

  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return audioExtensions.includes(ext);
};

/**
 * 根据文件名判断文件类型
 * @param filename - 文件名
 * @returns 'video' | 'image' | 'unknown' - 文件类型
 */
export const getFileType = (filename: string): 'video' | 'image' | 'audio' | 'unknown' => {
  if (isVideoFile(filename)) {
    return 'video';
  }

  if (isImageFile(filename)) {
    return 'image';
  }

  if (isAudioFile(filename)) {
    return 'audio';
  }

  return 'unknown';
};

// 判断是否为阿里云 OSS 图片链接
const isAliyunOssUrl = (url: string) => /aliyuncs\.com/i.test(url);

/** 根据 URL / data URL 判定是否为 SVG 图片 */
export const isSvgImageUrl = (url: string): boolean => {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^data:image\/svg\+xml/i.test(raw)) return true;
  try {
    return /\.svg$/i.test(new URL(raw, 'https://local.invalid').pathname);
  } catch {
    return /\.svg$/i.test(raw.split(/[?#]/)[0] || '');
  }
};

// 图片缩略图格式转换
export const compressImage = (url: string, width?: number) => {
  if (!url) {
    return url;
  }

  if (isSvgImageUrl(url)) {
    return url;
  }

  // 域名拦截：非阿里云图片（包括 fal.ai 等其他外部链接）直接返回原值
  if (!isAliyunOssUrl(url)) {
    return url;
  }

  try {
    // 使用原生 URL 对象安全解析，彻底杜绝字符串拼接导致的 `??` 或 `?&` 语法错误
    const parsedUrl = new URL(url);

    // 防止重复处理：如果 URL 中已经有了 x-oss-process 参数，直接返回
    if (parsedUrl.searchParams.has('x-oss-process')) {
      return url;
    }

    // 精准判断后缀：只取路径部分 (pathname)，避免 URL 参数中包含 .png 被误判
    const pathname = parsedUrl.pathname.toLowerCase();
    const isPng = pathname.endsWith('.png');

    // 构建 OSS 图片处理命令
    let processCmd = '';
    if (width) {
      // 场景 A：指定宽度的等比缩放 + 质量压缩
      processCmd = `image/resize,w_${width},q_50`;
    } else if (isPng) {
      // 场景 B：PNG 图片压缩
      processCmd = 'image/format,webp/quality,q_50';
    } else {
      processCmd = 'image/quality,q_50';
    }

    parsedUrl.searchParams.set('x-oss-process', processCmd);

    return parsedUrl.toString();
  } catch (_: any) {
    console.warn('compressImage: Failed to parse URL, returning original.', url);
    return url;
  }
};

/**
 * 深拷贝可序列化对象，优先使用原生 structuredClone，降级使用 JSON 序列化
 */
export const cloneSerializable = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};
