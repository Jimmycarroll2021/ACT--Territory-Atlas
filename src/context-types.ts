export interface ContextCard {
  id: string
  title: string
  summary: string
  status: 'available' | 'unavailable' | 'stale'
  sourceName: string
  sourceUrl: string
  observedAt: string | null
  expiresAt?: string
  coverage: string
  action?: string
  href?: string
}

export interface ContextData {
  asOf: string
  persistent: ContextCard[]
  today: ContextCard[]
}
