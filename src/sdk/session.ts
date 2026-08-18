import type {
  AblyEvent,
  Capabilities,
  ChannelSnapshot,
  ChannelState,
  ConnectionSnapshot,
  SdkOptions,
  SerializedError,
  SessionStats,
  Snapshot,
} from '../shared/types'

/**
 * Owns all observed state for one instrumented client and decides what crosses
 * the bridge.
 *
 * Two behaviours matter here:
 *
 *  - **Events are batched.** A busy channel can emit hundreds of messages a
 *    second; sending each one individually would make the bridge, not the app,
 *    the bottleneck. Events accumulate for `FLUSH_MS` and flush as one array.
 *  - **History lives on the device.** The panel can open late, reload, or
 *    detach and reattach. Keeping the ring buffer here means it always gets the
 *    full retained history from a single `ably:snapshot`.
 */

/** How long events accumulate before a batch is sent. */
const FLUSH_MS = 120

/** Flush early once a batch reaches this size, to bound bridge message size. */
const MAX_BATCH = 100

/** Channel-snapshot pushes are throttled to at most one per this interval. */
const CHANNEL_FLUSH_MS = 200

const DEFAULT_MAX_EVENTS = 1000

/**
 * Device-side actions that `instrumentClient` attaches to a session after
 * construction, rather than widening `Session`'s public API with methods that
 * only mean anything once a client is patched. Declared here so every consumer
 * agrees on the shape.
 */
export type SessionInternals = {
  __setProtocolCapture?: (enabled: boolean) => void
  __channelAction?: (action: string, channel: string) => void
}

export type SessionSink = {
  events: (events: AblyEvent[]) => void
  channels: (channels: ChannelSnapshot[]) => void
  connection: (connection: ConnectionSnapshot) => void
  stats: (stats: SessionStats) => void
  options: (options: SdkOptions) => void
}

/** Mutable per-channel record; `toSnapshot` projects it onto the wire type. */
type ChannelRecord = {
  name: string
  state: ChannelState
  since: number
  firstSeen: number
  lastActivity?: number
  reason?: SerializedError
  subscriberCount: number
  listeners: { id: number; label?: string; subscribedAt: number; events?: string[] }[]
  counters: { in: number; out: number; presence: number; errors: number }
  released: boolean
  everAttached: boolean
  params?: Record<string, string>
  modes?: string[]
}

export class Session {
  private events: AblyEvent[] = []
  private channels = new Map<string, ChannelRecord>()
  private nextEventId = 1
  private nextListenerId = 1

  private pendingEvents: AblyEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private channelTimer: ReturnType<typeof setTimeout> | null = null

  private sink: SessionSink | null = null

  private connection: ConnectionSnapshot = {
    state: 'initialized',
    since: Date.now(),
  }

  private stats: SessionStats = {
    totalEvents: 0,
    dropped: 0,
    messagesIn: 0,
    messagesOut: 0,
    presence: 0,
    errors: 0,
    startedAt: Date.now(),
  }

  options: SdkOptions = {
    paused: false,
    captureProtocol: false,
    maxEvents: DEFAULT_MAX_EVENTS,
  }

  capabilities: Capabilities = { protocol: false, labels: false }

  /** Resolves channel name -> labels; supplied by the host app, may be absent. */
  private labelResolver: (() => Record<string, string[]>) | null = null

  attachSink(sink: SessionSink | null) {
    this.sink = sink
    if (sink) this.flushNow()
  }

  setLabelResolver(resolver: (() => Record<string, string[]>) | null) {
    this.labelResolver = resolver
    this.capabilities.labels = Boolean(resolver)
    this.scheduleChannelFlush()
  }

  setOptions(next: Partial<SdkOptions>) {
    this.options = { ...this.options, ...next }
    if (this.options.maxEvents < 1) this.options.maxEvents = 1
    this.trim()
    this.sink?.options(this.options)
  }

  // ---------------------------------------------------------------- events

