import { describe, expect, test } from 'bun:test'

import * as handlers from '../agent-handlers'
import { instrumentClient } from '../instrument'
import { Session } from '../session'
import type { SessionInternals } from '../session'
import type { MockChannel } from '../../testing/fake-ably'
import { MockClient } from '../../testing/fake-ably'

function setup() {
  const client = new MockClient()
  const session = new Session()
  const dispose = instrumentClient(client as never, session)
  return { client, session, dispose }
}

/** Goes through the *patched* `channels.get`, which is what installs the spy. */
function channelOf(client: MockClient, name: string): MockChannel {
  return client.channels.get(name) as unknown as MockChannel
}

/** A subscribed channel — the spy only exists once the app has subscribed. */
function liveChannel(client: MockClient, name: string): MockChannel {
  const channel = channelOf(client, name)
  channel.subscribe(() => {})
  return channel
}

describe('list-events', () => {
  test('returns newest first by default, oldest first on asc', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'first', data: '1' })
    channel.deliver({ name: 'second', data: '2' })

    const desc = handlers.listEvents(session)
    const asc = handlers.listEvents(session, { order: 'asc' })

    expect(desc.items[0].name).toBe('second')
    expect(asc.items[0].name).toBe('first')
  })

  test('omits payload bodies but reports size and availability', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'tick', data: '{"value":42}' })

    const [row] = handlers.listEvents(session, { kind: 'message' }).items

    expect(row.hasPayload).toBe(true)
    expect(row.bytes).toBe('{"value":42}'.length)
    // The row type has no payload field at all — this is the guarantee that a
    // page stays small enough to read.
    expect(row as Record<string, unknown>).not.toHaveProperty('payload')
  })

  test('filters by channel, kind and direction', () => {
    const { client, session } = setup()
    const a = liveChannel(client, 'a')
    const b = liveChannel(client, 'b')
    a.deliver({ name: 'in-a', data: '1' })
    b.deliver({ name: 'in-b', data: '2' })
    a.publish('out-a', '3')
    a.setState('attached')

    expect(
      handlers.listEvents(session, { channel: 'a', kind: 'message' }).items,
    ).toHaveLength(2)
    expect(
      handlers.listEvents(session, { channel: 'a', kind: 'message', dir: 'out' })
        .items.map((row) => row.name),
    ).toEqual(['out-a'])
    expect(
      handlers.listEvents(session, { kind: 'channel-state' }).items,
    ).toHaveLength(1)
  })

  test('search matches decoded payload contents, not just the summary', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'telemetry', data: '{"deviceId":"device_7b41"}' })
    channel.deliver({ name: 'telemetry', data: '{"deviceId":"device_0000"}' })

    const found = handlers.listEvents(session, { search: 'DEVICE_7B41' })

    expect(found.items).toHaveLength(1)
    expect(found.items[0].bytes).toBe('{"deviceId":"device_7b41"}'.length)
  })

  test('filters by since', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'old', data: '1' })
    const cutoff = Date.now() + 1
    const [old] = session.getEvents()
    expect(old.ts).toBeLessThan(cutoff)

    expect(handlers.listEvents(session, { since: cutoff }).items).toHaveLength(0)
    expect(handlers.listEvents(session, { since: 0 }).items).toHaveLength(1)
  })

  test('cursor paging walks the whole buffer exactly once', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    for (let i = 0; i < 7; i++) channel.deliver({ name: `m${i}`, data: '1' })

    const seen: number[] = []
    let cursor: string | undefined
    let guard = 0

    do {
      const page = handlers.listEvents(session, {
        order: 'asc',
        limit: 3,
        cursor,
        kind: 'message',
      })
      seen.push(...page.items.map((row) => row.id))
      cursor = page.page.nextCursor
      expect(guard++).toBeLessThan(10)
    } while (cursor)

    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  test('cursor paging works descending too', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    for (let i = 0; i < 5; i++) channel.deliver({ name: `m${i}`, data: '1' })

    const first = handlers.listEvents(session, { limit: 2, kind: 'message' })
    const second = handlers.listEvents(session, {
      limit: 2,
      kind: 'message',
      cursor: first.page.nextCursor,
    })

    expect(first.items.map((r) => r.id)).toEqual([5, 4])
    expect(second.items.map((r) => r.id)).toEqual([3, 2])
    expect(second.page.hasMore).toBe(true)
  })

  test('flags reset when the cursor has aged out of the ring buffer', () => {
    const { client, session } = setup()
    session.setOptions({ maxEvents: 5 })
    const channel = liveChannel(client, 'a')
    for (let i = 0; i < 20; i++) channel.deliver({ name: `m${i}`, data: '1' })

    const fresh = handlers.listEvents(session, { order: 'asc' })
    expect(fresh.page.reset).toBeUndefined()

    // Rozenite's contract for a stale cursor: reset with no items, meaning
    // "restart this listing", never a partial page that hides the gap.
    const stale = handlers.listEvents(session, { order: 'asc', cursor: '3' })
    expect(stale.page.reset).toBe(true)
    expect(stale.items).toHaveLength(0)
    expect(stale.page.hasMore).toBe(false)
  })

  test('a still-live cursor is not treated as a reset', () => {
    const { client, session } = setup()
    session.setOptions({ maxEvents: 5 })
    const channel = liveChannel(client, 'a')
    for (let i = 0; i < 20; i++) channel.deliver({ name: `m${i}`, data: '1' })

    const oldest = session.oldestEventId()!
    const page = handlers.listEvents(session, {
      order: 'asc',
      cursor: String(oldest),
    })

    expect(page.page.reset).toBeUndefined()
    expect(page.items.map((row) => row.id)).toEqual([17, 18, 19, 20])
  })

  test('clamps limit into range', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    for (let i = 0; i < 3; i++) channel.deliver({ name: `m${i}`, data: '1' })

    expect(handlers.listEvents(session, { limit: 0 }).page.limit).toBe(1)
    expect(handlers.listEvents(session, { limit: 9999 }).page.limit).toBe(
      handlers.MAX_LIMIT,
    )
    expect(handlers.listEvents(session, { limit: Number.NaN }).page.limit).toBe(20)
  })
})

