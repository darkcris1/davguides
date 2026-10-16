"use client"

import { Analytics as VercelAnalytics } from "@vercel/analytics/next"

// Trip links carry riders' coordinates, so only the bare path is ever sent.
export default function Analytics() {
  return (
    <VercelAnalytics
      beforeSend={(event) => {
        const url = new URL(event.url)
        url.search = ""
        return { ...event, url: url.toString() }
      }}
    />
  )
}
