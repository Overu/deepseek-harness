/** 画布只读标志（供 toolUtil 等无环依赖模块读取） */
let canvasReadOnlyFlag = false;

export function setCanvasReadOnlyFlag(value: boolean) {
  canvasReadOnlyFlag = value;
}

export function isCanvasReadOnly() {
  return canvasReadOnlyFlag;
}
