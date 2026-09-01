import { useRef, useState } from 'react'

export interface CropRect {
  x: number // 0-1, fraction of image width
  y: number // 0-1
  w: number // 0-1
  h: number // 0-1
}

const HANDLES: Array<{ key: string; cursor: string; xEdge: 'left' | 'right'; yEdge: 'top' | 'bottom' }> = [
  { key: 'nw', cursor: 'nwse-resize', xEdge: 'left', yEdge: 'top' },
  { key: 'ne', cursor: 'nesw-resize', xEdge: 'right', yEdge: 'top' },
  { key: 'sw', cursor: 'nesw-resize', xEdge: 'left', yEdge: 'bottom' },
  { key: 'se', cursor: 'nwse-resize', xEdge: 'right', yEdge: 'bottom' },
]

// Draggable/resizable crop rectangle over an image, matching the design's
// exact anatomy: a dark scrim outside the frame, a 3x3 rule-of-thirds grid
// inside it, and four square corner handles. Hand-built rather than a
// crop library, since the design's crop UI is simpler than what a general
// library ships (no rotation, no aspect presets) and pulling one in would
// add its own default chrome that wouldn't match "exact same UI."
export function CropOverlay({
  imageUrl,
  value,
  onChange,
}: {
  imageUrl: string
  value: CropRect
  onChange: (rect: CropRect) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragMode, setDragMode] = useState<'move' | string | null>(null)
  const dragStart = useRef<{ x: number; y: number; rect: CropRect } | null>(null)

  const handlePointerDown = (mode: 'move' | string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDragMode(mode)
    dragStart.current = { x: e.clientX, y: e.clientY, rect: value }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragMode || !dragStart.current) return
    const el = containerRef.current
    if (!el) return
    const bounds = el.getBoundingClientRect()
    const dx = (e.clientX - dragStart.current.x) / bounds.width
    const dy = (e.clientY - dragStart.current.y) / bounds.height
    const start = dragStart.current.rect

    if (dragMode === 'move') {
      const x = clamp(start.x + dx, 0, 1 - start.w)
      const y = clamp(start.y + dy, 0, 1 - start.h)
      onChange({ ...start, x, y })
      return
    }

    const handle = HANDLES.find((h) => h.key === dragMode)
    if (!handle) return
    let { x, y, w, h } = start
    if (handle.xEdge === 'left') {
      const newX = clamp(start.x + dx, 0, start.x + start.w - 0.08)
      w = start.w - (newX - start.x)
      x = newX
    } else {
      w = clamp(start.w + dx, 0.08, 1 - start.x)
    }
    if (handle.yEdge === 'top') {
      const newY = clamp(start.y + dy, 0, start.y + start.h - 0.08)
      h = start.h - (newY - start.y)
      y = newY
    } else {
      h = clamp(start.h + dy, 0.08, 1 - start.y)
    }
    onChange({ x, y, w, h })
  }

  const handlePointerUp = () => {
    setDragMode(null)
    dragStart.current = null
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="relative flex h-[320px] items-center justify-center overflow-hidden rounded-[10px] bg-[var(--bg-surface-sunken)]"
      style={{ touchAction: 'none' }}
    >
      <img src={imageUrl} alt="Uploaded photo" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/42" />
      <div
        onPointerDown={handlePointerDown('move')}
        className="absolute cursor-move rounded-[2px] border-2 border-[var(--color-brand)]"
        style={{
          left: `${value.x * 100}%`,
          top: `${value.y * 100}%`,
          width: `${value.w * 100}%`,
          height: `${value.h * 100}%`,
          boxShadow: '0 0 0 9999px rgba(0,0,0,.34)',
        }}
      >
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-35">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="border-white"
              style={{
                borderRightWidth: i % 3 !== 2 ? 1 : 0,
                borderBottomWidth: i < 6 ? 1 : 0,
                borderStyle: 'solid',
              }}
            />
          ))}
        </div>
        {HANDLES.map((handle) => (
          <div
            key={handle.key}
            onPointerDown={handlePointerDown(handle.key)}
            className="absolute h-3.5 w-3.5 rounded-[4px] bg-[var(--color-brand)]"
            style={{
              cursor: handle.cursor,
              left: handle.xEdge === 'left' ? -7 : undefined,
              right: handle.xEdge === 'right' ? -7 : undefined,
              top: handle.yEdge === 'top' ? -7 : undefined,
              bottom: handle.yEdge === 'bottom' ? -7 : undefined,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

export const DEFAULT_CROP_RECT: CropRect = { x: 0.24, y: 0.2, w: 0.52, h: 0.58 }

/** Crops an image File to the given fractional rect, returning a new File (JPEG). */
export async function cropImageToFile(file: File, rect: CropRect): Promise<File> {
  const imageUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(imageUrl)
    const sx = rect.x * img.naturalWidth
    const sy = rect.y * img.naturalHeight
    const sw = rect.w * img.naturalWidth
    const sh = rect.h * img.naturalHeight

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new Error('Crop failed')
    return new File([blob], file.name, { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
