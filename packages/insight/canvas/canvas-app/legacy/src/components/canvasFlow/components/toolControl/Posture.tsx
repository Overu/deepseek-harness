import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import styles from './index.module.less';
import { Sparkles, LoaderCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadFile } from '@/services/upload/uploadFile';
import { getImgPose } from '@/api/tool';

// 系数 600 * 600
const initJoints = [
  { x: 300, y: 75, name: 'headTop' }, // 头部
  { x: 300, y: 150, name: 'neck' }, // 颈部
  { x: 300, y: 255, name: 'hip' }, // 臀部
  { x: 217.5, y: 225, name: 'leftElbow' }, // 左肘
  { x: 172.5, y: 330, name: 'leftHand' }, // 左手
  { x: 382.5, y: 225, name: 'rightElbow' }, // 右肘
  { x: 427.5, y: 330, name: 'rightHand' }, // 右手
  { x: 240, y: 442.5, name: 'leftKnee' }, // 左膝
  { x: 225, y: 570, name: 'leftFoot' }, // 左脚
  { x: 360, y: 442.5, name: 'rightKnee' }, // 右膝
  { x: 375, y: 570, name: 'rightFoot' }, // 右脚
];
const imgJoints = {
  point_list: [
    { x: 781, y: 657, name: 'head' },
    { x: 781, y: 752, name: 'neck' },
    { x: 776, y: 941, name: 'hip' },
    { x: 667, y: 963, name: 'leftElbow' },
    { x: 693, y: 1059, name: 'leftHand' },
    { x: 869, y: 956, name: 'rightElbow' },
    { x: 835, y: 1064, name: 'rightHand' },
    { x: 733, y: 1379, name: 'leftKnee' },
    { x: 766, y: 1636, name: 'leftFoot' },
    { x: 810, y: 1380, name: 'rightKnee' },
    { x: 801, y: 1648, name: 'rightFoot' },
  ],
  image_size: { width: 1536, height: 2752 },
};

// 最小长度限制
const lineConstraints = {
  neckToHip: { min: 1, max: 150 },
  neckToLeftElbow: { min: 1, max: 180 },
  leftElbowToLeftHand: { min: 1, max: 135 },
  neckToRightElbow: { min: 1, max: 180 },
  rightElbowToRightHand: { min: 1, max: 135 },
  hipToLeftKnee: { min: 1, max: 180 },
  leftKneeToLeftFoot: { min: 1, max: 135 },
  hipToRightKnee: { min: 1, max: 180 },
  rightKneeToRightFoot: { min: 1, max: 135 },
  headToNeck: { min: 1, max: 90 },
};

// 连线映射，和反向映射支持
const lineJointsMap = {
  neckToHip: { start: 'neck', end: 'hip' },
  neckToLeftElbow: { start: 'neck', end: 'leftElbow' },
  leftElbowToLeftHand: { start: 'leftElbow', end: 'leftHand' },
  neckToRightElbow: { start: 'neck', end: 'rightElbow' },
  rightElbowToRightHand: { start: 'rightElbow', end: 'rightHand' },
  hipToLeftKnee: { start: 'hip', end: 'leftKnee' },
  leftKneeToLeftFoot: { start: 'leftKnee', end: 'leftFoot' },
  hipToRightKnee: { start: 'hip', end: 'rightKnee' },
  rightKneeToRightFoot: { start: 'rightKnee', end: 'rightFoot' },
  headToNeck: { start: 'headTop', end: 'neck' },
};

// 🔥 改动点：新增固定输出尺寸配置（可自定义）
const OUTPUT_IMAGE_WIDTH = 1500;
const OUTPUT_BIG_IMAGE_HEIGHT = 1200;
const OUTPUT_IMAGE_HEIGHT = 800;

interface PosturePros {
  onImageSuccess: (url: string) => void;
  onClose: () => void;
  backgroundImage?: string; // 可选的背景图片URL
}

