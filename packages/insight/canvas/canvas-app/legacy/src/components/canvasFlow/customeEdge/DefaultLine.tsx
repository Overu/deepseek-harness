// CustomEdge.jsx
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import setting from '../settings/setting';
import EdgeDeleteControl from './EdgeDeleteControl';

const { handlerColorMap, handerHoverColorMap } = setting;

const DefaultLine: React.FC<EdgeProps> = props => {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd, markerStart, interactionWidth = 20, sourceHandleId, selected } = props;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // 在这里添加你的颜色处理逻辑， style.stroke == '#fff'为特殊激活标识
  const enhancedStyle = {
    ...style,
    stroke: style.stroke != '#fff' ? handlerColorMap[sourceHandleId as keyof typeof handlerColorMap] : handerHoverColorMap[sourceHandleId as keyof typeof handlerColorMap],
    strokeWidth: style.stroke != '#fff' ? 1.5 : 3,
  };

  return (
    <EdgeDeleteControl id={id} edgePath={edgePath} labelX={labelX} labelY={labelY} selected={selected} interactionWidth={interactionWidth}>
      <BaseEdge path={edgePath} markerStart={markerStart} markerEnd={markerEnd} style={enhancedStyle} interactionWidth={interactionWidth} />
    </EdgeDeleteControl>
  );
};

export default DefaultLine;
