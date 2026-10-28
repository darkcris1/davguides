// Well-known Davao City places, searchable with no connection. Coordinates from OpenStreetMap via Photon.

import type { PlaceResult } from "./nominatim"
import { haversineKm } from "./geo"

// [name, lat, lng]; kept under 5 KB, so names stay short.
const PLACES: [string, number, number][] = [
  ["SM Lanang Premier", 7.099, 125.6308],
  ["SM City Davao (Ecoland)", 7.0488, 125.5888],
  ["Abreeza Mall", 7.0912, 125.6116],
  ["Gaisano Mall of Davao", 7.0776, 125.6141],
  ["NCCC Mall Buhangin", 7.1106, 125.6119],
  ["NCCC Mall VP (Victoria Plaza)", 7.0866, 125.6118],
  ["NCCC Mall Ma-a", 7.0628, 125.5937],
  ["Gaisano Grand Citygate", 7.1109, 125.6127],
  ["Gaisano Grand Toril", 7.0125, 125.4909],
  ["Gaisano Grand Ilustre", 7.0692, 125.6063],
  ["Gaisano Grand Calinan", 7.1934, 125.4543],
  ["Robinsons Cybergate Davao", 7.0996, 125.6239],
  ["Felcris Centrale", 7.0595, 125.6089],
  ["Matina Town Square", 7.0638, 125.5966],
  ["Damosa Gateway", 7.1017, 125.6326],
  ["Roxas Night Market", 7.0704, 125.6134],
  ["Bankerohan Public Market", 7.0687, 125.6007],
  ["Agdao Public Market", 7.0818, 125.6233],
  ["Toril Public Market", 7.0183, 125.496],
  ["Mintal Public Market", 7.0926, 125.5012],
  ["Calinan Public Market", 7.1909, 125.4545],
  ["Chinatown", 7.0755, 125.6188],
  ["People's Park", 7.0709, 125.6088],
  ["Magsaysay Park", 7.0744, 125.6258],
  ["Rizal Park", 7.0646, 125.6084],
  ["Davao Crocodile Park", 7.0971, 125.599],
  ["Eden Nature Park", 7.0282, 125.4018],
  ["Philippine Eagle Center", 7.1849, 125.4153],
  ["Malagos Garden Resort", 7.191, 125.4277],
  ["Jack's Ridge", 7.0659, 125.5806],
  ["Shrine Hills", 7.0708, 125.5779],
  ["Infant Jesus of Prague Shrine", 7.0656, 125.5784],
  ["Japanese Tunnel", 7.0658, 125.5633],
  ["Museo Dabawenyo", 7.0794, 125.6045],
  ["San Pedro Cathedral", 7.0647, 125.6095],
  ["Davao City Hall", 7.0647, 125.608],
  ["Puentespina Orchid Garden", 7.0885, 125.6251],
  ["Mergrande Ocean Resort", 7.0321, 125.5293],
  ["Times Beach", 7.0454, 125.5928],
  ["Azuela Cove", 7.1022, 125.6448],
  ["Lanang Business Park", 7.1032, 125.6371],
  ["Davao Airport (Francisco Bangoy)", 7.1249, 125.6435],
  ["Ecoland Terminal (DCOTT)", 7.0556, 125.6011],
  ["Sasa Wharf", 7.1265, 125.6627],
  ["Santa Ana Wharf", 7.0775, 125.6278],
  ["Ateneo de Davao University", 7.0718, 125.6134],
  ["Ateneo de Davao Matina", 7.0612, 125.5978],
  ["University of Mindanao", 7.067, 125.6095],
  ["University of Mindanao Matina", 7.0671, 125.5949],
  ["UP Mindanao", 7.0849, 125.4837],
  ["USeP Obrero", 7.0858, 125.6161],
  ["Holy Cross of Davao College", 7.0775, 125.6164],
  ["San Pedro College", 7.078, 125.6156],
  ["University of the Immaculate Conception", 7.07, 125.6],
  ["Mapua Malayan Colleges Mindanao", 7.0639, 125.5957],
  ["Philippine Women's College", 7.0571, 125.5929],
  ["Davao Medical School Foundation", 7.0855, 125.6068],
  ["Davao Doctors College", 7.0719, 125.6034],
  ["Davao City National High School", 7.0794, 125.6061],
  ["Assumption College of Davao", 7.0881, 125.6242],
  ["Davao Christian High School", 7.0795, 125.6107],
  ["Mindanao Kokusai Daigaku", 7.103, 125.6322],
  ["Southern Philippines Medical Center (SPMC)", 7.0998, 125.6195],
  ["Davao Doctors Hospital", 7.0704, 125.6044],
  ["Brokenshire Hospital", 7.0745, 125.5972],
  ["San Pedro Hospital", 7.079, 125.615],
  ["Ricardo Limso Medical Center", 7.0705, 125.6069],
  ["Metro Davao Medical Center", 7.0952, 125.6132],
  ["Davao City Police Office", 7.0641, 125.611],
  ["LTO Region XI", 7.0605, 125.6086],
  ["Davao Light", 7.0933, 125.6144],
  ["Almendras Gym", 7.0617, 125.6109],
  ["Davao City Library", 7.0728, 125.6109],
  ["Marco Polo Davao", 7.0721, 125.6112],
  ["Seda Abreeza", 7.0895, 125.6106],
  ["Royal Mandaya Hotel", 7.0695, 125.6103],
  ["Apo View Hotel", 7.0695, 125.6078],
  ["Waterfront Insular Hotel", 7.1062, 125.6505],
  ["Pinnacle Hotel", 7.076, 125.6151],
  ["Apo Golf and Country Club", 7.0499, 125.5282],
  ["Riverfront Corporate City", 7.0982, 125.5964],
  ["Bajada", 7.0913, 125.6099],
  ["Buhangin", 7.1087, 125.6135],
  ["Agdao", 7.0837, 125.6243],
  ["Toril", 7.0183, 125.496],
  ["Calinan", 7.1902, 125.4525],
  ["Mintal", 7.0924, 125.5019],
  ["Bunawan", 7.2358, 125.6424],
  ["Sasa", 7.1248, 125.6612],
  ["Panacan", 7.1517, 125.659],
  ["Lanang", 7.0983, 125.6347],
  ["Matina", 7.0618, 125.593],
  ["Ma-a", 7.0807, 125.5827],
  ["Ecoland", 7.0508, 125.5961],
  ["Bangkal", 7.0613, 125.56],
  ["Catalunan Grande", 7.0802, 125.5438],
  ["Catalunan Pequeño", 7.0754, 125.5203],
  ["Ulas", 7.0549, 125.5455],
  ["Talomo", 7.0492, 125.5479],
  ["Tibungco", 7.1905, 125.6488],
  ["Cabantian", 7.1279, 125.6195],
  ["Obrero", 7.0863, 125.6154],
  ["Tigatto", 7.1195, 125.5987],
  ["Indangan", 7.1673, 125.5946],
  ["Lasang", 7.2671, 125.665],
  ["Mandug", 7.1651, 125.5768],
  ["Tugbok", 7.1099, 125.4841],
  ["Dumoy", 7.0316, 125.5127],
  ["Puan", 7.0517, 125.5401],
  ["Bago Aplaya", 7.0437, 125.5312],
  ["Bago Gallera", 7.0546, 125.5103],
  ["Daliao", 7.009, 125.5041],
  ["Communal", 7.1413, 125.6226],
  ["Marfori Heights", 7.0814, 125.602],
  ["Dacudao", 7.0878, 125.6221],
  ["Sandawa", 7.061, 125.6015],
  ["Langub", 7.1058, 125.5627],
  ["Waan", 7.1283, 125.5764],
  ["Mahayag", 7.2188, 125.6194],
  ["Insular Village", 7.1079, 125.6435],
  ["Catitipan", 7.1275, 125.6365],
]

