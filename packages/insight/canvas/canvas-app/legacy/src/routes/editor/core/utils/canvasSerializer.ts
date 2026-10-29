import type { Canvas } from 'fabric';
import * as fabric from 'fabric';

/**
 * 给图片 URL 追加 CORS 去缓存参数，避免浏览器复用无 CORS 头的缓存响应
 * （页面中 <img> 标签加载过的图片会在缓存中不带 CORS 头，导致 Fabric.js 的 crossOrigin 请求命中脏缓存）
 */
function withCorsCacheBust(url: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'x-cors=1';
}

/**
 * 需要保留的核心属性列表
 * 这些属性是还原画布场景所必需的
 */
const ESSENTIAL_PROPS = [
  // 标识
  'id',
  'name',
  'type',
  // 位置和尺寸
  'left',
  'top',
  'width',
  'height',
  'scaleX',
  'scaleY',
  // 变换
  'angle',
  'skewX',
  'skewY',
  'flipX',
  'flipY',
  // 原点
  'originX',
  'originY',
  // 外观
  'fill',
  'stroke',
  'strokeWidth',
  'opacity',
  'shapeKind',
  'fillColor',
  'fillOpacity',
  'strokeColor',
  'strokeOpacity',
  // 文本特有
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'lineHeight',
  'charSpacing',
  'underline',
  'linethrough',
  // 图片特有
  'src',
  'cropX',
  'cropY',
  // 路径特有
  'path',
  // 多边形特有
  'points',
  // 分组
  'objects',
  // 可见性和锁定
  'visible',
  'lockMovementX',
  'lockMovementY',
  'lockScalingX',
  'lockScalingY',
  'lockRotation',
] as const;

/**
 * 默认值映射表
 * 如果属性值等于默认值，则可以剔除
 */
const DEFAULT_VALUES: Record<string, any> = {
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  opacity: 1,
  visible: true,
  flipX: false,
  flipY: false,
  skewX: 0,
  skewY: 0,
  strokeWidth: 1,
  originX: 'left',
  originY: 'top',
};

/**
 * 判断对象是否应该从缓存中过滤掉
 * @param obj Fabric 对象
 * @returns 是否应过滤
 */
function shouldFilterObject(obj: any): boolean {
  // 过滤工作区手柄 (运行时自动创建)
  if (obj.id?.startsWith('workspace-handle-')) return true;
  return false;
}

/**
 * 判断属性是否为默认值，可以剔除
 * @param prop 属性名
 * @param value 属性值
 * @returns 是否为默认值
 */
function isDefaultValue(prop: string, value: any): boolean {
  return prop in DEFAULT_VALUES && DEFAULT_VALUES[prop] === value;
}

/**
 * 提取单个对象的精简数据
 * @param objData Fabric 对象的 JSON 数据
 * @returns 精简后的对象数据
 */
function optimizeObjectData(objData: Record<string, any>): Record<string, any> {
  const data: Record<string, any> = {};

  ESSENTIAL_PROPS.forEach(prop => {
    if (objData[prop] !== undefined && !isDefaultValue(prop, objData[prop])) {
      data[prop] = objData[prop];
    }
  });

  return data;
}

export interface OptimizedCanvasData {
  version: string;
  objects: Record<string, any>[];
}

/**
 * 获取优化后的画布数据，剔除冗余字段
 *
 * 可剔除的字段分析:
 * 1. 控制相关 (运行时可恢复): cornerColor, cornerSize, cornerStyle, transparentCorners, borderColor, etc.
 * 2. 默认值字段: 值等于 Fabric 默认值的属性
 * 3. 内部状态: oCoords, aCoords, cacheKey, dirty, etc.
 * 4. 工作区手柄: workspace-handle-* 对象 (运行时自动创建)
 *
 * @param canvas Fabric Canvas 实例
 * @returns 优化后的画布数据
 */
export function getOptimizedCanvasData(canvas: Canvas): OptimizedCanvasData {
  // 使用 canvas.toObject() 获取完整数据，确保坐标是绝对坐标
  // 避免直接遍历 canvas.getObjects() 时，若对象在 ActiveSelection 中会导致坐标为相对坐标 (0,0) 的问题
  const fullData = canvas.toObject(['id', 'name']);

  const objects = fullData.objects.filter((obj: any) => !shouldFilterObject(obj)).map((obj: any) => optimizeObjectData(obj));

  return {
    version: fullData.version || '6.9.1',
    objects,
  };
}

