import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'

import type {
  AblyDevToolsEventMap,
  AblyEvent,
  Capabilities,
  ChannelAction,
  ChannelSnapshot,
  ConnectionSnapshot,
  SdkOptions,
  SessionStats,
  Snapshot,
} from '../shared/types'
import { PLUGIN_ID } from '../shared/types'

/**
 * Panel-side retention. Kept above the device default so the panel is not the
 * component that silently drops history; the device's ring buffer stays the
 * single place where retention is decided.
 */
const PANEL_MAX_EVENTS = 5000

export type PanelState = {
  /** True once a snapshot has arrived — distinguishes "no app" from "app idle". */
  hydrated: boolean
  connection: ConnectionSnapshot
  channels: ChannelSnapshot[]
  events: AblyEvent[]
  stats: SessionStats
  capabilities: Capabilities
  options: SdkOptions
}

const INITIAL: PanelState = {
  hydrated: false,
  connection: { state: 'initialized', since: Date.now() },
  channels: [],
  events: [],
  stats: {
    totalEvents: 0,
    dropped: 0,
    messagesIn: 0,
    messagesOut: 0,
    presence: 0,
    errors: 0,
    startedAt: Date.now(),
  },
  capabilities: { protocol: false, labels: false },
  options: { paused: false, captureProtocol: false, maxEvents: 1000 },
}

type Action =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'events'; events: AblyEvent[] }
  | { type: 'channels'; channels: ChannelSnapshot[] }
  | { type: 'connection'; connection: ConnectionSnapshot }
  | { type: 'stats'; stats: SessionStats }
  | { type: 'options'; options: SdkOptions }
  | { type: 'reset' }

function reducer(state: PanelState, action: Action): PanelState {
  switch (action.type) {
    case 'snapshot':
      return {
        hydrated: true,
        connection: action.snapshot.connection,
        channels: action.snapshot.channels,
        events: action.snapshot.events,
        stats: action.snapshot.stats,
        capabilities: action.snapshot.capabilities,
        options: action.snapshot.options,
      }
    case 'events': {
      if (action.events.length === 0) return state
      const next = state.events.concat(action.events)
      return {
        ...state,
        events:
          next.length > PANEL_MAX_EVENTS
            ? next.slice(next.length - PANEL_MAX_EVENTS)
            : next,
      }
    }
    case 'channels':
      return { ...state, channels: action.channels }
    case 'connection':
      return { ...state, connection: action.connection }
    case 'stats':
      return { ...state, stats: action.stats }
    case 'options':
      return { ...state, options: action.options }
    case 'reset':
      return { ...INITIAL, hydrated: state.hydrated }
    default:
      return state
  }
}

export type PanelActions = {
  clear: () => void
  setOptions: (next: Partial<SdkOptions>) => void
  channelAction: (action: ChannelAction, channel: string) => void
  refresh: () => void
}

export function useAblyPanel(): {
  state: PanelState
  actions: PanelActions
  /** Null until the bridge connects to the app. */
  bridgeReady: boolean
} {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const client = useRozeniteDevToolsClient<AblyDevToolsEventMap>({
    pluginId: PLUGIN_ID,
  })

  useEffect(() => {
    if (!client) return

    const subscriptions = [
      client.onMessage('ably:snapshot', (snapshot) =>
        dispatch({ type: 'snapshot', snapshot }),
      ),
      client.onMessage('ably:events', ({ events }) =>
        dispatch({ type: 'events', events }),
      ),
      client.onMessage('ably:channels', ({ channels }) =>
        dispatch({ type: 'channels', channels }),
      ),
      client.onMessage('ably:connection', (connection) =>
        dispatch({ type: 'connection', connection }),
      ),
      client.onMessage('ably:stats', (stats) => dispatch({ type: 'stats', stats })),
      client.onMessage('ably:options', (options) =>
        dispatch({ type: 'options', options }),
      ),
    ]

    // The app may have been running long before this panel opened.
    client.send('ably:request-snapshot', {})

    return () => subscriptions.forEach((s) => s.remove())
  }, [client])

  const actions = useMemo<PanelActions>(
    () => ({
      clear: () => {
        dispatch({ type: 'reset' })
        client?.send('ably:clear', {})
      },
      setOptions: (next) => client?.send('ably:set-options', next),
      channelAction: (action, channel) =>
        client?.send('ably:channel-action', { action, channel }),
      refresh: () => client?.send('ably:request-snapshot', {}),
    }),
    [client],
  )

  const bridgeReady = Boolean(client)

  return { state, actions, bridgeReady }
}

/** Stable empty array so filtered selectors do not churn referential identity. */
export const EMPTY_EVENTS: AblyEvent[] = []

export function useNow(intervalMs = 1000): number {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return Date.now()
}

export function useStableCallback<T extends (...args: never[]) => unknown>(
  fn: T,
): T {
  return useCallback(fn, [fn])
}
