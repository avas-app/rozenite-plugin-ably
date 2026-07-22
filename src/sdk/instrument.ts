import type { AblyEvent, ChannelState, ConnectionState } from '../shared/types'
import { serializeError, serializePayload } from './serialize'
import type { Session } from './session'

/**
 * Instruments a live `Ably.Realtime` client by patching its public surface.
 *
 * Design rules, in priority order:
 *
 *  1. **Never change delivery behaviour.** The app's own listeners are passed
 *     through untouched — we never wrap them. Message *content* is observed via
 *     a separate passive "spy" subscription, so a bug in this file cannot stop
 *     the app receiving a message.
 *  2. **Never throw into app code.** Every patched method calls through inside
 *     a try/finally, and all bookkeeping is wrapped so an exception here can
 *     never surface as an Ably error.
 *  3. **Never cause an attach the app did not ask for.** Spy subscriptions are
 *     installed lazily, only once the app has itself subscribed to that channel,
 *     because that is the point at which an attach was already going to happen.
 *  4. **Fully reversible.** Every patch stores its original and is restored on
 *     dispose, so hot reload cannot stack wrappers.
 *
 * The client is typed structurally rather than against `ably` so this package
 * has no runtime or type dependency on the SDK version in the host app.
 */

const INSTRUMENTED = Symbol.for('rozenite-plugin-ably.instrumented')

/**
 * Deliberately loose. This is the interop boundary with an SDK we do not
 * import: `(...args: unknown[]) => unknown` would be *stricter* than the real
 * methods and, under `strictFunctionTypes`, would make a genuine
 * `Ably.Realtime` fail to satisfy `ClientLike` through parameter
 * contravariance. `any` here is what makes the structural typing work against
 * every ably-js version.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any

type PresenceLike = {
  subscribe: AnyFn
  unsubscribe: AnyFn
  enter?: AnyFn
  leave?: AnyFn
  update?: AnyFn
  enterClient?: AnyFn
  leaveClient?: AnyFn
  updateClient?: AnyFn
}

type ChannelLike = {
  name: string
  state: string
  subscribe: AnyFn
  unsubscribe: AnyFn
  publish?: AnyFn
  on: AnyFn
  off: AnyFn
  attach?: () => Promise<unknown>
  detach?: () => Promise<unknown>
  presence?: PresenceLike
  params?: Record<string, string>
  modes?: string[]
}

type ChannelsLike = {
  get: AnyFn
  release?: AnyFn
  all?: Record<string, ChannelLike>
}

type ConnectionLike = {
  state: string
  id?: string
  key?: string
  on: AnyFn
  off: AnyFn
}

export type ClientLike = {
  channels: ChannelsLike
  connection: ConnectionLike
  auth?: { clientId?: string }
  /** Present on real clients but absent from the public typings. */
  setLog?: (options: { level?: number; handler?: AnyFn }) => void
}

type ChannelPatch = {
  channel: ChannelLike
  originalSubscribe: AnyFn
  originalUnsubscribe: AnyFn
  originalPublish?: AnyFn
  originalPresenceSubscribe?: AnyFn
  presenceOutbound: { key: string; original: AnyFn }[]
  stateListener: AnyFn
  spyListener: AnyFn | null
  presenceSpy: AnyFn | null
  /** App listener registrations, so unsubscribe can find the right record. */
  registrations: { id: number; listener: unknown; events?: string[] }[]
}

/** Runs bookkeeping so that a throw can never escape into the app's call path. */
function guard(fn: () => void): void {
  try {
    fn()
  } catch {
    // Instrumentation must stay invisible; swallow and carry on.
  }
}

/**
 * Reads and serializes a payload without trusting property access.
 *
 * `message.data` can be a getter — Ably's own decoding is lazy, and user code
 * can hand us anything. If reading it throws we still record the event, marked
 * undecodable, because silently dropping it would make the stream claim a
 * message never arrived when the app plainly received one.
 */
