// Downtown spots where outbound jeeps load; see CONTEXT.md for sources and confidence.

export interface LoadingHub {
  name: string
  lat: number
  lng: number
  /** Route names exactly as they appear in routes.ts. */
  routes: string[]
}

export const LOADING_HUBS: LoadingHub[] = [
  {
    name: "Roxas Ave",
    lat: 7.0707,
    lng: 125.6134,
    routes: [
      "Toril",
      "Bago Aplaya",
      "Talomo",
      "Catalunan Grande",
      "Mintal",
      "Calinan",
      "Bunawan via Buhangin",
      "Bunawan via Sasa",
      "Lasang via Buhangin",
      "Lasang via Sasa",
      "Tibungco via Buhangin",
      "Tibungco via Cabaguio",
      "Tibungco via R. Castillo",
      "Panacan via Cabaguio",
    ],
  },
  {
    name: "Acacia",
    lat: 7.0736,
    lng: 125.6125,
    routes: ["Emily Homes", "Camp Catitipan via JP Laurel", "Buhangin via JP Laurel", "El Rio"],
  },
  {
    name: "Bankerohan",
    lat: 7.0687,
    lng: 125.6007,
    routes: ["Maa - Bankerohan", "Jade Valley", "Route 5", "Route 7", "Route 9", "Route 10"],
  },
  {
    name: "Agdao Public Market",
    lat: 7.0818,
    lng: 125.6233,
    routes: ["Maa - Agdao", "Matina Aplaya", "Buhangin via Dacudao", "Route 6", "Route 11"],
  },
  {
    name: "R. Magsaysay Ave",
    lat: 7.0742,
    lng: 125.6231,
    routes: ["Bangkal", "Puan", "Ulas", "Matina Pangi"],
  },
  {
    name: "Gaisano Bajada",
    lat: 7.0776,
    lng: 125.6141,
    routes: ["Sasa via JP Laurel", "Panacan - SM City Davao", "Bo. Obrero"],
  },
  {
    name: "San Pedro St",
    lat: 7.0647,
    lng: 125.6095,
    routes: ["Route 4"],
  },
  {
    name: "Ecoland Terminal",
    lat: 7.0556,
    lng: 125.6011,
    routes: ["Ecoland", "Route 2", "Route 12"],
  },
]

// Davao is UTC+8 year-round, so peak checks don't depend on the device's time zone.
export function isPeakHour(date: Date, windows: readonly (readonly [number, number])[]): boolean {
  const hour = (date.getUTCHours() + 8) % 24
  return windows.some(([start, end]) => hour >= start && hour < end)
}
