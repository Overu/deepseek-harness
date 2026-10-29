import type { EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, Input } from 'mediabunny';
import { fetchSourceBlob, getCachedSourceBlob, KEYFRAME_SNAP_THRESHOLD_SEC, KeyframeTooFarError, OUTPUT_MIME, setCachedSourceBlob } from './shared';

const inputCache = new Map<string, Input>();
const rangeUnsupported = new Set<string>();
const preloadPromises = new Map<string, Promise<void>>();

let webcodecsCapability: boolean | null = null;

export async function canUseWebCodecs(): Promise<boolean> {
  if (webcodecsCapability != null) return webcodecsCapability;
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined') {
    webcodecsCapability = false;
    return false;
  }
  try {
    const { canEncodeVideo } = await import('mediabunny');
    webcodecsCapability = await canEncodeVideo('avc');
  } catch {
    webcodecsCapability = false;
  }
  return webcodecsCapability;
}

const disposeCachedInput = (sourceUrl: string): void => {
  const input = inputCache.get(sourceUrl);
  if (!input) return;
  try {
    input.dispose();
  } catch {
    // ignore
  }
  inputCache.delete(sourceUrl);
};

const createInputFromBlob = async (sourceUrl: string, blob: Blob): Promise<Input> => {
  const { Input, ALL_FORMATS, BlobSource } = await import('mediabunny');
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  await input.getFormat();
  disposeCachedInput(sourceUrl);
  inputCache.set(sourceUrl, input);
  return input;
};

const ensureInput = async (sourceUrl: string): Promise<Input> => {
  const cached = inputCache.get(sourceUrl);
  if (cached && !cached.disposed) return cached;

  const blobCached = getCachedSourceBlob(sourceUrl);
  if (blobCached) return createInputFromBlob(sourceUrl, blobCached);

  if (!rangeUnsupported.has(sourceUrl)) {
    try {
      const { Input, ALL_FORMATS, UrlSource } = await import('mediabunny');
      const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(sourceUrl) });
      await input.getFormat();
      disposeCachedInput(sourceUrl);
      inputCache.set(sourceUrl, input);
      return input;
    } catch {
      rangeUnsupported.add(sourceUrl);
    }
  }

  const blob = await fetchSourceBlob(sourceUrl);
  setCachedSourceBlob(sourceUrl, blob);
  return createInputFromBlob(sourceUrl, blob);
};

export async function preloadWebCodecsSource(sourceUrl: string): Promise<void> {
  if (!sourceUrl) return;
  const cached = inputCache.get(sourceUrl);
  if (cached && !cached.disposed) return;

  const inflight = preloadPromises.get(sourceUrl);
  if (inflight) return inflight;

  const promise = (async () => {
    const input = await ensureInput(sourceUrl);
    await input.getPrimaryVideoTrack();
  })().finally(() => {
    if (preloadPromises.get(sourceUrl) === promise) preloadPromises.delete(sourceUrl);
  });

  preloadPromises.set(sourceUrl, promise);
  return promise;
}

export async function resetWebCodecsSources(): Promise<void> {
  for (const sourceUrl of [...inputCache.keys()]) {
    disposeCachedInput(sourceUrl);
  }
  rangeUnsupported.clear();
  preloadPromises.clear();
}

const toMp4Blob = (buffer: ArrayBuffer): Blob => new Blob([new Uint8Array(buffer)], { type: OUTPUT_MIME });

