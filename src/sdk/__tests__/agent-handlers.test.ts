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

  test('leaves a small payload structured and untouched', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'tick', data: '{"value":42}' })

    const { event } = handlers.readEvent(session, { id: 1 })

    expect(event.payload?.value).toEqual({ value: 42 })
    expect(event.payload?.truncated).toBeUndefined()
    expect(event.payload?.note).toBeUndefined()
  })

  test('caps a large payload and drops the redundant structured copy', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    const big = JSON.stringify({
      rows: Array.from({ length: 4000 }, (_, i) => ({ i, blob: 'x'.repeat(40) })),
    })
    channel.deliver({ name: 'BULK', data: big })

    const { event } = handlers.readEvent(session, { id: 1 })
    const payload = event.payload!

    expect(payload.raw).toHaveLength(handlers.DEFAULT_READ_EVENT_BYTES)
    expect(payload.truncated).toBe(true)
    // `value` would carry the whole 4000-row structure a second time.
    expect(payload.value).toBeUndefined()
    // The true size is still reported honestly.
    expect(payload.byteLength).toBe(big.length)
    expect(payload.note).toMatch(/clipped to 8192 of \d+ bytes/)

    // The stored event must not have been mutated by the capping.
    expect(session.getEvent(1)!.payload!.value).toBeDefined()
  })

  test('maxBytes raises and clamps the cap', () => {
    const { client, session } = setup()
    const channel = liveChannel(client, 'a')
    channel.deliver({ name: 'BULK', data: JSON.stringify({ blob: 'x'.repeat(60000) }) })

    expect(
      handlers.readEvent(session, { id: 1, maxBytes: 100 }).event.payload?.raw,
    ).toHaveLength(100)

    // Above the ceiling it clamps rather than honouring an arbitrary number.
    const huge = handlers.readEvent(session, { id: 1, maxBytes: 10_000_000 })
    expect(huge.event.payload?.truncated).toBeUndefined()
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

describe('emit-event', () => {
  /** Subscribes a recording listener, optionally filtered by event name. */
  function listening(channel: MockChannel, events?: string) {
    const received: Record<string, unknown>[] = []
    const listener = (message: Record<string, unknown>) => {
      received.push(message)
    }
    if (events) channel.subscribe(events, listener)
    else channel.subscribe(listener)
    return received
  }

  test('hands the app’s own subscriber a message shaped like a real one', async () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'bid-orders')
    const received = listening(channel)

    const result = await handlers.emitEvent(session, {
      channel: 'bid-orders',
      name: 'ride_assignment',
      data: { rideId: 'r_42' },
      clientId: 'dispatcher',
    })

    expect(result.delivered).toBe(1)
    expect(result.local).toBe(true)
    expect(result.note).toBeUndefined()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      name: 'ride_assignment',
      data: { rideId: 'r_42' },
      clientId: 'dispatcher',
      encoding: null,
    })
    expect(received[0].id).toBe(result.messageId)
    expect(typeof received[0].timestamp).toBe('number')
  })

  // The whole reason this tool injects locally: a real publish would reach every
  // other client on the channel, including someone else's app or a real device.
  test('never publishes to the real channel', async () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'bid-orders')
    listening(channel)

    await handlers.emitEvent(session, {
      channel: 'bid-orders',
      name: 'ride_assignment',
      data: { rideId: 'r_42' },
    })

    expect(channel.published).toEqual([])
    expect(handlers.listEvents(session, { dir: 'out' }).items).toEqual([])
  })

  test('fabricates an id that cannot be mistaken for Ably’s own', async () => {
    const { client, session } = setup()
    listening(channelOf(client, 'a'))

    const result = await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(result.messageId).toStartWith('injected:')
  })

  test('honours an event-name filter, and counts what it passed over', async () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'bid-orders')
    const matching = listening(channel, 'ride_assignment')
    const other = listening(channel, 'ride_cancelled')
    const unfiltered = listening(channel)

    const result = await handlers.emitEvent(session, {
      channel: 'bid-orders',
      name: 'ride_assignment',
    })

    expect(matching).toHaveLength(1)
    expect(unfiltered).toHaveLength(1)
    expect(other).toHaveLength(0)
    expect(result.delivered).toBe(2)
    expect(result.skipped).toBe(1)
  })

  test('records the injection exactly once, not twice via the spy', async () => {
    const { client, session } = setup()
    // Subscribing is what installs the passive spy.
    listening(channelOf(client, 'a'))

    await handlers.emitEvent(session, { channel: 'a', name: 'tick', data: '1' })

    expect(handlers.listEvents(session, { kind: 'message' }).items).toHaveLength(1)
  })

  test('marks the recorded event injected, in the row and the summary', async () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'a')
    listening(channel)
    channel.deliver({ name: 'real', data: '1' })

    const result = await handlers.emitEvent(session, {
      channel: 'a',
      name: 'synthetic',
      data: '2',
    })

    const rows = handlers.listEvents(session, { kind: 'message', order: 'asc' }).items
    expect(rows.map((row) => row.injected)).toEqual([undefined, true])
    expect(rows[1].summary).toBe('injected synthetic · 1B')
    expect(rows[1].id).toBe(result.eventId!)
  })

  test('the recorded event carries the payload back to read-event', async () => {
    const { client, session } = setup()
    listening(channelOf(client, 'a'))

    const { eventId } = await handlers.emitEvent(session, {
      channel: 'a',
      name: 'ride_assignment',
      data: { rideId: 'r_42' },
    })

    const { event } = handlers.readEvent(session, { id: eventId! })
    expect(event.injected).toBe(true)
    expect(event.dir).toBe('in')
    expect(event.payload?.value).toEqual({ rideId: 'r_42' })
  })

  test('sorts ahead of whatever the listener publishes in response', async () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'a')
    channel.subscribe(() => {
      channel.publish('ack', '1')
    })

    await handlers.emitEvent(session, { channel: 'a', name: 'ride_assignment' })

    expect(
      handlers.listEvents(session, { kind: 'message', order: 'asc' }).items.map(
        (row) => row.name,
      ),
    ).toEqual(['ride_assignment', 'ack'])
  })

  // Delivering to nobody is not an error: the event really was injected.
  test('says so when the channel has no listener at all', async () => {
    const { client, session } = setup()
    channelOf(client, 'a')

    const result = await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(result.delivered).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.note).toMatch(/no app listener/)
    expect(result.eventId).toBeDefined()
  })

  test('says so when every listener filtered the name out', async () => {
    const { client, session } = setup()
    listening(channelOf(client, 'a'), 'something_else')

    const result = await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(result.delivered).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.note).toMatch(/filter it out/)
  })

  test('one listener throwing does not stop the rest, and is reported', async () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'a')
    channel.subscribe(() => {
      throw new Error('reducer blew up')
    })
    const survivor = listening(channel)

    const result = await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(survivor).toHaveLength(1)
    expect(result.delivered).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['reducer blew up'])
    expect(result.note).toMatch(/threw/)
  })

  test('delivers while paused, but reports that nothing was recorded', async () => {
    const { client, session } = setup()
    const received = listening(channelOf(client, 'a'))
    handlers.setOptions(session, { paused: true })

    const result = await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(received).toHaveLength(1)
    expect(result.delivered).toBe(1)
    expect(result.eventId).toBeUndefined()
    expect(result.note).toMatch(/paused/)
  })

  // Real Ably evaluates a MessageFilter; treating it as unfiltered would make
  // the app react to messages it could never receive.
  test('honours a MessageFilter object, as Ably would', async () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'a')
    const byName: unknown[] = []
    const otherName: unknown[] = []
    const byClient: unknown[] = []
    const refsOnly: unknown[] = []
    channel.subscribe({ name: 'ride_assignment' }, (m: unknown) => byName.push(m))
    channel.subscribe({ name: 'ride_cancelled' }, (m: unknown) => otherName.push(m))
    channel.subscribe({ clientId: 'dispatcher' }, (m: unknown) => byClient.push(m))
    channel.subscribe({ isRef: true }, (m: unknown) => refsOnly.push(m))

    const result = await handlers.emitEvent(session, {
      channel: 'a',
      name: 'ride_assignment',
      clientId: 'dispatcher',
    })

    expect(byName).toHaveLength(1)
    expect(byClient).toHaveLength(1)
    expect(otherName).toHaveLength(0)
    // An injected message carries no extras.ref.
    expect(refsOnly).toHaveLength(0)
    expect(result.delivered).toBe(2)
    expect(result.skipped).toBe(2)
  })

  test('reports an async listener that rejects', async () => {
    const { client, session } = setup()
    channelOf(client, 'a').subscribe(async () => {
      throw new Error('saga failed')
    })

    const result = await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(result.delivered).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['saga failed'])
    expect(result.note).toMatch(/rejected/)
  })

  test('returns only once an async listener has finished reacting', async () => {
    const { client, session } = setup()
    let reacted = false
    channelOf(client, 'a').subscribe(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      reacted = true
    })

    const result = await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(reacted).toBe(true)
    expect(result.delivered).toBe(1)
    expect(result.pending).toBeUndefined()
  })

  test('is recorded, but not counted as inbound traffic', async () => {
    const { client, session } = setup()
    listening(channelOf(client, 'a'))

    await handlers.emitEvent(session, { channel: 'a', name: 'tick' })

    expect(handlers.getStats(session).stats.messagesIn).toBe(0)
    expect(handlers.readChannel(session, { name: 'a' }).channel.counters.in).toBe(0)
    expect(handlers.listEvents(session, { kind: 'message' }).items).toHaveLength(1)
  })

  test('reaches channels of every client instrumented into the session', async () => {
    const { client, session, dispose } = setup()
    const second = new MockClient()
    const disposeSecond = instrumentClient(second as never, session)
    const first = listening(channelOf(client, 'a'))
    const other = listening(channelOf(second, 'b'))

    await handlers.emitEvent(session, { channel: 'a', name: 'tick' })
    await handlers.emitEvent(session, { channel: 'b', name: 'tick' })
    expect(first).toHaveLength(1)
    expect(other).toHaveLength(1)

    disposeSecond()
    await handlers.emitEvent(session, { channel: 'a', name: 'tick' })
    expect(first).toHaveLength(2)

    dispose()
    const internals = session as unknown as SessionInternals
    expect(internals.__emitEvent).toBeUndefined()
  })

  test('refuses an unknown channel rather than silently succeeding', async () => {
    const { session } = setup()
    await expect(handlers.emitEvent(session, { channel: 'nope', name: 'tick' })).rejects.toThrow(/has not been seen/)
  })

  test('refuses a released channel, whose listeners are gone', async () => {
    const { client, session } = setup()
    liveChannel(client, 'a')
    handlers.channelAction(session, { action: 'release', channel: 'a' })

    await expect(handlers.emitEvent(session, { channel: 'a', name: 'tick' })).rejects.toThrow(/has been released/)
  })

  test('refuses an empty event name', async () => {
    const { client, session } = setup()
    listening(channelOf(client, 'a'))

    await expect(handlers.emitEvent(session, { channel: 'a', name: '  ' })).rejects.toThrow(/non-empty name/)
  })

  test('reports when no client is instrumented', async () => {
    const session = new Session()
    session.touchChannel('a')
    const internals = session as unknown as SessionInternals
    expect(internals.__emitEvent).toBeUndefined()

    await expect(handlers.emitEvent(session, { channel: 'a', name: 'tick' })).rejects.toThrow(
      /no client is instrumented/,
    )
  })
})
