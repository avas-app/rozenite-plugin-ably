/**
 * The wire contract shared by the React Native SDK and the DevTools panel.
 *
 * Everything crossing the Rozenite bridge is structured-clone'd, so every type
 * here must be plain JSON — no class instances, no functions, no cycles. The
 * SDK is responsible for flattening Ably's `ErrorInfo`/`Message` objects into
 * these shapes before sending.
 */

/** Mirrors `Ably.ConnectionState`. */
export type ConnectionState =
  | 'initialized'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'suspended'
  | 'closing'
  | 'closed'
  | 'failed'

/** Mirrors `Ably.ChannelState`. */
export type ChannelState =
  | 'initialized'
  | 'attaching'
  | 'attached'
  | 'detaching'
  | 'detached'
  | 'suspended'
  | 'failed'

/** Channel states that mean "this channel is live and receiving". */
export const LIVE_CHANNEL_STATES: ChannelState[] = ['attached']

/** Channel states that mean "this channel is broken, not just idle". */
export const BROKEN_CHANNEL_STATES: ChannelState[] = ['failed', 'suspended']

/** A flattened `Ably.ErrorInfo`. */
export type SerializedError = {
  message: string
  /** Ably error code (e.g. 40142 = token expired). */
  code?: number
  statusCode?: number
  href?: string
}

/**
 * How a payload was decoded. `json` means we successfully produced a structured
 * value; `raw` carries the original string when the payload arrived as a JSON
 * string, so the panel can offer a "raw" toggle without a second round-trip.
 */
export type PayloadKind =
  | 'json'
  | 'string'
  | 'number'
  | 'boolean'
  | 'binary'
  | 'null'
  | 'undecodable'

export type SerializedPayload = {
  kind: PayloadKind
  /** Structured value for `json`; the scalar itself for string/number/boolean. */
  value?: unknown
  /** Original text when the payload was a JSON string that we parsed. */
  raw?: string
  /** Set when the payload exceeded the size cap and was clipped. */
  truncated?: boolean
  /** Approximate encoded size in bytes. */
  byteLength?: number
  /** Ably's `encoding` field, verbatim (e.g. `json/utf-8/cipher+aes-256-cbc`). */
  encoding?: string | null
  /** Why decoding failed, for `undecodable`. */
  note?: string
}

/** One registered subscriber on a channel. */
export type ChannelListener = {
  /**
   * Caller-supplied source label. The SDK cannot infer this — it arrives via
   * the optional `labels` source (see `AblyDevToolsOptions`), which lets an app
   * map channel names to the feature that subscribed.
   */
  label?: string
  subscribedAt: number
  /** Event-name filter when the app used `subscribe(name, cb)`. */
  events?: string[]
}

export type ChannelCounters = {
  in: number
  out: number
  presence: number
  errors: number
}

/**
 * A channel as the panel sees it. Channels are retained after detach/release so
 * the panel can show *disconnected* channels too — `released` and `state`
 * together describe whether it is live, idle, or gone.
 */
export type ChannelSnapshot = {
  name: string
  state: ChannelState
  /** `Date.now()` when the channel entered `state`. */
  since: number
  firstSeen: number
  lastActivity?: number
  reason?: SerializedError
  /** Number of app listeners currently registered (excludes our own spy). */
  subscriberCount: number
  listeners: ChannelListener[]
  counters: ChannelCounters
  /** True once `channels.release(name)` was called. */
  released: boolean
  /** True if the channel reached `attached` at least once. */
  everAttached: boolean
  /** Labels contributed by the host app's label source. */
  labels?: string[]
  params?: Record<string, string>
  modes?: string[]
}

export type ConnectionSnapshot = {
  state: ConnectionState
  previous?: ConnectionState
  /** `Date.now()` when the connection entered `state`. */
  since: number
  id?: string
  key?: string
  clientId?: string
  reason?: SerializedError
  /** Milliseconds until the SDK's next auto-retry, when it advertises one. */
  retryIn?: number
}

export type EventKind =
  | 'message'
  | 'presence'
  | 'channel-state'
  | 'connection-state'
  | 'error'
  | 'protocol'

export type Direction = 'in' | 'out' | 'none'

/**
 * One row in the event stream. A single flat shape (rather than a discriminated
 * union) keeps the panel's table, filtering, and virtualization simple; fields
 * that do not apply to a given `kind` are simply absent.
 */
export type AblyEvent = {
  /** Monotonic per-session id, also used as the React key. */
  id: number
  ts: number
  kind: EventKind
  dir: Direction
  channel?: string
  /** Message name, presence action, or state transition target. */
  name?: string
  /** Pre-rendered one-line description, so the panel never re-derives it. */
  summary: string
  payload?: SerializedPayload
  error?: SerializedError
  /** Ably `message.id`, used to correlate duplicates across reconnects. */
  messageId?: string
  clientId?: string
  connectionId?: string
  /** Server-assigned timestamp, distinct from local `ts`. */
  timestamp?: number
  /** State transitions: where we came from. */
  from?: string
  labels?: string[]
}

/** Rolling counters for the panel's header. */
export type SessionStats = {
  totalEvents: number
  /** Events discarded because the ring buffer wrapped. */
  dropped: number
  messagesIn: number
  messagesOut: number
  presence: number
  errors: number
  startedAt: number
}

/** What the SDK managed to hook, so the panel can explain gaps honestly. */
export type Capabilities = {
  /** `client.setLog` was present, so protocol capture is available. */
  protocol: boolean
  /** A label source was supplied by the host app. */
  labels: boolean
}

export type SdkOptions = {
  paused: boolean
  captureProtocol: boolean
  maxEvents: number
}

/**
 * The full state of a session. Sent on connect and on explicit request so a
 * panel that opens late (or reloads) gets complete history rather than only
 * events from the moment it attached.
 */
export type Snapshot = {
  connection: ConnectionSnapshot
  channels: ChannelSnapshot[]
  events: AblyEvent[]
  stats: SessionStats
  capabilities: Capabilities
  options: SdkOptions
}

/** Actions the panel can invoke against a channel. */
export type ChannelAction = 'attach' | 'detach' | 'release'

/**
 * The Rozenite bridge event map. `ably:*` names are prefixed to avoid collisions
 * if this map is ever merged with another plugin's.
 */
export type AblyDevToolsEventMap = {
  // ---- React Native -> panel ----
  'ably:snapshot': Snapshot
  'ably:events': { events: AblyEvent[] }
  'ably:connection': ConnectionSnapshot
  'ably:channels': { channels: ChannelSnapshot[] }
  'ably:stats': SessionStats
  'ably:options': SdkOptions

  // ---- panel -> React Native ----
  'ably:request-snapshot': Record<string, never>
  'ably:clear': Record<string, never>
  'ably:set-options': Partial<SdkOptions>
  'ably:channel-action': { action: ChannelAction; channel: string }
}

/**
 * Bridge identifier, matched on both ends of the DevTools connection.
 *
 * It only has to agree between the app and the panel, but it must not collide
 * with another plugin — so it mirrors the package name, which is what the
 * official Rozenite plugins do (`@rozenite/mmkv-plugin`, etc.). Keep it in step
 * with `name` in package.json.
 */
export const PLUGIN_ID = '@avasapp/rozenite-plugin-ably'