// Lowercase, no accents or punctuation, so "pequeno" finds "Pequeño" and "peoples" finds "People's".
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")

const INDEX = PLACES.map(([name]) => normalize(name).split(" "))

// Every typed word must start a word in the name; earlier and shorter names rank first.
export function findDavaoPlaces(query: string, limit = 6): PlaceResult[] {
  const words = normalize(query).split(" ").filter(Boolean)
  if (words.length === 0) return []
  return PLACES.flatMap(([name, lat, lng], i) => {
    const nameWords = INDEX[i]
    const at = words.map((w) => nameWords.findIndex((n) => n.startsWith(w)))
    return at.every((x) => x >= 0) ? [{ rank: Math.min(...at) * 100 + name.length, place: { id: `local-${i}`, lat, lng, name: `${name}, Davao City`, detail: "Davao City" } }] : []
  })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((hit) => hit.place)
}

// Saved places first, then online results that aren't the same spot under the same name.
export function mergePlaces(local: PlaceResult[], remote: PlaceResult[], limit = 8): PlaceResult[] {
  const dupe = (r: PlaceResult) =>
    local.some((l) => {
      const [a, b] = [normalize(l.name.split(",")[0]), normalize(r.name.split(",")[0])]
      return b !== "" && (a.includes(b) || b.includes(a)) && haversineKm(l.lat, l.lng, r.lat, r.lng) < 0.5
    })
  return [...local, ...remote.filter((r) => !dupe(r))].slice(0, limit)
}
