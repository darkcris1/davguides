"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Clock, Loader2, MapPin, MapPinPlus, Search, X } from "lucide-react"
import { findDavaoPlaces, mergePlaces } from "@/lib/davao-places"
import { searchPlaces, type PlaceResult } from "@/lib/nominatim"
import { suggestPlaces } from "@/lib/photon"
import type { Location } from "@/commons/models/maps"
import { cn, shortPlaceName } from "@/lib/utils"

interface SearchBoxProps {
  /** Current destination, so pins dropped on the map show their name here. */
  value: Location | null
  onSelect: (location: Location | null) => void
  recent: Location[]
  /** Puts a draggable pin in the middle of the map for places search can't find. */
  onDropPin: () => void
}

interface Option {
  key: string
  place: Location
  title: string
  detail: string
  recent: boolean
}

const toOption = (place: PlaceResult): Option => ({
  key: place.id,
  place: { lat: place.lat, lng: place.lng, name: place.name },
  title: shortPlaceName(place.name),
  detail: place.detail,
  recent: false,
})

const recentOption = (place: Location, i: number): Option => ({
  key: `recent-${i}`,
  place,
  title: shortPlaceName(place.name),
  detail: place.name.split(",").slice(1).join(",").trim(),
  recent: true,
})

// Suggest after a typing pause, and only once the query says something; saved places need less.
const SUGGEST_DELAY_MS = 300
const SUGGEST_MIN_CHARS = 3
const LOCAL_MIN_CHARS = 2
const PIN_TIP_MS = 8000

type Status = { kind: "idle" } | { kind: "searching" } | { kind: "results"; count: number } | { kind: "empty"; query: string } | { kind: "error"; message: string } | { kind: "pin" }

