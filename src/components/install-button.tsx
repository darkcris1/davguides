"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Download, Share, SquarePlus } from "lucide-react"
import { useInstallPrompt } from "@/lib/use-install-prompt"

// Phone-only Install control; iOS has no install API, so it shows the Share sheet steps instead.
export default function InstallButton({ className }: { className: string }) {
  const { mode, install } = useInstallPrompt()
  const [showSteps, setShowSteps] = useState(false)
  const closeSteps = useCallback(() => setShowSteps(false), [])

  if (mode === "none") return null

  return (
    <>
      <button
        type="button"
        aria-label="Install app"
        title="Install app"
        onClick={() => (mode === "prompt" ? install() : setShowSteps(true))}
        className={`${className} md:hidden`}
      >
        <Download className="size-5" aria-hidden />
      </button>
      {/* Portaled so the map controls' z-10 stacking context can't put it under the sheet. */}
      {showSteps && createPortal(<IosSteps onClose={closeSteps} />, document.body)}
    </>
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
