"use client"

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Download, MapPinned, Share, SquarePlus, WifiOff, Zap } from "lucide-react"
import { useInstallPrompt } from "@/lib/use-install-prompt"
import { cn } from "@/lib/utils"

const HINT_KEY = "davguides.installHint"
const HINT_DELAY_MS = 1500

// Phone-only Install control; iOS has no install API, so it shows the Share sheet steps instead.
export default function InstallButton({ className }: { className: string }) {
  const { mode, install } = useInstallPrompt()
  const [showSteps, setShowSteps] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const closeSteps = useCallback(() => setShowSteps(false), [])
  const closeWelcome = useCallback(() => setShowWelcome(false), [])
  const buttonRef = useRef<HTMLButtonElement>(null)

  // First visit only: the welcome modal is marked seen as soon as it appears.
  useEffect(() => {
    // The button is md:hidden, so don't spend the one-time welcome where it can't be found again.
    if (mode === "none" || !window.matchMedia("(max-width: 767px)").matches) return
    let seen = true
    try {
      seen = window.localStorage.getItem(HINT_KEY) != null
    } catch {}
    if (seen) return
    const show = setTimeout(() => {
      // Don't steal focus mid-typing; it stays unseen and shows next visit.
      if (document.activeElement instanceof HTMLInputElement) return
      setShowWelcome(true)
      try {
        window.localStorage.setItem(HINT_KEY, "1")
      } catch {}
    }, HINT_DELAY_MS)
    return () => clearTimeout(show)
  }, [mode])

  if (mode === "none") return null

  const open = () => {
    // Focus the button first so the iOS dialog returns focus there, not to what the welcome modal replaced.
    buttonRef.current?.focus()
    setShowWelcome(false)
    if (mode === "prompt") install()
    else setShowSteps(true)
  }

  return (
    <div className="relative md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Install app"
        title="Install app"
        onClick={open}
        className={cn(className, "relative bg-[var(--dg-yellow)] text-[var(--dg-navy)] ring-[var(--dg-navy)]/15 hover:bg-[var(--dg-yellow)]/90")}
      >
        <Download className="size-5" strokeWidth={2.5} aria-hidden />
      </button>
      {/* Portaled so the map controls' z-10 stacking context can't put it under the sheet. */}
      {showSteps && createPortal(<IosSteps onClose={closeSteps} />, document.body)}
      {showWelcome && createPortal(<Welcome mode={mode} onInstall={open} onClose={closeWelcome} />, document.body)}
    </div>
  )
}

// Bottom-anchored modal; focuses `focusRef` on open and hands focus back to the opener on close.
function Modal({
  onClose,
  focusRef,
  title,
  children,
}: {
  onClose: () => void
  focusRef: RefObject<HTMLButtonElement | null>
  title: string
  children: ReactNode
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    focusRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      // Leave focus alone if the close already moved it somewhere else.
      const active = document.activeElement
      if (!active || active === document.body || dialog?.contains(active)) opener?.focus()
    }
  }, [onClose, focusRef])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"
      >
        <h2 id={titleId} className="font-signboard text-2xl font-bold uppercase tracking-wide text-[var(--dg-ink)]">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

const PERKS = [
  { icon: WifiOff, text: "Plan jeepney trips with no signal or mobile data" },
  { icon: MapPinned, text: "Search 120+ Davao landmarks offline" },
  { icon: Zap, text: "Opens in one tap from your home screen" },
]

function Welcome({ mode, onInstall, onClose }: { mode: "prompt" | "ios"; onInstall: () => void; onClose: () => void }) {
  const installRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal onClose={onClose} focusRef={installRef} title="Use DavGuides offline">
      <p className="mt-1 text-sm text-slate-600">Install it once and find your jeepney even when you run out of load. Free, no app store.</p>
      <ul className="mt-4 space-y-3 text-sm text-slate-700">
        {PERKS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--dg-yellow)] text-[var(--dg-navy)]">
              <Icon className="size-4" aria-hidden />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 flex-1 rounded-full px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-yellow)]"
        >
          Not now
        </button>
        <button
          ref={installRef}
          type="button"
          onClick={onInstall}
          className="flex min-h-11 flex-[2] items-center justify-center gap-2 rounded-full bg-[var(--dg-navy)] px-4 text-sm font-semibold text-white hover:bg-[var(--dg-navy)]/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-yellow)]"
        >
          <Download className="size-4" aria-hidden />
          {mode === "ios" ? "Show me how" : "Install for offline"}
        </button>
      </div>
    </Modal>
  )
}

function IosSteps({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal onClose={onClose} focusRef={closeRef} title="Install DavGuides">
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
    </Modal>
  )
}
