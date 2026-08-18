/**
 * Agent tool contracts for `rozenite agent`.
 *
 * These are the wire contract for the *agent* surface, in the same way that
 * `AblyDevToolsEventMap` is the wire contract for the panel. They live in
 * `shared/` because both ends need them: the device registers handlers against
 * them (`sdk/use-ably-agent-tools.ts`) and `@rozenite/agent-sdk` consumers get
 * them as typed descriptors (the package's `./sdk` entry point).
 *
 * Two rules shape the design:
 *
 *  - **List tools never return payload bodies.** A single message can carry
 *    128 KB, so a page of twenty would be worse than useless in an agent's
 *    context. `list-events` returns flat rows with a size and a summary;
 *    `read-event` returns the decoded payload for exactly one of them.
 *  - **Rows are one level deep.** Cursor pagination projects rows onto selected
 *    fields columnar-style, which only addresses top-level keys — so per-channel
 *    counters are flattened rather than nested.
 */

import {
  defineAgentToolContract,
  definePaginatedAgentToolContract,
  type AgentToolContract,
  type PageEnvelope,
} from '@rozenite/agent-shared'

import type {
  AblyEvent,
  ChannelAction,
  ChannelSnapshot,
  Capabilities,
  ConnectionSnapshot,
  Direction,
  EventKind,
  SdkOptions,
  SessionStats,
} from './types'

export const EVENT_KINDS = [
  'message',
  'presence',
  'channel-state',
  'connection-state',
  'error',
  'protocol',
] as const satisfies readonly EventKind[]

export const DIRECTIONS = ['in', 'out', 'none'] as const satisfies readonly Direction[]

export const CHANNEL_ACTIONS = [
  'attach',
  'detach',
  'release',
] as const satisfies readonly ChannelAction[]

/** Newest-first is the default because "what just happened" is the common ask. */
export type SortOrder = 'asc' | 'desc'

// ------------------------------------------------------------------- rows

/**
 * One row in `list-events`. Deliberately not `AblyEvent`: the payload is
 * replaced by its size, so a page stays small enough to read.
 */
export type AblyEventRow = {
  id: number
  ts: number
  kind: EventKind
  dir: Direction
  channel?: string
  name?: string
  summary: string
  /** Approximate payload size in bytes; absent when there is no payload. */
  bytes?: number
  /** True when `read-event` on this id will return a decoded payload. */
  hasPayload: boolean
  /** Flattened error message, so the row stays one level deep. */
  error?: string
}

/** One row in `list-channels`, with counters flattened for field projection. */
export type AblyChannelRow = {
  name: string
  state: ChannelSnapshot['state']
  /** Milliseconds the channel has been in `state`. */
  msInState: number
  subscriberCount: number
  in: number
  out: number
  presence: number
  errors: number
  released: boolean
  everAttached: boolean
  lastActivity?: number
  labels?: string[]
  /** Flattened `reason.message`. */
  error?: string
}

// ------------------------------------------------------------------- args

export type GetConnectionArgs = undefined
export type GetConnectionResult = {
  connection: ConnectionSnapshot
  /** Milliseconds the connection has been in its current state. */
  msInState: number
  capabilities: Capabilities
}

export type ListChannelsArgs = {
  state?: ChannelSnapshot['state']
  /** Substring match on the channel name. */
  search?: string
  /** Include channels that have been released. Defaults to false. */
  includeReleased?: boolean
  /** Only channels with at least one recorded error. Defaults to false. */
  onlyErrored?: boolean
  limit?: number
  cursor?: string
}
export type ListChannelsResult = {
  items: AblyChannelRow[]
  page: PageEnvelope
}

export type ReadChannelArgs = { name: string }
export type ReadChannelResult = { channel: ChannelSnapshot }

export type ListEventsArgs = {
  channel?: string
  kind?: EventKind
  dir?: Direction
  /** Case-insensitive substring match over summary, name, channel and payload. */
  search?: string
  /** Only events at or after this epoch-millisecond timestamp. */
  since?: number
  order?: SortOrder
  limit?: number
  cursor?: string
}
export type ListEventsResult = {
  items: AblyEventRow[]
  page: PageEnvelope
}

export type ReadEventArgs = {
  id: number
  /**
   * Cap on the payload text returned, in bytes. Defaults to 8192 — enough for
   * an ordinary message, small enough that an unexpectedly large one cannot
   * flood the caller.
   */
  maxBytes?: number
}
export type ReadEventResult = { event: AblyEvent }

export type GetStatsArgs = undefined
export type GetStatsResult = {
  stats: SessionStats
  options: SdkOptions
  capabilities: Capabilities
  /** Events currently retained in the ring buffer. */
  retained: number
}

export type SetOptionsArgs = Partial<SdkOptions>
export type SetOptionsResult = { options: SdkOptions }

export type ClearArgs = undefined
export type ClearResult = { cleared: true }

export type ChannelActionArgs = { action: ChannelAction; channel: string }
export type ChannelActionResult = {
  channel: string
  action: ChannelAction
  /**
   * The action was handed to ably-js. Attach and detach resolve asynchronously,
   * so this reports dispatch, not completion — poll `read-channel` for the
   * resulting state.
   */
  dispatched: true
}

// -------------------------------------------------------------- contracts

const channelNameProperty = {
  channel: { type: 'string', description: 'Ably channel name.' },
} as const

