import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RefreshCw } from 'lucide-react';
import SendButton from '../promptControl/SendButton';

// 定义组件 Props 接口
interface MultiViewProps {
  imageList?: string[];
  horizontal: number;
  vertical: number;
  zoom: number;
  isExcute: boolean;
  status: string;
  caculatePoint: number;
  onLayerClick: (imageList: string[] | undefined, params: Params) => void; // 点击图层按钮回调
  onParamsChange: (params: Params) => void; // 组件销毁时同步参数回调
  permissionDisabled?: boolean;
}

interface Params {
  horizontal: number;
  vertical: number;
  zoom: number;
}

type ZoomLevel = 0 | 2.5 | 5 | 7.5 | 10;

const ZOOM_PRESETS: Array<{ value: ZoomLevel; label: string; radius: number }> = [
  { value: 0, label: '远景', radius: 8 },
  { value: 2.5, label: '中远景', radius: 7 },
  { value: 5, label: '中景', radius: 5 },
  { value: 7.5, label: '中近景', radius: 3.5 },
  { value: 10, label: '近景', radius: 2 },
];

const normalizeLegacyZoom = (z: number) => {
  // 兼容旧值：远景-6、中远景-7、中景-8、中近景-9、近景-10
  if (z === 6) return 0;
  if (z === 7) return 2.5;
  if (z === 8) return 5;
  if (z === 9) return 7.5;
  if (z === 10) return 10;
  return z;
};

const clampZoomLevel = (z: number): ZoomLevel => {
  const normalized = normalizeLegacyZoom(z);

  let best = ZOOM_PRESETS[0].value;
  let bestDist = Math.abs(normalized - best);
  for (const p of ZOOM_PRESETS) {
    const d = Math.abs(normalized - p.value);
    if (d < bestDist) {
      best = p.value;
      bestDist = d;
    }
  }
  return best;
};

const zoomToRadius = (z: number) => {
  const level = clampZoomLevel(z);
  return ZOOM_PRESETS.find(p => p.value === level)?.radius ?? ZOOM_PRESETS[2].radius;
};