  /**
   * Records an event. Callers pass everything except `id`/`ts`, which are
   * assigned here so ordering is centrally controlled.
   *
   * While paused, events are dropped entirely rather than buffered — a paused
   * inspector should not silently accumulate memory in the app under test.
   */
  push(event: Omit<AblyEvent, 'id' | 'ts'> & { ts?: number }): void {
    if (this.options.paused) return

    const full: AblyEvent = {
      ...event,
      id: this.nextEventId++,
      ts: event.ts ?? Date.now(),
    }

    this.events.push(full)
    this.stats.totalEvents++

    if (full.kind === 'message') {
      if (full.dir === 'in') this.stats.messagesIn++
      else if (full.dir === 'out') this.stats.messagesOut++
    } else if (full.kind === 'presence') {
      this.stats.presence++
    } else if (full.kind === 'error') {
      this.stats.errors++
    }

    if (full.channel) {
      const record = this.channels.get(full.channel)
      if (record) {
        record.lastActivity = full.ts
        if (full.kind === 'message') {
          if (full.dir === 'in') record.counters.in++
          else if (full.dir === 'out') record.counters.out++
        } else if (full.kind === 'presence') {
          record.counters.presence++
        } else if (full.kind === 'error') {
          record.counters.errors++
        }
      }
    }

    this.trim()
    this.pendingEvents.push(full)
    if (this.pendingEvents.length >= MAX_BATCH) this.flushEvents()
    else this.scheduleFlush()
  }

