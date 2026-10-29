import type { IPlugin } from '../types';
import type { EditorEngine } from '../EditorEngine';
import * as fabric from 'fabric';
import { uploadFile } from '@/services/upload/uploadFile';
import { toast } from 'sonner';
import { generateId } from '../utils/uuid';

const MAX_IMAGE_SIZE_MB = 10;

export class ShortcutPlugin implements IPlugin {
  name = 'ShortcutPlugin';
  private editor: EditorEngine;
  private clipboard: fabric.Object | null = null;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleKeyUp: (e: KeyboardEvent) => void;
  private boundHandlePaste: (e: ClipboardEvent) => void;

  private isSpacePressed = false;
  private previousToolMode: 'select' | 'hand' | 'draw' = 'select';
  private enabled = true;

  constructor(editor: EditorEngine) {
    this.editor = editor;
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    this.boundHandlePaste = this.handlePaste.bind(this);
  }

  public pause(): void {
    this.enabled = false;
    // 重置状态
    this.isSpacePressed = false;
  }

  public resume(): void {
    this.enabled = true;
  }

  init(): void {
    window.addEventListener('keydown', this.boundHandleKeyDown);
    window.addEventListener('keyup', this.boundHandleKeyUp);
    window.addEventListener('paste', this.boundHandlePaste);
    console.log('ShortcutPlugin initialized');
  }

  destroy(): void {
    window.removeEventListener('keydown', this.boundHandleKeyDown);
    window.removeEventListener('keyup', this.boundHandleKeyUp);
    window.removeEventListener('paste', this.boundHandlePaste);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    const target = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
      return;
    }

    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const cmdKey = isMac ? e.metaKey : e.ctrlKey;
    const shiftKey = e.shiftKey;