const Posture: React.FC<PosturePros> = ({ onImageSuccess, onClose, backgroundImage }) => {
  const [execute, setExecute] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [joints, setJoints] = useState([...initJoints]);
  const [poseData, setPoseData] = useState<any>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 600 });
  const [imageSize] = useState({ width: 600, height: 600 });
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  // 存储线宽和关节点大小的状态
  const [lineWidth, setLineWidth] = useState(5);
  const [jointRadius, setJointRadius] = useState(13);
  const [isMouseOverJoint, setIsMouseOverJoint] = useState(false);

  // 计算两点距离
  const calculateDistance = (x1: number, y1: number, x2: number, y2: number) => {
    return Number(Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)).toFixed(2));
  };

  // 加载背景图片并计算合适的画布尺寸
  const loadBackgroundImage = (imageUrl: string) => {
    const img = new Image();
    img.onload = () => {
      // 计算画布尺寸：长边600px，短边按比例缩小
      let width = img.width;
      let height = img.height;

      if (width >= height) {
        // 宽度为长边
        const ratio = height / width;
        width = imageSize.width;
        height = Math.round(width * ratio);
      } else {
        // 高度为长边
        const ratio = width / height;
        height = imageSize.height;
        width = Math.round(height * ratio);
      }

      setCanvasSize({ width, height });
      setBgImage(img);

      // 请求姿态检测接口获取火柴人点数据
      detectPosture(imageUrl);
    };
    img.src = imageUrl;
  };

  // 将姿态检测接口返回的数据转换为组件所需的关节点数组格式
  const convertToJointsFormat = (poseData: any): typeof initJoints => {
    const newJoints = [...initJoints];

    if (!poseData?.point_list || !poseData?.image_size) {
      return newJoints;
    }

    // 计算坐标缩放比例
    const originalWidth = poseData.image_size.width;
    const originalHeight = poseData.image_size.height;

    // 计算缩放比例：Canvas长边为600px，保持原始比例
    const scale = originalWidth > originalHeight ? canvasSize.width / originalWidth : canvasSize.height / originalHeight;

    // 关键点名称映射（处理API返回名称与组件所需名称的差异）
    const jointNameMapping: { [key: string]: string } = {
      head: 'headTop', // API返回'head'，组件使用'headTop'
    };

    // 遍历API返回的关键点数据
    poseData.point_list.forEach((point: any) => {
      // 转换关键点名称
      const jointName = jointNameMapping[point.name] || point.name;

      // 缩放坐标到Canvas尺寸
      const x = point.x * scale;
      const y = point.y * scale;

      // 找到对应的关节点并更新坐标
      const jointIndex = newJoints.findIndex(joint => joint.name === jointName);
      if (jointIndex !== -1) {
        newJoints[jointIndex] = {
          ...newJoints[jointIndex],
          x,
          y,
        };
      }
    });

    return newJoints;
  };

  // 计算线宽和关节点大小
  const calculateLineWidthAndJointRadius = (jointsData: typeof initJoints) => {
    // 计算各连接线长度
    const lineLengths = {
      neckToHip: Math.sqrt(Math.pow(jointsData[2].x - jointsData[1].x, 2) + Math.pow(jointsData[2].y - jointsData[1].y, 2)),
      neckToLeftElbow: Math.sqrt(Math.pow(jointsData[3].x - jointsData[1].x, 2) + Math.pow(jointsData[3].y - jointsData[1].y, 2)),
      leftElbowToLeftHand: Math.sqrt(Math.pow(jointsData[4].x - jointsData[3].x, 2) + Math.pow(jointsData[4].y - jointsData[3].y, 2)),
      neckToRightElbow: Math.sqrt(Math.pow(jointsData[5].x - jointsData[1].x, 2) + Math.pow(jointsData[5].y - jointsData[1].y, 2)),
      rightElbowToRightHand: Math.sqrt(Math.pow(jointsData[6].x - jointsData[5].x, 2) + Math.pow(jointsData[6].y - jointsData[5].y, 2)),
      hipToLeftKnee: Math.sqrt(Math.pow(jointsData[7].x - jointsData[2].x, 2) + Math.pow(jointsData[7].y - jointsData[2].y, 2)),
      leftKneeToLeftFoot: Math.sqrt(Math.pow(jointsData[8].x - jointsData[7].x, 2) + Math.pow(jointsData[8].y - jointsData[7].y, 2)),
      hipToRightKnee: Math.sqrt(Math.pow(jointsData[9].x - jointsData[2].x, 2) + Math.pow(jointsData[9].y - jointsData[2].y, 2)),
      rightKneeToRightFoot: Math.sqrt(Math.pow(jointsData[10].x - jointsData[9].x, 2) + Math.pow(jointsData[10].y - jointsData[9].y, 2)),
      headToNeck: Math.sqrt(Math.pow(jointsData[0].x - jointsData[1].x, 2) + Math.pow(jointsData[0].y - jointsData[1].y, 2)),
    };

    // 计算线宽
    const calculateLineWidth = (length: number) => {
      // 根据长度动态计算线宽，确保在合理范围内
      const width = Math.max(2, Math.min(10, length / 20));
      return width;
    };

    // 计算关节点大小
    const calculateJointRadius = (length: number) => {
      // 根据长度动态计算关节点大小，确保在合理范围内
      const radius = Math.max(5, Math.min(20, length / 10));
      return radius;
    };

    // 计算平均长度，用于设置默认线宽和关节点大小
    const avgLength = Object.values(lineLengths).reduce((sum, length) => sum + length, 0) / Object.values(lineLengths).length;

    // 计算统一的线宽
    const newLineWidth = calculateLineWidth(avgLength);

    // 计算关节点大小
    const newJointRadius = calculateJointRadius(avgLength);

    return { newLineWidth, newJointRadius };
  };

  // 请求姿态检测接口
  const detectPosture = async (imageUrl: string) => {
    try {
      // 使用项目中已有的姿态检测API
      const { code, data }: any = await getImgPose({ img_url: imageUrl });
      if (code === 'SUCCESS' && data) {
        // console.log('姿态检测结果:', data);
        // 转换姿态检测结果为关节点数组
        const convertedJoints = convertToJointsFormat(data);
        // 计算线宽和关节点大小
        const { newLineWidth, newJointRadius } = calculateLineWidthAndJointRadius(convertedJoints);
        // 更新状态
        setPoseData(convertedJoints);
        setJoints(convertedJoints);
        setLineWidth(newLineWidth);
        setJointRadius(newJointRadius);
      }
    } catch (error) {
      console.error('姿态检测失败:', error);
      // 失败时使用默认姿态
      // setJoints([...initJoints]);
      const convertedJoints = convertToJointsFormat(imgJoints);
      // 计算线宽和关节点大小
      const { newLineWidth, newJointRadius } = calculateLineWidthAndJointRadius(convertedJoints);
      // 更新状态
      setJoints(convertedJoints);
      setLineWidth(newLineWidth);
      setJointRadius(newJointRadius);
    }
  };

  // 算Canvas显示尺寸和原始坐标的缩放比例
  const calculateScaleRatio = () => {
    if (!containerRef.current || !canvasRef.current) return 1;

    const containerWidth = window.innerWidth;
    const containerHeight = window.innerHeight;
    // 以容器尺寸和原始Canvas尺寸(400x400)的最小比例作为缩放比
    const widthRatio = containerWidth / OUTPUT_IMAGE_WIDTH;
    const heightOut = containerHeight > 850 ? OUTPUT_IMAGE_HEIGHT : OUTPUT_BIG_IMAGE_HEIGHT;
    const heightRatio = containerHeight / heightOut;

    const ratio = Math.min(widthRatio, heightRatio, 1) || 1;
    // 限制最小缩放比，避免过小
    return Math.max(ratio, 0.2);
  };

  // 约束关节位置的工具函数
  const constrainJointPosition = (targetJointName: string, targetX: number, targetY: number, currentJoints: typeof joints) => {
    let constrainedX = targetX;
    let constrainedY = targetY;

    const relatedLines = Object.entries(lineJointsMap).filter(([_, jointMap]) => {
      return jointMap.start === targetJointName || jointMap.end === targetJointName;
    });

    relatedLines.forEach(([lineKey, jointMap]) => {
      // 获取连线的约束规则
      const constraints = (lineConstraints as any)[lineKey];
      if (!constraints) return;

      // 找到连线的另一端关节
      const otherJointName = jointMap.start === targetJointName ? jointMap.end : jointMap.start;
      const otherJoint = currentJoints.find(j => j.name === otherJointName);
      if (!otherJoint) return;

      // 计算当前约束后的坐标与另一端关节的距离
      const distance = calculateDistance(constrainedX, constrainedY, otherJoint.x, otherJoint.y);

      // 超过最大长度 → 缩放到最大长度
      if (distance > constraints.max) {
        const ratio = constraints.max / distance;
        // const ratio = constraints.max / distance * scaleRatio;
        constrainedX = otherJoint.x + (constrainedX - otherJoint.x) * ratio;
        constrainedY = otherJoint.y + (constrainedY - otherJoint.y) * ratio;
      }

      // 小于最小长度 → 拉伸到最小长度（可选，提升交互体验）
      else if (distance < constraints.min) {
        const ratio = constraints.min / distance;
        // const ratio = constraints.min / distance * scaleRatio;
        constrainedX = otherJoint.x + (constrainedX - otherJoint.x) * ratio;
        constrainedY = otherJoint.y + (constrainedY - otherJoint.y) * ratio;
      }

      // 限制关节在Canvas范围内（避免拖出画布）
      const canvas = canvasRef.current;
      if (canvas) {
        constrainedX = Math.max(20, Math.min(canvas.width - 20, constrainedX));
        constrainedY = Math.max(20, Math.min(canvas.height - 20, constrainedY));
      }
    });

    return { x: constrainedX, y: constrainedY };
  };

  // 绘制火柴人
  const drawStickman = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'red';
    ctx.fillStyle = 'red';

    // 绘制身体
    // 设置统一的线宽
    ctx.lineWidth = lineWidth;

    // 绘制颈部到臀部
    ctx.beginPath();
    ctx.moveTo(joints[1].x, joints[1].y); // 从颈部开始
    ctx.lineTo(joints[2].x, joints[2].y); // 到臀部

    // 绘制颈部到左肘
    ctx.moveTo(joints[1].x, joints[1].y);
    ctx.lineTo(joints[3].x, joints[3].y); // 到左肘

    // 绘制左肘到左手
    ctx.moveTo(joints[3].x, joints[3].y);
    ctx.lineTo(joints[4].x, joints[4].y); // 到左手

    // 绘制颈部到右肘
    ctx.moveTo(joints[1].x, joints[1].y);
    ctx.lineTo(joints[5].x, joints[5].y); // 到右肘

    // 绘制右肘到右手
    ctx.moveTo(joints[5].x, joints[5].y);
    ctx.lineTo(joints[6].x, joints[6].y); // 到右手

    // 绘制臀部到左膝
    ctx.moveTo(joints[2].x, joints[2].y);
    ctx.lineTo(joints[7].x, joints[7].y); // 到左膝

    // 绘制左膝到左脚
    ctx.moveTo(joints[7].x, joints[7].y);
    ctx.lineTo(joints[8].x, joints[8].y); // 到左脚

    // 绘制臀部到右膝
    ctx.moveTo(joints[2].x, joints[2].y);
    ctx.lineTo(joints[9].x, joints[9].y); // 到右膝

    // 绘制右膝到右脚
    ctx.moveTo(joints[9].x, joints[9].y);
    ctx.lineTo(joints[10].x, joints[10].y); // 到右脚
    ctx.stroke();

    // 绘制头部
    const headCenterX = joints[0].x;
    const headCenterY = joints[0].y;
    const headAngle = Math.atan2(joints[1].y - joints[0].y, joints[1].x - joints[0].x);

    ctx.save();
    ctx.translate(headCenterX, headCenterY);
    ctx.rotate(headAngle + Math.PI / 2);
    ctx.lineWidth = 2; // 头部边框粗细
    ctx.beginPath();
    ctx.ellipse(0, 0, jointRadius * 1.6, jointRadius * 1.6, 0, 0, 2 * Math.PI); // 第3、4个参数头部大小，设置为关节点大小的1.5倍
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 绘制从颈部到头顶的线
    ctx.beginPath();
    ctx.moveTo(joints[1].x, joints[1].y);
    ctx.lineTo(joints[0].x, joints[0].y);
    ctx.stroke();

    // 绘制关节点
    joints.forEach(joint => {
      ctx.save(); // 保存当前样式状态
      ctx.beginPath();
      // 使用状态中的关节点大小
      ctx.arc(joint.x, joint.y, jointRadius, 0, Math.PI * 2); // 第3个参数是关节半径（数值越大，支点越大）
      ctx.fill();

      ctx.fillStyle = 'red';
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; // 黑色透明（0.3是透明度，0-1调整）
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  // 处理鼠标移动到canvas上的事件
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let overJoint = false;
    joints.forEach(joint => {
      if (Math.abs(x - joint.x) < lineWidth * 2 && Math.abs(y - joint.y) < lineWidth * 2) {
        overJoint = true;
      }
    });

    setIsMouseOverJoint(overJoint);
  };

  // 处理鼠标离开canvas的事件
  const handleCanvasMouseLeave = () => {
    setIsMouseOverJoint(false);
  };

  // 处理鼠标按下事件
  const handleMouseDown = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // const ratio = 1
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // const x = (e.clientX - rect.left) / scaleRatio;
    // const y = (e.clientY - rect.top) / scaleRatio;

    joints.forEach(joint => {
      if (Math.abs(x - joint.x) < 10 && Math.abs(y - joint.y) < 10) {
        setDragging(true);
        setSelectedJoint(joint.name);
      }
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragging || !selectedJoint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const newX = e.clientX - rect.left;
    const newY = e.clientY - rect.top;
    // const newX = (e.clientX - rect.left) / scaleRatio;
    // const newY = (e.clientY - rect.top) / scaleRatio;
    // console.log('in move', e.clientX, e.clientY)

    setJoints(prevJoints => {
      const { x: constrainedX, y: constrainedY } = constrainJointPosition(selectedJoint, newX, newY, prevJoints);

      // 更新关节坐标
      return prevJoints.map(joint => (joint.name === selectedJoint ? { ...joint, x: constrainedX, y: constrainedY } : joint));
    });
  };

  // 处理鼠标释放事件
  const handleMouseUp = () => {
    setDragging(false);
    setSelectedJoint(null);
  };

  // base64转Blob
  const dataURLtoBlob = (dataURL: string) => {
    const arr = dataURL.split(',');
    const matchResult = arr[0].match(/:(.*?);/);
    const mime = matchResult?.[1] ?? 'image/png'; // 优先取匹配结果，失败则默认 image/png
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }

    return new Blob([u8arr], { type: mime });
  };

  // 处理下载
  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (execute) return;

    drawStickman();
    setExecute(true);
    const dataUrl = canvas.toDataURL('image/png');

    const blob = dataURLtoBlob(dataUrl);
    // 构建 File 对象（参数：blob 对象、文件名、文件格式）
    const fileName = `canvas_upload_${Date.now()}.png`; // 自定义文件名（带时间戳避免重复）
    const file = new File([blob], fileName, { type: blob.type });

    let url = '';
    url = (await uploadFile(file)).url;
    // toast.error('无法识别文件类型');
    drawStickman();
    setExecute(false);
    onImageSuccess(url);
  };
  // 处理重置
  const handleRe = () => {
    if (!poseData) {
      setJoints([...initJoints]);
    } else {
      setJoints(poseData);
    }
  };

  // 初始化和更新时绘制
  useEffect(() => {
    if (backgroundImage && !poseData) {
      loadBackgroundImage(backgroundImage);
    } else {
      drawStickman();
    }
  }, [joints, backgroundImage, poseData]);

  // 添加全局鼠标事件监听
  useEffect(() => {
    // 添加全局鼠标移动事件监听
    window.addEventListener('mousemove', handleMouseMove);
    // 添加全局鼠标释放事件监听
    window.addEventListener('mouseup', handleMouseUp);

    // 清理函数
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div
      className='relative h-full w-full rounded-md flex flex-col justify-between items-center'
      ref={containerRef} // 🔥 改动点：绑定容器ref
    >
      <div
        className='w-full relative'
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          margin: 0,
          fontFamily: 'Arial, sans-serif',
          flex: 1,
        }}
      >
        {/* 背景图片 */}
        {bgImage && (
          <img
            src={bgImage.src}
            alt='背景'
            style={{
              position: 'absolute',
              width: canvasSize.width + 'px',
              height: canvasSize.height + 'px',
              opacity: 0.5, // 半透明效果
              zIndex: 1,
            }}
          />
        )}
        {/* Canvas绘制火柴人 */}
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          style={{
            // marginBottom: '10px',
            background: bgImage ? 'transparent' : '#262626',
            // background: 'transparent', // 透明背景
            width: canvasSize.width + 'px',
            height: canvasSize.height + 'px',
            position: 'relative',
            zIndex: 2,
            cursor: isMouseOverJoint ? 'pointer' : 'default',
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
        />
      </div>
      <div className='flex justify-center w-fit mt-1 bg-[#262626] p-1 rounded-lg gap-2'>
        <Button variant='ghost' className={cn('h-8 text-xs gap-1 transition-colors', 'text-primary  hover:bg-primary/10')} onClick={onClose}>
          <X size={14}></X>
          取消
        </Button>
        <Button variant='ghost' className={cn('h-8 text-xs gap-1 transition-colors', 'text-primary  hover:bg-primary/10')} onClick={handleRe}>
          重置
        </Button>
        <div className={`${styles.sendButton} ${execute ? styles.locked : ''}`} onClick={handleDownload}>
          {execute ? <LoaderCircle className='animate-spin' size={14}></LoaderCircle> : <Sparkles size={14}></Sparkles>}
          <div>{execute ? '生成中' : '生成'}</div>
          {/* <Sparkles size={14}></Sparkles>
          <div>生成</div> */}
        </div>
      </div>
    </div>
  );
};

export default Posture;
