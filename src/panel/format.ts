import type {
  AblyEvent,
  ChannelState,
  ConnectionState,
} from '../shared/types'

/** `12:04:31.220` — devtools convention: time of day, millisecond precision. */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds(),
  )}.${pad(d.getMilliseconds(), 3)}`
}

/** Compact elapsed time: `4s`, `2m 14s`, `1h 03m`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Semantic status for a channel state. Drives colour so the channel list can be
 * scanned without reading every label.
 */
export type Tone = 'good' | 'warn' | 'bad' | 'idle' | 'busy'

export function channelTone(state: ChannelState, released: boolean): Tone {
  if (released) return 'idle'
  switch (state) {
    case 'attached':
      return 'good'
    case 'attaching':
    case 'detaching':
      return 'busy'
    case 'failed':
      return 'bad'
    case 'suspended':
      return 'warn'
    default:
      return 'idle'
  }
}

export function connectionTone(state: ConnectionState): Tone {
  switch (state) {
    case 'connected':
      return 'good'
    case 'connecting':
      return 'busy'
    case 'failed':
      return 'bad'
    case 'suspended':
    case 'disconnected':
      return 'warn'
    default:
      return 'idle'
  }
}

export function eventTone(event: AblyEvent): Tone {
  if (event.kind === 'error' || event.error) return 'bad'
  if (event.kind === 'message') return event.dir === 'out' ? 'busy' : 'good'
  if (event.kind === 'presence') return 'warn'
  return 'idle'
}

/** `↓` incoming, `↑` outgoing, `·` neither. */
export function directionGlyph(event: AblyEvent): string {
  if (event.dir === 'in') return '↓'
  if (event.dir === 'out') return '↑'
  return '·'
}

/** Short human label for the event kind column. */
export function kindLabel(kind: AblyEvent['kind']): string {
  switch (kind) {
    case 'message':
      return 'msg'
    case 'presence':
      return 'pres'
    case 'channel-state':
      return 'chan'
    case 'connection-state':
      return 'conn'
    case 'protocol':
      return 'proto'
    case 'error':
      return 'err'
    default:
      return kind
  }
}

/** Case-insensitive substring test that tolerates undefined haystacks. */
export function matches(haystack: string | undefined, query: string): boolean {
  if (!haystack) return false
  return haystack.toLowerCase().includes(query)
}
