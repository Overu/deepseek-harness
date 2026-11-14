/** Pointer-lit halftone artwork behind the skill search. */
import { useEffect, useRef } from 'react'
import handsSource from './assets/hands-source.webp'
import styles from './SkillCenterPage.module.css'

type Color = readonly [number, number, number]
type TrailPoint = { readonly x: number; readonly y: number; readonly at: number }

/** @returns the decorative canvas for the two hands in the skill center hero. */
export function SkillHeroHands() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return
    const image = new Image()
    let stop: (() => void) | undefined
    image.onload = () => { stop = animateHands(canvas, image) }
    image.src = handsSource
    return () => {
      image.onload = null
      stop?.()
    }
  }, [])
  return <canvas ref={ref} className={styles.heroHands} aria-hidden="true" />
}

/** Run the reference animation for one mounted hero. */
function animateHands(canvas: HTMLCanvasElement, image: HTMLImageElement): (() => void) | undefined {
  const hero = canvas.parentElement
  const context = canvas.getContext('2d')
  const field = document.createElement('canvas')
  const sampler = field.getContext('2d', { willReadFrequently: true })
  if (hero === null || context === null || sampler === null) return
  const tiles = [0, .53].map((left) => {
    const tile = document.createElement('canvas')
    tile.width = 420
    tile.height = Math.round(420 * .4 * image.height / (.47 * image.width))
    const brush = tile.getContext('2d')
    if (brush !== null) {
      brush.imageSmoothingQuality = 'high'
      brush.drawImage(image, left * image.width, .06 * image.height, .47 * image.width, .4 * image.height,
        0, 0, tile.width, tile.height)
    }
    return tile
  })
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = { x: -1000, y: -1000, active: false, strength: 0 }
  let trail: TrailPoint[] = []
  let width = 0
  let height = 0
  let step = 0
  let rowStep = 0
  let frame = 0
  let lastFrame = 0
  let time = 0
  let visible = true
  const start = performance.now()
  const readColors = (): readonly [Color, Color] => {
    const computed = getComputedStyle(canvas)
    sampler.resetTransform()
    return [
      rgbColor(sampler, computed.getPropertyValue('--dsw-alias-label-tertiary')),
      rgbColor(sampler, computed.getPropertyValue('--dsw-alias-state-business-primary')),
    ]
  }
  let [neutral, blue] = readColors()

  const draw = (): void => {
    if (width === 0 || height === 0) return
    const now = performance.now()
    trail = trail.filter(point => now - point.at < 1400)
    const strength = pointer.active ? 1 : 0
    pointer.strength = motion.matches ? strength : pointer.strength + (strength - pointer.strength) * .22

    const columns = field.width
    const rows = field.height
    sampler.resetTransform()
    sampler.fillStyle = 'white'
    sampler.fillRect(0, 0, columns, rows)
    sampler.setTransform(columns / width, 0, 0, rows / height, 0, 0)
    const handWidth = width * .49
    const handHeight = Math.min(height * .86, handWidth * .4 * image.height / (.47 * image.width))
    const centerY = height * .57
    // Sample luminance after the drift so the dot grid stays fixed on screen.
    for (const [side, tile] of tiles.entries()) {
      const phase = time * Math.PI / 12 + side * Math.PI
      const drift = Math.sin(phase) * width * .009
      const anchor = side === 0 ? 0 : width
      const x = side === 0 ? -width * .015 + drift : width - handWidth + width * .015 - drift
      sampler.save()
      sampler.translate(anchor, centerY)
      sampler.rotate(Math.sin(phase + .9) * .018 * (side === 0 ? 1 : -1))
      sampler.translate(-anchor, -centerY)
      sampler.drawImage(tile, x, centerY - handHeight / 2, handWidth, handHeight)
      sampler.restore()
    }

    const pixels = sampler.getImageData(0, 0, columns, rows).data
    context.clearRect(0, 0, width, height)
    for (let row = 0; row < rows; row++) {
      const y = (row + .5) * rowStep
      const vertical = smooth(.02, .16, y / height) * (1 - smooth(.90, 1, y / height))
      for (let column = 0; column < columns; column++) {
        const x = (column + .5) * step
        const luminance = pixels[(row * columns + column) * 4] ?? 255
        const value = clamp((1 - luminance / 255 - .04) / .88)
          * smooth(.035, .13, Math.abs(x / width - .5)) * vertical
          * (.92 + .08 * Math.sin(time * .65 + noise(column, row) * 10))
        if (value < .12) continue
        let light = glow(x, y, pointer) * pointer.strength
        if (!motion.matches) {
          for (const point of trail) {
            light = Math.max(light, glow(x, y, point) * (1 - smooth(280, 1400, now - point.at)))
          }
        }
        const mix = (index: 0 | 1 | 2): number => Math.round(neutral[index] + (blue[index] - neutral[index]) * light)
        context.fillStyle = `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`
        context.globalAlpha = (.62 + .28 * light) * (.62 + .38 * value)
        context.beginPath()
        context.arc(x, y, step * .42 * Math.pow(value, .65), 0, Math.PI * 2)
        context.fill()
      }
    }
    context.globalAlpha = 1
  }
  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect()
    width = bounds.width
    height = bounds.height
    const scale = Math.min(2, devicePixelRatio)
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    context.setTransform(scale, 0, 0, scale, 0, 0)
    step = Math.max(4.2, width / 230)
    rowStep = step * 1.22
    field.width = Math.ceil(width / step)
    field.height = Math.ceil(height / rowStep)
    draw()
  }
  const tick = (now: number): void => {
    if (now - lastFrame > 42) {
      time = (now - start) / 1000
      draw()
      lastFrame = now
    }
    frame = requestAnimationFrame(tick)
  }
  const syncMotion = (): void => {
    cancelAnimationFrame(frame)
    if (motion.matches) {
      time = 0
      trail = []
      draw()
    } else if (visible) frame = requestAnimationFrame(tick)
  }
  const remember = (): void => {
    if (motion.matches) return
    if (trail.length === 48) trail.shift()
    trail.push({ x: pointer.x, y: pointer.y, at: performance.now() })
  }
  const move = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return
    const bounds = canvas.getBoundingClientRect()
    pointer.x = event.clientX - bounds.left
    pointer.y = event.clientY - bounds.top
    pointer.active = true
    remember()
    if (motion.matches) draw()
  }
  const leave = (): void => {
    if (!pointer.active) return
    remember()
    pointer.active = false
    if (motion.matches) draw()
  }
  const resized = new ResizeObserver(resize)
  const visibility = new IntersectionObserver(([entry]) => {
    if (entry === undefined || entry.isIntersecting === visible) return
    visible = entry.isIntersecting
    syncMotion()
  })
  const theme = new MutationObserver(() => {
    [neutral, blue] = readColors()
    draw()
  })
  resized.observe(canvas)
  visibility.observe(canvas)
  theme.observe(document.body, { attributeFilter: ['data-ds-dark-theme'] })
  motion.addEventListener('change', syncMotion)
  hero.addEventListener('pointermove', move, { passive: true })
  hero.addEventListener('pointerleave', leave)
  resize()
  syncMotion()
  return () => {
    cancelAnimationFrame(frame)
    resized.disconnect()
    visibility.disconnect()
    theme.disconnect()
    motion.removeEventListener('change', syncMotion)
    hero.removeEventListener('pointermove', move)
    hero.removeEventListener('pointerleave', leave)
  }
}

/** Resolve the same CSS color syntax as the browser before interpolating the dot palette. */
function rgbColor(brush: CanvasRenderingContext2D, color: string): Color {
  brush.clearRect(0, 0, 1, 1)
  brush.fillStyle = color.trim()
  brush.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0] = brush.getImageData(0, 0, 1, 1).data
  return [red, green, blue]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smooth(start: number, end: number, value: number): number {
  const fraction = clamp((value - start) / (end - start))
  return fraction * fraction * (3 - 2 * fraction)
}

function noise(column: number, row: number): number {
  const wave = Math.sin(column * 127.1 + row * 311.7) * 43758.5453
  return wave - Math.floor(wave)
}

function glow(x: number, y: number, point: { readonly x: number; readonly y: number }): number {
  return 1 - smooth(12, 100, Math.hypot(x - point.x, y - point.y))
}
