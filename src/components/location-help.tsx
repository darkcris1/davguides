"use client"

import { useSyncExternalStore } from "react"
import { ChevronDown } from "lucide-react"

type Platform = "ios" | "android" | "windows" | "macos" | "other"

const GUIDES: { id: Exclude<Platform, "other">; label: string; steps: string[] }[] = [
  {
    id: "android",
    label: "Android",
    steps: [
      "Swipe down from the top and turn Location on.",
      "Open Settings › Location › Location services › Google Location Accuracy, and turn it on.",
      "In Chrome, tap the icon left of the address › Permissions › Location › Allow.",
      "If Android asks, pick “Precise”, not “Approximate”.",
    ],
  },
  {
    id: "ios",
    label: "iPhone or iPad",
    steps: [
      "Open Settings › Privacy & Security › Location Services, and turn it on.",
      "Scroll to Safari Websites (or Chrome) and pick “While Using the App”.",
      "On that same screen, turn on Precise Location.",
      "Back here, tap “aA” in the address bar › Website Settings › Location › Allow.",
    ],
  },
  {
    id: "windows",
    label: "Windows",
    steps: [
      "Open Settings › Privacy & security › Location, and turn Location services on.",
      "Turn on “Let desktop apps access your location”.",
      "Click the icon left of the address bar › Location › Allow, then reload.",
      "Turn Wi-Fi on: laptops find their place from nearby networks.",
    ],
  },
  {
    id: "macos",
    label: "Mac",
    steps: [
      "Open System Settings › Privacy & Security › Location Services, and turn it on.",
      "Turn it on for your browser (Safari, Chrome, Firefox…) in that list.",
      "Allow location for this site in the browser, then reload.",
      "Turn Wi-Fi on: Macs find their place from nearby networks.",
    ],
  },
]

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios"
  if (/Android/.test(ua)) return "android"
  if (/Windows/.test(ua)) return "windows"
  if (/Macintosh|Mac OS X/.test(ua)) return "macos"
  return "other"
}

const noSubscribe = () => () => {}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  )
}

// Step-by-step help for turning on precise location, with the rider's own device first.
export default function LocationHelp({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const platform = useSyncExternalStore(noSubscribe, detectPlatform, () => "other" as Platform)
  const mine = GUIDES.find((g) => g.id === platform)
  const others = GUIDES.filter((g) => g !== mine)

  return (
    <details open={defaultOpen} className="group rounded-xl bg-slate-50 px-3 py-1 text-left">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--dg-navy)] [&::-webkit-details-marker]:hidden">
        How to get an accurate location
        <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 pb-3">
        {mine && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-600">On your {mine.label}</p>
            <Steps steps={mine.steps} />
          </div>
        )}
        {others.map((guide) => (
          <details key={guide.id} className="rounded-lg bg-white px-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm text-slate-800">{guide.label}</summary>
            <div className="pb-3">
              <Steps steps={guide.steps} />
            </div>
          </details>
        ))}
        <p className="text-xs text-slate-600">Outdoors or near a window works best. You can also long-press the map, or drag the blue dot, to set your start by hand.</p>
      </div>
    </details>
  )
}