describe('read-event', () => {
  test('returns the decoded payload', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'tick', data: '{"value":42}' })

    const { event } = handlers.readEvent(session, { id: 1 })

    expect(event.payload?.kind).toBe('json')
    expect(event.payload?.value).toEqual({ value: 42 })
    expect(event.payload?.raw).toBe('{"value":42}')
  })

  test('names the retained id range when the event is gone', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'tick', data: '1' })

    expect(() => handlers.readEvent(session, { id: 99 })).toThrow(
      /retained ids are 1–1/,
    )
  })

  test('says the buffer is empty rather than naming a range', () => {
    const { session } = setup()
    expect(() => handlers.readEvent(session, { id: 1 })).toThrow(
      /the buffer is empty/,
    )
  })
})

describe('list-channels', () => {
  test('hides released channels unless asked', () => {
    const { client, session } = setup()
    liveChannel(client, 'kept')
    liveChannel(client, 'gone')
    client.channels.release?.('gone')

    expect(handlers.listChannels(session).items.map((c) => c.name)).toEqual([
      'kept',
    ])
    expect(
      handlers
        .listChannels(session, { includeReleased: true })
        .items.map((c) => c.name),
    ).toEqual(['gone', 'kept'])
  })

  test('flattens counters onto the row', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'x', data: '1' })
    channel.deliver({ name: 'y', data: '2' })
    channel.publish('z', '3')

    const [row] = handlers.listChannels(session).items

    expect(row.in).toBe(2)
    expect(row.out).toBe(1)
    expect(row.subscriberCount).toBe(1)
    expect(row.msInState).toBeGreaterThanOrEqual(0)
  })

  test('filters by state, name and error', () => {
    const { client, session } = setup()
    const ok = liveChannel(client, 'ok-channel')
    const bad = liveChannel(client, 'bad-channel')
    ok.setState('attached')
    bad.setState('failed', { message: 'nope', code: 40160 })

    expect(
      handlers.listChannels(session, { state: 'attached' }).items.map((c) => c.name),
    ).toEqual(['ok-channel'])
    expect(
      handlers.listChannels(session, { search: 'BAD' }).items.map((c) => c.name),
    ).toEqual(['bad-channel'])

    const errored = handlers.listChannels(session, { onlyErrored: true })
    expect(errored.items.map((c) => c.name)).toEqual(['bad-channel'])
    expect(errored.items[0].error).toBe('nope')
  })

  test('pages by name', () => {
    const { client, session } = setup()
    for (const name of ['c', 'a', 'b']) liveChannel(client, name)

    const first = handlers.listChannels(session, { limit: 2 })
    expect(first.items.map((c) => c.name)).toEqual(['a', 'b'])
    expect(first.page.hasMore).toBe(true)

    const second = handlers.listChannels(session, {
      limit: 2,
      cursor: first.page.nextCursor,
    })
    expect(second.items.map((c) => c.name)).toEqual(['c'])
    expect(second.page.hasMore).toBe(false)
  })
})

