import type { Metadata, Viewport } from "next"
import { Barlow_Condensed, Geist } from "next/font/google"
import Analytics from "@/components/analytics"
import { SITE } from "@/lib/site"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow",
  weight: ["600", "700"],
  subsets: ["latin"],
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — Jeepney Route Finder for Davao City`,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "Davao jeepney routes",
    "Davao City jeepney",
    "jeepney route finder",
    "Davao commute",
    "Davao tricycle fare",
    "jeepney fare calculator",
    "Davao transport map",
    "how to commute in Davao",
  ],
  authors: [{ name: SITE.name, url: SITE.url }],
  creator: SITE.name,
  category: "travel",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_PH",
    url: "/",
    siteName: SITE.name,
    title: `${SITE.name} — Jeepney Route Finder for Davao City`,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — Jeepney Route Finder for Davao City`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "default" },
}

export const viewport: Viewport = {
  themeColor: SITE.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE.name,
  url: SITE.url,
  description: SITE.description,
  applicationCategory: "TravelApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript and a modern browser",
  inLanguage: "en-PH",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "PHP" },
  areaServed: { "@type": "City", name: "Davao City", address: { "@type": "PostalAddress", addressCountry: "PH" } },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en-PH">
      <body className={`${geistSans.variable} ${barlowCondensed.variable} antialiased`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {children}
        <Analytics />
      </body>
    </html>
  )
}
