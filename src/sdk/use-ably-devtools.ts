import { useEffect, useRef } from 'react'
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge'

import type { AblyDevToolsEventMap } from '../shared/types'
import { PLUGIN_ID } from '../shared/types'
import type { ClientLike } from './instrument'
import { instrumentClient } from './instrument'
import { Session, type SessionInternals } from './session'
import { useAblyAgentTools } from './use-ably-agent-tools'

/**
 * Supplies human-readable labels for channel names.
 *
 * The SDK cannot infer *why* a channel was subscribed — `device_7b41-…` tells you
 * nothing about which screen wants it. Apps that track that themselves can feed
 * it in here, and the panel shows it alongside each channel.
 *
 * `subscribe` is optional; without it labels are simply re-read on each flush.
 */
export type AblyDevToolsLabelSource = {
  getLabels: () => Record<string, string[]>
  subscribe?: (onChange: () => void) => () => void
}

export type AblyDevToolsOptions = {
  labels?: AblyDevToolsLabelSource
  /** Ring-buffer size. Older events are dropped once exceeded. Default 1000. */
  maxEvents?: number
  /**
   * Capture raw ably-js protocol frames. Off by default: it forces the SDK to
   * log level 4, which is noisy and measurably slower, and those frames are
   * already visible in the Network Activity panel.
   */
  captureProtocol?: boolean
  /** Escape hatch. The plugin is already inert outside `__DEV__`. */
  enabled?: boolean
}

declare const __DEV__: boolean

function isDev(): boolean {
  return typeof __DEV__ === 'undefined' ? false : __DEV__
}

/**
 * Instruments an Ably Realtime client and streams what it observes to the
 * Rozenite DevTools panel.
 *
 * Safe to call unconditionally: it is a no-op outside `__DEV__` and a no-op
 * while `client` is null, so it can be called before the client exists.
 *
 * ```ts
 * useAblyDevTools(getAblyJsClient())
 * ```
 *
 * Instrumentation and bridge wiring are deliberately split across two effects.
 * The panel connects late and can disconnect at any time; keeping the session
 * alive independently means history survives a panel reload instead of
 * restarting from empty.
 */
export function useAblyDevTools(
  client: ClientLike | null | undefined,
  options: AblyDevToolsOptions = {},
): void {
  const {
    labels,
    maxEvents = 1000,
    captureProtocol = false,
    enabled = true,
  } = options

  const active = enabled && isDev() && Boolean(client)

  const sessionRef = useRef<Session | null>(null)

  // Read the latest label source without making it an effect dependency —
  // callers routinely pass an inline object, and re-instrumenting on every
  // render would thrash the channel patches.
  const labelsRef = useRef<AblyDevToolsLabelSource | undefined>(labels)
  labelsRef.current = labels

  const devToolsClient = useRozeniteDevToolsClient<AblyDevToolsEventMap>({
    pluginId: PLUGIN_ID,
  })

  // Agent tools read the same session as the panel, and register independently
  // of it — `rozenite agent` works with no DevTools window open.
  useAblyAgentTools({ sessionRef, enabled: active })

  // ---- instrumentation lifecycle (independent of the panel) ----
  useEffect(() => {
    if (!active || !client) return

    const session = new Session()
    sessionRef.current = session
    session.setOptions({ maxEvents, captureProtocol })

    const dispose = instrumentClient(client, session)
    const internals = session as unknown as SessionInternals

    if (captureProtocol) internals.__setProtocolCapture?.(true)

    const source = labelsRef.current
    let unsubscribeLabels: (() => void) | undefined
    if (source) {
      const resolve = () => labelsRef.current?.getLabels() ?? {}
      session.setLabelResolver(resolve)
      unsubscribeLabels = source.subscribe?.(() => {
        session.setLabelResolver(resolve)
      })
    }

    return () => {
      unsubscribeLabels?.()
      dispose()
      session.dispose()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [active, client, maxEvents, captureProtocol])

  // ---- bridge wiring (re-runs whenever the panel attaches or detaches) ----
  useEffect(() => {
    const session = sessionRef.current
    if (!active || !session || !devToolsClient) return

    session.attachSink({
      events: (events) => devToolsClient.send('ably:events', { events }),
      channels: (channels) => devToolsClient.send('ably:channels', { channels }),
      connection: (connection) =>
        devToolsClient.send('ably:connection', connection),
      stats: (stats) => devToolsClient.send('ably:stats', stats),
      options: (opts) => devToolsClient.send('ably:options', opts),
    })

    devToolsClient.send('ably:snapshot', session.snapshot())

    const internals = session as unknown as SessionInternals

    const subscriptions = [
      devToolsClient.onMessage('ably:request-snapshot', () => {
        devToolsClient.send('ably:snapshot', session.snapshot())
      }),
      devToolsClient.onMessage('ably:clear', () => {
        session.clear()
        devToolsClient.send('ably:snapshot', session.snapshot())
      }),
      devToolsClient.onMessage('ably:set-options', (next) => {
        session.setOptions(next)
        if (next.captureProtocol !== undefined) {
          internals.__setProtocolCapture?.(next.captureProtocol)
        }
      }),
      devToolsClient.onMessage('ably:channel-action', ({ action, channel }) => {
        internals.__channelAction?.(action, channel)
      }),
    ]

    return () => {
      subscriptions.forEach((s) => s.remove())
      session.attachSink(null)
    }
    // `sessionRef.current` is populated by the effect above, which React runs
    // first; `active`/`client` changing re-runs both in order.
  }, [active, client, devToolsClient])
}