    if (cmdKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          if (shiftKey) {
            this.editor.redo();
          } else {
            this.editor.undo();
          }
          return;
        case 'y':
          if (!isMac) {
            e.preventDefault();
            this.editor.redo();
          }
          return;
        case 'c':
          e.preventDefault();
          this.copy();
          return;
        case 'v':
          // 如果有内部复制的对象，粘贴它
          // 图片粘贴由 paste 事件处理
          if (this.clipboard) {
            e.preventDefault();
            this.pasteInternalClipboard();
          }
          // 没有内部剪贴板时，不阻止默认行为，让 paste 事件处理
          return;
        case 'a':
          e.preventDefault();
          this.selectAll();
          return;
        case '=':
        case '+':
          e.preventDefault();
          this.editor.zoomIn();
          return;
        case '-':
          e.preventDefault();
          this.editor.zoomOut();
          return;
        case '0':
          e.preventDefault();
          this.editor.zoomToFit();
          return;
        case '1':
          e.preventDefault();
          this.editor.setZoom(1);
          return;
      }
    }

    switch (e.key) {
      case 'Backspace':
      case 'Delete':
        this.editor.deleteSelected();
        break;
      case ' ':
        if (!this.isSpacePressed && !e.repeat) {
          this.isSpacePressed = true;
          this.previousToolMode = 'select';
          this.editor.setToolMode('hand');
        }
        e.preventDefault();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        this.handleNudge(e.key, shiftKey);
        e.preventDefault();
        break;
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (!this.enabled) return;

    if (e.key === ' ') {
      if (this.isSpacePressed) {
        this.isSpacePressed = false;
        this.editor.setToolMode(this.previousToolMode);
      }
    }
  }

  private async copy(): Promise<void> {
    const activeObjects = this.editor.getActiveObjects();

    if (activeObjects.length > 1) {
      toast.error('暂不支持多节点复制，请单选后复制');
      return;
    }

    const activeObject = activeObjects[0];
    if (activeObject) {
      this.clipboard = await activeObject.clone();
      console.log('Copied to internal clipboard');
    }
  }

  /**
   * 处理 paste 事件，用于粘贴系统剪贴板中的图片
   */
  private async handlePaste(e: ClipboardEvent): Promise<void> {
    if (!this.enabled) return;

    // 如果焦点在输入框等元素上，不处理
    const target = e.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) {
      return;
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    // 查找剪贴板中的图片文件
    let imageFile: File | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // 检查是否是文件类型的图片
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        imageFile = item.getAsFile();
        break;
      }
    }

    // 没有图片文件则忽略，让其他逻辑处理
    if (!imageFile) return;

    // 阻止默认粘贴行为
    e.preventDefault();

    // 校验文件大小
    const sizeMB = imageFile.size / 1024 / 1024;
    if (sizeMB > MAX_IMAGE_SIZE_MB) {
      toast.error(`图片大小不能超过 ${MAX_IMAGE_SIZE_MB}MB`);
      return;
    }

    // 显示上传中提示
    const toastId = toast.loading('图片上传中...');

    try {
      const imageUrl = (await uploadFile(imageFile)).url;
      if (imageUrl) {
        await this.editor.addImage(imageUrl);
        toast.success('图片已添加到画布', { id: toastId });
      } else {
        toast.error('图片上传失败', { id: toastId });
      }
    } catch (error) {
      console.error('粘贴图片失败:', error);
      toast.error('图片上传失败', { id: toastId });
    }
  }

  /**
   * 粘贴内部复制的对象
   */
  private async pasteInternalClipboard(): Promise<void> {
    if (!this.clipboard) return;

    // 如果剪贴板内是多选对象，且当前逻辑已禁止多选复制，则拒绝粘贴
    if (this.clipboard.type === 'activeSelection') {
      toast.error('暂不支持多节点粘贴，请单选后复制粘贴');
      this.clipboard = null;
      return;
    }

    const cloned = await this.clipboard.clone();
    this.editor.canvasManager.getCanvas().discardActiveObject();

    // 重新分配克隆出来的内部对象的 ID (单选对象可能包含内部组)
    const resetId = (object: fabric.Object) => {
      object.set('id', generateId());
      if (object.type === 'group') {
        const group = object as fabric.Group;
        group.getObjects().forEach(resetId);
      }
    };
    resetId(cloned);

    cloned.set({
      left: (cloned.left || 0) + 20,
      top: (cloned.top || 0) + 20,
      evented: true,
    });

    // 暂缓历史记录
    this.editor.eventBus.emit('history:pause');

    this.editor.canvasManager.getCanvas().add(cloned);
    this.editor.canvasManager.getCanvas().setActiveObject(cloned);

    this.editor.canvasManager.getCanvas().requestRenderAll();

    // 恢复历史记录并保存合并状态
    this.editor.eventBus.emit('history:resume');
    this.editor.eventBus.emit('history:save');
  }

  private selectAll(): void {
    const canvas = this.editor.canvasManager.getCanvas();
    const objects = canvas.getObjects().filter(obj => obj.id !== 'workspace' && !obj.id?.startsWith('workspace-handle'));
    if (objects.length) {
      const selection = new fabric.ActiveSelection(objects, { canvas: canvas });
      canvas.setActiveObject(selection);
      canvas.requestRenderAll();
    }
  }

  private handleNudge(key: string, shiftKey: boolean): void {
    const activeObject = this.editor.getActiveObject();
    if (!activeObject) return;

    const step = shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;

    switch (key) {
      case 'ArrowUp':
        dy = -step;
        break;
      case 'ArrowDown':
        dy = step;
        break;
      case 'ArrowLeft':
        dx = -step;
        break;
      case 'ArrowRight':
        dx = step;
        break;
    }

    activeObject.set({
      left: (activeObject.left || 0) + dx,
      top: (activeObject.top || 0) + dy,
    });
    activeObject.setCoords();
    this.editor.canvasManager.getCanvas().requestRenderAll();
    this.editor.canvasManager.getCanvas().fire('object:modified');
  }
}
