import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useFlowStore } from '@/store/flowStore';
import setting from '../../../settings/setting';
import hooks from '../../../hooks';
import util from '../../../utils/util';
import { exportTableToExcel } from './excelExport';
import { type CellData, type CellLocation, type StoryboardAspectRatio, type TableProtocol, DEFAULT_CELL_SIZE } from './types';
import { applyUniformCellSize, computeCellSizeFromAspectRatio } from './tableSizeAdjust';
import { canComposeStoryboardGrid, composeStoryboardGridToFile } from './composeGrid';
import { toast } from 'sonner';
import { uploadFile } from '@/services/upload/uploadFile';
import { syncCanvasUploadToAssetLibrary } from '@/components/canvasFlow/utils/canvasAssetSync';

const nodeType = 'storyboardTool';
const { defaultStoryboardTable } = setting;
const { useConfirmDialog } = hooks;
const { createNode } = util;

type UseStoryboardTableParams = {
  id: string;
  dataRef: RefObject<any>;
  nodeTable: unknown;
  aspectRatio: StoryboardAspectRatio;
  /** 仅脚本任务忙碌时为 true；分镜运行中不锁表 */
  tableOpsLockedRef: RefObject<boolean>;
  attachUploadOutputNode: (url: string) => Promise<string | undefined>;
};

/**
 * 分镜表格协议与编辑侧操作：行列变更、比例、上传、拖出画布、合成宫格、Excel 导出。
 */
