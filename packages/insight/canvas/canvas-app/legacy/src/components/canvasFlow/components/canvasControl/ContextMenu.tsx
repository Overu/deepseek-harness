import NodeList from '../leftOperation/NodeList';

interface ContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    show: boolean;
    fromHandle?: any;
    multiSourceNodeIds?: string[];
  };
  handleAddContent: (type: string, contextMenu: any) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ contextMenu, handleAddContent }) => {
  if (!contextMenu.show) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: contextMenu.x,
        top: contextMenu.y,
        zIndex: 1000,
        // 动态计算菜单位置，防止超出视口底部和右侧
        transform: `translate(${contextMenu.x > window.innerWidth - 300 ? '-100%' : '0'}, ${contextMenu.y > window.innerHeight - 300 ? '-100%' : '0'})`, // 假设菜单宽度和高度约300px
      }}
    >
      <NodeList fromHandle={contextMenu.fromHandle} onAdd={type => handleAddContent(type, contextMenu)} />
    </div>
  );
};

export default ContextMenu;