/** 关键帧吸附纯流拷贝：不解码不编码，仅重封装 */
const remuxCopyClip = async (input: Input, startSecond: number, endSecond: number): Promise<Blob> => {
  const { EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource, Output, Mp4OutputFormat, BufferTarget } = await import('mediabunny');

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('no video track');

  const videoCodec = await videoTrack.getCodec();
  if (!videoCodec) throw new Error('unknown video codec');

  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  if (!format.getSupportedVideoCodecs().includes(videoCodec)) {
    throw new Error(`mp4 does not support video codec ${videoCodec}`);
  }

  const videoSink = new EncodedPacketSink(videoTrack);
  const keyPacket = await videoSink.getKeyPacket(startSecond, { verifyKeyPackets: true });
  if (!keyPacket) throw new Error('no keyframe near start');

  const snapDistance = Math.abs(keyPacket.timestamp - startSecond);
  if (snapDistance > KEYFRAME_SNAP_THRESHOLD_SEC) {
    throw new KeyframeTooFarError(snapDistance);
  }

  const clipStart = keyPacket.timestamp;
  const target = new BufferTarget();
  const output = new Output({ format, target });
  const videoSource = new EncodedVideoPacketSource(videoCodec);
  output.addVideoTrack(videoSource);

  const audioTrack = await input.getPrimaryAudioTrack();
  let audioSource: EncodedAudioPacketSource | null = null;
  let audioSink: EncodedPacketSink | null = null;
  let audioDecoderConfig: AudioDecoderConfig | undefined;
  let audioStartPacket: EncodedPacket | null = null;

  if (audioTrack) {
    const audioCodec = await audioTrack.getCodec();
    if (audioCodec && format.getSupportedAudioCodecs().includes(audioCodec)) {
      audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addAudioTrack(audioSource);
      audioSink = new EncodedPacketSink(audioTrack);
      audioDecoderConfig = (await audioTrack.getDecoderConfig()) ?? undefined;
      audioStartPacket = await audioSink.getPacket(clipStart);
    }
  }

  await output.start();

  const videoMeta = { decoderConfig: (await videoTrack.getDecoderConfig()) ?? undefined };
  let firstVideo = true;
  for await (const packet of videoSink.packets(keyPacket, undefined, { verifyKeyPackets: true })) {
    if (packet.timestamp >= endSecond) break;
    await videoSource.add(packet.clone({ timestamp: Math.max(0, packet.timestamp - clipStart) }), firstVideo ? videoMeta : undefined);
    firstVideo = false;
  }
  videoSource.close();

  if (audioSource && audioSink) {
    const audioMeta = { decoderConfig: audioDecoderConfig };
    let firstAudio = true;
    for await (const packet of audioSink.packets(audioStartPacket ?? undefined)) {
      if (packet.timestamp >= endSecond) break;
      if (packet.timestamp + packet.duration <= clipStart) continue;
      await audioSource.add(packet.clone({ timestamp: Math.max(0, packet.timestamp - clipStart) }), firstAudio ? audioMeta : undefined);
      firstAudio = false;
    }
    audioSource.close();
  }

  await output.finalize();
  if (!target.buffer) throw new Error('empty remux output');
  return toMp4Blob(target.buffer);
};

/** WebCodecs 硬件转码，帧精确 */
const transcodeClip = async (input: Input, startSecond: number, endSecond: number): Promise<Blob> => {
  const { Conversion, Output, Mp4OutputFormat, BufferTarget } = await import('mediabunny');

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: startSecond, end: endSecond },
    video: { hardwareAcceleration: 'prefer-hardware' },
    showWarnings: false,
  });

  if (!conversion.isValid || !conversion.utilizedTracks.some(track => track.isVideoTrack())) {
    const reasons = conversion.discardedTracks.map(item => item.reason).join(',');
    throw new Error(`conversion invalid: ${reasons || 'no video track'}`);
  }

  await conversion.execute();
  if (!target.buffer) throw new Error('empty transcode output');
  return toMp4Blob(target.buffer);
};

export async function clipWithWebCodecs(sourceUrl: string, startSecond: number, endSecond: number): Promise<Blob> {
  const input = await ensureInput(sourceUrl);

  try {
    return await remuxCopyClip(input, startSecond, endSecond);
  } catch {
    // 关键帧过远或 remux 失败 → 精确转码
  }

  return transcodeClip(input, startSecond, endSecond);
}
