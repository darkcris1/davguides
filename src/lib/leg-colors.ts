// Route colours in the dataset repeat, so legs get their own palette to tell them apart.
export const LEG_PALETTE = ["#2563eb", "#db2777", "#16a34a", "#ea580c"] as const

export const jeepneyColor = (ordinal: number) => LEG_PALETTE[ordinal % LEG_PALETTE.length]

export const WALK_COLOR = "#64748b"
export const TRICYCLE_COLOR = "#d97706"
export const CONTEXT_COLOR = "#94a3b8"
