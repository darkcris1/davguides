"use client"

import { useSyncExternalStore } from "react"
import { isInstalledApp } from "./offline"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

// "prompt": the browser can show its install dialog. "ios": Safari needs Share > Add to Home Screen.
export type InstallMode = "none" | "prompt" | "ios"

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

// Listen at import time: Chrome can fire beforeinstallprompt before the first effect runs.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Our button is phone-only, so wider screens keep the browser's own install bar.
    if (window.matchMedia("(max-width: 767px)").matches) event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    installed = true
    notify()
  })
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

// iPadOS reports itself as a Mac, so touch support tells them apart.
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

const readMode = (): InstallMode => {
  if (installed || isInstalledApp()) return "none"
  if (deferred) return "prompt"
  return isIOS() ? "ios" : "none"
}

export function useInstallPrompt() {
  const mode = useSyncExternalStore(subscribe, readMode, () => "none" as const)

  const install = async () => {
    if (!deferred) return
    const event = deferred
    // The browser allows each prompt event to be used only once.
    deferred = null
    notify()
    try {
      await event.prompt()
      await event.userChoice
    } catch {
      // A rejected prompt just hides the button until the browser offers a new event.
    }
  }

  return { mode, install }
}
