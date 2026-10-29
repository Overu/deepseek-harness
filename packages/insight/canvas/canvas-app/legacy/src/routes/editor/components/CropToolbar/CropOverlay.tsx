import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Check, X, RectangleHorizontal, Square, Smartphone, PanelsTopLeft } from 'lucide-react';
import { useEditorEngine } from '../../hooks/useEditorEngine';
import * as fabric from 'fabric';

export type CropRatio = 'free' | '1:1' | '4:3' | '16:9' | '3:4' | '9:16';

const RATIO_OPTIONS: {
  value: CropRatio;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: 'free', label: '自由', icon: <PanelsTopLeft size={16} /> },
  { value: '1:1', label: '1:1', icon: <Square size={16} /> },
  { value: '4:3', label: '4:3', icon: <RectangleHorizontal size={16} /> },
  { value: '16:9', label: '16:9', icon: <RectangleHorizontal size={16} /> },
  { value: '3:4', label: '3:4', icon: <Smartphone size={16} /> },
  { value: '9:16', label: '9:16', icon: <Smartphone size={16} /> },
];

interface CropBounds {
  /** 图片中心在视口中的坐标 */
  centerX: number;
  centerY: number;
  /** 图片在视口中的尺寸（未旋转，仅 scale * zoom） */
  imageWidth: number;
  imageHeight: number;
  /** 旋转角度（度） */
  angle: number;
}

interface CropOverlayProps {
  targetId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 裁剪覆盖层组件
 * 裁剪框随图片旋转，完全贴合图片边界
 */
export function CropOverlay({ targetId, onConfirm, onCancel }: CropOverlayProps) {
  const engine = useEditorEngine();

  // 裁剪框状态（相对于旋转容器内部，即图片本地视口空间）
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [imageBounds, setImageBounds] = useState<CropBounds | null>(null);
  const [cropRatio, setCropRatio] = useState<CropRatio>('free');

  const dragRef = useRef<{
    type: 'move' | 'resize' | 'pan';
    handle?: string;
    startX: number;
    startY: number;
    startRect: typeof cropRect;
  } | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);