describe('read-channel', () => {
  test('returns listeners and state', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.subscribe('named-event', () => {})
    channel.setState('attached')

    const { channel: snapshot } = handlers.readChannel(session, { name: 'a' })

    expect(snapshot.state).toBe('attached')
    expect(snapshot.subscriberCount).toBe(2)
    expect(snapshot.listeners[1].events).toEqual(['named-event'])
  })

  test('points at list-channels when the name is unknown', () => {
    const { session } = setup()
    expect(() => handlers.readChannel(session, { name: 'nope' })).toThrow(
      /Use list-channels/,
    )
  })
})

describe('get-connection', () => {
  test('reports state and failure reason', () => {
    const { client, session } = setup()
    client.setConnectionState('connected')
    client.setConnectionState('failed', { message: 'token expired', code: 40142 })

    const result = handlers.getConnection(session)

    expect(result.connection.state).toBe('failed')
    expect(result.connection.previous).toBe('connected')
    expect(result.connection.reason?.code).toBe(40142)
    expect(result.msInState).toBeGreaterThanOrEqual(0)
    expect(result.capabilities.protocol).toBe(true)
  })
})

describe('get-stats', () => {
  test('reports retained count alongside dropped', () => {
    const { client, session } = setup()
    session.setOptions({ maxEvents: 3 })
    const channel = liveChannel(client, 'a')
    for (let i = 0; i < 10; i++) channel.deliver({ name: `m${i}`, data: '1' })

    const { stats, retained, options } = handlers.getStats(session)

    expect(retained).toBe(3)
    expect(stats.totalEvents).toBe(10)
    expect(stats.dropped).toBe(7)
    expect(options.maxEvents).toBe(3)
  })
})

describe('set-options', () => {
  test('pauses capture', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')

    handlers.setOptions(session, { paused: true })
    channel.deliver({ name: 'ignored', data: '1' })

    expect(session.getEvents()).toHaveLength(0)
  })

  test('drives real protocol capture through the instrumented client', () => {
    const { client, session } = setup()

    handlers.setOptions(session, { captureProtocol: true })
    expect(client.logOptions?.level).toBe(4)

    handlers.setOptions(session, { captureProtocol: false })
    expect(client.logOptions?.level).toBe(1)
  })

  test('refuses protocol capture when the client cannot do it', () => {
    const session = new Session()
    const client = new MockClient()
    ;(client as { setLog?: unknown }).setLog = undefined
    instrumentClient(client as never, session)

    expect(() => handlers.setOptions(session, { captureProtocol: true })).toThrow(
      /no setLog method/,
    )
  })

  test('rejects a nonsense maxEvents instead of silently clamping', () => {
    const { session } = setup()
    expect(() => handlers.setOptions(session, { maxEvents: 0 })).toThrow(
      /positive number/,
    )
  })
})

describe('clear', () => {
  test('drops retained events', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'x', data: '1' })

    expect(handlers.clear(session)).toEqual({ cleared: true })
    expect(session.getEvents()).toHaveLength(0)
    expect(handlers.getStats(session).stats.totalEvents).toBe(0)
  })
})

describe('channel-action', () => {
  test('dispatches attach and detach to the real channel', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')

    handlers.channelAction(session, { action: 'attach', channel: 'a' })
    expect(channel.state).toBe('attached')

    handlers.channelAction(session, { action: 'detach', channel: 'a' })
    expect(channel.state).toBe('detached')
  })

  test('releases through the client', () => {
    const { client, session } = setup()
    liveChannel(client, 'a')

    const result = handlers.channelAction(session, {
      action: 'release',
      channel: 'a',
    })

    expect(result.dispatched).toBe(true)
    expect(client.getChannel('a')).toBeUndefined()
    expect(session.getChannel('a')?.released).toBe(true)
  })

  test('refuses an unknown channel rather than silently succeeding', () => {
    const { session } = setup()
    expect(() =>
      handlers.channelAction(session, { action: 'attach', channel: 'nope' }),
    ).toThrow(/has not been seen/)
  })

  test('reports when no client is instrumented', () => {
    const session = new Session()
    session.touchChannel('a')
    const internals = session as unknown as SessionInternals
    expect(internals.__channelAction).toBeUndefined()

    expect(() =>
      handlers.channelAction(session, { action: 'attach', channel: 'a' }),
    ).toThrow(/no client is instrumented/)
  })
})
