/**
 * The behaviour behind the `rozenite agent` tools, as plain functions over a
 * `Session`.
 *
 * Kept separate from `use-ably-agent-tools.ts` for the same reason
 * `instrument.ts` is separate from `use-ably-devtools.ts`: the logic worth
 * testing — filtering, cursor paging, row projection — has nothing to do with
 * React, and should not need a renderer to exercise.
 *
 * Every handler reads the same `Session` the panel reads, so an agent sees
 * exactly what the panel would, including history captured before either one
 * attached.
 */

import { DEFAULT_PAGE_LIMIT } from '@rozenite/agent-shared'

import type {
  AblyEvent,
  ChannelSnapshot,
  SdkOptions,
  SerializedPayload,
} from '../shared/types'
import type {
  AblyChannelRow,
  AblyEventRow,
  ChannelActionArgs,
  ChannelActionResult,
  ClearResult,
  GetConnectionResult,
  GetStatsResult,
  ListChannelsArgs,
  ListChannelsResult,
  ListEventsArgs,
  ListEventsResult,
  ReadChannelArgs,
  ReadChannelResult,
  ReadEventArgs,
  ReadEventResult,
  SetOptionsArgs,
  SetOptionsResult,
  SortOrder,
} from '../shared/agent-tools'
import type { Session, SessionInternals } from './session'

/** Upper bound on a page, so a bad `limit` cannot dump the whole buffer. */
export const MAX_LIMIT = 200

/** Payload text `read-event` returns by default, and the ceiling it allows. */
export const DEFAULT_READ_EVENT_BYTES = 8 * 1024
export const MAX_READ_EVENT_BYTES = 128 * 1024

function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_LIMIT
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

/**
 * Everything an event can be matched against by `search`. The payload is
 * included because "which message carried this device id" is the question
 * free-text search exists to answer.
 */
function searchableText(event: AblyEvent): string {
  const parts = [event.summary, event.name, event.channel, event.error?.message]

  const payload = event.payload
  if (payload) {
    if (typeof payload.raw === 'string') {
      parts.push(payload.raw)
    } else if (payload.value !== undefined) {
      try {
        parts.push(
          typeof payload.value === 'string'
            ? payload.value
            : JSON.stringify(payload.value),
        )
      } catch {
        // A value that cannot be stringified simply does not match.
      }
    }
  }

  return parts.filter(Boolean).join(' ').toLowerCase()
}

export function toEventRow(event: AblyEvent): AblyEventRow {
  return {
    id: event.id,
    ts: event.ts,
    kind: event.kind,
    dir: event.dir,
    channel: event.channel,
    name: event.name,
    summary: event.summary,
    bytes: event.payload?.byteLength,
    hasPayload: event.payload !== undefined,
    error: event.error?.message,
  }
}

export function toChannelRow(
  channel: ChannelSnapshot,
  now: number,
): AblyChannelRow {
  return {
    name: channel.name,
    state: channel.state,
    msInState: Math.max(0, now - channel.since),
    subscriberCount: channel.subscriberCount,
    in: channel.counters.in,
    out: channel.counters.out,
    presence: channel.counters.presence,
    errors: channel.counters.errors,
    released: channel.released,
    everAttached: channel.everAttached,
    lastActivity: channel.lastActivity,
    labels: channel.labels,
    error: channel.reason?.message,
  }
}

// -------------------------------------------------------------- handlers

export function getConnection(session: Session): GetConnectionResult {
  const connection = session.getConnection()
  return {
    connection,
    msInState: Math.max(0, Date.now() - connection.since),
    capabilities: session.capabilities,
  }
}

