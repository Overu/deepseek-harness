import ExcelJS from 'exceljs';
import type { TableProtocol } from './types';

const PIXEL_TO_EXCEL_HEIGHT = 0.75; // Excel 行高单位 ≈ 0.75 px
const PIXEL_TO_EXCEL_WIDTH = 0.142; // Excel 列宽单位 ≈ 7px → 1单位

const fetchImageBuffer = async (url: string): Promise<{ buffer: ArrayBuffer; ext: 'jpeg' | 'png' | 'gif' } | null> => {
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    let ext: 'jpeg' | 'png' | 'gif' = 'jpeg';
    if (blob.type.includes('png')) ext = 'png';
    else if (blob.type.includes('gif')) ext = 'gif';
    return { buffer, ext };
  } catch {
    return null;
  }
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * 导出表格协议数据为 Excel 文件
 * 文本类型直接写入对应单元格；图片类型尝试请求图片并嵌入；视频/音频回退为链接文本
 */
export const exportTableToExcel = async (table: TableProtocol, filename = '智能分镜脚本.xlsx') => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Storyboard');

  // 列宽
  worksheet.columns = [
    { header: '序号', width: 8 },
    ...table.columns.map(col => ({
      header: col.title,
      width: Math.max(col.width * PIXEL_TO_EXCEL_WIDTH, 10),
    })),
  ];

  // 表头单独样式
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF262626' } };
  });

  // 行数据写入
  for (let rowIndex = 0; rowIndex < table.data.length; rowIndex++) {
    const dataRow = table.data[rowIndex];
    const row = worksheet.getRow(rowIndex + 2);
    row.height = (table.rowsHeight[rowIndex] ?? 60) * PIXEL_TO_EXCEL_HEIGHT;
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.getCell(1).value = rowIndex + 1;

    for (let colIndex = 0; colIndex < table.columns.length; colIndex++) {
      const field = table.columns[colIndex].field;
      const cellData = dataRow[field];
      const targetCell = row.getCell(colIndex + 2);
      if (!cellData || cellData.type === 'empty' || !cellData.value) {
        targetCell.value = '';
        continue;
      }
      if (cellData.type === 'text') {
        targetCell.value = cellData.value;
        continue;
      }
      if (cellData.type === 'image') {
        const fetched = await fetchImageBuffer(cellData.value);
        if (fetched) {
          const imageId = workbook.addImage({ buffer: fetched.buffer as any, extension: fetched.ext });
          worksheet.addImage(imageId, {
            tl: { col: colIndex + 1, row: rowIndex + 1 } as any,
            br: { col: colIndex + 2, row: rowIndex + 2 } as any,
            editAs: 'oneCell',
          });
        } else {
          // 图片获取失败时回退为链接
          targetCell.value = { text: cellData.value, hyperlink: cellData.value };
        }
        continue;
      }
      // video/audio 回退为可点击的文字链接
      targetCell.value = { text: cellData.value, hyperlink: cellData.value };
    }
  }

  // 序号列样式
  worksheet.getColumn(1).alignment = { vertical: 'middle', horizontal: 'center' };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, filename);
};
