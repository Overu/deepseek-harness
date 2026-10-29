import setting from '../settings/setting';

interface Props {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromHandle: any;
}

const { handlerColorMap } = setting;

const ConnectionLine = ({ fromX, fromY, toX, toY, fromHandle }: Props) => {
  const strokeColor = handlerColorMap[fromHandle.id as keyof typeof handlerColorMap] || '#b1b1b7';

  // 恢复为标准贝塞尔曲线计算方式
  const curvature = 0.25;
  const offsetX = Math.abs(toX - fromX) * curvature;
  const offsetY = Math.abs(toY - fromY) * curvature;

  const controlX1 = fromX + offsetX;
  const controlY1 = fromY + offsetY;
  const controlX2 = toX - offsetX;
  const controlY2 = toY - offsetY;

  return (
    <g>
      <path fill='none' stroke={strokeColor} strokeWidth={1.5} className='animated' d={`M ${fromX},${fromY} C ${controlX1},${controlY1} ${controlX2},${controlY2} ${toX},${toY}`} />
      <circle cx={toX} cy={toY} fill='#fff' r={3} stroke={strokeColor} strokeWidth={10} />
    </g>
  );
};

export default ConnectionLine;