  // 处理空格平移相关状态
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const isSpacePressed = useRef(false);

  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  }, [onConfirm, onCancel]);

  const originalVptRef = useRef<fabric.TMat2D | null>(null);
  // 保存目标图片的原始层级
  const originalZIndexRef = useRef<number | null>(null);
  // 保存目标图片的原始 clipPath，裁剪结束后还原
  const savedClipPathRef = useRef<fabric.Object | undefined>(undefined);

  // 获取图片在视口中的中心位置、未旋转尺寸和旋转角度
  const getImageBoundsInViewport = useCallback(() => {
    if (!targetId) return null;

    const canvas = engine.getCanvas();
    const obj = engine.getObjectById(targetId);
    if (!obj || obj.type !== 'image') return null;

    const image = obj as fabric.Image;
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];

    // 此覆盖层使用 absolute inset-0 挂载在图层结构中，这代表其原点恰好是 canvas-container 左上角。
    // 我们直接舍弃 getBoundingClientRect() 防止因为 flex/viewport 的小数点像素对齐导致 0.5~2px 的视觉误差。
    const center = image.getCenterPoint();
    const centerVpX = center.x * zoom + vpt[4];
    const centerVpY = center.y * zoom + vpt[5];

    // 图片在视口中的尺寸（未旋转）
    const imgWidth = (image.width || 0) * (image.scaleX || 1) * zoom;
    const imgHeight = (image.height || 0) * (image.scaleY || 1) * zoom;

    return {
      centerX: centerVpX,
      centerY: centerVpY,
      imageWidth: imgWidth,
      imageHeight: imgHeight,
      angle: image.angle || 0,
    };
  }, [targetId, engine]);

  // 初始化裁剪框
  useEffect(() => {
    if (!targetId) return;

    const obj = engine.getObjectById(targetId) as fabric.Image;
    if (!obj || obj.type !== 'image') return;

    // 暂停历史记录
    const historyPlugin = engine.pluginManager.get('HistoryPlugin') as any;
    historyPlugin?.pause?.();

    // 禁用快捷键
    engine.disableShortcuts();

    // 隐藏原生控制柄和边框，避免在底层透出干扰用户
    obj.set({
      hasControls: false,
      hasBorders: false,
    });

    // 临时移除工作区 clipPath，使超出工作区的图片部分在裁剪模式下完整可见
    savedClipPathRef.current = (obj as any).clipPath;
    (obj as any).clipPath = undefined;

    const canvas = engine.getCanvas();
    if (canvas) {
      // 临时移至顶层，防止裁剪时被其他对象遮挡
      if (originalZIndexRef.current === null) {
        originalZIndexRef.current = canvas.getObjects().indexOf(obj);
        canvas.moveObjectTo(obj, canvas.getObjects().length - 1);
      }

      if (!originalVptRef.current) {
        originalVptRef.current = [...(canvas.viewportTransform || [1, 0, 0, 1, 0, 0])] as fabric.TMat2D;
      }

      // 自动最佳伸缩：聚焦到裁剪对象，避免大图手柄超出可视边界
      const canvasEl = canvas.getElement().parentElement;
      if (canvasEl) {
        const cw = canvasEl.clientWidth;
        const ch = canvasEl.clientHeight;

        const ow = (obj.width || 0) * (obj.scaleX || 1);
        const oh = (obj.height || 0) * (obj.scaleY || 1);

        // 留 20% 空白用来显示拖拽边框和工具栏，容差 0.8，底部额外预留 60px
        const scaleX = (cw * 0.8) / Math.max(1, ow);
        const scaleY = (ch * 0.8 - 60) / Math.max(1, oh);

        // 我们不特地去放大正常比例内的小图，只限制超大图。因此 Math.min 加入 canvas.getZoom()
        const targetZoom = Math.min(scaleX, scaleY, canvas.getZoom());

        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        const center = obj.getCenterPoint();
        canvas.zoomToPoint(new fabric.Point(cw / 2, ch / 2 - 30), targetZoom);

        // 平移 viewport 使得图片中心位于容器中心偏上 30px，给底部工具栏留足空间
        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        vpt[4] = cw / 2 - center.x * targetZoom;
        vpt[5] = ch / 2 - 30 - center.y * targetZoom;
        canvas.requestRenderAll();
      }
    }

    requestAnimationFrame(() => {
      const bounds = getImageBoundsInViewport();
      if (!bounds) return;

      setImageBounds(bounds);
      // cropRect 相对于旋转容器内部（0,0 = 图片左上角）
      setCropRect({
        x: 0,
        y: 0,
        width: bounds.imageWidth,
        height: bounds.imageHeight,
      });
      setCropRatio('free');
    });
  }, [targetId, engine, getImageBoundsInViewport]);

  // 监听画布视口变化（缩放、平移等）
  useEffect(() => {
    if (!targetId || !imageBounds) return;

    const canvas = engine.getCanvas();
    if (!canvas) return;

    // 保存裁剪框相对于图片的比例位置
    let cropRelative = {
      xRatio: cropRect.x / imageBounds.imageWidth,
      yRatio: cropRect.y / imageBounds.imageHeight,
      widthRatio: cropRect.width / imageBounds.imageWidth,
      heightRatio: cropRect.height / imageBounds.imageHeight,
    };

    const updateOnViewportChange = () => {
      const newBounds = getImageBoundsInViewport();
      if (!newBounds) return;

      const newCropRect = {
        x: cropRelative.xRatio * newBounds.imageWidth,
        y: cropRelative.yRatio * newBounds.imageHeight,
        width: cropRelative.widthRatio * newBounds.imageWidth,
        height: cropRelative.heightRatio * newBounds.imageHeight,
      };

      setImageBounds(newBounds);
      setCropRect(newCropRect);
    };

    // 更新相对位置
    cropRelative = {
      xRatio: cropRect.x / imageBounds.imageWidth,
      yRatio: cropRect.y / imageBounds.imageHeight,
      widthRatio: cropRect.width / imageBounds.imageWidth,
      heightRatio: cropRect.height / imageBounds.imageHeight,
    };

    canvas.on('after:render', updateOnViewportChange);
    return () => {
      canvas.off('after:render', updateOnViewportChange);
    };
  }, [targetId, engine, imageBounds, cropRect, getImageBoundsInViewport]);

  // 约束裁剪框在图片范围内
  const constrainRect = useCallback(
    (rect: typeof cropRect) => {
      if (!imageBounds) return rect;

      let { x, y, width, height } = rect;
      const minSize = 20;

      width = Math.max(width, minSize);
      height = Math.max(height, minSize);

      // 约束在容器内 (0, 0, imageWidth, imageHeight)
      x = Math.max(0, Math.min(x, imageBounds.imageWidth - width));
      y = Math.max(0, Math.min(y, imageBounds.imageHeight - height));
      width = Math.min(width, imageBounds.imageWidth - x);
      height = Math.min(height, imageBounds.imageHeight - y);

      return { x, y, width, height };
    },
    [imageBounds]
  );

  // 鼠标按下
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'move' | 'resize', handle?: string) => {
      e.preventDefault();
      e.stopPropagation();

      dragRef.current = {
        type,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...cropRect },
      };
    },
    [cropRect]
  );

  // 鼠标移动 - 将鼠标位移投影到图片对齐的坐标系
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragRef.current || !imageBounds) return;

      const { type, handle, startX, startY, startRect } = dragRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // 将屏幕坐标系的位移投影到图片本地坐标系（反旋转）
      const rad = -(imageBounds.angle || 0) * (Math.PI / 180);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const localDx = dx * cos - dy * sin;
      const localDy = dx * sin + dy * cos;

      let newRect = { ...startRect };

      if (type === 'move') {
        newRect.x = startRect.x + localDx;
        newRect.y = startRect.y + localDy;
      } else if (type === 'resize' && handle) {
        switch (handle) {
          case 'nw':
            newRect.x = startRect.x + localDx;
            newRect.y = startRect.y + localDy;
            newRect.width = startRect.width - localDx;
            newRect.height = startRect.height - localDy;
            break;
          case 'ne':
            newRect.y = startRect.y + localDy;
            newRect.width = startRect.width + localDx;
            newRect.height = startRect.height - localDy;
            break;
          case 'sw':
            newRect.x = startRect.x + localDx;
            newRect.width = startRect.width - localDx;
            newRect.height = startRect.height + localDy;
            break;
          case 'se':
            newRect.width = startRect.width + localDx;
            newRect.height = startRect.height + localDy;
            break;
          case 'n':
            newRect.y = startRect.y + localDy;
            newRect.height = startRect.height - localDy;
            break;
          case 's':
            newRect.height = startRect.height + localDy;
            break;
          case 'w':
            newRect.x = startRect.x + localDx;
            newRect.width = startRect.width - localDx;
            break;
          case 'e':
            newRect.width = startRect.width + localDx;
            break;
        }

        // 比例约束
        if (cropRatio !== 'free') {
          const [rw, rh] = cropRatio.split(':').map(Number);
          const targetRatio = rw / rh;

          if (['nw', 'ne', 'sw', 'se'].includes(handle)) {
            newRect.height = newRect.width / targetRatio;
          }
        }
      }

      setCropRect(constrainRect(newRect));
    },
    [imageBounds, cropRatio, constrainRect]
  );

  // 鼠标释放
  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // 绑定全局鼠标事件与缩放拦截
  useEffect(() => {
    if (!targetId) return;

    // 禁用默认的浏览器缩放行为 (Cmd/Ctrl + 滚轮/加减号)
    const preventZoom = (e: WheelEvent | KeyboardEvent) => {
      const canvas = engine.getCanvas();
      if (!canvas) return;

      // 触控板/鼠标滚轮 pinch-to-zoom 或 Ctrl+滚轮
      if (e.type === 'wheel') {
        const wheelEvent = e as WheelEvent;
        const isCtrl = wheelEvent.ctrlKey || wheelEvent.metaKey;

        if (isCtrl) {
          e.preventDefault();
          // Zoom
          const delta = wheelEvent.deltaY;
          let zoom = canvas.getZoom();
          // 跟 WorkspacePlugin 保持一致的缩放系数
          zoom *= 0.999 ** delta;
          if (zoom > 20) zoom = 20; // 对应 constants.MAX_ZOOM
          if (zoom < 0.05) zoom = 0.05; // 对应 constants.MIN_ZOOM

          // 以鼠标当前位置为中心缩放
          // 返回屏幕坐标相对偏移
          const rect = canvas.getElement().getBoundingClientRect();
          const point = new fabric.Point(wheelEvent.clientX - rect.left, wheelEvent.clientY - rect.top);
          canvas.zoomToPoint(point, zoom);
        } else {
          // 仅在非缩放时平移
          // Pan Logic (Standard trackpad/wheel panning)
          e.preventDefault();
          canvas.relativePan(new fabric.Point(-wheelEvent.deltaX, -wheelEvent.deltaY));
          canvas.requestRenderAll();
        }
      }
      // 快捷键 Cmd/Ctrl + '+' / '-' / '=' / '0'
      else if (e.type === 'keydown') {
        const keyEvent = e as KeyboardEvent;

        // 空格平移
        if (keyEvent.code === 'Space' && !isSpacePressed.current) {
          keyEvent.preventDefault();
          isSpacePressed.current = true;
          setIsSpacePanning(true);
          return;
        }

        // 屏蔽删除操作避免裁剪中误删
        if (keyEvent.key === 'Backspace' || keyEvent.key === 'Delete') {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          return;
        }

        if (keyEvent.ctrlKey || keyEvent.metaKey) {
          if (['=', '+'].includes(keyEvent.key)) {
            keyEvent.preventDefault();
            engine.zoomIn();
          } else if (keyEvent.key === '-') {
            keyEvent.preventDefault();
            engine.zoomOut();
          } else if (keyEvent.key === '0') {
            keyEvent.preventDefault();
            engine.zoomToFit();
          }
        }
      } else if (e.type === 'keyup') {
        const keyEvent = e as KeyboardEvent;
        if (keyEvent.code === 'Space') {
          keyEvent.preventDefault();
          isSpacePressed.current = false;
          setIsSpacePanning(false);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    // 空格键松开
    const handleKeyUp = (e: KeyboardEvent) => preventZoom(e);

    // 监听滚轮和键盘阻止浏览器默认缩放
    document.addEventListener('wheel', preventZoom, { passive: false });
    document.addEventListener('keydown', preventZoom, { passive: false });
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('wheel', preventZoom);
      document.removeEventListener('keydown', preventZoom);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [targetId, handleMouseMove, handleMouseUp, engine]);

  // 处理空格拖拽平移
  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isSpacePanning && engine.getCanvas()) {
        dragRef.current = {
          type: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          startRect: { ...cropRect },
        } as any;
      }
    },
    [isSpacePanning, engine, cropRect]
  );

  const handleOverlayMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isSpacePanning && dragRef.current?.type === 'pan') {
        e.preventDefault();
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        dragRef.current.startX = e.clientX;
        dragRef.current.startY = e.clientY;

        const canvas = engine.getCanvas();
        if (canvas) {
          canvas.relativePan(new fabric.Point(dx, dy));
          canvas.requestRenderAll();
        }
      }
    },
    [isSpacePanning, engine]
  );

  // 确认裁剪
  const handleConfirmClick = useCallback(() => {
    if (!targetId || !imageBounds) return;

    const canvas = engine.getCanvas();
    const obj = engine.getObjectById(targetId);
    if (!obj || obj.type !== 'image') return;

    const image = obj as fabric.Image;
    const zoom = canvas.getZoom();
    const scaleX = image.scaleX || 1;
    const scaleY = image.scaleY || 1;

    // cropRect 在容器内（视口像素），转换为图片像素空间
    const pixelLeft = cropRect.x / (scaleX * zoom);
    const pixelTop = cropRect.y / (scaleY * zoom);
    const pixelWidth = cropRect.width / (scaleX * zoom);
    const pixelHeight = cropRect.height / (scaleY * zoom);

    if (pixelWidth <= 0 || pixelHeight <= 0) return;

    // 计算新裁剪区域中心在图片本地坐标系中的位置（center-origin）
    const halfW = (image.width || 0) / 2;
    const halfH = (image.height || 0) / 2;
    const newCropCenterLocalX = pixelLeft + pixelWidth / 2 - halfW;
    const newCropCenterLocalY = pixelTop + pixelHeight / 2 - halfH;

    // 通过变换矩阵转换到画布坐标
    const transformMatrix = image.calcTransformMatrix();
    const newCenterCanvas = fabric.util.transformPoint(new fabric.Point(newCropCenterLocalX, newCropCenterLocalY), transformMatrix);

    const currentCropX = image.cropX || 0;
    const currentCropY = image.cropY || 0;

    // 应用裁剪参数（同时还原工作区 clipPath）
    image.set({
      cropX: currentCropX + pixelLeft,
      cropY: currentCropY + pixelTop,
      width: pixelWidth,
      height: pixelHeight,
      clipPath: savedClipPathRef.current,
    });
    savedClipPathRef.current = undefined;

    // 设置新位置，使裁剪区域保持原位
    image.setPositionByOrigin(newCenterCanvas, 'center', 'center');
    image.setCoords();
    canvas.requestRenderAll();

    // 恢复控制柄
    image.set({
      hasControls: true,
      hasBorders: true,
    });

    // 恢复原始层级
    if (originalZIndexRef.current !== null) {
      canvas.moveObjectTo(image, originalZIndexRef.current);
      originalZIndexRef.current = null;
    }

    if (originalVptRef.current) {
      canvas.setViewportTransform(originalVptRef.current);
      originalVptRef.current = null;
      canvas.requestRenderAll();
    }

    // 恢复历史记录
    const historyPlugin = engine.pluginManager.get('HistoryPlugin') as any;
    historyPlugin?.resume?.();

    // 恢复快捷键
    engine.enableShortcuts();

    canvas.fire('object:modified', { target: image });

    onConfirmRef.current();
  }, [targetId, imageBounds, cropRect, engine]);

  const handleConfirmRef = useRef(handleConfirmClick);
  useEffect(() => {
    handleConfirmRef.current = handleConfirmClick;
  }, [handleConfirmClick]);

  // 取消
  const handleCancel = useCallback(() => {
    if (!targetId) return;

    const canvas = engine.getCanvas();
    if (canvas) {
      if (originalVptRef.current) {
        canvas.setViewportTransform(originalVptRef.current);
        originalVptRef.current = null;
      }

      const obj = engine.getObjectById(targetId);
      if (obj) {
        obj.set({
          hasControls: true,
          hasBorders: true,
          clipPath: savedClipPathRef.current,
        });
        savedClipPathRef.current = undefined;

        // 恢复原始层级
        if (originalZIndexRef.current !== null) {
          canvas.moveObjectTo(obj, originalZIndexRef.current);
          originalZIndexRef.current = null;
        }
      }
      canvas.requestRenderAll();
    }

    const historyPlugin = engine.pluginManager.get('HistoryPlugin') as any;
    historyPlugin?.resume?.();

    engine.enableShortcuts();

    onCancelRef.current();
  }, [targetId, engine]);

  // 键盘事件
  useEffect(() => {
    if (!targetId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirmRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [targetId, handleCancel]);

  // 比例变化
  const handleRatioChange = useCallback(
    (ratio: CropRatio) => {
      setCropRatio(ratio);

      if (!imageBounds) return;

      if (ratio === 'free') {
        setCropRect({
          x: 0,
          y: 0,
          width: imageBounds.imageWidth,
          height: imageBounds.imageHeight,
        });
        return;
      }

      const [w, h] = ratio.split(':').map(Number);
      const targetRatio = w / h;

      const imageRatio = imageBounds.imageWidth / imageBounds.imageHeight;
      let newWidth: number;
      let newHeight: number;

      if (imageRatio > targetRatio) {
        newHeight = imageBounds.imageHeight;
        newWidth = newHeight * targetRatio;
      } else {
        newWidth = imageBounds.imageWidth;
        newHeight = newWidth / targetRatio;
      }

      const newX = (imageBounds.imageWidth - newWidth) / 2;
      const newY = (imageBounds.imageHeight - newHeight) / 2;

      setCropRect(constrainRect({ x: newX, y: newY, width: newWidth, height: newHeight }));
    },
    [imageBounds, constrainRect]
  );

  // 计算裁剪框四角在视口中的旋转坐标（用于遮罩和工具栏定位）
  const getCropCornersInViewport = useCallback(() => {
    if (!imageBounds) return [];

    const { centerX, centerY, imageWidth, imageHeight, angle } = imageBounds;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // 裁剪框四角相对于图片中心
    const cx = cropRect.x + cropRect.width / 2 - imageWidth / 2;
    const cy = cropRect.y + cropRect.height / 2 - imageHeight / 2;
    const hw = cropRect.width / 2;
    const hh = cropRect.height / 2;

    const localCorners = [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh },
    ];

    return localCorners.map(p => ({
      x: centerX + p.x * cos - p.y * sin,
      y: centerY + p.x * sin + p.y * cos,
    }));
  }, [imageBounds, cropRect]);

  // 工具栏位置（在裁剪框正下方，已考虑旋转）
  const toolbarPosition = useMemo(() => {
    if (!imageBounds) return {};

    const { centerX, centerY, imageWidth, imageHeight, angle } = imageBounds;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // 裁剪框底部中心（在图片本地空间，相对于图片中心）
    const localX = cropRect.x + cropRect.width / 2 - imageWidth / 2;
    const localY = cropRect.y + cropRect.height - imageHeight / 2;

    let left = centerX + localX * cos - localY * sin;
    let top = centerY + localX * sin + localY * cos + 16;

    // 边界约束，确保即使放大拖拽，工具栏也始终悬浮在可见视口内
    const canvas = engine.getCanvas();
    const canvasEl = canvas?.getElement()?.parentElement;
    if (canvasEl) {
      const cw = canvasEl.clientWidth;
      const ch = canvasEl.clientHeight;
      // 距底边留白 80px，左右各留 180px 安全区
      left = Math.max(180, Math.min(left, cw - 180));
      top = Math.max(40, Math.min(top, ch - 80));
    }

    return {
      left,
      top,
      transform: 'translateX(-50%)',
    };
  }, [imageBounds, cropRect, engine]);

  if (!targetId || !imageBounds) return null;

  const handleSize = 10;
  const cropCorners = getCropCornersInViewport();

  // SVG mask 多边形顶点
  const maskPolygonPoints = cropCorners.length === 4 ? cropCorners.map(c => `${c.x},${c.y}`).join(' ') : '';

  return (
    <div
      ref={overlayRef}
      className={`absolute inset-0 z-50 ${isSpacePanning ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ pointerEvents: 'auto', overflow: 'hidden' }}
      onMouseDown={handleOverlayMouseDown}
      onMouseMove={handleOverlayMouseMove}
    >
      {/* 遮罩层：SVG mask 实现全屏半透明 + 裁剪框透明孔 */}
      <svg className='absolute inset-0 w-full h-full' style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id={`crop-mask-${targetId}`}>
            <rect width='100%' height='100%' fill='white' />
            {maskPolygonPoints && <polygon points={maskPolygonPoints} fill='black' />}
          </mask>
        </defs>
        <rect width='100%' height='100%' fill='rgba(0,0,0,0.6)' mask={`url(#crop-mask-${targetId})`} />
      </svg>

      {/* 旋转容器 - 与图片旋转对齐 */}
      <div
        style={{
          position: 'absolute',
          left: imageBounds.centerX - imageBounds.imageWidth / 2,
          top: imageBounds.centerY - imageBounds.imageHeight / 2,
          width: imageBounds.imageWidth,
          height: imageBounds.imageHeight,
          transform: `rotate(${imageBounds.angle}deg)`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
        }}
      >
        {/* 裁剪框 */}
        <div
          className='absolute border-2 border-white cursor-move'
          style={{
            left: cropRect.x,
            top: cropRect.y,
            width: cropRect.width,
            height: cropRect.height,
            pointerEvents: 'auto',
          }}
          onMouseDown={e => handleMouseDown(e, 'move')}
        >
          {/* 网格线 */}
          <div className='absolute inset-0 pointer-events-none'>
            <div className='absolute left-1/3 top-0 bottom-0 w-px bg-white/30' />
            <div className='absolute left-2/3 top-0 bottom-0 w-px bg-white/30' />
            <div className='absolute top-1/3 left-0 right-0 h-px bg-white/30' />
            <div className='absolute top-2/3 left-0 right-0 h-px bg-white/30' />
          </div>

          {/* 8个控制点 */}
          {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(handle => {
            const positions: Record<string, React.CSSProperties> = {
              nw: {
                top: -handleSize / 2,
                left: -handleSize / 2,
                cursor: 'nw-resize',
              },
              n: {
                top: -handleSize / 2,
                left: '50%',
                transform: 'translateX(-50%)',
                cursor: 'n-resize',
              },
              ne: {
                top: -handleSize / 2,
                right: -handleSize / 2,
                cursor: 'ne-resize',
              },
              w: {
                top: '50%',
                left: -handleSize / 2,
                transform: 'translateY(-50%)',
                cursor: 'w-resize',
              },
              e: {
                top: '50%',
                right: -handleSize / 2,
                transform: 'translateY(-50%)',
                cursor: 'e-resize',
              },
              sw: {
                bottom: -handleSize / 2,
                left: -handleSize / 2,
                cursor: 'sw-resize',
              },
              s: {
                bottom: -handleSize / 2,
                left: '50%',
                transform: 'translateX(-50%)',
                cursor: 's-resize',
              },
              se: {
                bottom: -handleSize / 2,
                right: -handleSize / 2,
                cursor: 'se-resize',
              },
            };

            return (
              <div
                key={handle}
                className='absolute bg-white border border-black'
                style={{
                  width: handleSize,
                  height: handleSize,
                  pointerEvents: 'auto',
                  ...positions[handle],
                }}
                onMouseDown={e => handleMouseDown(e, 'resize', handle)}
              />
            );
          })}
        </div>
      </div>

      {/* 工具栏 */}
      <div
        className='absolute flex items-center gap-2 bg-zinc-900/95 border border-zinc-700 rounded-lg px-3 py-2 shadow-lg'
        style={toolbarPosition}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onMouseDown={e => e.stopPropagation()}
        onMouseUp={e => e.stopPropagation()}
      >
        {/* 比例选择 */}
        <div className='flex items-center gap-1'>
          {RATIO_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => handleRatioChange(option.value)}
              className={`flex flex-col items-center justify-center gap-0.5 w-10 h-11 rounded hover:bg-zinc-700 transition-colors ${
                cropRatio === option.value ? 'bg-zinc-700 text-blue-400' : 'text-white'
              }`}
            >
              <div className=''>{option.icon}</div>
              <span className='text-[10px] scale-90 font-medium opacity-80'>{option.label}</span>
            </button>
          ))}
        </div>

        <div className='w-px h-8 bg-zinc-700 mx-1' />

        {/* 确认/取消 */}
        <div className='flex items-center gap-1'>
          <button
            onClick={handleCancel}
            className='flex flex-col items-center justify-center gap-0.5 w-10 h-11 rounded text-red-600 hover:text-red-400 hover:bg-zinc-700 transition-colors'
          >
            <X size={20} />
          </button>
          <button
            onClick={handleConfirmClick}
            className='flex flex-col items-center justify-center gap-0.5 w-10 h-11 rounded text-green-600 hover:text-green-400 hover:bg-zinc-700 transition-colors'
          >
            <Check size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
