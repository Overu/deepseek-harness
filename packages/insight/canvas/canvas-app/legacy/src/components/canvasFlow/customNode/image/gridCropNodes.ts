import type { Node } from '@xyflow/react';
import util from '../../utils/util';
import { calculateMediaNodeDimensions } from '../../utils/mediaDimensions';
import { preserveNodeTitle } from '../../utils/nodeNaming';
import type { UploadedGridCrop } from './gridCropImage';

const CHILD_GAP = 32;
const GROUP_PADDING = 50;
const GROUP_SOURCE_GAP = 80;

interface GridCropLayoutItem {
  row: number;
  column: number;
  width: number;
  height: number;
}

interface BuildGridCropNodesOptions {
  crops: UploadedGridCrop[];
  existingNodes: Node[];
  sourcePosition: {
    x: number;
    y: number;
  };
  sourceWidth: number;
  modelsMap: Parameters<typeof util.createNode>[0];
  modelNodePermission: Parameters<typeof util.createNode>[2];
}

export const createGridCropGroupTitle = (index: number) => `宫格裁切-组${index}`;

export const createGridCropNodeTitle = (groupTitle: string, row: number, column: number) => `${groupTitle}-${row},${column}`;

export const getNextGridCropGroupIndex = (nodes: Node[]) => nodes.filter(node => node.type === 'group').length + 1;

export const calculateGridCropLayout = (items: GridCropLayoutItem[]) => {
  if (!items.length) {
    return { positions: [], width: 0, height: 0 };
  }

  const columnCount = Math.max(...items.map(item => item.column));
  const rowCount = Math.max(...items.map(item => item.row));
  const columnWidths = Array.from({ length: columnCount }, () => 0);
  const rowHeights = Array.from({ length: rowCount }, () => 0);

  items.forEach(item => {
    columnWidths[item.column - 1] = Math.max(columnWidths[item.column - 1], item.width);
    rowHeights[item.row - 1] = Math.max(rowHeights[item.row - 1], item.height);
  });

  const columnOffsets = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((total, width) => total + width, 0) + index * CHILD_GAP);
  const rowOffsets = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((total, height) => total + height, 0) + index * CHILD_GAP);

  return {
    positions: items.map(item => ({
      x: columnOffsets[item.column - 1],
      y: rowOffsets[item.row - 1],
    })),
    width: columnWidths.reduce((total, width) => total + width, 0) + Math.max(columnCount - 1, 0) * CHILD_GAP,
    height: rowHeights.reduce((total, height) => total + height, 0) + Math.max(rowCount - 1, 0) * CHILD_GAP,
  };
};

export const buildGridCropNodes = ({ crops, existingNodes, sourcePosition, sourceWidth, modelsMap, modelNodePermission }: BuildGridCropNodesOptions): Node[] => {
  const dimensions = crops.map(crop => calculateMediaNodeDimensions({ width: crop.width, height: crop.height }));
  if (dimensions.some(item => !item)) {
    throw new Error('宫格裁切节点尺寸计算失败');
  }

  const measuredSizes = dimensions.map(item => item!);
  const groupTitle = createGridCropGroupTitle(getNextGridCropGroupIndex(existingNodes));
  const layout = calculateGridCropLayout(
    crops.map((crop, index) => ({
      row: crop.row,
      column: crop.column,
      width: measuredSizes[index].width,
      height: measuredSizes[index].height,
    }))
  );
  const childOrigin = {
    x: sourcePosition.x + sourceWidth + GROUP_SOURCE_GAP + GROUP_PADDING,
    y: sourcePosition.y + GROUP_PADDING,
  };

  const childNodes = crops.map((crop, index) => {
    const size = measuredSizes[index];
    const offset = layout.positions[index];
    const node = util.createNode(
      modelsMap,
      {
        type: 'image',
        position: {
          x: childOrigin.x + offset.x,
          y: childOrigin.y + offset.y,
        },
        width: size.width,
        height: size.height,
        measured: size.measured,
      },
      modelNodePermission
    ) as Node;

    node.data = {
      ...util.buildMediaUploadNodeData(node.data, crop.url),
      title: createGridCropNodeTitle(groupTitle, crop.row, crop.column),
    };
    return preserveNodeTitle(node);
  });

  const groupNode = util.creatGroupNode({
    minX: childOrigin.x,
    minY: childOrigin.y,
    maxX: childOrigin.x + layout.width,
    maxY: childOrigin.y + layout.height,
  });
  groupNode.data.title = groupTitle;
  const { updatedNodes } = util.updateGroupChild(childNodes, childNodes, groupNode);

  return [groupNode, ...updatedNodes];
};
