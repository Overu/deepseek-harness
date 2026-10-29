/** Decorative, motion-aware background used only by the Insight sign-in page. */
import { useEffect, useRef } from 'react'
import css from './login.module.css'

const DOT_SIZE = 2
const CELL_SIZE = 24
const PROXIMITY = 150
const HOVER_DISPLACEMENT_RADIUS = 190
const RETURN_DURATION = 1.3

const BASE_COLOR = { r: 36, g: 50, b: 81 }
const FALLOFF_COLOR = { r: 101, g: 88, b: 217 }
const ACTIVE_COLOR = { r: 49, g: 93, b: 251 }

interface Dot {
  x: number
  y: number
  offsetX: number
  offsetY: number
  velocityX: number
  velocityY: number
  influence: number
}

interface PointerState {
  x: number
  y: number
  active: boolean
}

function mix(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount)
}

function dotColor(influence: number): string {
  if (influence <= 0) return `rgb(${BASE_COLOR.r} ${BASE_COLOR.g} ${BASE_COLOR.b})`
  const outerRange = 0.48
  if (influence < outerRange) {
    const amount = influence / outerRange
    return `rgb(${mix(BASE_COLOR.r, FALLOFF_COLOR.r, amount)} ${mix(BASE_COLOR.g, FALLOFF_COLOR.g, amount)} ${mix(BASE_COLOR.b, FALLOFF_COLOR.b, amount)})`
  }
  const amount = (influence - outerRange) / (1 - outerRange)
  return `rgb(${mix(FALLOFF_COLOR.r, ACTIVE_COLOR.r, amount)} ${mix(FALLOFF_COLOR.g, ACTIVE_COLOR.g, amount)} ${mix(FALLOFF_COLOR.b, ACTIVE_COLOR.b, amount)})`
}

/**
 * Draw the existing Insight pointer-reactive dot field without a second UI runtime.
 * @returns A decorative canvas that releases all listeners and animation work on unmount.
 */
