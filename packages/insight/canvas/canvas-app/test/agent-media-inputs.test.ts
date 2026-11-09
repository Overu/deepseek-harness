import type { Node } from '@xyflow/react'
import { expect, it, vi } from 'vitest'
import util from '../legacy/src/components/canvasFlow/utils/util'

vi.mock('@/api/asset', () => ({ getAvailableCapacity: vi.fn() }))
vi.mock('@/utils', () => ({ isSvgImageUrl: () => false, compressImage: vi.fn() }))

it('keeps reference video mode compatible with connected empty media', () => {
  const modelType = 'reference_image_to_video'
  const nodes: Node[] = ['image', 'video', 'audio'].map(type => ({
    id: type,
    type,
    position: { x: 0, y: 0 },
    data: { title: type, value: '' },
  }))
  const edges = nodes.map(node => ({ id: node.id, source: node.id, target: 'target' }))

  const emptyInputs = util.getSourceMap(nodes, edges, 'target')
  const counts = emptyInputs.mediaByTypeCounts
  expect(counts).toEqual({ images: 1, videos: 1, audios: 1 })
  expect(emptyInputs.mediaInputs).toEqual([])
  expect(util.resolveVideoModelTypeOnInputChange(counts.images, counts.videos, counts.audios)).toBe(modelType)
  expect(util.getVideoModelTypeMismatchReason(modelType, counts.images, counts.videos > 0 || counts.audios > 0)).toBeUndefined()

  nodes[0].data.value = 'https://assets.example/reference.png'
  const readyInputs = util.getSourceMap(nodes, edges, 'target')
  expect(readyInputs.mediaByTypeCounts).toEqual(counts)
  expect(readyInputs.mediaInputs).toEqual([{ kind: 'image', edgeId: 'image', title: 'image', value: nodes[0].data.value }])
  expect(util.getSourceMap(nodes, [], 'target').mediaByTypeCounts).toEqual({ images: 0, videos: 0, audios: 0 })
})
