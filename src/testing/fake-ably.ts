import type { ClientLike } from '../sdk/instrument'

/**
 * A hand-written stand-in for `Ably.Realtime` that mirrors the parts of the
 * real SDK's shape that the instrumentation touches, plus helpers (`deliver`,
 * `setState`) for driving inbound traffic.
 *
 * Shared by the unit tests and by the `rozenite dev` scenario harness, so the
 * panel is always developed against the same wire format the real SDK produces
 * rather than against hand-maintained fixtures that can drift.
 *
 * Kept faithful to ably-js semantics in the ways that matter:
 *  - `channels.get(name)` returns the *same* object for a given name.
 *  - `channels.all` is the live registry.
 *  - `subscribe(fn)` is unfiltered; `subscribe(name, fn)` filters by name.
 *  - `unsubscribe()` with no arguments removes every listener.
 */

type Fn = (...args: any[]) => any

/**
 * Mirrors ably-js's own `callListener`, which wraps every listener in a
 * try/catch so one subscriber throwing cannot stop the others from running
 * (`src/common/lib/util/eventemitter.ts`: "catch any exceptions and log, but
 * continue operation"). Without this the mock would be stricter than the real
 * SDK and would fail tests for behaviour that cannot actually occur.
 */
function callIsolated(fn: Fn, arg: unknown) {
  try {
    fn(arg)
  } catch {
    // Swallowed, exactly as ably-js does.
  }
}

class Emitter {
  listeners: Fn[] = []
  on(fn: Fn) {
    this.listeners.push(fn)
  }
  off(fn?: Fn) {
    if (!fn) this.listeners = []
    else this.listeners = this.listeners.filter((l) => l !== fn)
  }
  emit(value: unknown) {
    for (const l of [...this.listeners]) l(value)
  }
}

export class MockPresence {
  subscribers: { actions?: string[]; fn: Fn }[] = []
  entered: unknown[] = []

  subscribe(...args: any[]) {
    const [first, second] = args
    if (typeof first === 'function') this.subscribers.push({ fn: first })
    else if (typeof first === 'string')
      this.subscribers.push({ actions: [first], fn: second })
    else if (Array.isArray(first))
      this.subscribers.push({ actions: first, fn: second })
    return Promise.resolve()
  }

  unsubscribe(...args: any[]) {
    if (args.length === 0) {
      this.subscribers = []
      return
    }
    const fn = args[args.length - 1]
    this.subscribers = this.subscribers.filter((s) => s.fn !== fn)
  }

  enter(data?: unknown) {
    this.entered.push(data)
    return Promise.resolve()
  }
  leave(data?: unknown) {
    return Promise.resolve(data)
  }
  update(data?: unknown) {
    return Promise.resolve(data)
  }
  enterClient(clientId: string, data?: unknown) {
    this.entered.push({ clientId, data })
    return Promise.resolve()
  }
  leaveClient(clientId?: string, data?: unknown) {
    return Promise.resolve({ clientId, data })
  }
  updateClient(clientId: string, data?: unknown) {
    return Promise.resolve({ clientId, data })
  }

  /** Test helper: push an inbound presence message. */
  deliver(member: Record<string, unknown>) {
    for (const s of [...this.subscribers]) {
      if (!s.actions || s.actions.includes(member.action as string)) {
        callIsolated(s.fn, member)
      }
    }
  }
}

export class MockChannel {
  state = 'initialized'
  presence = new MockPresence()
  published: { name?: string; data: unknown }[] = []

  private stateEmitter = new Emitter()
  private subscribers: { events?: string[]; fn: Fn }[] = []

  constructor(public name: string) {}

  subscribe(...args: any[]) {
    const [first, second] = args
    if (typeof first === 'function') this.subscribers.push({ fn: first })
    else if (typeof first === 'string')
      this.subscribers.push({ events: [first], fn: second })
    else if (Array.isArray(first))
      this.subscribers.push({ events: first, fn: second })
    else this.subscribers.push({ fn: second })
    return Promise.resolve(null)
  }

  unsubscribe(...args: any[]) {
    if (args.length === 0) {
      this.subscribers = []
      return
    }
    const fn = args[args.length - 1]
    this.subscribers = this.subscribers.filter((s) => s.fn !== fn)
  }

  publish(...args: any[]) {
    const [first, second] = args
    if (typeof first === 'string') this.published.push({ name: first, data: second })
    else if (Array.isArray(first)) this.published.push(...first)
    else this.published.push(first)
    return Promise.resolve()
  }

  on(fn: Fn) {
    this.stateEmitter.on(fn)
  }
  off(fn?: Fn) {
    this.stateEmitter.off(fn)
  }

  attach() {
    this.setState('attached')
    return Promise.resolve()
  }
  detach() {
    this.setState('detached')
    return Promise.resolve()
  }

  /** Test helper: drive a state transition. */
  setState(next: string, reason?: unknown) {
    const previous = this.state
    this.state = next
    this.stateEmitter.emit({ previous, current: next, reason })
  }

  /** Test helper: push an inbound message. */
  deliver(message: Record<string, unknown>) {
    for (const s of [...this.subscribers]) {
      if (!s.events || s.events.includes(message.name as string)) {
        callIsolated(s.fn, message)
      }
    }
  }

  /** Test helper: how many listeners are registered right now. */
  get listenerCount() {
    return this.subscribers.length
  }
}

export class MockClient implements ClientLike {
  auth = { clientId: 'test-client' }
  connectionEmitter = new Emitter()

  all: Record<string, MockChannel> = Object.create(null)

  channels = {
    all: this.all,
    get: (name: string) => {
      let channel = this.all[name]
      if (!channel) {
        channel = new MockChannel(name)
        this.all[name] = channel
      }
      return channel
    },
    release: (name: string) => {
      delete this.all[name]
    },
  } as unknown as ClientLike['channels']

  connection = {
    state: 'initialized',
    id: undefined as string | undefined,
    key: undefined as string | undefined,
    on: (fn: Fn) => this.connectionEmitter.on(fn),
    off: (fn?: Fn) => this.connectionEmitter.off(fn),
  } as unknown as ClientLike['connection']

  logOptions: { level?: number; handler?: Fn } | null = null
  setLog = (options: { level?: number; handler?: Fn }) => {
    this.logOptions = { ...this.logOptions, ...options }
  }

  /** Test helper: drive a connection transition. */
  setConnectionState(next: string, reason?: unknown) {
    const previous = (this.connection as { state: string }).state
    ;(this.connection as { state: string }).state = next
    this.connectionEmitter.emit({ previous, current: next, reason })
  }

  getChannel(name: string): MockChannel {
    return this.all[name]
  }
}