export default function SearchBox({ value, onSelect, recent, onDropPin }: SearchBoxProps) {
  const [query, setQuery] = useState(value ? shortPlaceName(value.name) : "")
  const [syncedValue, setSyncedValue] = useState(value)
  const [results, setResults] = useState<PlaceResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const abortRef = useRef<AbortController | null>(null)
  const suggestRef = useRef<{ timer: ReturnType<typeof setTimeout>; controller: AbortController } | null>(null)
  const wrapperRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  // Follow outside changes, such as a pin dropped or dragged on the map.
  if (syncedValue !== value) {
    setSyncedValue(value)
    // A late name for the same spot only fills the box if the rider hasn't started typing.
    const renamedOnly = value && syncedValue && value.lat === syncedValue.lat && value.lng === syncedValue.lng
    const untouched = query === (syncedValue ? shortPlaceName(syncedValue.name) : "")
    if (!renamedOnly || untouched) setQuery(value ? shortPlaceName(value.name) : "")
  }

  const options: Option[] = results.length > 0 ? results.map(toOption) : query === "" ? recent.map(recentOption) : []

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    return () => {
      document.removeEventListener("pointerdown", close)
      abortRef.current?.abort()
      cancelSuggest()
    }
  }, [])

  // The drag tip only needs to be read once.
  useEffect(() => {
    if (status.kind !== "pin") return
    const timer = setTimeout(() => setStatus({ kind: "idle" }), PIN_TIP_MS)
    return () => clearTimeout(timer)
  }, [status])

  function cancelSuggest() {
    if (!suggestRef.current) return
    clearTimeout(suggestRef.current.timer)
    suggestRef.current.controller.abort()
    suggestRef.current = null
  }

  const scheduleSuggest = (text: string) => {
    cancelSuggest()
    const q = text.trim()
    // Saved places show at once and stay when the network is down.
    const local = q.length >= LOCAL_MIN_CHARS ? findDavaoPlaces(q) : []
    if (local.length > 0) {
      setResults(local)
      setOpen(document.activeElement === inputRef.current)
      setStatus({ kind: "results", count: local.length })
    }
    if (q.length < SUGGEST_MIN_CHARS) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const places = mergePlaces(local, await suggestPlaces(q, controller.signal))
        if (controller.signal.aborted) return
        setResults(places)
        setActive(-1)
        // Don't pop the list back open if the rider has tapped away.
        setOpen(places.length > 0 && document.activeElement === inputRef.current)
        // Silent when nothing matches yet: the rider is still typing.
        setStatus(places.length > 0 ? { kind: "results", count: places.length } : { kind: "idle" })
      } catch {
        // Suggestions are a nicety; submitting still searches.
      }
    }, SUGGEST_DELAY_MS)
    suggestRef.current = { timer, controller }
  }

  const choose = (place: Location) => {
    cancelSuggest()
    onSelect(place)
    setSyncedValue(place)
    setQuery(shortPlaceName(place.name))
    setOpen(false)
    setActive(-1)
    inputRef.current?.blur()
  }

  const runSearch = async () => {
    const q = query.trim()
    if (!q) return

    cancelSuggest()
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: "searching" })

    const local = findDavaoPlaces(q)
    try {
      // Photon steps in when Nominatim is rate limiting or down; saved places cover no connection at all.
      const remote = await searchPlaces(q, controller.signal)
        .catch((error) => {
          if (controller.signal.aborted) throw error
          return suggestPlaces(q, controller.signal)
        })
        .catch((error) => {
          if (controller.signal.aborted || local.length === 0) throw error
          return []
        })
      if (controller.signal.aborted) return
      const places = mergePlaces(local, remote)
      setResults(places)
      if (places.length === 1) {
        choose(toOption(places[0]).place)
        setStatus({ kind: "results", count: 1 })
        return
      }
      setActive(places.length > 0 ? 0 : -1)
      setOpen(places.length > 0)
      setStatus(places.length > 0 ? { kind: "results", count: places.length } : { kind: "empty", query: q })
    } catch (error) {
      if (controller.signal.aborted) return
      setResults([])
      setOpen(false)
      const message = !navigator.onLine
        ? "You're offline and no saved place matches"
        : error instanceof Error
          ? error.message
          : "Place search failed."
      setStatus({ kind: "error", message })
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && options.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % options.length)
    } else if (event.key === "ArrowUp" && options.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (event.key === "Enter" && open && active >= 0 && options[active]) {
      event.preventDefault()
      choose(options[active].place)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  const dropPin = () => {
    cancelSuggest()
    abortRef.current?.abort()
    setResults([])
    setOpen(false)
    setStatus({ kind: "pin" })
    onDropPin()
  }

  const clear = () => {
    cancelSuggest()
    abortRef.current?.abort()
    setQuery("")
    setResults([])
    setStatus({ kind: "idle" })
    setSyncedValue(null)
    onSelect(null)
    inputRef.current?.focus()
    setOpen(recent.length > 0)
  }

  const searching = status.kind === "searching"
  const message =
    status.kind === "searching"
      ? "Searching…"
      : status.kind === "results"
        ? status.count === 1
          ? "1 place found."
          : `${status.count} places found. Use the arrow keys to choose.`
        : status.kind === "empty"
          ? `No place in Davao City matches “${status.query}”. Try a landmark, mall or barangay name, or drop a pin.`
          : status.kind === "error"
            ? `${status.message}. Check your connection, or drop a pin.`
            : status.kind === "pin"
              ? "Pin dropped in the middle of the map. Drag it to where you're going."
              : ""

  return (
    <form
      ref={wrapperRef}
      role="search"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault()
        if (!searching) runSearch()
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Where are you going?
      </label>
      <div className="flex h-12 items-center rounded-full bg-white shadow-lg ring-1 ring-black/10 focus-within:ring-2 focus-within:ring-[var(--dg-navy)]">
        <MapPin className="ml-4 size-5 shrink-0 text-[var(--dg-red)]" aria-hidden />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Where to? Try SM Lanang"
          value={query}
          onChange={(e) => {
            // A new query makes any in-flight search stale.
            abortRef.current?.abort()
            if (searching || status.kind === "pin" || status.kind === "results") setStatus({ kind: "idle" })
            setQuery(e.target.value)
            setResults([])
            setOpen(e.target.value === "" && recent.length > 0)
            setActive(-1)
            scheduleSuggest(e.target.value)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => (results.length > 1 || (query === "" && recent.length > 0)) && setOpen(true)}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-base text-[var(--dg-ink)] placeholder:text-slate-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && !searching && (
          <button type="button" onClick={clear} aria-label="Clear search" className="flex size-11 items-center justify-center rounded-full text-slate-500 hover:text-slate-900">
            <X className="size-5" aria-hidden />
          </button>
        )}
        <button
          type="submit"
          aria-label="Search"
          disabled={searching}
          className="mr-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--dg-navy)] text-white hover:bg-[var(--dg-navy)]/90 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-yellow)]"
        >
          {searching ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Search className="size-5" aria-hidden />}
        </button>
      </div>

      {/* A solid card, since the message floats over the map on phones. */}
      <div className={cn(status.kind === "empty" || status.kind === "error" || status.kind === "pin" ? "mt-2 rounded-2xl bg-white px-4 py-2.5 shadow-lg ring-1 ring-black/10" : "contents")}>
        <p role="status" aria-live="polite" className={cn("text-sm text-slate-800", (status.kind === "idle" || status.kind === "searching" || status.kind === "results") && "sr-only")}>
          {message}
        </p>
        {(status.kind === "empty" || status.kind === "error") && (
          <button
            type="button"
            onClick={dropPin}
            className="mt-1.5 inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--dg-navy)] px-4 text-sm font-medium text-white hover:bg-[var(--dg-navy)]/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--dg-yellow)]"
          >
            <MapPinPlus className="size-4" aria-hidden />
            Drop a pin instead
          </button>
        )}
      </div>

      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={results.length > 0 ? "Places" : "Recent places"}
          className="absolute inset-x-0 top-14 z-30 max-h-[min(60dvh,24rem)] overflow-y-auto rounded-2xl bg-white py-1 shadow-xl ring-1 ring-black/10"
        >
          {results.length === 0 && <li role="presentation" className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-slate-500">Recent</li>}
          {options.map((option, i) => (
            <li
              key={option.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(option.place)}
              className={cn("flex min-h-12 cursor-pointer items-start gap-3 px-4 py-2.5", i === active && "bg-slate-100")}
            >
              {option.recent ? (
                <Clock className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
              ) : (
                <MapPin className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--dg-ink)]">{option.title}</span>
                {option.detail && <span className="block truncate text-xs text-slate-600">{option.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
