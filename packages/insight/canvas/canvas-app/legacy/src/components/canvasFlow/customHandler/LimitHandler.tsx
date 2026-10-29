import { Handle, useNodeConnections } from '@xyflow/react';

const CustomHandle = (props: any) => {
  const connections = useNodeConnections({
    handleType: props.type,
    handleId: props.id,
  });

  // 根据连接状态调整样式，有连接时移除动画
  const handleStyle = connections.length > 0 ? { ...props.style, animation: 'none' } : props.style;

  return <Handle {...props} style={handleStyle} isConnectable={props.limit ? connections.length < props.limit : true} />;
};

export default CustomHandle;
