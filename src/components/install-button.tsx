"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Download, Share, SquarePlus, X } from "lucide-react"
import { useInstallPrompt } from "@/lib/use-install-prompt"
import { cn } from "@/lib/utils"

const HINT_KEY = "davguides.installHint"
const HINT_DELAY_MS = 1500
const HINT_SHOW_MS = 12_000

// Phone-only Install control; iOS has no install API, so it shows the Share sheet steps instead.
export default function InstallButton({ className }: { className: string }) {
  const { mode, install } = useInstallPrompt()
  const [showSteps, setShowSteps] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const closeSteps = useCallback(() => setShowSteps(false), [])
  const hintId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)

  // First visit only: the hint is marked seen as soon as it appears.
  useEffect(() => {
    // The button is md:hidden, so don't spend the one-time hint where it can't be seen.
    if (mode === "none" || !window.matchMedia("(max-width: 767px)").matches) return
    let seen = true
    try {
      seen = window.localStorage.getItem(HINT_KEY) != null
    } catch {}
    if (seen) return
    const show = setTimeout(() => {
      setShowHint(true)
      try {
        window.localStorage.setItem(HINT_KEY, "1")
      } catch {}
    }, HINT_DELAY_MS)
    const hide = setTimeout(() => setShowHint(false), HINT_DELAY_MS + HINT_SHOW_MS)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
      setShowHint(false)
    }
  }, [mode])

  if (mode === "none") return null

  const open = () => {
    // Focus the button first so the iOS dialog returns focus there, not to the unmounted hint.
    buttonRef.current?.focus()
    setShowHint(false)
    if (mode === "prompt") install()
    else setShowSteps(true)
  }

  return (
    <div className="relative md:hidden">
      {showHint && <span className="absolute inset-0 rounded-full bg-[var(--dg-yellow)] motion-safe:animate-ping" aria-hidden />}
      <button
        ref={buttonRef}
        type="button"
        aria-label="Install app"
        aria-describedby={showHint ? hintId : undefined}
        title="Install app"
        onClick={open}
        className={cn(className, "relative bg-[var(--dg-yellow)] text-[var(--dg-navy)] ring-[var(--dg-navy)]/15 hover:bg-[var(--dg-yellow)]/90")}
      >
        <Download className="size-5" strokeWidth={2.5} aria-hidden />
      </button>
      {showHint && (
        <div
          role="note"
          className="absolute right-[calc(100%+10px)] top-1/2 flex w-56 -translate-y-1/2 items-center gap-1 rounded-2xl bg-[var(--dg-navy)] py-2 pl-3 pr-1 text-sm text-white shadow-lg"
        >
          <span className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rotate-45 bg-[var(--dg-navy)]" aria-hidden />
          <button id={hintId} type="button" onClick={open} className="relative min-h-11 flex-1 text-left leading-snug">
            <strong className="font-semibold">Install DavGuides</strong> for one-tap access from your home screen.
          </button>
          <button
            type="button"
            aria-label="Dismiss install tip"
            onClick={() => setShowHint(false)}
            className="relative flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dg-yellow)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      {/* Portaled so the map controls' z-10 stacking context can't put it under the sheet. */}
      {showSteps && createPortal(<IosSteps onClose={closeSteps} />, document.body)}
    </div>
  )
}

function IosSteps({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      opener?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"
      >
        <h2 id={titleId} className="font-signboard text-2xl font-bold uppercase tracking-wide text-[var(--dg-ink)]">
          Install DavGuides
        </h2>
        <ol className="mt-3 space-y-3 text-sm text-slate-700">
          <li className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--dg-navy)]/10 text-[var(--dg-navy)]">
              <Share className="size-4" aria-hidden />
            </span>
            <span>
              Tap <strong>Share</strong> in the browser bar.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--dg-navy)]/10 text-[var(--dg-navy)]">
              <SquarePlus className="size-4" aria-hidden />
            </span>
            <span>
              Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
            </span>
          </li>
        </ol>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-5 min-h-11 w-full rounded-full bg-[var(--dg-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--dg-navy)]/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-yellow)]"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