function readPayload(
  read: () => unknown,
  encoding?: string | null,
): ReturnType<typeof serializePayload> {
  let raw: unknown
  try {
    raw = read()
  } catch (error) {
    return {
      kind: 'undecodable',
      note: error instanceof Error ? error.message : 'payload access threw',
      encoding,
    }
  }
  return serializePayload(raw, encoding)
}

/** Property access that yields `undefined` instead of throwing. */
function safeRead<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

/** Normalises the many `publish()` overloads into a flat list. */
function describePublish(args: unknown[]): { name?: string; data: unknown }[] {
  const [first, second] = args

  if (typeof first === 'string') return [{ name: first, data: second }]

  if (Array.isArray(first)) {
    return first.map((m) => {
      const msg = m as { name?: string; data?: unknown } | null
      return { name: msg?.name, data: msg?.data }
    })
  }

  if (first && typeof first === 'object') {
    const msg = first as { name?: string; data?: unknown }
    return [{ name: msg.name, data: msg.data }]
  }

  return [{ data: first }]
}

/** Extracts the event-name filter (if any) from a `subscribe()` call. */
function describeSubscribe(args: unknown[]): {
  events?: string[]
  listener: unknown
} {
  const [first, second] = args

  if (typeof first === 'function') return { listener: first }
  if (typeof first === 'string') return { events: [first], listener: second }
  if (Array.isArray(first)) {
    return {
      events: first.filter((e): e is string => typeof e === 'string'),
      listener: second,
    }
  }
  // MessageFilter object form — the filter is not a plain event-name list.
  if (first && typeof first === 'object') return { listener: second }
  return { listener: undefined }
}

function summarisePayloadSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return ` · ${bytes}B`
  return ` · ${(bytes / 1024).toFixed(1)}KB`
}

