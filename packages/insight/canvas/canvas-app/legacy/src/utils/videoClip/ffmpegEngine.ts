import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { clearSourceBlobCache, fetchSourceBlob, guessInputExtension, OUTPUT_MIME } from './shared';

const BASE_CLIP_EXEC_TIMEOUT_MS = 180_000;
const WORKERFS_SIZE_THRESHOLD = 50 * 1024 * 1024;
const WORKERFS_MOUNT_POINT = '/input';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

/** 已写入 ffmpeg MEMFS 的输入文件名 */
const memfsInputCache = new Map<string, string>();
/** WORKERFS 挂载的输入路径 */
const workerfsInputCache = new Map<string, string>();
const preloadPromises = new Map<string, Promise<void>>();
let workerfsMounted = false;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    // worker 必须用 ?worker&url 打成自包含模块：纯 ?url 只拷贝 worker.js，
    // 生产环境相对 import（./const.js、./errors.js）会 404 并被 SPA 回成 HTML，触发 MIME 报错。
    // core/wasm 再用 toBlobURL 赋正确 MIME，避免网关对 .js/.wasm 响应头不当时的 module 加载失败。
    const [{ FFmpeg }, { toBlobURL }, { default: coreURL }, { default: wasmURL }, { default: classWorkerURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
      import('@ffmpeg/core?url'),
      import('@ffmpeg/core/wasm?url'),
      import('@ffmpeg/ffmpeg/worker?worker&url'),
    ]);
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(coreURL, 'text/javascript'),
      wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
      classWorkerURL,
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } catch (error) {
    ffmpegLoadPromise = null;
    throw error;
  }
}

const ensureWorkerfsUnmounted = async (ffmpeg: FFmpeg): Promise<void> => {
  if (!workerfsMounted) return;
  try {
    await ffmpeg.unmount(WORKERFS_MOUNT_POINT);
  } catch {
    // ignore missing mount
  }
  try {
    await ffmpeg.deleteDir(WORKERFS_MOUNT_POINT);
  } catch {
    // ignore missing dir
  }
  workerfsMounted = false;
  workerfsInputCache.clear();
};

const ensureInputPath = async (ffmpeg: FFmpeg, sourceUrl: string): Promise<string> => {
  const cachedWorker = workerfsInputCache.get(sourceUrl);
  if (cachedWorker) return cachedWorker;
  const cachedMemfs = memfsInputCache.get(sourceUrl);
  if (cachedMemfs) return cachedMemfs;

  const blob = await fetchSourceBlob(sourceUrl);
  const ext = guessInputExtension(sourceUrl);

  // 大文件走 WORKERFS：按需读取，跳过 MEMFS 整包拷贝
  if (blob.size >= WORKERFS_SIZE_THRESHOLD) {
    await ensureWorkerfsUnmounted(ffmpeg);
    try {
      await ffmpeg.createDir(WORKERFS_MOUNT_POINT);
    } catch {
      // dir may already exist
    }
    const { FFFSType } = await import('@ffmpeg/ffmpeg');
    const fileName = `source.${ext}`;
    await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: fileName, data: blob }] }, WORKERFS_MOUNT_POINT);
    workerfsMounted = true;
    const inputPath = `${WORKERFS_MOUNT_POINT}/${fileName}`;
    workerfsInputCache.set(sourceUrl, inputPath);
    return inputPath;
  }

  const inputName = `source_${memfsInputCache.size}.${ext}`;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await ffmpeg.writeFile(inputName, bytes);
  memfsInputCache.set(sourceUrl, inputName);
  return inputName;
};

/** -ss 放在 -i 前快速定位；音频优先 copy，失败由调用方重试 aac */
const buildArgs = (inputName: string, outputName: string, startSecond: number, duration: number, audioCopy: boolean): string[] => [
  '-ss',
  String(startSecond),
  '-i',
  inputName,
  '-t',
  String(duration),
  '-map',
  '0:v:0',
  '-map',
  '0:a:0?',
  '-sn',
  '-dn',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-crf',
  '23',
  '-c:a',
  audioCopy ? 'copy' : 'aac',
  '-movflags',
  '+faststart',
  outputName,
];

const runFfmpegClip = async (ffmpeg: FFmpeg, inputName: string, outputName: string, startSecond: number, endSecond: number): Promise<void> => {
  const duration = Math.max(0, endSecond - startSecond);
  const timeoutMs = Math.max(BASE_CLIP_EXEC_TIMEOUT_MS, Math.ceil(duration * 4000));

  // 音频优先流拷贝；失败再退回 aac 重编码
  let exitCode = await ffmpeg.exec(buildArgs(inputName, outputName, startSecond, duration, true), timeoutMs);
  if (exitCode === 0) return;

  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    // ignore
  }
  exitCode = await ffmpeg.exec(buildArgs(inputName, outputName, startSecond, duration, false), timeoutMs);
  if (exitCode !== 0) {
    throw new Error(`ffmpeg exited with code ${exitCode}`);
  }
};

export async function preloadFfmpegSource(sourceUrl: string): Promise<void> {
  if (!sourceUrl) return;
  if (memfsInputCache.has(sourceUrl) || workerfsInputCache.has(sourceUrl)) return;

  const inflight = preloadPromises.get(sourceUrl);
  if (inflight) return inflight;

  const promise = (async () => {
    const ffmpeg = await getFFmpeg();
    await ensureInputPath(ffmpeg, sourceUrl);
  })().finally(() => {
    if (preloadPromises.get(sourceUrl) === promise) preloadPromises.delete(sourceUrl);
  });

  preloadPromises.set(sourceUrl, promise);
  return promise;
}

export async function resetFfmpegSources(): Promise<void> {
  const ffmpeg = ffmpegInstance;
  if (ffmpeg) {
    await ensureWorkerfsUnmounted(ffmpeg);
    await Promise.all(
      [...memfsInputCache.values()].map(async name => {
        try {
          await ffmpeg.deleteFile(name);
        } catch {
          // ignore missing file
        }
      })
    );
  }
  clearSourceBlobCache();
  memfsInputCache.clear();
  workerfsInputCache.clear();
  preloadPromises.clear();
}

export async function clipWithFfmpeg(sourceUrl: string, startSecond: number, endSecond: number): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const outputName = `clip_${Date.now()}.mp4`;
  const inputName = await ensureInputPath(ffmpeg, sourceUrl);

  await runFfmpegClip(ffmpeg, inputName, outputName, startSecond, endSecond);

  const data = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(outputName);

  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(data);
  return new Blob([bytes], { type: OUTPUT_MIME });
}
