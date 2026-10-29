import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeFrameRect, type PanoramaAspectRatio, type PanoramaViewState } from './panoramaUtil';

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2;
const DEFAULT_FOV = 75;
const SPHERE_RADIUS = 500;
const SPHERE_WIDTH_SEGMENTS = 128;
const SPHERE_HEIGHT_SEGMENTS = 64;
const MAX_PIXEL_RATIO = 3;

const getPixelRatio = () => Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);

const applyRendererSize = (renderer: THREE.WebGLRenderer, width: number, height: number) => {
  renderer.setPixelRatio(getPixelRatio());
  renderer.setSize(width, height, false);
};

const configurePanoramaTexture = (texture: THREE.Texture, renderer: THREE.WebGLRenderer) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
};

const configureRenderer = (renderer: THREE.WebGLRenderer) => {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
};

const applyViewState = (camera: THREE.PerspectiveCamera, controls: OrbitControls, zoomRef: { current: number }, view: PanoramaViewState) => {
  camera.position.fromArray(view.position);
  controls.target.fromArray(view.target);
  zoomRef.current = view.zoom;
  camera.fov = DEFAULT_FOV / view.zoom;
  camera.updateProjectionMatrix();
  controls.update();
};

interface UsePanoramaViewerOptions {
  imageUrl: string;
  enabled: boolean;
  /** 场景初始化时应用的视角（嵌入/全屏切换用） */
  initialView?: PanoramaViewState | null;
}

export function usePanoramaViewer({ imageUrl, enabled, initialView }: UsePanoramaViewerOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const frameRef = useRef<number | null>(null);
  const initialCameraQuaternionRef = useRef<THREE.Quaternion | null>(null);
  const wheelHandlerRef = useRef<((event: WheelEvent) => void) | null>(null);
  const zoomRef = useRef(1);
  // 仅在挂载时读一次，避免视角变化触发重建
  const initialViewRef = useRef(initialView);
  initialViewRef.current = initialView;

  const [ready, setReady] = useState(false);

  const disposeScene = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    controlsRef.current?.dispose();
    controlsRef.current = null;
    if (meshRef.current) {
      meshRef.current.geometry.dispose();
      const disposeMaterial = (m: THREE.Material) => {
        if (m instanceof THREE.MeshBasicMaterial && m.map) m.map.dispose();
        m.dispose();
      };
      const material = meshRef.current.material;
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else disposeMaterial(material);
      meshRef.current = null;
    }
    const renderer = rendererRef.current;
    if (renderer) {
      if (wheelHandlerRef.current) {
        renderer.domElement.removeEventListener('wheel', wheelHandlerRef.current);
        wheelHandlerRef.current = null;
      }
      renderer.domElement.parentElement?.removeChild(renderer.domElement);
      renderer.dispose();
    }
    rendererRef.current = null;
    sceneRef.current = null;
    cameraRef.current = null;
    initialCameraQuaternionRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!enabled || !imageUrl || !containerRef.current) {
      disposeScene();
      return;
    }

    let cancelled = false;
    const container = containerRef.current;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, width / height, 0.1, 1000);
    camera.position.set(0, 0, 0.1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    configureRenderer(renderer);
    applyRendererSize(renderer, width, height);
    container.appendChild(renderer.domElement);

    const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
    geometry.scale(-1, 1, 1);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.crossOrigin = 'anonymous';
    textureLoader.load(
      imageUrl,
      texture => {
        if (cancelled) {
          texture.dispose();
          geometry.dispose();
          return;
        }
        configurePanoramaTexture(texture, renderer);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        meshRef.current = mesh;
        setReady(true);
      },
      undefined,
      () => {
        if (!cancelled) geometry.dispose();
      }
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = -0.3;
    controls.minDistance = 0.1;
    controls.maxDistance = 0.1;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.target.set(0, 0, 0);

    initialCameraQuaternionRef.current = camera.quaternion.clone();
    zoomRef.current = 1;
    camera.fov = DEFAULT_FOV;
    camera.updateProjectionMatrix();

    const savedView = initialViewRef.current;
    if (savedView) {
      applyViewState(camera, controls, zoomRef, savedView);
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY > 0 ? -0.08 : 0.08;
      const nextZoom = THREE.MathUtils.clamp(zoomRef.current + delta, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === zoomRef.current) return;
      zoomRef.current = nextZoom;
      camera.fov = DEFAULT_FOV / nextZoom;
      camera.updateProjectionMatrix();
    };

    wheelHandlerRef.current = onWheel;
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth || 1;
      const h = containerRef.current.clientHeight || 1;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      applyRendererSize(rendererRef.current, w, h);
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      disposeScene();
    };
  }, [disposeScene, enabled, imageUrl]);

  const getViewState = useCallback((): PanoramaViewState | null => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return null;
    return {
      position: camera.position.toArray() as [number, number, number],
      target: controls.target.toArray() as [number, number, number],
      zoom: zoomRef.current,
    };
  }, []);

  const resetView = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || !initialCameraQuaternionRef.current) return;
    camera.quaternion.copy(initialCameraQuaternionRef.current);
    camera.position.set(0, 0, 0.1);
    controls.target.set(0, 0, 0);
    controls.update();
    zoomRef.current = 1;
    camera.fov = DEFAULT_FOV;
    camera.updateProjectionMatrix();
  }, []);

  const captureFrame = useCallback(
    async (aspectRatio: PanoramaAspectRatio): Promise<string | null> => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!renderer || !scene || !camera || !container || !ready) return null;

      const containerW = container.clientWidth || 1;
      const containerH = container.clientHeight || 1;
      const { width: frameW, height: frameH } = computeFrameRect(containerW, containerH, aspectRatio);

      const outputW = Math.max(1, Math.round(frameW));
      const outputH = Math.max(1, Math.round(frameH));

      const offscreenRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      configureRenderer(offscreenRenderer);
      applyRendererSize(offscreenRenderer, outputW, outputH);

      const offscreenCamera = camera.clone();
      offscreenCamera.aspect = outputW / outputH;
      offscreenCamera.updateProjectionMatrix();

      offscreenRenderer.render(scene, offscreenCamera);
      const dataUrl = offscreenRenderer.domElement.toDataURL('image/png');
      offscreenRenderer.dispose();

      return dataUrl;
    },
    [ready]
  );

  return {
    containerRef,
    ready,
    resetView,
    captureFrame,
    getViewState,
  };
}