/**
 * 分析画布数据大小
 * @param canvas Fabric Canvas 实例
 * @returns 完整数据、优化数据及压缩比
 */
export function analyzeCanvasData(canvas: Canvas) {
  const fullData = canvas.toObject(['id', 'name']);
  const optimizedData = getOptimizedCanvasData(canvas);

  const fullSize = JSON.stringify(fullData).length;
  const optimizedSize = JSON.stringify(optimizedData).length;
  const compressionRatio = ((1 - optimizedSize / fullSize) * 100).toFixed(1);

  return {
    fullData,
    optimizedData,
    fullSize,
    optimizedSize,
    compressionRatio,
  };
}

/**
 * 从 objData 中提取可设置的属性（排除只读属性如 type）
 */
function getSettableProps(objData: Record<string, any>): Record<string, any> {
  const { type, ...props } = objData;
  return props;
}

/**
 * 从优化数据创建 Fabric 对象
 * @param objData 对象数据
 * @returns Fabric 对象或 null
 */
async function createFabricObject(objData: Record<string, any>): Promise<fabric.Object | null> {
  const type = objData.type;
  const props = getSettableProps(objData);

  // 跳过 workspace（由 WorkspacePlugin 管理，在 loadOptimizedData 中单独处理）
  if (objData.id === 'workspace') return null;

  try {
    let obj: fabric.Object | null = null;

    switch (type) {
      case 'textbox':
      case 'Textbox':
        obj = new fabric.Textbox(objData.text || '', props);
        break;

      case 'text':
      case 'Text':
        obj = new fabric.Text(objData.text || '', props);
        break;

      case 'rect':
      case 'Rect':
        obj = new fabric.Rect(props);
        break;

      case 'circle':
      case 'Circle':
        obj = new fabric.Circle(props);
        break;

      case 'triangle':
      case 'Triangle':
        obj = new fabric.Triangle(props);
        break;

      case 'polygon':
      case 'Polygon': {
        const polygonProps = { ...props };
        delete polygonProps.points;
        obj = new fabric.Polygon(objData.points || [], polygonProps);
        break;
      }

      case 'image':
      case 'Image':
        if (objData.src) {
          obj = await fabric.Image.fromURL(withCorsCacheBust(objData.src), {
            crossOrigin: 'anonymous',
          });
          const { src, ...imageProps } = props;
          obj.set(imageProps);
        }
        break;

      case 'path':
      case 'Path':
        if (objData.path) {
          const { path, ...pathProps } = props;
          obj = new fabric.Path(objData.path, pathProps);
        }
        break;

      case 'group':
      case 'Group':
        if (objData.objects && Array.isArray(objData.objects)) {
          const groupObjects = await Promise.all(objData.objects.map((child: any) => createFabricObject(child)));
          const validObjects = groupObjects.filter((o): o is fabric.Object => o !== null);
          const { objects: _, ...groupProps } = props;
          obj = new fabric.Group(validObjects, groupProps);
        }
        break;

      default:
        console.warn(`[loadOptimizedData] 未知对象类型: ${type}`);
        return null;
    }

    return obj;
  } catch (error) {
    console.error(`[loadOptimizedData] 创建对象失败:`, error, objData);
    return null;
  }
}

/**
 * 从优化后的数据还原画布内容
 *
 * @param canvas Fabric Canvas 实例
 * @param data 优化后的画布数据
 * @returns 加载成功与否
 */
export async function loadOptimizedData(canvas: Canvas, data: OptimizedCanvasData): Promise<boolean> {
  if (!data || !data.objects) {
    console.error('[loadOptimizedData] 无效的数据格式');
    return false;
  }

  console.log(`[loadOptimizedData] 开始加载 ${data.objects.length} 个对象，版本: ${data.version}`);

  try {
    // 遍历并创建对象
    for (const objData of data.objects) {
      // 特殊处理 workspace：更新现有 workspace 的属性
      if (objData.id === 'workspace') {
        const workspace = canvas.getObjects().find(obj => obj.id === 'workspace');
        if (workspace) {
          const { type, id, ...workspaceProps } = objData;
          workspace.set(workspaceProps);
          workspace.setCoords();
          console.log('[loadOptimizedData] 已更新 workspace 属性:', workspaceProps);
        }
        continue;
      }

      const obj = await createFabricObject(objData);
      if (obj) {
        canvas.add(obj);
      }
    }

    canvas.requestRenderAll();
    console.log('[loadOptimizedData] 加载完成');
    return true;
  } catch (error) {
    console.error('[loadOptimizedData] 加载失败:', error);
    return false;
  }
}
