import { useEffect, useRef, useState } from 'react'

/** Anime un nombre de sa valeur précédente vers `target` (désactivé si mouvement réduit). */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    fromRef.current = target
    if (from === target) return
    const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = instant ? 1 : Math.min(1, (t - start) / durationMs)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])
  return value
}
