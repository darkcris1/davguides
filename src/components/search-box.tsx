"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Clock, Loader2, MapPin, Search, X } from "lucide-react"
import { searchPlaces, type PlaceResult } from "@/lib/nominatim"
import type { Location } from "@/commons/models/maps"
import { cn, shortPlaceName } from "@/lib/utils"

interface SearchBoxProps {
  /** Current destination, so pins dropped on the map show their name here. */
  value: Location | null
  onSelect: (location: Location | null) => void
  recent: Location[]
}

interface Option {
  key: string
  place: Location
  title: string
  detail: string
  recent: boolean
}

const toOption = (place: PlaceResult): Option => ({
  key: String(place.id),
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

type Status = { kind: "idle" } | { kind: "searching" } | { kind: "results"; count: number } | { kind: "empty"; query: string } | { kind: "error"; message: string }

export default function SearchBox({ value, onSelect, recent }: SearchBoxProps) {
  const [query, setQuery] = useState(value ? shortPlaceName(value.name) : "")
  const [syncedValue, setSyncedValue] = useState(value)
  const [results, setResults] = useState<PlaceResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const abortRef = useRef<AbortController | null>(null)
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
    }
  }, [])

  const choose = (place: Location) => {
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

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: "searching" })

    try {
      const places = await searchPlaces(q, controller.signal)
      if (controller.signal.aborted) return
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
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Place search failed." })
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

  const clear = () => {
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
          ? `No place in Davao City matches “${status.query}”. Try a landmark, mall or barangay name.`
          : status.kind === "error"
            ? `${status.message}. Check your connection and search again.`
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
            setQuery(e.target.value)
            setResults([])
            setOpen(e.target.value === "" && recent.length > 0)
            setActive(-1)
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

      <p role="status" aria-live="polite" className={cn(
          "text-sm text-slate-800",
          // A solid card, since the message floats over the map on phones.
          status.kind === "empty" || status.kind === "error" ? "mt-2 rounded-2xl bg-white px-4 py-2.5 shadow-lg ring-1 ring-black/10" : "sr-only",
        )}>
        {message}
      </p>

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
