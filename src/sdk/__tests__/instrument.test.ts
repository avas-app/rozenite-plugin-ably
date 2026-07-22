import { describe, expect, test } from 'bun:test'

import { instrumentClient } from '../instrument'
import { Session } from '../session'
import type { MockChannel } from './mock-client'
import { MockClient } from './mock-client'

function setup() {
  const client = new MockClient()
  const session = new Session()
  const dispose = instrumentClient(client as never, session)
  return { client, session, dispose }
}

/**
 * Goes through the *patched* `channels.get` (which is the thing under test) and
 * restores the concrete mock type, which `ClientLike` deliberately erases.
 */
function channelOf(client: MockClient, name: string): MockChannel {
  return client.channels.get(name) as unknown as MockChannel
}

function messagesOf(session: Session) {
  return session.snapshot().events.filter((e) => e.kind === 'message')
}

function channelRecord(session: Session, name: string) {
  return session.snapshot().channels.find((c) => c.name === name)!
}

describe('channel registry', () => {
  test('records channels obtained after instrumentation', () => {
    const { client, session } = setup()
    channelOf(client, 'session_a3f2')

    expect(session.snapshot().channels.map((c) => c.name)).toEqual(['session_a3f2'])
  })

  test('sweeps channels that existed before instrumentation', () => {
    const client = new MockClient()
    client.channels.get('pre-existing')

    const session = new Session()
    instrumentClient(client as never, session)

    expect(session.snapshot().channels.map((c) => c.name)).toContain('pre-existing')
  })

  test('tracks attach state transitions', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'device_7b41')

    channel.setState('attaching')
    channel.setState('attached')

    const record = channelRecord(session, 'device_7b41')
    expect(record.state).toBe('attached')
    expect(record.everAttached).toBe(true)

    const states = session
      .snapshot()
      .events.filter((e) => e.kind === 'channel-state')
      .map((e) => e.name)
    expect(states).toEqual(['attaching', 'attached'])
  })

  test('retains released channels as released rather than deleting them', () => {
    const { client, session } = setup()
    channelOf(client, 'gone')
    ;(client.channels as unknown as { release: (n: string) => void }).release('gone')

    expect(channelRecord(session, 'gone').released).toBe(true)
  })

  test('surfaces a failed channel with its error reason', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'x')
    channel.setState('failed', {
      message: 'permission denied',
      code: 40160,
      statusCode: 401,
    })

    const record = channelRecord(session, 'x')
    expect(record.state).toBe('failed')
    expect(record.reason?.code).toBe(40160)
    expect(record.reason?.message).toBe('permission denied')
  })
})

describe('listener tracking', () => {
  test('counts app subscribers without counting the internal spy', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')

    channel.subscribe(() => {})
    channel.subscribe('NAMED_EVENT', () => {})

    const record = channelRecord(session, 'c')
    expect(record.subscriberCount).toBe(2)
    expect(record.listeners[1].events).toEqual(['NAMED_EVENT'])
  })

  test('unsubscribing a specific listener decrements the count', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    const listener = () => {}

    channel.subscribe(listener)
    channel.subscribe(() => {})
    channel.unsubscribe(listener)

    expect(channelRecord(session, 'c').subscriberCount).toBe(1)
  })

  test('bare unsubscribe() clears every listener', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})
    channel.subscribe(() => {})

    channel.unsubscribe()

    expect(channelRecord(session, 'c').subscriberCount).toBe(0)
  })
})

describe('message capture', () => {
  test('does not break delivery to the app’s own listener', () => {
    const { client } = setup()
    const channel = channelOf(client, 'c')
    const received: unknown[] = []

    channel.subscribe((m: unknown) => received.push(m))
    channel.deliver({ name: 'SESSION_EVENT', data: '{"ok":true}' })

    expect(received).toHaveLength(1)
  })

  test('parses a JSON string payload and keeps the original raw text', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})
    channel.deliver({
      name: 'SESSION_EVENT',
      id: 'msg-1',
      data: '{"device":{"name":"Probe"},"eta":4}',
    })

    const [event] = messagesOf(session)
    expect(event.dir).toBe('in')
    expect(event.name).toBe('SESSION_EVENT')
    expect(event.messageId).toBe('msg-1')
    expect(event.payload?.kind).toBe('json')
    expect(event.payload?.value).toEqual({ device: { name: 'Probe' }, eta: 4 })
    expect(event.payload?.raw).toBe('{"device":{"name":"Probe"},"eta":4}')
  })

  test('leaves a non-JSON string as a plain string payload', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})
    channel.deliver({ name: 'E', data: 'not json at all' })

    const [event] = messagesOf(session)
    expect(event.payload?.kind).toBe('string')
    expect(event.payload?.value).toBe('not json at all')
  })

  test('captures a message exactly once even with several app listeners', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})
    channel.subscribe(() => {})
    channel.subscribe('SESSION_EVENT', () => {})

    channel.deliver({ name: 'SESSION_EVENT', data: '{}' })

    expect(messagesOf(session)).toHaveLength(1)
  })

  test('captures messages the app filtered out of its own subscription', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    // The app only cares about one event name; the spy still sees the rest.
    channel.subscribe('WANTED', () => {})

    channel.deliver({ name: 'IGNORED_BY_APP', data: '{}' })

    const messages = messagesOf(session)
    expect(messages).toHaveLength(1)
    expect(messages[0].name).toBe('IGNORED_BY_APP')
  })

  test('records outgoing publishes', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.publish('PING', { n: 1 })

    const event = messagesOf(session).find((e) => e.dir === 'out')!
    expect(event.name).toBe('PING')
    expect(event.payload?.value).toEqual({ n: 1 })
    // The real publish must still have happened.
    expect(channel.published).toHaveLength(1)
  })

  test('records each message of a batch publish', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.publish([
      { name: 'A', data: 1 },
      { name: 'B', data: 2 },
    ])

    expect(messagesOf(session).map((e) => e.name)).toEqual(['A', 'B'])
  })

  test('updates per-channel traffic counters', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})
    channel.deliver({ name: 'E', data: '{}' })
    channel.deliver({ name: 'E', data: '{}' })
    channel.publish('OUT', {})

    const record = channelRecord(session, 'c')
    expect(record.counters.in).toBe(2)
    expect(record.counters.out).toBe(1)
  })
})