export function instrumentClient(
  client: ClientLike,
  session: Session,
): () => void {
  const marked = client as unknown as Record<symbol, unknown>
  if (marked[INSTRUMENTED]) {
    // Already instrumented (typically a hot reload that re-ran the hook).
    return () => {}
  }
  marked[INSTRUMENTED] = true

  const patches = new Map<string, ChannelPatch>()
  const restorers: (() => void)[] = []

  // ------------------------------------------------------------- connection

  const connection = client.connection

  const connectionListener = ((change: {
    previous?: string
    current?: string
    reason?: unknown
    retryIn?: number
  }) => {
    guard(() => {
      const current = (change?.current ?? connection.state) as ConnectionState
      const previous = change?.previous as ConnectionState | undefined
      const reason = serializeError(change?.reason)

      session.setConnection({
        state: current,
        previous,
        id: connection.id,
        key: connection.key,
        clientId: client.auth?.clientId,
        reason,
        retryIn: change?.retryIn,
      })

      session.push({
        kind: 'connection-state',
        dir: 'none',
        name: current,
        from: previous,
        summary: previous
          ? `connection ${previous} → ${current}`
          : `connection ${current}`,
        error: reason,
      })
    })
  }) as AnyFn

  connection.on(connectionListener)
  restorers.push(() => {
    guard(() => connection.off(connectionListener))
  })

  // Seed the initial connection state so the panel is correct before the first
  // transition rather than showing `initialized` until something happens.
  guard(() => {
    session.setConnection({
      state: connection.state as ConnectionState,
      id: connection.id,
      key: connection.key,
      clientId: client.auth?.clientId,
    })
  })

  // ---------------------------------------------------------------- channel

  function installSpy(patch: ChannelPatch) {
    if (patch.spyListener) return
    const { channel } = patch

    const spy = ((message: {
      name?: string
      data?: unknown
      id?: string
      clientId?: string
      connectionId?: string
      timestamp?: number
      encoding?: string | null
    }) => {
      guard(() => {
        const encoding = safeRead(() => message?.encoding)
        const payload = readPayload(() => message?.data, encoding)
        const name = safeRead(() => message?.name)
        session.push({
          kind: 'message',
          dir: 'in',
          channel: channel.name,
          name,
          messageId: safeRead(() => message?.id),
          clientId: safeRead(() => message?.clientId),
          connectionId: safeRead(() => message?.connectionId),
          timestamp: safeRead(() => message?.timestamp),
          payload,
          summary: `${name ?? '(unnamed)'}${summarisePayloadSize(
            payload.byteLength,
          )}`,
        })
      })
    }) as AnyFn

    patch.spyListener = spy

    // Call the ORIGINAL subscribe — the patched one would recurse.
    try {
      const result = patch.originalSubscribe.call(channel, spy) as
        | Promise<unknown>
        | undefined
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        // An attach failure is the app's problem to surface, not ours; we only
        // avoid an unhandled rejection.
        ;(result as Promise<unknown>).catch(() => {})
      }
    } catch {
      patch.spyListener = null
    }
  }

  function installPresenceSpy(patch: ChannelPatch) {
    if (patch.presenceSpy || !patch.originalPresenceSubscribe) return
    const presence = patch.channel.presence
    if (!presence) return

    const spy = ((member: {
      action?: string
      clientId?: string
      connectionId?: string
      data?: unknown
      id?: string
      timestamp?: number
    }) => {
      guard(() => {
        const payload = readPayload(() => member?.data)
        const action = safeRead(() => member?.action)
        const clientId = safeRead(() => member?.clientId)
        session.push({
          kind: 'presence',
          dir: 'in',
          channel: patch.channel.name,
          name: action,
          messageId: safeRead(() => member?.id),
          clientId,
          connectionId: safeRead(() => member?.connectionId),
          timestamp: safeRead(() => member?.timestamp),
          payload,
          summary: `presence ${action ?? '?'}${clientId ? ` · ${clientId}` : ''}`,
        })
      })
    }) as AnyFn

    patch.presenceSpy = spy
    try {
      const result = patch.originalPresenceSubscribe.call(presence, spy) as
        | Promise<unknown>
        | undefined
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        ;(result as Promise<unknown>).catch(() => {})
      }
    } catch {
      patch.presenceSpy = null
    }
  }

  function patchChannel(channel: ChannelLike) {
    if (!channel || patches.has(channel.name)) return
    const channelMarked = channel as unknown as Record<symbol, unknown>
    if (channelMarked[INSTRUMENTED]) return
    channelMarked[INSTRUMENTED] = true

    const patch: ChannelPatch = {
      channel,
      originalSubscribe: channel.subscribe.bind(channel),
      originalUnsubscribe: channel.unsubscribe.bind(channel),
      originalPublish: channel.publish?.bind(channel),
      originalPresenceSubscribe: channel.presence?.subscribe.bind(
        channel.presence,
      ),
      presenceOutbound: [],
      stateListener: (() => {}) as AnyFn,
      spyListener: null,
      presenceSpy: null,
      registrations: [],
    }

    guard(() => {
      session.touchChannel(channel.name, {
        params: channel.params,
        modes: channel.modes,
      })
      session.setChannelState(channel.name, channel.state as ChannelState)
    })

    // ---- state transitions
    const stateListener = ((change: {
      previous?: string
      current?: string
      reason?: unknown
    }) => {
      guard(() => {
        const current = (change?.current ?? channel.state) as ChannelState
        const previous = change?.previous as ChannelState | undefined
        const reason = serializeError(change?.reason)

        session.setChannelState(channel.name, current, reason)
        session.push({
          kind: reason ? 'error' : 'channel-state',
          dir: 'none',
          channel: channel.name,
          name: current,
          from: previous,
          summary: previous
            ? `${previous} → ${current}`
            : `channel ${current}`,
          error: reason,
        })
      })
    }) as AnyFn

    patch.stateListener = stateListener
    channel.on(stateListener)

    // ---- subscribe / unsubscribe: registration tracking only, never wrapping
    //      the app's listener.
    ;(channel as { subscribe: AnyFn }).subscribe = ((...args: unknown[]) => {
      let id: number | null = null
      guard(() => {
        const { events, listener } = describeSubscribe(args)
        id = session.addListener(channel.name, undefined, events)
        patch.registrations.push({ id, listener, events })
      })

      try {
        return patch.originalSubscribe.apply(channel, args)
      } finally {
        // Installed after the app's own subscribe so the attach it triggers is
        // attributable to the app, not to us.
        guard(() => installSpy(patch))
      }
    }) as AnyFn

    ;(channel as { unsubscribe: AnyFn }).unsubscribe = ((
      ...args: unknown[]
    ) => {
      guard(() => {
        if (args.length === 0) {
          // Bare unsubscribe() removes every listener — including our spy.
          session.clearListeners(channel.name)
          patch.registrations = []
          patch.spyListener = null
          return
        }
        const { listener } = describeSubscribe(args)
        const target = typeof args[0] === 'function' ? args[0] : listener
        const index = patch.registrations.findIndex(
          (r) => r.listener === target,
        )
        if (index >= 0) {
          session.removeListener(channel.name, patch.registrations[index].id)
          patch.registrations.splice(index, 1)
        }
      })
      return patch.originalUnsubscribe.apply(channel, args)
    }) as AnyFn

    // ---- publish
    if (patch.originalPublish) {
      ;(channel as { publish: AnyFn }).publish = ((...args: unknown[]) => {
        guard(() => {
          for (const { name, data } of describePublish(args)) {
            const payload = readPayload(() => data)
            session.push({
              kind: 'message',
              dir: 'out',
              channel: channel.name,
              name,
              payload,
              summary: `${name ?? '(unnamed)'}${summarisePayloadSize(
                payload.byteLength,
              )}`,
            })
          }
        })
        return patch.originalPublish!.apply(channel, args)
      }) as AnyFn
    }

    // ---- presence
    const presence = channel.presence
    if (presence && patch.originalPresenceSubscribe) {
      ;(presence as { subscribe: AnyFn }).subscribe = ((
        ...args: unknown[]
      ) => {
        try {
          return patch.originalPresenceSubscribe!.apply(presence, args)
        } finally {
          guard(() => installPresenceSpy(patch))
        }
      }) as AnyFn

      for (const key of [
        'enter',
        'leave',
        'update',
        'enterClient',
        'leaveClient',
        'updateClient',
      ] as const) {
        const original = presence[key]
        if (typeof original !== 'function') continue
        const bound = original.bind(presence)
        patch.presenceOutbound.push({ key, original: bound })
        ;(presence as unknown as Record<string, AnyFn>)[key] = ((
          ...args: unknown[]
        ) => {
          guard(() => {
            // enterClient/leaveClient/updateClient take clientId first.
            const takesClientId = key.endsWith('Client')
            const data = takesClientId ? args[1] : args[0]
            const clientId = takesClientId
              ? (args[0] as string | undefined)
              : client.auth?.clientId
            session.push({
              kind: 'presence',
              dir: 'out',
              channel: channel.name,
              name: key,
              clientId,
              payload: serializePayload(data),
              summary: `presence ${key}${clientId ? ` · ${clientId}` : ''}`,
            })
          })
          return bound(...args)
        }) as AnyFn
      }
    }

    patches.set(channel.name, patch)
  }

  function unpatchChannel(patch: ChannelPatch) {
    const { channel } = patch
    guard(() => channel.off(patch.stateListener))
    guard(() => {
      if (patch.spyListener) {
        patch.originalUnsubscribe.call(channel, patch.spyListener)
      }
    })
    guard(() => {
      const presence = channel.presence
      if (presence && patch.presenceSpy) {
        presence.unsubscribe(patch.presenceSpy)
      }
    })

    guard(() => {
      ;(channel as { subscribe: AnyFn }).subscribe = patch.originalSubscribe
      ;(channel as { unsubscribe: AnyFn }).unsubscribe = patch.originalUnsubscribe
      if (patch.originalPublish) {
        ;(channel as { publish: AnyFn }).publish = patch.originalPublish
      }
      const presence = channel.presence
      if (presence && patch.originalPresenceSubscribe) {
        ;(presence as { subscribe: AnyFn }).subscribe =
          patch.originalPresenceSubscribe
      }
      for (const { key, original } of patch.presenceOutbound) {
        if (presence) {
          ;(presence as unknown as Record<string, AnyFn>)[key] = original
        }
      }
    })

    const channelMarked = channel as unknown as Record<symbol, unknown>
    delete channelMarked[INSTRUMENTED]
  }

  // ---- patch the channel factory so future channels are covered
  const channels = client.channels
  const originalGet = channels.get.bind(channels)
  const originalRelease = channels.release?.bind(channels)

  guard(() => {
    ;(channels as { get: AnyFn }).get = ((...args: unknown[]) => {
      const channel = originalGet(...args) as ChannelLike
      guard(() => patchChannel(channel))
      return channel
    }) as AnyFn
  })

  if (originalRelease) {
    guard(() => {
      ;(channels as { release: AnyFn }).release = ((...args: unknown[]) => {
        const name = args[0]
        guard(() => {
          if (typeof name === 'string') {
            const patch = patches.get(name)
            if (patch) {
              unpatchChannel(patch)
              patches.delete(name)
            }
            session.markReleased(name)
            session.push({
              kind: 'channel-state',
              dir: 'none',
              channel: name,
              name: 'released',
              summary: 'channel released',
            })
          }
        })
        return originalRelease(...args)
      }) as AnyFn
    })
  }

  restorers.push(() => {
    guard(() => {
      ;(channels as { get: AnyFn }).get = originalGet
      if (originalRelease) {
        ;(channels as { release: AnyFn }).release = originalRelease
      }
    })
  })

  // ---- sweep channels that already existed before instrumentation
  guard(() => {
    const all = channels.all
    if (all && typeof all === 'object') {
      for (const key of Object.keys(all)) {
        const channel = all[key]
        if (channel && typeof channel.subscribe === 'function') {
          patchChannel(channel)
        }
      }
    }
  })

  // --------------------------------------------------------------- protocol

  let protocolInstalled = false
  session.capabilities.protocol = typeof client.setLog === 'function'

  function setProtocolCapture(enabled: boolean) {
    if (typeof client.setLog !== 'function') return
    if (enabled === protocolInstalled) return

    if (!enabled) {
      // Level 1 (errors only) is ably-js's own default.
      guard(() => client.setLog!({ level: 1 }))
      protocolInstalled = false
      return
    }

    guard(() => {
      client.setLog!({
        level: 4,
        handler: ((msg: unknown) => {
          guard(() => {
            const text = typeof msg === 'string' ? msg : String(msg)
            const action = /action=(\w+)/.exec(text)?.[1]
            const channel = /channel=([^;\]\s]+)/.exec(text)?.[1]
            const received = text.includes('received')
            session.push({
              kind: 'protocol',
              dir: received ? 'in' : 'out',
              channel,
              name: action,
              summary: text.replace(/^Ably:\s*/, '').slice(0, 400),
            })
          })
        }) as AnyFn,
      })
    })
    protocolInstalled = true
  }

  restorers.push(() => setProtocolCapture(false))

  // Expose the toggle to the hook without widening the public API surface.
  ;(session as unknown as Record<string, unknown>).__setProtocolCapture =
    setProtocolCapture

  // Channel actions requested from the panel.
  ;(session as unknown as Record<string, unknown>).__channelAction = (
    action: string,
    name: string,
  ) => {
    guard(() => {
      if (action === 'release') {
        channels.release?.(name)
        return
      }
      const channel = channels.all?.[name]
      if (!channel) return
      const result =
        action === 'attach' ? channel.attach?.() : channel.detach?.()
      if (result && typeof result.catch === 'function') result.catch(() => {})
    })
  }

  // ---------------------------------------------------------------- dispose

  return () => {
    for (const patch of patches.values()) unpatchChannel(patch)
    patches.clear()
    for (const restore of restorers) restore()
    delete marked[INSTRUMENTED]
  }
}

export type { AblyEvent }
