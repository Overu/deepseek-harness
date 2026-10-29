import type { ShapeKind } from '../types';

export const DEFAULT_SHAPE_STYLE = {
  fillColor: '#FF0000',
  fillOpacity: 0,
  strokeColor: '#FF0000',
  strokeOpacity: 100,
  strokeWidth: 4,
  opacity: 100,
} as const;

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  circle: '圆形',
  triangle: '三角形',
  square: '正方形',
  rectangle: '长方形',
  star: '五角星',
  hexagon: '六边形',
};

export interface ShapePoint {
  x: number;
  y: number;
}

export interface ParsedShapeColor {
  color: string;
  opacity: number;
}

const clampOpacity = (opacity: number): number => Math.min(100, Math.max(0, Math.round(opacity)));

const expandHex = (value: string): string | null => {
  const hex = value.trim();
  if (!/^#[\da-f]{3,4}$|^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) return null;

  if (hex.length === 4 || hex.length === 5) {
    return `#${hex
      .slice(1)
      .split('')
      .map(char => `${char}${char}`)
      .join('')}`.toUpperCase();
  }

  return hex.toUpperCase();
};

const channelToHex = (value: number): string =>
  Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

export function parseShapeColor(value: unknown, fallbackColor: string, fallbackOpacity: number): ParsedShapeColor {
  if (typeof value !== 'string') {
    return { color: fallbackColor, opacity: clampOpacity(fallbackOpacity) };
  }

  if (value.trim().toLowerCase() === 'transparent') {
    return { color: fallbackColor, opacity: 0 };
  }

  const expandedHex = expandHex(value);
  if (expandedHex) {
    const color = expandedHex.slice(0, 7);
    const opacity = expandedHex.length === 9 ? (Number.parseInt(expandedHex.slice(7), 16) / 255) * 100 : fallbackOpacity;
    return { color, opacity: clampOpacity(opacity) };
  }

  const rgbMatch = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)%?)?\s*\)$/i);
  if (rgbMatch) {
    const [, red = '0', green = '0', blue = '0', alpha] = rgbMatch;
    const color = `#${channelToHex(Number(red))}${channelToHex(Number(green))}${channelToHex(Number(blue))}`;
    const opacity = alpha === undefined ? fallbackOpacity : Number(alpha) <= 1 ? Number(alpha) * 100 : Number(alpha);
    return { color, opacity: clampOpacity(opacity) };
  }

  return { color: fallbackColor, opacity: clampOpacity(fallbackOpacity) };
}

export function colorWithOpacity(color: string, opacity: number): string {
  if (color.trim().toLowerCase() === 'transparent') return 'transparent';

  const { color: normalizedColor } = parseShapeColor(color, DEFAULT_SHAPE_STYLE.fillColor, 100);
  const normalizedOpacity = clampOpacity(opacity);
  if (normalizedOpacity === 100) return normalizedColor;

  return `${normalizedColor}${channelToHex((normalizedOpacity / 100) * 255)}`;
}

export function createRegularPolygonPoints(sides: number, radius: number, startAngle = -Math.PI / 2): ShapePoint[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = startAngle + (index * Math.PI * 2) / sides;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}

export function createStarPoints(points: number, outerRadius: number, innerRadius: number): ShapePoint[] {
  return Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}
