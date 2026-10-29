import { memo, useEffect, useRef, type ComponentType } from 'react';
import { useFlowStore } from '@/store/flowStore';

function isOverPlayOnHoverRoot(host: HTMLElement, clientX: number, clientY: number) {
  const media = host.querySelector('[data-play-on-hover-root]');
  if (!media) return false;
  const rect = media.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

/**
 * 只读预览：在节点本体铺透明遮罩，拦截上传/编辑等内部交互。
 * 不 stopPropagation，点击仍冒泡到 .react-flow__node，保证选中并展开 prompt。
 * NodeToolbar（portal）不受影响；NodeTitle 在盒外需单独门控。
 * 指针落在 [data-play-on-hover-root]（如 VideoPlayer）上时关闭遮罩命中，
 * 以支持悬浮播放与暂停/拖进度等控制条操作；移出后恢复拦截。
 */
function withReadOnlyNodeGuard<P extends object>(NodeComponent: ComponentType<P>) {
  const GuardedNode = (props: P) => {
    const readOnly = useFlowStore(state => state.readOnly);
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!readOnly) return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      const host = overlay.parentElement;
      if (!host) return;

      const syncPointerEvents = (clientX: number, clientY: number) => {
        overlay.style.pointerEvents = isOverPlayOnHoverRoot(host, clientX, clientY) ? 'none' : 'auto';
      };

      const onMouseMove = (e: MouseEvent) => syncPointerEvents(e.clientX, e.clientY);
      const onMouseLeave = () => {
        overlay.style.pointerEvents = 'auto';
      };

      host.addEventListener('mousemove', onMouseMove);
      host.addEventListener('mouseleave', onMouseLeave);
      return () => {
        host.removeEventListener('mousemove', onMouseMove);
        host.removeEventListener('mouseleave', onMouseLeave);
        overlay.style.pointerEvents = '';
      };
    }, [readOnly]);

    return (
      <>
        <NodeComponent {...props} />
        {readOnly ? <div ref={overlayRef} className='absolute inset-0 z-[20] rounded-2xl' aria-hidden data-readonly-node-guard /> : null}
      </>
    );
  };

  const displayName = NodeComponent.displayName || NodeComponent.name || 'Node';
  GuardedNode.displayName = `withReadOnlyNodeGuard(${displayName})`;

  return memo(GuardedNode) as unknown as ComponentType<P>;
}

export default withReadOnlyNodeGuard;