export function useStoryboardTable({ id, dataRef, nodeTable, aspectRatio, tableOpsLockedRef, attachUploadOutputNode }: UseStoryboardTableParams) {
  const reactFlow = useReactFlow();
  const modelsMap = useFlowStore(state => state.modelsMap);
  const modelNodePermission = useFlowStore(state => state.modelNodePermission);
  const { updateNodeData, addNode } = useFlowStore(state => state.actions);
  const { confirmDialog, openConfirmDialog, closeConfirmDialog } = useConfirmDialog();

  const [uploadState, setUploadState] = useState<{
    visible: boolean;
    location: CellLocation | null;
    accept: 'image' | 'video' | 'audio';
  }>({ visible: false, location: null, accept: 'image' });
  const shrinkCountCancelRef = useRef<(() => void) | null>(null);
  const [countInputRevert, setCountInputRevert] = useState<{
    dimension: 'rows' | 'cols';
    value: number;
    token: number;
  } | null>(null);
  const [composing, setComposing] = useState(false);

  /** 节点表格协议，缺省时回退默认 */
  const table: TableProtocol = useMemo(() => {
    if (nodeTable && Array.isArray((nodeTable as TableProtocol).columns) && Array.isArray((nodeTable as TableProtocol).data)) {
      return nodeTable as TableProtocol;
    }
    return JSON.parse(JSON.stringify(defaultStoryboardTable)) as TableProtocol;
  }, [nodeTable]);

  const rowsCount = table.data.length;
  const colsCount = table.columns.length;

  /** 当前预设对应的单元格尺寸（custom 时使用 DEFAULT_CELL_SIZE） */
  const presetCellSize = useMemo(() => {
    if (aspectRatio === 'custom') return { width: DEFAULT_CELL_SIZE, height: DEFAULT_CELL_SIZE };
    return computeCellSizeFromAspectRatio(aspectRatio);
  }, [aspectRatio]);

  const canCompose = useMemo(() => canComposeStoryboardGrid(table), [table]);

  /** 表格协议变更入口（可选是否记入撤销栈、是否提交到后端） */
  const setTable = useCallback(
    (next: TableProtocol, isRecord: boolean = true, isSubmit: boolean = true) => {
      const latest = dataRef.current;
      updateNodeData(
        id,
        {
          ...latest,
          table: next,
        },
        isRecord,
        isSubmit
      );
    },
    [dataRef, id, updateNodeData]
  );

  const openShrinkCountConfirm = (dimension: 'rows' | 'cols', revertValue: number, onConfirm: () => void) => {
    shrinkCountCancelRef.current = () => {
      setCountInputRevert({ dimension, value: revertValue, token: Date.now() });
    };
    openConfirmDialog('是否仍要继续缩小表格？', '表格缩小范围内存在已编辑内容，确认修改后该部分内容将被删除', () => {
      shrinkCountCancelRef.current = null;
      onConfirm();
      closeConfirmDialog();
    });
  };

  const handleShrinkCountCancel = () => {
    shrinkCountCancelRef.current?.();
    shrinkCountCancelRef.current = null;
    closeConfirmDialog();
  };

  // 顶部操作栏 - 行列变更
  const handleColsCountChange = (next: number): boolean => {
    if (next === colsCount) return true;
    const latestTable = JSON.parse(JSON.stringify(table)) as TableProtocol;
    if (next > colsCount) {
      const append = next - colsCount;
      for (let i = 0; i < append; i++) {
        const field = `c_${Date.now()}_${Math.floor(Math.random() * 10000)}_${i}`;
        latestTable.columns.push({ field, title: '自定义', width: presetCellSize.width });
        latestTable.data.forEach(row => {
          row[field] = { type: 'empty', value: '' };
        });
      }
      setTable(latestTable);
      return true;
    }
    // 缩小：检查待删除区域是否有内容
    const removeFields = latestTable.columns.slice(next).map(c => c.field);
    const hasContent = latestTable.data.some(row => removeFields.some(field => row[field] && row[field].type !== 'empty'));
    const apply = () => {
      const trimmed = JSON.parse(JSON.stringify(latestTable)) as TableProtocol;
      trimmed.columns = trimmed.columns.slice(0, next);
      const keepFields = trimmed.columns.map(c => c.field);
      trimmed.data = trimmed.data.map(row => {
        const newRow: Record<string, CellData> = {};
        keepFields.forEach(f => (newRow[f] = row[f] || { type: 'empty', value: '' }));
        return newRow;
      });
      setTable(trimmed);
    };
    if (hasContent) {
      openShrinkCountConfirm('cols', colsCount, apply);
      return false;
    }
    apply();
    return true;
  };

  const handleRowsCountChange = (next: number): boolean => {
    if (next === rowsCount) return true;
    const latestTable = JSON.parse(JSON.stringify(table)) as TableProtocol;
    if (next > rowsCount) {
      const append = next - rowsCount;
      const fields = latestTable.columns.map(c => c.field);
      for (let i = 0; i < append; i++) {
        const newRow: Record<string, CellData> = {};
        fields.forEach(f => (newRow[f] = { type: 'empty', value: '' }));
        latestTable.data.push(newRow);
        latestTable.rowsHeight.push(presetCellSize.height);
      }
      setTable(latestTable);
      return true;
    }
    const removeRows = latestTable.data.slice(next);
    const hasContent = removeRows.some(row => Object.values(row).some(c => c && c.type !== 'empty'));
    const apply = () => {
      const trimmed = JSON.parse(JSON.stringify(latestTable)) as TableProtocol;
      trimmed.data = trimmed.data.slice(0, next);
      trimmed.rowsHeight = trimmed.rowsHeight.slice(0, next);
      setTable(trimmed);
    };
    if (hasContent) {
      openShrinkCountConfirm('rows', rowsCount, apply);
      return false;
    }
    apply();
    return true;
  };

  // 表格内单元格类型选择 -> 上传弹窗
  const handleOpenUploadFor = (location: CellLocation, type: 'image' | 'video' | 'audio') => {
    setUploadState({ visible: true, location, accept: type });
  };

  const handleUploadSuccess = (url: string) => {
    if (uploadState.location) {
      const latestTable = JSON.parse(JSON.stringify(table)) as TableProtocol;
      const fields = latestTable.columns.map(c => c.field);
      const targetRow = latestTable.data[uploadState.location.rowIndex];
      if (targetRow) {
        fields.forEach(f => {
          if (!targetRow[f]) targetRow[f] = { type: 'empty', value: '' };
        });
        targetRow[uploadState.location.field] = {
          type: uploadState.accept,
          value: url,
        };
        setTable(latestTable);
      }
    }
    setUploadState({ visible: false, location: null, accept: 'image' });
  };

  const handleCloseUpload = () => {
    setUploadState(prev => ({ ...prev, visible: false }));
  };

  /** 单元格内容拖出表格至画布 */
  const handleDragCellOutToCanvas = (cell: CellData, screenPosition: { x: number; y: number }) => {
    if (!reactFlow || cell.type === 'empty') return;
    const flowPosition = reactFlow.screenToFlowPosition(screenPosition);
    const newNode = createNode(
      modelsMap,
      {
        position: flowPosition,
        type: cell.type,
        value: cell.value,
      },
      modelNodePermission
    );
    addNode([newNode as any]);
  };

  // 顶部操作栏功能
  const handleDownloadExcel = async () => {
    try {
      await exportTableToExcel(table);
    } catch (e) {
      console.error('Excel 导出失败', e);
    }
  };

  /** 比例选择 */
  const handleAspectRatioChange = useCallback(
    (ratio: StoryboardAspectRatio) => {
      if (tableOpsLockedRef.current) return;
      const latest = dataRef.current;
      if (ratio === 'custom') {
        // 只改 params，不改尺寸
        updateNodeData(id, { ...latest, params: { ...latest.params, aspectRatio: ratio } });
        return;
      }
      const size = computeCellSizeFromAspectRatio(ratio);
      const nextTable = applyUniformCellSize(table, size);
      updateNodeData(id, { ...latest, params: { ...latest.params, aspectRatio: ratio }, table: nextTable });
    },
    [tableOpsLockedRef, dataRef, id, table, updateNodeData]
  );

  /** 用户手动拖拽列宽/行高：原子写入新尺寸 + 切回自定义比例，避免二次 update 覆盖 table */
  const handleCellSizeManualChange = useCallback(
    (nextTable: TableProtocol) => {
      const latest = dataRef.current;
      const nextData = {
        ...latest,
        table: nextTable,
        params: {
          ...latest.params,
          aspectRatio: 'custom',
        },
      };
      dataRef.current = nextData;
      updateNodeData(id, nextData);
    },
    [dataRef, id, updateNodeData]
  );

  /** 合成宫格 */
  const handleComposeGrid = useCallback(async () => {
    if (composing || !canCompose || tableOpsLockedRef.current) return;
    setComposing(true);
    try {
      const file = await composeStoryboardGridToFile(table);
      const { url } = await uploadFile(file);
      if (!url) {
        toast.error('宫格图片上传失败');
        return;
      }
      const childNodeId = await attachUploadOutputNode(url);
      if (childNodeId) {
        syncCanvasUploadToAssetLibrary(url, childNodeId, 'image', 1, nodeType);
      }
      toast.success('宫格合成完成');
    } catch (e: any) {
      console.error('composeGrid error', e);
      toast.error(e?.message || '宫格合成失败');
    } finally {
      setComposing(false);
    }
  }, [composing, canCompose, tableOpsLockedRef, table, attachUploadOutputNode]);

  return {
    table,
    setTable,
    rowsCount,
    colsCount,
    presetCellSize,
    canCompose,
    composing,
    uploadState,
    countInputRevert,
    confirmDialog,
    handleColsCountChange,
    handleRowsCountChange,
    handleOpenUploadFor,
    handleUploadSuccess,
    handleCloseUpload,
    handleDragCellOutToCanvas,
    handleDownloadExcel,
    handleAspectRatioChange,
    handleCellSizeManualChange,
    handleComposeGrid,
    handleShrinkCountCancel,
  };
}

export type UseStoryboardTableReturn = ReturnType<typeof useStoryboardTable>;
