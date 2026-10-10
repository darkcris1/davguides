import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

// Leaflet popups and divIcons take raw HTML, so every outside string goes through this.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

// Nominatim names run "Place, Street, Barangay, City, ..."; the first part is what people recognise.
export function shortPlaceName(displayName: string): string {
  return displayName.split(",")[0].trim()
}
