import AppShell from "@/components/app-shell"

export default function Home() {
  return (
    <>
      <AppShell />
      <noscript>
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h2>DavGuides needs JavaScript</h2>
          <p>
            DavGuides finds which jeepney to ride in Davao City, where to board and get off, transfers, tricycle hops and fare
            estimates. Turn on JavaScript to use the map.
          </p>
        </div>
      </noscript>
    </>
  )
}
