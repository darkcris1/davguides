import { ImageResponse } from "next/og"
import { SITE } from "@/lib/site"

export const alt = `${SITE.name} — find which jeepney to ride in Davao City`
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const { navy, yellow, red, ink } = SITE.brand

// Pulls only the glyphs the card needs from Google Fonts.
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&text=${encodeURIComponent(text)}`)
    ).text()
    const url = css.match(/src: url\((.+?)\) format/)?.[1]
    return url ? await (await fetch(url)).arrayBuffer() : null
  } catch {
    return null
  }
}

const SIGNBOARDS = ["TORIL", "BAJADA", "MATINA", "LANANG", "CALINAN"]

export default async function OpengraphImage() {
  const lines = ["WHICH JEEPNEY", "DO I RIDE?"]
  const tagline = "Routes, transfers and fares for every jeepney in Davao City."
  const font = await loadFont(`${lines.join("")}${tagline}${SIGNBOARDS.join("")}DAVGUIDES`)
  const display = font ? "Barlow Condensed" : "sans-serif"

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: navy,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.06) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,.06) 2px, transparent 2px)",
          backgroundSize: "60px 60px",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="96" height="96" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#fff" />
            <path d="M16 49V13h14a18 18 0 0 1 0 36" fill="none" stroke={navy} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16" cy="49" r="4.5" fill={yellow} stroke={navy} strokeWidth="2" />
            <circle cx="30" cy="49" r="4.5" fill={red} stroke="#fff" strokeWidth="2" />
          </svg>
          <div style={{ display: "flex", fontFamily: display, fontSize: 64, fontWeight: 700 }}>
            <span style={{ color: yellow }}>DAV</span>
            <span>GUIDES</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", fontFamily: display, fontSize: 120, fontWeight: 700, lineHeight: 0.95, letterSpacing: 1 }}>
            {lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
          <div style={{ fontFamily: display, fontSize: 40, color: "rgba(255,255,255,.85)" }}>{tagline}</div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {SIGNBOARDS.map((name) => (
            <div
              key={name}
              style={{
                display: "flex",
                padding: "8px 22px",
                borderRadius: 8,
                background: yellow,
                color: ink,
                fontFamily: display,
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: 2,
              }}
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: "Barlow Condensed", data: font, weight: 700, style: "normal" }] : undefined,
    },
  )
}