describe('presence', () => {
  test('captures inbound presence without breaking delivery', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    const seen: unknown[] = []

    channel.presence.subscribe((m: unknown) => seen.push(m))
    channel.presence.deliver({
      action: 'enter',
      clientId: 'u1',
      data: '{"role":"operator"}',
    })

    expect(seen).toHaveLength(1)
    const event = session.snapshot().events.find((e) => e.kind === 'presence')!
    expect(event.dir).toBe('in')
    expect(event.clientId).toBe('u1')
    expect(event.payload?.value).toEqual({ role: 'operator' })
  })

  test('records outbound presence enter', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.presence.enter({ role: 'operator' })

    const event = session
      .snapshot()
      .events.find((e) => e.kind === 'presence' && e.dir === 'out')!
    expect(event.name).toBe('enter')
    expect(channel.presence.entered).toHaveLength(1)
  })
})

describe('connection', () => {
  test('records transitions and exposes the current state', () => {
    const { client, session } = setup()
    client.setConnectionState('connecting')
    client.setConnectionState('connected')

    const snapshot = session.snapshot()
    expect(snapshot.connection.state).toBe('connected')
    expect(
      snapshot.events
        .filter((e) => e.kind === 'connection-state')
        .map((e) => e.name),
    ).toEqual(['connecting', 'connected'])
  })

  test('carries the error reason on a failed connection', () => {
    const { client, session } = setup()
    client.setConnectionState('failed', {
      message: 'token expired',
      code: 40142,
      statusCode: 401,
    })

    const snapshot = session.snapshot()
    expect(snapshot.connection.reason?.code).toBe(40142)
    expect(snapshot.connection.state).toBe('failed')
  })
})

describe('lifecycle', () => {
  test('is idempotent — instrumenting twice does not double-capture', () => {
    const { client, session } = setup()
    instrumentClient(client as never, session)

    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})
    channel.deliver({ name: 'E', data: '{}' })

    expect(messagesOf(session)).toHaveLength(1)
  })

  test('dispose restores the original methods and removes the spy', () => {
    const { client, session, dispose } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})

    const patchedSubscribe = channel.subscribe
    dispose()

    expect(channel.subscribe).not.toBe(patchedSubscribe)
    // Only the app's own listener should remain registered.
    expect(channel.listenerCount).toBe(1)

    const before = session.snapshot().events.length
    channel.deliver({ name: 'AFTER_DISPOSE', data: '{}' })
    expect(session.snapshot().events).toHaveLength(before)
  })

  test('pausing stops capture without detaching instrumentation', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})

    session.setOptions({ paused: true })
    channel.deliver({ name: 'E', data: '{}' })
    expect(messagesOf(session)).toHaveLength(0)

    session.setOptions({ paused: false })
    channel.deliver({ name: 'E', data: '{}' })
    expect(messagesOf(session)).toHaveLength(1)
  })

  test('the ring buffer drops oldest events and counts the loss', () => {
    const { client, session } = setup()
    session.setOptions({ maxEvents: 5 })
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})

    for (let i = 0; i < 20; i++) {
      channel.deliver({ name: `E${i}`, data: '{}' })
    }

    const snapshot = session.snapshot()
    expect(snapshot.events).toHaveLength(5)
    expect(snapshot.stats.dropped).toBeGreaterThan(0)
    // The retained window must be the newest events.
    expect(snapshot.events[snapshot.events.length - 1].name).toBe('E19')
  })
})

describe('resilience', () => {
  test('a throwing app listener does not stop capture', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    // Registered *before* our spy, and it throws. ably-js isolates each
    // listener, so the spy downstream of it still runs.
    channel.subscribe(() => {
      throw new Error('app bug')
    })

    channel.deliver({ name: 'E', data: '{}' })

    expect(messagesOf(session)).toHaveLength(1)
  })

  test('a hostile payload is recorded rather than dropped', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    const received: unknown[] = []
    channel.subscribe((m: unknown) => received.push(m))

    const hostile = {
      name: 'E',
      get data(): unknown {
        throw new Error('exploding getter')
      },
    }

    expect(() => channel.deliver(hostile)).not.toThrow()
    expect(received).toHaveLength(1)

    // Dropping it would make the stream claim nothing arrived when the app
    // plainly received something.
    const [event] = messagesOf(session)
    expect(event.name).toBe('E')
    expect(event.payload?.kind).toBe('undecodable')
  })

  test('a circular payload is captured rather than crashing serialization', () => {
    const { client, session } = setup()
    const channel = channelOf(client, 'c')
    channel.subscribe(() => {})

    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    channel.deliver({ name: 'E', data: circular })

    const [event] = messagesOf(session)
    expect(event.payload?.kind).toBe('json')
    expect((event.payload?.value as Record<string, unknown>).self).toBe('[Circular]')
  })

  test('protocol capture is reported unavailable when setLog is absent', () => {
    const client = new MockClient()
    delete (client as { setLog?: unknown }).setLog
    const session = new Session()
    instrumentClient(client as never, session)

    expect(session.capabilities.protocol).toBe(false)
  })
})
