import { lazy, Suspense, useState, useEffect } from 'react';
import { History, Layers } from 'lucide-react'; // 添加Settings图标
import styles from '../index.module.less';
import { CANVAS_ONBOARDING_TARGETS } from '../../onboarding';

const NodeList = lazy(() => import('./NodeList'));
const AssetHistory = lazy(() => import('./AssetHistory'));
const TemplateList = lazy(() => import('./TemplateList'));
const ToolList = lazy(() => import('./ToolList'));

export type AddToCanvasItem = { type: string; value: string; index?: number };

export type SideOperationsPosition = 'left' | 'right';

interface SideOperationsProps {
  className?: string;
  position?: SideOperationsPosition;
  onAddContent?: (type: string) => void;
  onAddHistory?: (items: AddToCanvasItem[]) => void;
}

// 定义操作项配置类型
interface OperationItem {
  id: 'add' | 'tool' | 'history' | 'template';
  icon: React.ReactNode;
  className?: string;
  onboardingTarget?: string;
  visible?: boolean; // 添加控制显隐的字段
}

// 定义二级菜单配置类型
interface SubMenuItem {
  id: 'add' | 'tool' | 'history' | 'template';
  component: React.ReactNode;
  className: string;
}

const SideOperations: React.FC<SideOperationsProps> = ({ onAddContent, onAddHistory, className, position }) => {
  const isRight = position !== undefined ? position === 'right' : !className?.includes('left-');
  const subMenuPositionClass = isRight ? 'right-16' : 'left-16';
  const [hoveredItem, setHoveredItem] = useState<'add' | 'history' | 'template' | 'tool' | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [loadedMenus, setLoadedMenus] = useState<Partial<Record<OperationItem['id'], true>>>({});
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);

  // 操作项配置列表
  const operationItems: OperationItem[] = [
    {
      id: 'add',
      icon: null, // 添加按钮使用特殊样式，不使用通用图标
      className: `${styles.addButton} w-12 h-12 ${hoveredItem == 'add' ? styles.active : ''}`,
      onboardingTarget: CANVAS_ONBOARDING_TARGETS.basicNodes,
    },
    {
      id: 'tool',
      icon: <div className='iconfont icon-sparkling text-xl tex-white'></div>,
      onboardingTarget: CANVAS_ONBOARDING_TARGETS.toolNodes,
    },
    {
      id: 'history',
      icon: <History size={20} color='#fff' />,
      onboardingTarget: CANVAS_ONBOARDING_TARGETS.assets,
    },
    {
      id: 'template',
      icon: <Layers size={20} color='#fff' />,
      onboardingTarget: CANVAS_ONBOARDING_TARGETS.templates,
    },
  ];

  // 处理二级菜单选项点击
  const handleContentSelect = (type: string) => {
    if (onAddContent) {
      onAddContent(type);
    }
  };

  // 处理历史/资产加入画布（支持单个或多个节点，多节点时由画布按 450px 横向间距排列）
  const handleHistorySelect = (items: AddToCanvasItem[]) => {
    if (onAddHistory && items.length) {
      onAddHistory(items);
    }
  };

  // 二级菜单配置列表
  const subMenuItems: SubMenuItem[] = [
    {
      id: 'add',
      component: <NodeList onAdd={handleContentSelect} />,
      className: `side-operations-menu absolute ${subMenuPositionClass}`,
    },
    {
      id: 'tool',
      component: <ToolList onAdd={handleContentSelect} />,
      className: `side-operations-menu absolute ${subMenuPositionClass} top-[-150px]`,
    },
    {
      id: 'history',
      component: <AssetHistory onAdd={handleHistorySelect} refreshTrigger={historyRefreshTrigger} />,
      className: `side-operations-menu absolute ${subMenuPositionClass} top-[-200px]`,
    },
    {
      id: 'template',
      component: isMenuVisible && hoveredItem === 'template' ? <TemplateList /> : null,
      className: `side-operations-menu absolute ${subMenuPositionClass} top-[-200px]`,
    },
  ];

  // 处理主操作项的悬浮 - 添加延迟机制
  const handleItemHover = (item: 'add' | 'history' | 'template' | 'tool' | null) => {
    setHoveredItem(item);
    setIsMenuVisible(true);
    if (item) {
      setLoadedMenus(prev => (prev[item] ? prev : { ...prev, [item]: true }));
    }
  };

  // 处理点击事件，判断是否点击了组件外部
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // 获取所有需要检查的DOM元素（含通过 Portal 渲染的弹窗，避免点击弹窗内被误判为点击外部）
      const elementsToCheck = [
        '.side-operations-main',
        '.side-operations-menu',
        '.media-preview',
        '.template-list',
        '.tool-list',
        '[role="dialog"]', // 弹窗通过 Portal 挂到 body，需单独判断
        '[role="menu"]', // 下拉菜单通过 Portal 渲染，点击选项时不应关闭侧边栏
        '[data-radix-popper-content-wrapper]', // Radix 下拉/Popover 等浮层
      ];

      // 只有当二级菜单可见时才需要判断是否隐藏
      if (isMenuVisible) {
        // 检查点击目标是否在任何一个元素内部
        const isClickInsideAnyElement = elementsToCheck.some(selector => {
          const elements = document.querySelectorAll(selector);
          return Array.from(elements).some(el => el.contains(event.target as Node));
        });

        // 只有当点击不在任何元素内部时，才隐藏菜单
        if (!isClickInsideAnyElement) {
          setIsMenuVisible(false);
        }
      }
    };

    // 添加全局点击事件监听，使用捕获模式确保即使ReactFlow阻止冒泡也能捕获事件
    document.addEventListener('mousedown', handleClickOutside, true);

    // 清理函数
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isMenuVisible]); // 添加isMenuVisible依赖，确保状态同步

  const isHistoryVisible = isMenuVisible && hoveredItem === 'history';

  useEffect(() => {
    if (isHistoryVisible) {
      setHistoryRefreshTrigger(prev => prev + 1);
    }
  }, [isHistoryVisible]);

  const defaultPositionClass = isRight ? 'right-4' : 'left-4';
  const rootClassName = className || `absolute top-1/2 ${defaultPositionClass} transform -translate-y-1/2 z-[9]`;

  return (
    <div className={rootClassName}>
      <div className='relative h-full flex items-start'>
        {/* 主操作栏 */}
        <div className='side-operations-main flex flex-col items-center bg-[#262626] rounded-lg py-1 w-14 gap-1 border-white/10 border'>
          {/* 使用配置列表渲染按钮，只渲染visible为true的项 */}
          {operationItems
            .filter(item => item.visible !== false)
            .map(item => (
              <button
                key={item.id}
                data-onboarding-target={item.onboardingTarget}
                className={item.className || 'w-12 h-12 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors duration-200'}
                onMouseEnter={() => handleItemHover(item.id)}
              >
                {item.icon}
              </button>
            ))}
        </div>

        {/* 悬浮窗口 - 二级操作栏 */}
        {subMenuItems.map(
          menu =>
            loadedMenus[menu.id] && (
              <div
                key={menu.id}
                className={menu.className}
                style={{
                  display: isMenuVisible && hoveredItem === menu.id ? 'block' : 'none',
                }}
              >
                <Suspense fallback={null}>{menu.component}</Suspense>
              </div>
            )
        )}
      </div>
    </div>
  );
};

export default SideOperations;
