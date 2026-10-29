import type { TableProtocol } from './types';

/** 合成输出按 2K：长边目标像素（与画布常见 2048 档位对齐） */
const TARGET_LONG_SIDE = 2048;

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`加载图片失败: ${url}`));
    img.src = url;
  });

/** 非空单元格均为带 value 的图片，且至少有一张图时才可合成（空单元格允许） */
export const canComposeStoryboardGrid = (table: TableProtocol): boolean => {
  if (!table?.columns?.length || !table?.data?.length) return false;
  let hasImage = false;
  for (const row of table.data) {
    for (const col of table.columns) {
      const cell = row[col.field];
      if (!cell || cell.type === 'empty') continue;
      if (cell.type !== 'image' || !cell.value) return false;
      hasImage = true;
    }
  }
  return hasImage;
};

/** 在单元格矩形内按 object-contain 绘制图片，未占满区域保持底色（白色） */
const drawImageContain = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, cellW: number, cellH: number) => {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw <= 0 || ih <= 0 || cellW <= 0 || cellH <= 0) return;

  const scale = Math.min(cellW / iw, cellH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (cellW - dw) / 2;
  const dy = y + (cellH - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
};

/**
 * 按当前宫格列宽/行高比例拼图，输出长边固定约 2K（2048px），短边等比缩放。
 * 每格先填白，再 object-contain 绘制图片。
 */
export const composeStoryboardGridToFile = async (table: TableProtocol): Promise<File> => {
  if (!canComposeStoryboardGrid(table)) {
    throw new Error('表格内存在非图片或空图单元格，无法合成宫格');
  }

  const colWidths = table.columns.map(c => Math.max(1, Number(c.width) || 0));
  const rowHeights = table.data.map((_, i) => Math.max(1, Number(table.rowsHeight[i]) || 0));
  const displayW = colWidths.reduce((a, b) => a + b, 0);
  const displayH = rowHeights.reduce((a, b) => a + b, 0);
  if (displayW <= 0 || displayH <= 0) {
    throw new Error('表格尺寸无效，无法合成宫格');
  }

  const urls = table.data.flatMap(row =>
    table.columns.flatMap(col => {
      const cell = row[col.field];
      return cell?.type === 'image' && cell.value ? [cell.value] : [];
    })
  );
  const uniqueUrls = [...new Set(urls)];
  const imageMap = new Map<string, HTMLImageElement>();
  await Promise.all(
    uniqueUrls.map(async url => {
      imageMap.set(url, await loadImage(url));
    })
  );

  // 按显示宫格比例放大，使长边达到 2K
  const pixelScale = TARGET_LONG_SIDE / Math.max(displayW, displayH);
  const canvasW = Math.max(1, Math.round(displayW * pixelScale));
  const canvasH = Math.max(1, Math.round(displayH * pixelScale));

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(canvasW, canvasH);
    ctx = canvas.getContext('2d');
  } else {
    const el = document.createElement('canvas');
    el.width = canvasW;
    el.height = canvasH;
    canvas = el;
    ctx = el.getContext('2d');
  }

  if (!ctx) throw new Error('无法创建绘图上下文');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let y = 0;
  for (let rowIndex = 0; rowIndex < table.data.length; rowIndex++) {
    const cellH = Math.round(rowHeights[rowIndex] * pixelScale);
    let x = 0;
    for (let colIndex = 0; colIndex < table.columns.length; colIndex++) {
      const cellW = Math.round(colWidths[colIndex] * pixelScale);
      const field = table.columns[colIndex].field;
      const url = table.data[rowIndex][field].value;
      const img = imageMap.get(url);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, cellW, cellH);
      if (img) drawImageContain(ctx, img, x, y, cellW, cellH);
      x += cellW;
    }
    y += cellH;
  }

  const blob =
    'convertToBlob' in canvas
      ? await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(b => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/png');
        });

  return new File([blob], `storyboard-grid-${Date.now()}.png`, { type: 'image/png' });
};
