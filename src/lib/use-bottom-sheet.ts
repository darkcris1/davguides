"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

export type SheetSnap = "peek" | "half" | "full"

const SNAP_ORDER: SheetSnap[] = ["peek", "half", "full"]
const EASE = "cubic-bezier(.32,.72,0,1)"
const DURATION_MS = 420
// A release faster than this, in px/ms, moves one snap in the flick's direction.
const FLICK_VELOCITY = 0.4
const RUBBER_BAND = 0.35
const DRAG_SLOP_PX = 6
const VELOCITY_WINDOW_MS = 100

interface Options {
  enabled: boolean
  /** Only the peek snap is offered when false. */
  expandable: boolean
  snap: SheetSnap
  onSnapChange: (snap: SheetSnap) => void
  sheetRef: React.RefObject<HTMLElement | null>
  handleRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLElement | null>
  scrollRef: React.RefObject<HTMLElement | null>
  headerRef: React.RefObject<HTMLElement | null>
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

// Phone bottom sheet that follows the finger and settles on a snap with momentum.
export function useBottomSheet({ enabled, expandable, snap, onSnapChange, sheetRef, handleRef, contentRef, scrollRef, headerRef }: Options) {
  const [visiblePx, setVisiblePx] = useState(0)
  const peekPxRef = useRef(0)
  const snapRef = useRef(snap)
  const currentPxRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const optionsRef = useRef({ expandable, onSnapChange })

  useLayoutEffect(() => {
    snapRef.current = snap
    optionsRef.current = { expandable, onSnapChange }
  })

  const sizes = useCallback(() => {
    const vh = window.innerHeight
    const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0
    const full = Math.max(Math.round(vh * 0.5), Math.round(vh - headerBottom - 8))
    const half = Math.min(full, Math.round(vh * 0.5))
    const peek = Math.min(Math.round(vh * 0.6), full, Math.max(96, peekPxRef.current))
    return { peek, half, full }
  }, [headerRef])

  const heightOf = useCallback((s: SheetSnap) => sizes()[s], [sizes])

  // Animates by translating a full-height sheet, then settles to a real height so the content can scroll.
  const animateTo = useCallback(
    (targetPx: number, fromPx: number) => {
      const sheet = sheetRef.current
      if (!sheet) return
      clearTimeout(settleTimerRef.current)
      const full = sizes().full
      const settle = () => {
        sheet.style.transition = "none"
        sheet.style.height = `${targetPx}px`
        sheet.style.transform = "translate3d(0,0,0)"
        currentPxRef.current = targetPx
        setVisiblePx(targetPx)
      }

      if (prefersReducedMotion() || Math.abs(targetPx - fromPx) < 1) return settle()

      sheet.style.transition = "none"
      sheet.style.height = `${full}px`
      sheet.style.transform = `translate3d(0,${full - fromPx}px,0)`
      // Force a style flush so the transition starts from the drag position.
      void sheet.offsetHeight
      sheet.style.transition = `transform ${DURATION_MS}ms ${EASE}`
      sheet.style.transform = `translate3d(0,${full - targetPx}px,0)`
      currentPxRef.current = targetPx
      settleTimerRef.current = setTimeout(settle, DURATION_MS + 30)
    },
    [sheetRef, sizes],
  )

  const measurePeek = useCallback(() => {
    const handle = handleRef.current?.offsetHeight ?? 0
    const content = contentRef.current?.offsetHeight ?? 0
    return handle + content + 28
  }, [handleRef, contentRef])

  // Applies the snap whenever it, the layout or the mode changes.
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    if (!enabled) {
      clearTimeout(settleTimerRef.current)
      sheet.style.removeProperty("height")
      sheet.style.removeProperty("transform")
      sheet.style.removeProperty("transition")
      return
    }
    // Measure before the first move, so phones don't see the sheet dip to a placeholder height.
    if (snap === "peek") peekPxRef.current = measurePeek()
    const from = currentPxRef.current || sheet.offsetHeight
    animateTo(heightOf(snap), from)
  }, [enabled, snap, animateTo, heightOf, measurePeek, sheetRef])

  // Peek fits the folded content, so it is measured only while folded.
  useEffect(() => {
    if (!enabled) return
    const measure = () => {
      if (snapRef.current !== "peek") return
      const next = measurePeek()
      if (Math.abs(next - peekPxRef.current) < 2) return
      peekPxRef.current = next
      animateTo(heightOf("peek"), currentPxRef.current)
    }
    const observer = new ResizeObserver(measure)
    if (handleRef.current) observer.observe(handleRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    const onResize = () => animateTo(heightOf(snapRef.current), currentPxRef.current)
    window.addEventListener("resize", onResize)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", onResize)
    }
  }, [enabled, animateTo, heightOf, measurePeek, handleRef, contentRef])

  // Touch drag, handing off to content scrolling when the content should scroll instead.
  useEffect(() => {
    const sheet = sheetRef.current
    if (!enabled || !sheet) return

    let startY = 0
    let startX = 0
    let startPx = 0
    let decided = false
    let dragging = false
    let fromContent = false
    let samples: { t: number; y: number }[] = []
    let frame = 0

    const offered = () => (optionsRef.current.expandable ? SNAP_ORDER : (["peek"] as SheetSnap[]))

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      startY = touch.clientY
      startX = touch.clientX
      startPx = currentPxRef.current
      decided = false
      dragging = false
      const target = event.target as HTMLElement
      fromContent = !!scrollRef.current?.contains(target)
      samples = [{ t: event.timeStamp, y: startY }]
    }

    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      const dy = touch.clientY - startY

      if (!decided) {
        const dx = touch.clientX - startX
        if (Math.abs(dy) < DRAG_SLOP_PX && Math.abs(dx) < DRAG_SLOP_PX) return
        decided = true
        if (Math.abs(dx) > Math.abs(dy)) return
        const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0
        const canGrow = optionsRef.current.expandable && snapRef.current !== "full"
        dragging = !fromContent || (dy > 0 && atTop) || (dy < 0 && canGrow)
        if (!dragging) return
        clearTimeout(settleTimerRef.current)
        const full = sizes().full
        sheet.style.transition = "none"
        sheet.style.height = `${full}px`
        sheet.style.transform = `translate3d(0,${full - startPx}px,0)`
      }
      if (!dragging) return

      event.preventDefault()
      samples.push({ t: event.timeStamp, y: touch.clientY })
      while (samples.length > 2 && event.timeStamp - samples[0].t > VELOCITY_WINDOW_MS) samples.shift()

      const s = sizes()
      const positions = offered().map((k) => s[k])
      const min = Math.min(...positions)
      const max = Math.max(...positions)
      let px = startPx - dy
      if (px > max) px = max + (px - max) * RUBBER_BAND
      if (px < min) px = min - (min - px) * RUBBER_BAND
      currentPxRef.current = px

      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        sheet.style.transform = `translate3d(0,${s.full - px}px,0)`
      })
    }

    const onEnd = (event: TouchEvent) => {
      if (!dragging) return
      dragging = false
      cancelAnimationFrame(frame)

      const first = samples[0]
      const elapsed = event.timeStamp - first.t
      const lastY = samples[samples.length - 1].y
      // Positive velocity means the sheet is moving up.
      const velocity = elapsed > 0 ? (first.y - lastY) / elapsed : 0

      const s = sizes()
      const choices = offered()
        .map((k) => ({ k, px: s[k] }))
        .sort((a, b) => a.px - b.px)
      const px = currentPxRef.current
      let target = choices.reduce((best, c) => (Math.abs(c.px - px) < Math.abs(best.px - px) ? c : best))
      if (Math.abs(velocity) > FLICK_VELOCITY) {
        const next = velocity > 0 ? choices.find((c) => c.px > px + 1) : [...choices].reverse().find((c) => c.px < px - 1)
        if (next) target = next
      }

      if (target.k === snapRef.current) animateTo(target.px, px)
      else optionsRef.current.onSnapChange(target.k)
    }

    sheet.addEventListener("touchstart", onStart, { passive: true })
    sheet.addEventListener("touchmove", onMove, { passive: false })
    sheet.addEventListener("touchend", onEnd)
    sheet.addEventListener("touchcancel", onEnd)
    return () => {
      cancelAnimationFrame(frame)
      sheet.removeEventListener("touchstart", onStart)
      sheet.removeEventListener("touchmove", onMove)
      sheet.removeEventListener("touchend", onEnd)
      sheet.removeEventListener("touchcancel", onEnd)
    }
  }, [enabled, sheetRef, scrollRef, sizes, animateTo])

  // Visible height for map padding; fits read the target snap so they don't wait for the animation.
  const readVisible = useCallback(() => (enabled ? heightOf(snapRef.current) : 0), [enabled, heightOf])

  return { visiblePx: enabled ? visiblePx : 0, readVisible }
}