export function listChannels(
  session: Session,
  { state, search, includeReleased, onlyErrored, limit, cursor }: ListChannelsArgs = {},
): ListChannelsResult {
  const now = Date.now()
  const needle = search?.toLowerCase()

  // Sorted by name so the cursor is a stable position, rather than an index
  // into a list that reorders as traffic arrives.
  const matching = session
    .getChannels()
    .filter((channel) => {
      if (!includeReleased && channel.released) return false
      if (state && channel.state !== state) return false
      if (onlyErrored && channel.counters.errors === 0) return false
      if (needle && !channel.name.toLowerCase().includes(needle)) return false
      return true
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const start = cursor ? matching.findIndex((channel) => channel.name > cursor) : 0
  const from = start < 0 ? matching.length : start

  const size = clampLimit(limit)
  const page = matching.slice(from, from + size)
  const hasMore = from + size < matching.length

  return {
    items: page.map((channel) => toChannelRow(channel, now)),
    page: {
      limit: size,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?.name : undefined,
    },
  }
}

export function readChannel(
  session: Session,
  { name }: ReadChannelArgs,
): ReadChannelResult {
  const channel = session.getChannel(name)
  if (!channel) {
    throw new Error(
      `Channel "${name}" has not been seen on this client. Use list-channels to see what has.`,
    )
  }
  return { channel }
}

export function listEvents(
  session: Session,
  { channel, kind, dir, search, since, order, limit, cursor }: ListEventsArgs = {},
): ListEventsResult {
  const needle = search?.toLowerCase()
  const direction: SortOrder = order === 'asc' ? 'asc' : 'desc'

  const matching = session.getEvents().filter((event) => {
    if (channel && event.channel !== channel) return false
    if (kind && event.kind !== kind) return false
    if (dir && event.dir !== dir) return false
    if (typeof since === 'number' && event.ts < since) return false
    if (needle && !searchableText(event).includes(needle)) return false
    return true
  })

  // The buffer is already chronological; desc only has to walk it backwards.
  const ordered = direction === 'asc' ? [...matching] : [...matching].reverse()

  const cursorId = cursor !== undefined ? Number(cursor) : undefined
  const hasCursor = cursorId !== undefined && Number.isFinite(cursorId)
  const size = clampLimit(limit)

  // The event the caller last saw has aged out of the ring buffer, so events
  // between it and whatever survives may have been dropped. Rozenite's
  // pagination contract spells this case out: an explicit reset with no items,
  // meaning "restart this listing", rather than a page that silently skips a
  // gap the caller would have no way to notice.
  const oldest = session.oldestEventId()
  if (hasCursor && oldest !== undefined && cursorId < oldest) {
    return { items: [], page: { limit: size, hasMore: false, reset: true } }
  }

  const after = hasCursor
    ? ordered.findIndex((event) =>
        direction === 'asc' ? event.id > cursorId : event.id < cursorId,
      )
    : 0
  const from = after < 0 ? ordered.length : after

  const page = ordered.slice(from, from + size)
  const hasMore = from + size < ordered.length

  return {
    items: page.map(toEventRow),
    page: {
      limit: size,
      hasMore,
      nextCursor: hasMore ? String(page[page.length - 1]?.id) : undefined,
    },
  }
}

/**
 * Bounds the payload text a single `read-event` returns.
 *
 * The serializer's own 128KB cap clips `raw` but passes a *parsed* `value`
 * through whole, because the panel renders it as a lazily-expanded tree and
 * wants the real structure. An agent has no such affordance: the whole thing
 * lands in its context at once, and a 322KB message came back as a 477KB
 * response — larger than the payload itself, since `raw` and `value` both
 * carry it.
 *
 * So the agent path caps the text and drops the redundant structured copy,
 * keeping `byteLength` honest about the true size.
 */
function boundPayload(
  payload: SerializedPayload,
  maxBytes: number,
): SerializedPayload {
  let text = typeof payload.raw === 'string' ? payload.raw : undefined

  if (text === undefined && payload.value !== undefined) {
    try {
      text =
        typeof payload.value === 'string'
          ? payload.value
          : JSON.stringify(payload.value)
    } catch {
      return payload
    }
  }

  if (text === undefined || text.length <= maxBytes) return payload

  // Report the payload's true size, not the length of `text` — the serializer
  // may already have clipped `raw` at its own 128KB cap, and quoting that
  // figure would understate how much is actually missing.
  const total = payload.byteLength ?? text.length

  return {
    ...payload,
    value: undefined,
    raw: text.slice(0, maxBytes),
    truncated: true,
    note: `clipped to ${maxBytes} of ${total} bytes; raise maxBytes (max ${MAX_READ_EVENT_BYTES}) for more`,
  }
}

export function readEvent(
  session: Session,
  { id, maxBytes }: ReadEventArgs,
): ReadEventResult {
  const event = session.getEvent(id)
  if (!event) {
    const events = session.getEvents()
    const range =
      events.length === 0
        ? 'the buffer is empty'
        : `retained ids are ${events[0].id}–${events[events.length - 1].id}`
    throw new Error(`Event ${id} is not retained (${range}).`)
  }

  if (!event.payload) return { event }

  const cap =
    typeof maxBytes === 'number' && Number.isFinite(maxBytes)
      ? Math.min(MAX_READ_EVENT_BYTES, Math.max(1, Math.floor(maxBytes)))
      : DEFAULT_READ_EVENT_BYTES

  return { event: { ...event, payload: boundPayload(event.payload, cap) } }
}

export function getStats(session: Session): GetStatsResult {
  return {
    stats: session.getStats(),
    options: session.options,
    capabilities: session.capabilities,
    retained: session.getEvents().length,
  }
}

export function setOptions(
  session: Session,
  next: SetOptionsArgs = {},
): SetOptionsResult {
  if (next.captureProtocol && !session.capabilities.protocol) {
    throw new Error(
      'Protocol capture is unavailable: this ably-js client has no setLog method.',
    )
  }

  const patch: Partial<SdkOptions> = {}
  if (next.paused !== undefined) patch.paused = next.paused
  if (next.captureProtocol !== undefined) {
    patch.captureProtocol = next.captureProtocol
  }
  if (next.maxEvents !== undefined) {
    if (!Number.isFinite(next.maxEvents) || next.maxEvents < 1) {
      throw new Error('maxEvents must be a positive number.')
    }
    patch.maxEvents = Math.floor(next.maxEvents)
  }

  session.setOptions(patch)

  if (patch.captureProtocol !== undefined) {
    const internals = session as unknown as SessionInternals
    internals.__setProtocolCapture?.(patch.captureProtocol)
  }

  return { options: session.options }
}

export function clear(session: Session): ClearResult {
  session.clear()
  return { cleared: true }
}

export function channelAction(
  session: Session,
  { action, channel }: ChannelActionArgs,
): ChannelActionResult {
  // Refuse rather than no-op on an unknown name: `channels.all` is the only
  // thing that can act here, and a silent success would read as "detached".
  if (!session.getChannel(channel)) {
    throw new Error(
      `Channel "${channel}" has not been seen on this client. Use list-channels to see what has.`,
    )
  }

  const internals = session as unknown as SessionInternals
  if (!internals.__channelAction) {
    throw new Error('Channel actions are unavailable: no client is instrumented.')
  }
  internals.__channelAction(action, channel)

  return { channel, action, dispatched: true }
}
