import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { debounce } from '@/lib/debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('regroupe une rafale en un seul appel, avec le dernier argument', () => {
    const fn = vi.fn()
    const d = debounce(fn, 3000)
    d('a')
    vi.advanceTimersByTime(2000)
    d('b')
    vi.advanceTimersByTime(2999)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('cancel annule l’appel en attente', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d()
    d.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })
})