const radiusToZoom = (radius: number): ZoomLevel => {
  let best = ZOOM_PRESETS[0];
  let bestDist = Math.abs(radius - best.radius);
  for (const p of ZOOM_PRESETS) {
    const d = Math.abs(radius - p.radius);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best.value;
};

const zoomLabel = (z: number) => {
  const level = clampZoomLevel(z);
  return ZOOM_PRESETS.find(p => p.value === level)?.label ?? '中景';
};

const MultiView: React.FC<MultiViewProps> = ({
  imageList,
  horizontal: initialHorizontal = 0,
  vertical: initialVertical = 0,
  zoom: initialZoom = 5,
  isExcute,
  status,
  caculatePoint,
  onLayerClick,
  onParamsChange,
  permissionDisabled = false,
}) => {
  // 状态管理
  const [params, setParams] = useState<Params>({
    horizontal: initialHorizontal,
    vertical: initialVertical,
    zoom: clampZoomLevel(initialZoom),
  });

  // 引用管理
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cubeRef = useRef<THREE.Mesh | null>(null);
  const cubeWireRef = useRef<THREE.LineSegments | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  // 使用 Ref 实时追踪最新参数，用于销毁时的回调
  const paramsRef = useRef<Params>(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // 关键标志位：防止初始化过程中的控制权冲突
  const isUpdatingRef = useRef<boolean>(false);
  const isInitializingRef = useRef<boolean>(true);

  // 空白图片的base64编码
  const blankImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  const activeImage = useMemo(() => {
    if (imageList && imageList.length > 0) return imageList[0];
    return blankImage; // 返回完全透明的空白图片
  }, [imageList]);

  const allowSend = useMemo(() => {
    if (permissionDisabled || status === 'running' || !imageList || !imageList.length) {
      return false;
    } else {
      return true;
    }
  }, [status, imageList, permissionDisabled]);

  const centerOffset = new THREE.Vector3(0, 1.2, 0);
  // 网格与立方体底部的间距
  const GRID_OFFSET = 0.1;

  // 网格在场景中的下移量：让网格在视角中更接近底部约 1/3
  const GRID_Y = -1.2;
  const MAX_DIST = Math.max(...ZOOM_PRESETS.map(p => p.radius));
  const MIN_DIST = Math.min(...ZOOM_PRESETS.map(p => p.radius));
  // 立方体最大基础尺寸：减小以确保在最小相机距离时不会超出视窗
  const MAX_CUBE_SIZE = 2.2;
  // 立方体厚度：至少为原来的 3 倍（原 0.1）
  const CUBE_DEPTH = 0.3;

  // 根据参数更新相机物理位置
  const updateCameraFromParams = (h: number, v: number, z: number) => {
    if (!cameraRef.current || !controlsRef.current) return;

    isUpdatingRef.current = true;

    const radius = zoomToRadius(z);
    const phi = THREE.MathUtils.degToRad(90 - v);
    const theta = THREE.MathUtils.degToRad(h);

    const spherical = new THREE.Spherical(radius, phi, theta);
    const newPos = new THREE.Vector3().setFromSpherical(spherical);

    cameraRef.current.position.copy(centerOffset).add(newPos);
    controlsRef.current.target.copy(centerOffset);
    controlsRef.current.update();

    requestAnimationFrame(() => {
      isUpdatingRef.current = false;
    });
  };

  // 材质与纹理动态更新
  useEffect(() => {
    if (!cubeRef.current) return;
    let isCancelled = false;
    const textureLoader = new THREE.TextureLoader();

    textureLoader.load(activeImage, texture => {
      if (isCancelled || !cubeRef.current) {
        texture.dispose();
        return;
      }
      // 色彩还原：sRGB 纹理 + 不预乘 alpha，避免边缘色偏
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.premultiplyAlpha = false;

      const materials = cubeRef.current.material as THREE.MeshBasicMaterial[];

      // 前面：原图，材质纯白不参与着色以还原颜色
      materials[4].color.setHex(0xffffff);
      materials[4].map = texture;
      materials[4].needsUpdate = true;

      // 后面：克隆纹理并设置遮罩感 + 镜像效果（clone 会继承 colorSpace）
      const backTexture = texture.clone();
      // 设置纹理重复模式以支持镜像
      backTexture.wrapS = THREE.RepeatWrapping;
      // 水平翻转实现镜像效果
      backTexture.repeat.x = -1;
      backTexture.needsUpdate = true;
      materials[5].map = backTexture;
      materials[5].color.setScalar(0.25); // 对应 75% 的黑色遮罩
      materials[5].needsUpdate = true;

      // 按图片原始比例更新立方体几何：正面保持宽高比，长边为 MAX_CUBE_SIZE
      const img = texture.image as HTMLImageElement;
      if (img && img.width && img.height) {
        const aspect = img.width / img.height;
        let w: number;
        let h: number;
        if (aspect >= 1) {
          w = MAX_CUBE_SIZE * aspect;
          h = MAX_CUBE_SIZE;
        } else {
          w = MAX_CUBE_SIZE;
          h = MAX_CUBE_SIZE / aspect;
        }
        // 限制最大尺寸，确保在最小相机距离时不会超出视窗
        const maxDimension = MAX_CUBE_SIZE * 1.5;
        if (w > maxDimension) {
          h = h * (maxDimension / w);
          w = maxDimension;
        }
        if (h > maxDimension) {
          w = w * (maxDimension / h);
          h = maxDimension;
        }
        const oldGeom = cubeRef.current.geometry;
        cubeRef.current.geometry = new THREE.BoxGeometry(w, h, CUBE_DEPTH);
        oldGeom.dispose();

        // 同步更新线框（50% 不透明度边缘）
        if (cubeWireRef.current) {
          const oldEdges = cubeWireRef.current.geometry;
          cubeWireRef.current.geometry = new THREE.EdgesGeometry(cubeRef.current.geometry);
          oldEdges.dispose();
        }
        // 让立方体中心对齐场景中心点，确保图片始终在视窗中心
        cubeRef.current.position.y = centerOffset.y;

        // 同步更新网格位置，让网格始终与图片底部贴紧
        if (gridRef.current) {
          const cubeBottomY = cubeRef.current.position.y - h / 2;
          gridRef.current.position.y = cubeBottomY - GRID_OFFSET;
        }
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [activeImage]);

  useEffect(() => {
    if (!mountRef.current) return;

    while (mountRef.current.firstChild) {
      mountRef.current.removeChild(mountRef.current.firstChild);
    }

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    // 色彩还原：sRGB 输出 + 关闭色调映射，使画布显示与原图一致
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));

    const grid = new THREE.GridHelper(10, 20, 0x333333, 0x222222);
    grid.position.y = GRID_Y;
    scene.add(grid);
    gridRef.current = grid;

    // 创建带厚度的立方体
    const geometry = new THREE.BoxGeometry(MAX_CUBE_SIZE, MAX_CUBE_SIZE, CUBE_DEPTH);

    const materials = [
      new THREE.MeshBasicMaterial({ color: 0x222222 }), // 右
      new THREE.MeshBasicMaterial({ color: 0x222222 }), // 左
      new THREE.MeshBasicMaterial({ color: 0x222222 }), // 上
      new THREE.MeshBasicMaterial({ color: 0x222222 }), // 下
      new THREE.MeshBasicMaterial({ transparent: true }), // 前 (正面)
      new THREE.MeshBasicMaterial({ transparent: true }), // 后 (反面)
    ];

    const cube = new THREE.Mesh(geometry, materials);
    // 立方体边缘线框：50% 不透明度
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    cube.add(wire);
    cubeWireRef.current = wire;
    // 初始立方体：中心对齐场景中心点，确保图片在视窗中心
    cube.position.y = centerOffset.y;
    scene.add(cube);
    cubeRef.current = cube;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; // 阻尼调到 0
    controls.enablePan = false;
    controls.enableZoom = false; // 滚轮缩放改为“景别档位”离散跳变
    controls.minDistance = MIN_DIST;
    controls.maxDistance = MAX_DIST;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(120);
    controls.target.copy(centerOffset);
    controlsRef.current = controls;

    const handleWheel = (e: WheelEvent) => {
      // 仅在 MultiView 画布上接管缩放，按景别 6~10 离散跳变
      e.preventDefault();
      if (isUpdatingRef.current || isInitializingRef.current) return;

      const current = clampZoomLevel(paramsRef.current.zoom);
      const direction = e.deltaY > 0 ? -1 : 1; // 向下滚 = 拉远（数值变小），向上滚 = 拉近（数值变大）
      const next = clampZoomLevel(current + direction * 2.5);

      if (next === current) return;

      // 同步 UI 参数 + 相机位置
      setParams(prev => {
        const newParams = { ...prev, zoom: next };
        paramsRef.current = newParams;
        return newParams;
      });
      updateCameraFromParams(paramsRef.current.horizontal, paramsRef.current.vertical, next);
    };
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    const handleCameraChange = () => {
      if (isUpdatingRef.current || isInitializingRef.current) return;

      const relativePos = new THREE.Vector3().subVectors(camera.position, centerOffset);
      const sphere = new THREE.Spherical().setFromVector3(relativePos);

      const hDeg = Math.round(THREE.MathUtils.radToDeg(sphere.theta));
      const vDeg = Math.round(90 - THREE.MathUtils.radToDeg(sphere.phi));
      const zVal = radiusToZoom(sphere.radius);

      setParams({
        horizontal: hDeg,
        vertical: vDeg,
        zoom: zVal,
      });
    };
    controls.addEventListener('change', handleCameraChange);

    let aniId: number;
    const animate = () => {
      aniId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    isInitializingRef.current = true;
    updateCameraFromParams(initialHorizontal, initialVertical, clampZoomLevel(initialZoom));

    setTimeout(() => {
      isInitializingRef.current = false;
    }, 100);

    return () => {
      onParamsChange(paramsRef.current);
      cancelAnimationFrame(aniId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('wheel', handleWheel as any);
      controls.removeEventListener('change', handleCameraChange);
      renderer.dispose();
      geometry.dispose();
      if (cubeWireRef.current) {
        cubeWireRef.current.geometry.dispose();
        (cubeWireRef.current.material as THREE.Material).dispose();
        cubeWireRef.current = null;
      }
      materials.forEach(m => m.dispose());
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      if (mountRef.current && renderer.domElement) {
        if (mountRef.current.contains(renderer.domElement)) {
          mountRef.current.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  const handleParamChange = (key: keyof Params, value: number) => {
    const nextValue = key === 'zoom' ? clampZoomLevel(value) : value;
    const newParams = { ...params, [key]: nextValue };
    setParams(newParams);
    updateCameraFromParams(newParams.horizontal, newParams.vertical, newParams.zoom);
  };

  const handleReset = () => {
    const resetValues: Params = { horizontal: 0, vertical: 0, zoom: 5 };
    setParams(resetValues);
    updateCameraFromParams(resetValues.horizontal, resetValues.vertical, resetValues.zoom);
  };

  const handleSend = () => {
    if (!isExcute && allowSend) onLayerClick(imageList, params);
  };

  return (
    <div className='nowheel relative flex h-[360px] bg-[#262626] rounded-lg shadow-2xl overflow-hidden mx-auto'>
      {/* 左侧展示区 */}
      <div className='relative w-[360px] h-full bg-[#0d0d0f] border-r border-white/5'>
        <div ref={mountRef} className='w-full h-full cursor-grab active:cursor-grabbing' />
        <div className='absolute inset-6 pointer-events-none'>
          <div className='absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-500/60 rounded-tl-lg'></div>
          <div className='absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-500/60 rounded-tr-lg'></div>
          <div className='absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-500/60 rounded-bl-lg'></div>
          <div className='absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-500/60 rounded-br-lg'></div>
        </div>
        <div className='absolute top-8 left-8 flex items-center gap-2.5 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10'>
          <div className='w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]'></div>
          <span className='text-[10px] font-semibold text-gray-300 tracking-wider'>相机视角</span>
        </div>
      </div>

      {/* 右侧控制区 */}
      <div className='w-[288px] h-full flex flex-col p-6 justify-between bg-gradient-to-b from-[#18181b] to-[#141416]'>
        <div className='space-y-6'>
          <section>
            <h2 className='text-base font-bold tracking-tight mb-1 text-white/95'>角度调整</h2>
            <p className='text-white/65 text-xs'>左侧为摄像机视窗视角</p>
          </section>

          <div className='space-y-8'>
            <ControlSlider label='水平角度' value={params.horizontal} min={-180} max={180} unit='°' onChange={val => handleParamChange('horizontal', val)} />
            <ControlSlider label='垂直角度' value={params.vertical} min={-30} max={90} unit='°' onChange={val => handleParamChange('vertical', val)} />
            <ControlSlider
              label='缩放比例'
              value={params.zoom}
              min={0}
              max={10}
              step={2.5}
              unit=''
              valueText={zoomLabel(params.zoom)}
              onChange={val => handleParamChange('zoom', val)}
            />
          </div>
        </div>

        <div className='flex items-center justify-end gap-4 pt-4'>
          <button
            onClick={handleReset}
            className='flex items-center gap-2 text-gray-400 hover:text-white transition-all text-xs font-semibold py-2 px-3 rounded-xl hover:bg-white/5'
          >
            <RefreshCw size={14} />
            重置
          </button>
          <SendButton isExcute={isExcute} allowSend={allowSend} caculatePoint={caculatePoint} onClick={handleSend} />
        </div>
      </div>
    </div>
  );
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  valueText?: string;
  onChange: (val: number) => void;
}

const ControlSlider: React.FC<SliderProps> = ({ label, value, min, max, step = 1, unit, valueText, onChange }) => (
  <div className='group'>
    <div className='flex justify-between items-end mb-3'>
      <span className='text-white/95 text-sm'>{label}</span>
      <span className='text-white/95 text-sm text-right'>{valueText ?? `${value}${unit}`}</span>
    </div>
    <div className='relative flex items-center h-2'>
      <div className='absolute w-full h-1 bg-white/5 rounded-full'></div>
      <div className='absolute h-1 bg-blue-500 rounded-full' style={{ width: `${((value - min) / (max - min)) * 100}%` }}></div>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className='absolute w-full h-4 opacity-0 cursor-pointer z-10'
      />
      <div
        className='absolute w-4 h-4 bg-white rounded-full border-2 border-blue-600 shadow-xl pointer-events-none'
        style={{ left: `calc(${((value - min) / (max - min)) * 100}% - 7px)` }}
      ></div>
    </div>
  </div>
);

export default MultiView;
