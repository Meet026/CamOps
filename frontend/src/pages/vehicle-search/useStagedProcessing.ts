import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProcessingStage } from './demoInvestigation'

export type StageState = 'pending' | 'active' | 'done'

/**
 * Drives the staged "processing" sequence: advances through stages on a
 * timer so the operator watches the pipeline work rather than getting an
 * instant answer.
 *
 * Every timeout is tracked and cleared on unmount, so navigating away
 * mid-run cannot fire a setState on an unmounted component or leave a
 * stray timer running.
 */
export function useStagedProcessing() {
  const [stages, setStages] = useState<ProcessingStage[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isRunning, setIsRunning] = useState(false)
  const timers = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  /** Runs the sequence, resolving once the final stage completes. */
  const run = useCallback(
    (nextStages: ProcessingStage[]) =>
      new Promise<void>((resolve) => {
        clearTimers()
        setStages(nextStages)
        setCurrentIndex(0)
        setIsRunning(true)

        let elapsed = 0
        nextStages.forEach((stage, i) => {
          elapsed += stage.durationMs
          const isLast = i === nextStages.length - 1
          const timer = window.setTimeout(() => {
            if (isLast) {
              // Mark every stage done, then finish.
              setCurrentIndex(nextStages.length)
              setIsRunning(false)
              resolve()
            } else {
              setCurrentIndex(i + 1)
            }
          }, elapsed)
          timers.current.push(timer)
        })

        // An empty stage list would otherwise never resolve.
        if (nextStages.length === 0) {
          setIsRunning(false)
          resolve()
        }
      }),
    [clearTimers],
  )

  const reset = useCallback(() => {
    clearTimers()
    setStages([])
    setCurrentIndex(-1)
    setIsRunning(false)
  }, [clearTimers])

  const stateFor = useCallback(
    (index: number): StageState => {
      if (index < currentIndex) return 'done'
      if (index === currentIndex) return 'active'
      return 'pending'
    },
    [currentIndex],
  )

  return { stages, isRunning, run, reset, stateFor }
}