export function LoginDotGrid() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (wrapper === null || canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    let dots: Dot[] = []
    let frame: number | undefined
    let lastFrameTime = 0
    let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pointer: PointerState = { x: 0, y: 0, active: false }

    const draw = (time: number): void => {
      frame = undefined
      const elapsed = lastFrameTime === 0 ? 1 / 60 : Math.min((time - lastFrameTime) / 1000, 0.05)
      lastFrameTime = time
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      context.clearRect(0, 0, width, height)
      let unsettled = false
      const riseAmount = 1 - Math.exp(-elapsed / 0.08)
      const fallAmount = 1 - Math.exp(-elapsed / (RETURN_DURATION / 3))

      for (const dot of dots) {
        const deltaX = dot.x - pointer.x
        const deltaY = dot.y - pointer.y
        const distance = pointer.active ? Math.hypot(deltaX, deltaY) : Infinity
        const targetInfluence = distance < PROXIMITY ? Math.pow(1 - distance / PROXIMITY, 1.35) : 0
        const transition = targetInfluence > dot.influence ? riseAmount : fallAmount
        dot.influence += (targetInfluence - dot.influence) * transition

        const displacementFalloff = distance < HOVER_DISPLACEMENT_RADIUS ? Math.pow(1 - distance / HOVER_DISPLACEMENT_RADIUS, 1.8) : 0
        const displacement = 12 * displacementFalloff
        const targetOffsetX = distance > 0 && Number.isFinite(distance) ? (deltaX / distance) * displacement : 0
        const targetOffsetY = distance > 0 && Number.isFinite(distance) ? (deltaY / distance) * displacement : 0
        const motionTargetX = reducedMotion ? 0 : targetOffsetX
        const motionTargetY = reducedMotion ? 0 : targetOffsetY
        if (reducedMotion) {
          dot.offsetX = 0
          dot.offsetY = 0
          dot.velocityX = 0
          dot.velocityY = 0
        } else {
          dot.velocityX += (48 * (motionTargetX - dot.offsetX) - 12 * dot.velocityX) * elapsed
          dot.velocityY += (48 * (motionTargetY - dot.offsetY) - 12 * dot.velocityY) * elapsed
          dot.offsetX += dot.velocityX * elapsed
          dot.offsetY += dot.velocityY * elapsed
        }
        if (Math.abs(targetInfluence - dot.influence) > 0.003
          || Math.abs(motionTargetX - dot.offsetX) > 0.03
          || Math.abs(motionTargetY - dot.offsetY) > 0.03
          || Math.abs(dot.velocityX) > 0.03 || Math.abs(dot.velocityY) > 0.03) unsettled = true
        if (dot.influence > 0.55) {
          context.beginPath()
          context.fillStyle = `rgb(${ACTIVE_COLOR.r} ${ACTIVE_COLOR.g} ${ACTIVE_COLOR.b} / ${String(dot.influence * 0.14)})`
          context.arc(dot.x + dot.offsetX, dot.y + dot.offsetY, 4.5, 0, Math.PI * 2)
          context.fill()
        }
        context.beginPath()
        context.fillStyle = dotColor(dot.influence)
        context.arc(dot.x + dot.offsetX, dot.y + dot.offsetY, (DOT_SIZE / 2) * (1 + dot.influence * 1.15), 0, Math.PI * 2)
        context.fill()
      }
      if (unsettled && !document.hidden) frame = window.requestAnimationFrame(draw)
      else lastFrameTime = 0
    }

    const startDrawing = (): void => {
      if (frame === undefined && !document.hidden) frame = window.requestAnimationFrame(draw)
    }
    const buildGrid = (): void => {
      const { width, height } = wrapper.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(width * pixelRatio))
      canvas.height = Math.max(1, Math.round(height * pixelRatio))
      canvas.style.width = `${String(width)}px`
      canvas.style.height = `${String(height)}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      const columns = Math.ceil(width / CELL_SIZE) + 1
      const rows = Math.ceil(height / CELL_SIZE) + 1
      const startX = (width - (columns - 1) * CELL_SIZE) / 2
      const startY = (height - (rows - 1) * CELL_SIZE) / 2
      dots = []
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          dots.push({ x: startX + column * CELL_SIZE, y: startY + row * CELL_SIZE,
            offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0, influence: 0 })
        }
      }
      startDrawing()
    }
    const updatePointer = (event: PointerEvent): void => {
      const bounds = canvas.getBoundingClientRect()
      pointer.x = event.clientX - bounds.left
      pointer.y = event.clientY - bounds.top
      pointer.active = pointer.x >= 0 && pointer.x <= bounds.width && pointer.y >= 0 && pointer.y <= bounds.height
      startDrawing()
    }
    const releasePointer = (event: PointerEvent): void => {
      if (event.relatedTarget !== null) return
      pointer.active = false
      startDrawing()
    }
    const handleVisibility = (): void => {
      if (document.hidden) {
        if (frame !== undefined) window.cancelAnimationFrame(frame)
        frame = undefined
        lastFrameTime = 0
      } else startDrawing()
    }
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotionPreference = (): void => {
      reducedMotion = motionQuery.matches
      startDrawing()
    }
    const resizeObserver = new ResizeObserver(buildGrid)
    resizeObserver.observe(wrapper)
    window.addEventListener('pointermove', updatePointer, { passive: true })
    window.addEventListener('pointerout', releasePointer, { passive: true })
    document.addEventListener('visibilitychange', handleVisibility)
    motionQuery.addEventListener('change', updateMotionPreference)
    buildGrid()
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('pointermove', updatePointer)
      window.removeEventListener('pointerout', releasePointer)
      document.removeEventListener('visibilitychange', handleVisibility)
      motionQuery.removeEventListener('change', updateMotionPreference)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [])

  return <div ref={wrapperRef} className={css.dotGrid} aria-hidden="true"><canvas ref={canvasRef} /></div>
}
