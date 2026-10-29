import type { OnboardingStep } from '@/components/onboarding';
import { CANVAS_ONBOARDING_TARGETS, getCanvasOnboardingSelector } from './canvasOnboardingTargets';

export const canvasOnboardingSteps: OnboardingStep[] = [
  {
    id: 'canvas-center',
    title: '双击创建新节点至画布',
    description: '四个【基础节点】文本、图片、视频、音频，可以在画布中双击创建哦~创建的节点通过连线方式串联起来，就可以搭建出工作流了，快去试试吧~',
    placement: 'center',
    align: 'center',
    showArrow: false,
  },
  {
    id: 'basic-nodes',
    target: getCanvasOnboardingSelector(CANVAS_ONBOARDING_TARGETS.basicNodes),
    title: '基础节点 | 拖拽或点击添加至画布',
    description: '左侧栏【基础节点】内置文本、图片、视频、音频四个基础节点，可以通过拖拽或点击的方式快速运用到画布中。',
    placement: 'right',
    align: 'center',
  },
  {
    id: 'tool-nodes',
    target: getCanvasOnboardingSelector(CANVAS_ONBOARDING_TARGETS.toolNodes),
    title: '工具节点 | 拖拽或点击添加至画布',
    description: '左侧栏【工具节点】内置多个工具节点，可以通过拖拽或点击的方式快速运用到画布中。',
    placement: 'right',
    align: 'center',
  },
  {
    id: 'assets',
    target: getCanvasOnboardingSelector(CANVAS_ONBOARDING_TARGETS.assets),
    title: '资产库 | 查看或使用资产',
    description: '点击左侧栏【我的资产】可以查看过往历史生成与上传的资产，同时也可以选择【公共资产】查看官方内置的资产内容，选择并点击即可运用该资产到当前画布中，让创作更加便捷。',
    placement: 'right',
    align: 'center',
  },
  {
    id: 'templates',
    target: getCanvasOnboardingSelector(CANVAS_ONBOARDING_TARGETS.templates),
    title: '模版工作流 | 查看或使用工作流',
    description: '点击左侧栏【模版工作流】可以查看公共工作流模板及个人的工作流，选择点击即可运用该工作流到当前画布中。',
    placement: 'right',
    align: 'center',
  },
  {
    id: 'share',
    target: getCanvasOnboardingSelector(CANVAS_ONBOARDING_TARGETS.share),
    title: '分享 | 复制链接或发布到社区',
    description: '点击【分享】可选择复制画布链接或发布到社区，即可将该画布工作流分享出去了~',
    placement: 'bottom',
    align: 'end',
  },
];
