"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Loader2, MapPin, Search, X } from "lucide-react"
import { searchPlaces, type PlaceResult } from "@/lib/nominatim"
import type { Location } from "@/commons/models/maps"
import { cn, shortPlaceName } from "@/lib/utils"

interface SearchBoxProps {
  onSelect: (location: Location | null) => void
}

type Status = { kind: "idle" } | { kind: "searching" } | { kind: "results"; count: number } | { kind: "empty"; query: string } | { kind: "error"; message: string }

export default function SearchBox({ onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PlaceResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const abortRef = useRef<AbortController | null>(null)
  const wrapperRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

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

  const choose = (place: PlaceResult) => {
    onSelect({ lat: place.lat, lng: place.lng, name: place.name })
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
        choose(places[0])
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
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % results.length)
    } else if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (event.key === "Enter" && open && active >= 0) {
      event.preventDefault()
      choose(results[active])
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  const clear = () => {
    abortRef.current?.abort()
    setQuery("")
    setResults([])
    setOpen(false)
    setStatus({ kind: "idle" })
    onSelect(null)
    inputRef.current?.focus()
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
            setOpen(false)
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => results.length > 1 && setOpen(true)}
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

      <p role="status" aria-live="polite" className={cn("px-4 pt-2 text-sm text-slate-800", (status.kind === "empty" || status.kind === "error") ? "drop-shadow-[0_1px_0_#fff]" : "sr-only")}>
        {message}
      </p>

      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Places"
          className="absolute inset-x-0 top-14 z-30 max-h-[min(60dvh,24rem)] overflow-y-auto rounded-2xl bg-white py-1 shadow-xl ring-1 ring-black/10"
        >
          {results.map((place, i) => (
            <li
              key={place.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(place)}
              className={cn("flex min-h-12 cursor-pointer items-start gap-3 px-4 py-2.5", i === active && "bg-slate-100")}
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--dg-ink)]">{shortPlaceName(place.name)}</span>
                <span className="block truncate text-xs text-slate-600">{place.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
