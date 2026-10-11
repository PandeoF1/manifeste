import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Undo2, Trash2 } from 'lucide-react'
import { redact, type Rect } from '@/lib/photo'

interface Props {
  /** Image already re-encoded (no metadata). */
  image: HTMLCanvasElement
  /** Called on every change with the blurred image. */
  onChange: (redacted: HTMLCanvasElement) => void
  onRemove?: () => void
}

/**
 * Blurring tool: draw rectangles with a finger or the mouse over faces,
 * number plates, tattoos... The blur is applied in the image that gets sent (irreversible).
 */
export function PhotoRedactor({ image, onChange, onRemove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rects, setRects] = useState<Rect[]>([])
  const [draft, setDraft] = useState<Rect | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  // The blur is only recomputed when an area is added or removed (not on every movement).
  const redacted = useMemo(() => redact(image, rects), [image, rects])
  useEffect(() => onChange(redacted), [redacted, onChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = redacted.width
    canvas.height = redacted.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(redacted, 0, 0)
    if (draft) {
      ctx.strokeStyle = '#ff453a'
      ctx.lineWidth = Math.max(2, redacted.width / 300)
      ctx.setLineDash([10, 6])
      ctx.strokeRect(draft.x, draft.y, draft.w, draft.h)
    }
  }, [redacted, draft])

  // The canvas is displayed as "object-contain": the image may be narrower than the element
  // (empty bands on the sides). Coordinates are therefore computed on the area actually drawn.
  function toImage(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget
    const box = canvas.getBoundingClientRect()
    const scale = Math.min(box.width / canvas.width, box.height / canvas.height)
    const left = box.left + (box.width - canvas.width * scale) / 2
    const top = box.top + (box.height - canvas.height * scale) / 2
    return {
      x: Math.min(canvas.width, Math.max(0, (e.clientX - left) / scale)),
      y: Math.min(canvas.height, Math.max(0, (e.clientY - top) / scale)),
    }
  }

  function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <strong>Floute chaque visage</strong> (et tout ce qui permet de reconnaître quelqu'un) en
        traçant un rectangle dessus. Le staff vérifiera aussi avant toute publication.
      </p>
      <canvas
        ref={canvasRef}
        aria-label="Photo à flouter : trace des rectangles sur les visages"
        className="max-h-[60vh] w-full touch-none rounded-lg border border-border object-contain"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          start.current = toImage(e)
        }}
        onPointerMove={(e) => {
          if (start.current) setDraft(normalize(start.current, toImage(e)))
        }}
        onPointerUp={(e) => {
          if (start.current) {
            const r = normalize(start.current, toImage(e))
            if (r.w > 8 && r.h > 8) setRects((prev) => [...prev, r])
          }
          start.current = null
          setDraft(null)
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={rects.length === 0}
          onClick={() => setRects((r) => r.slice(0, -1))}
        >
          <Undo2 size={16} /> Annuler le dernier flou
        </button>
        {onRemove && (
          <button type="button" className="btn-secondary" onClick={onRemove}>
            <Trash2 size={16} /> Retirer la photo
          </button>
        )}
        <span className="self-center text-sm text-muted">
          {rects.length} zone{rects.length > 1 ? 's' : ''} floutée{rects.length > 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}
