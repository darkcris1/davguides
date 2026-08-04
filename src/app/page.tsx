"use client"

import type React from "react"

import { useState, useRef } from "react"
import dynamic from "next/dynamic"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"
import { routes } from "@/lib/routes"
import type { Location, Route } from "@/commons/models/maps"

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
}

// Dynamically import the Map component to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import("@/components/map-component"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[calc(100vh-64px)] flex items-center justify-center bg-gray-100">Loading map...</div>
  ),
})

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([])
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery + " Davao City",
        )}&limit=5`,
      )
      const data = await response.json()

      // Filter results to ensure they're in Davao City
      const davaoResults = (data as NominatimResult[]).filter((result) =>
        result.display_name.toLowerCase().includes("davao city"),
      )

      setSearchResults(davaoResults)

      if (davaoResults.length > 0) {
        setSelectedLocation({
          lat: Number.parseFloat(davaoResults[0].lat),
          lng: Number.parseFloat(davaoResults[0].lon),
          name: davaoResults[0].display_name,
        })
      }
    } catch (error) {
      console.error("Error searching for location:", error)
    } finally {
      setIsSearching(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch()
    }
  }

  const handleResultClick = (result: NominatimResult) => {
    setSelectedLocation({
      lat: Number.parseFloat(result.lat),
      lng: Number.parseFloat(result.lon),
      name: result.display_name,
    })
    setSearchResults([])
    if (searchInputRef.current) {
      searchInputRef.current.value = result.display_name
      setSearchQuery(result.display_name)
    }
  }

  return (
    <main className="relative w-full h-screen">
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 w-full max-w-md px-4">
        <div className="relative">
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search for a location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pr-10 shadow-lg bg-white border-gray-300"
          />
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-0 top-0 h-full"
            onClick={handleSearch}
            disabled={isSearching}
          >
            <Search className="h-4 w-4" />
          </Button>

          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg z-20 max-h-60 overflow-y-auto">
              <ul className="py-1">
                {searchResults.map((result, index) => (
                  <li
                    key={index}
                    className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                    onClick={() => handleResultClick(result)}
                  >
                    {result.display_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <MapComponent selectedLocation={selectedLocation} routes={routes as Route[]} />
    </main>
  )
}