export const ablyToolDefinitions = {
  getConnection: defineAgentToolContract<GetConnectionArgs, GetConnectionResult>({
    name: 'get-connection',
    description:
      'Read the current Ably connection state, including the failure reason and retry delay when the connection is not healthy.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    idempotent: true,
  }),

  listChannels: definePaginatedAgentToolContract<ListChannelsArgs, ListChannelsResult>({
    name: 'list-channels',
    description:
      'List every channel the client has touched, with attach state, subscriber count and per-channel counters. Released and detached channels are excluded unless asked for, because a channel that is missing when you expect it is the common bug.',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          description: 'Only channels in this attach state.',
        },
        search: {
          type: 'string',
          description: 'Substring match on the channel name.',
        },
        includeReleased: {
          type: 'boolean',
          description: 'Include released channels. Defaults to false.',
        },
        onlyErrored: {
          type: 'boolean',
          description:
            'Only channels with at least one recorded error. Defaults to false.',
        },
        limit: { type: 'number', description: 'Page size.' },
        cursor: { type: 'string', description: 'Cursor from a previous page.' },
      },
    },
    pagination: {
      kind: 'cursor',
      fields: [
        'name',
        'state',
        'msInState',
        'subscriberCount',
        'in',
        'out',
        'presence',
        'errors',
        'released',
        'everAttached',
        'lastActivity',
        'labels',
        'error',
      ],
      defaultFields: ['name', 'state', 'subscriberCount', 'in', 'out', 'errors'],
    },
    readOnly: true,
    idempotent: true,
  }),

  readChannel: defineAgentToolContract<ReadChannelArgs, ReadChannelResult>({
    name: 'read-channel',
    description:
      'Read one channel in full, including its registered listeners, params, modes and error reason.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Ably channel name.' },
      },
      required: ['name'],
    },
    readOnly: true,
    idempotent: true,
  }),

  listEvents: definePaginatedAgentToolContract<ListEventsArgs, ListEventsResult>({
    name: 'list-events',
    description:
      'List captured events — messages, presence, state transitions and errors. Payload bodies are omitted; use read-event for one event id.',
    inputSchema: {
      type: 'object',
      properties: {
        ...channelNameProperty,
        kind: {
          type: 'string',
          enum: [...EVENT_KINDS],
          description: 'Only events of this kind.',
        },
        dir: {
          type: 'string',
          enum: [...DIRECTIONS],
          description: 'Only events in this direction.',
        },
        search: {
          type: 'string',
          description:
            'Case-insensitive substring match over the summary, event name, channel and decoded payload.',
        },
        since: {
          type: 'number',
          description: 'Only events at or after this epoch-millisecond timestamp.',
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Chronological order. Defaults to desc (newest first).',
        },
        limit: { type: 'number', description: 'Page size.' },
        cursor: { type: 'string', description: 'Cursor from a previous page.' },
      },
    },
    pagination: {
      kind: 'cursor',
      fields: [
        'id',
        'ts',
        'kind',
        'dir',
        'channel',
        'name',
        'summary',
        'bytes',
        'hasPayload',
        'error',
      ],
      defaultFields: ['id', 'ts', 'kind', 'dir', 'channel', 'summary'],
    },
    readOnly: true,
    idempotent: true,
  }),

  readEvent: defineAgentToolContract<ReadEventArgs, ReadEventResult>({
    name: 'read-event',
    description:
      'Read one event in full, including its decoded payload. The payload is clipped to maxBytes (8KB by default) and marked truncated, with byteLength reporting the true size.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Event id from list-events.' },
        maxBytes: {
          type: 'number',
          description:
            'Cap on returned payload text. Defaults to 8192, maximum 131072.',
        },
      },
      required: ['id'],
    },
    readOnly: true,
    idempotent: true,
  }),

  getStats: defineAgentToolContract<GetStatsArgs, GetStatsResult>({
    name: 'get-stats',
    description:
      'Read session counters, current capture options, and how many events were dropped by the ring buffer.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    idempotent: true,
  }),

  setOptions: defineAgentToolContract<SetOptionsArgs, SetOptionsResult>({
    name: 'set-options',
    description:
      'Change capture options. Affects only what this inspector records, never the app’s Ably state. Enabling captureProtocol sets the ably-js log level to 4, which is noisy and slows the SDK.',
    inputSchema: {
      type: 'object',
      properties: {
        paused: {
          type: 'boolean',
          description: 'While paused, events are dropped rather than buffered.',
        },
        captureProtocol: {
          type: 'boolean',
          description:
            'Capture raw ably-js protocol frames. Unavailable when get-connection reports capabilities.protocol false.',
        },
        maxEvents: {
          type: 'number',
          description: 'Ring-buffer size. Lowering it drops the oldest events now.',
        },
      },
    },
    idempotent: true,
  }),

  clear: defineAgentToolContract<ClearArgs, ClearResult>({
    name: 'clear',
    description:
      'Discard all captured events and reset counters. Useful to get a clean baseline before reproducing something.',
    inputSchema: { type: 'object', properties: {} },
    destructive: true,
    idempotent: true,
  }),

  channelAction: defineAgentToolContract<ChannelActionArgs, ChannelActionResult>({
    name: 'channel-action',
    description:
      'Attach, detach or release a channel on the running app. This changes real Ably state, not just what is recorded — release drops the channel and its listeners.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...CHANNEL_ACTIONS],
          description: 'Action to perform.',
        },
        ...channelNameProperty,
      },
      required: ['action', 'channel'],
    },
    destructive: true,
  }),
} as const satisfies Record<string, AgentToolContract<unknown, unknown>>