  private trim() {
    const overflow = this.events.length - this.options.maxEvents
    if (overflow > 0) {
      this.events.splice(0, overflow)
      this.stats.dropped += overflow
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushEvents()
    }, FLUSH_MS)
  }

  private flushEvents() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.sink || this.pendingEvents.length === 0) {
      this.pendingEvents = []
      return
    }
    const batch = this.pendingEvents
    this.pendingEvents = []
    this.sink.events(batch)
    this.sink.stats(this.stats)
  }

  // -------------------------------------------------------------- channels

  private ensureChannel(name: string): ChannelRecord {
    let record = this.channels.get(name)
    if (!record) {
      const now = Date.now()
      record = {
        name,
        state: 'initialized',
        since: now,
        firstSeen: now,
        subscriberCount: 0,
        listeners: [],
        counters: { in: 0, out: 0, presence: 0, errors: 0 },
        released: false,
        everAttached: false,
      }
      this.channels.set(name, record)
    }
    return record
  }

  touchChannel(name: string, patch?: Partial<ChannelRecord>) {
    const record = this.ensureChannel(name)
    if (patch) Object.assign(record, patch)
    this.scheduleChannelFlush()
    return record
  }

  setChannelState(
    name: string,
    state: ChannelState,
    reason?: SerializedError,
  ): ChannelRecord {
    const record = this.ensureChannel(name)
    if (record.state !== state) {
      record.state = state
      record.since = Date.now()
    }
    record.reason = reason
    if (state === 'attached') record.everAttached = true
    this.scheduleChannelFlush()
    return record
  }

  addListener(name: string, label?: string, events?: string[]): number {
    const record = this.ensureChannel(name)
    const id = this.nextListenerId++
    record.listeners.push({ id, label, subscribedAt: Date.now(), events })
    record.subscriberCount = record.listeners.length
    this.scheduleChannelFlush()
    return id
  }

  removeListener(name: string, id: number) {
    const record = this.channels.get(name)
    if (!record) return
    record.listeners = record.listeners.filter((l) => l.id !== id)
    record.subscriberCount = record.listeners.length
    this.scheduleChannelFlush()
  }

  /** `unsubscribe()` with no arguments removes every listener at once. */
  clearListeners(name: string) {
    const record = this.channels.get(name)
    if (!record) return
    record.listeners = []
    record.subscriberCount = 0
    this.scheduleChannelFlush()
  }

  markReleased(name: string) {
    const record = this.channels.get(name)
    if (!record) return
    record.released = true
    record.listeners = []
    record.subscriberCount = 0
    this.scheduleChannelFlush()
  }

  private scheduleChannelFlush() {
    if (this.channelTimer) return
    this.channelTimer = setTimeout(() => {
      this.channelTimer = null
      if (this.sink) this.sink.channels(this.channelSnapshots())
    }, CHANNEL_FLUSH_MS)
  }

  private channelSnapshots(): ChannelSnapshot[] {
    const labels = this.labelResolver ? safeLabels(this.labelResolver) : null
    return Array.from(this.channels.values(), (record) => ({
      name: record.name,
      state: record.state,
      since: record.since,
      firstSeen: record.firstSeen,
      lastActivity: record.lastActivity,
      reason: record.reason,
      subscriberCount: record.subscriberCount,
      listeners: record.listeners.map(({ label, subscribedAt, events }) => ({
        label,
        subscribedAt,
        events,
      })),
      counters: { ...record.counters },
      released: record.released,
      everAttached: record.everAttached,
      labels: labels?.[record.name],
      params: record.params,
      modes: record.modes,
    }))
  }

  // ------------------------------------------------------------ connection

  setConnection(patch: Partial<ConnectionSnapshot>) {
    const stateChanged = patch.state && patch.state !== this.connection.state
    this.connection = {
      ...this.connection,
      ...patch,
      since: stateChanged ? Date.now() : this.connection.since,
    }
    this.sink?.connection(this.connection)
  }

  // ------------------------------------------------------------ read access

  /**
   * Narrow projections for the agent tools, which query the session directly
   * instead of going through the panel bridge. Kept separate from `snapshot()`
   * because that copies the entire ring buffer on every call, and an agent
   * listing twenty events should not pay for a thousand.
   */
  getConnection(): ConnectionSnapshot {
    return this.connection
  }

  getStats(): SessionStats {
    return this.stats
  }

  /** Live view of the retained buffer. Callers must not mutate it. */
  getEvents(): readonly AblyEvent[] {
    return this.events
  }

  getEvent(id: number): AblyEvent | undefined {
    return this.events.find((event) => event.id === id)
  }

  /**
   * Oldest id still retained, so a caller paging with a cursor can tell whether
   * events fell out of the buffer between pages rather than silently skipping
   * them.
   */
  oldestEventId(): number | undefined {
    return this.events[0]?.id
  }

  getChannels(): ChannelSnapshot[] {
    return this.channelSnapshots()
  }

  getChannel(name: string): ChannelSnapshot | undefined {
    return this.channelSnapshots().find((channel) => channel.name === name)
  }

  // -------------------------------------------------------------- lifecycle

  clear() {
    this.events = []
    this.pendingEvents = []
    this.stats = {
      totalEvents: 0,
      dropped: 0,
      messagesIn: 0,
      messagesOut: 0,
      presence: 0,
      errors: 0,
      startedAt: Date.now(),
    }
    for (const record of this.channels.values()) {
      record.counters = { in: 0, out: 0, presence: 0, errors: 0 }
    }
    // A released channel with no listeners has nothing left to show once its
    // counters are gone, so drop it rather than leaving a dead row behind.
    for (const [name, record] of this.channels) {
      if (record.released && record.listeners.length === 0) {
        this.channels.delete(name)
      }
    }
    this.flushNow()
  }

  snapshot(): Snapshot {
    return {
      connection: this.connection,
      channels: this.channelSnapshots(),
      events: [...this.events],
      stats: this.stats,
      capabilities: this.capabilities,
      options: this.options,
    }
  }

  flushNow() {
    this.flushEvents()
    if (this.channelTimer) {
      clearTimeout(this.channelTimer)
      this.channelTimer = null
    }
    if (this.sink) {
      this.sink.channels(this.channelSnapshots())
      this.sink.connection(this.connection)
      this.sink.stats(this.stats)
    }
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.channelTimer) clearTimeout(this.channelTimer)
    this.flushTimer = null
    this.channelTimer = null
    this.sink = null
  }
}

/** A host-supplied resolver is untrusted code; never let it break a flush. */
function safeLabels(
  resolver: () => Record<string, string[]>,
): Record<string, string[]> | null {
  try {
    return resolver()
  } catch {
    return null
  }
}
