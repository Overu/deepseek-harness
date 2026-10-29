import toolUtil from '../../utils/toolUtil';

interface AspectRatioHintProps {
  ratio: string;
}

/**
 * 比例矩形标识：在 14×14 容器内按 w:h 等比缩放描边矩形。
 * 供参数下拉、全景截图、分镜比例选择等共用。
 */
const AspectRatioHint = ({ ratio }: AspectRatioHintProps) => {
  const parsed = toolUtil.parseAspectRatio(ratio);
  const { w, h } = parsed ?? { w: 1, h: 1 };
  // 外层使用 `h-3.5 w-3.5`，Tailwind 默认 1rem=16px，因此外层大约是 14x14px。
  // 这里按 `w:h` 等比缩放，确保宽高比严格一致（包含 border 使用 border-box 避免额外尺寸偏移）。
  const MAX_PX = 14;
  const scale = MAX_PX / Math.max(w, h);
  const boxSize = {
    width: `${w * scale}px`,
    height: `${h * scale}px`,
  };
  return (
    <span className='inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center'>
      <span className='block rounded-[2px] border border-white/90 bg-transparent' style={{ ...boxSize, boxSizing: 'border-box' }} />
    </span>
  );
};

export default AspectRatioHint;
