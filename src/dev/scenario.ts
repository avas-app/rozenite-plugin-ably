import type { MockChannel } from '../testing/fake-ably'
import { MockClient } from '../testing/fake-ably'

/**
 * Synthetic Ably traffic for the example app.
 *
 * The client this produces is structurally an `Ably.Realtime`, so the example
 * app instruments it through the real `useAblyDevTools` hook and the real
 * bridge — nothing about the plugin is stubbed. Only the network is fake, which
 * is what makes the example runnable with no Ably account and no login.
 */

export const SESSION_CHANNEL = 'session_1d84-6e05-b273'
export const DEVICE_CHANNEL = 'device_7b41-2f60-9ac3'
export const GLOBAL_CHANNEL = 'system_notices'
export const PRESENCE_CHANNEL = 'operator_presence'

/** Labels a host app would supply, to exercise the enrichment path. */
export const SCENARIO_LABELS: Record<string, string[]> = {
  [SESSION_CHANNEL]: ['app-session-events'],
  [DEVICE_CHANNEL]: ['console-telemetry', 'console-chat'],
  [GLOBAL_CHANNEL]: ['release-notices'],
  [PRESENCE_CHANNEL]: ['online-operators'],
}

/** Deterministic pseudo-randomness — a fixed seed keeps runs comparable. */
function makeRandom(seed = 42) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const random = makeRandom()

export function createFakeAblyClient(): MockClient {
  return new MockClient()
}

export function channelOf(client: MockClient, name: string): MockChannel {
  return client.channels.get(name) as unknown as MockChannel
}

function readingPayload() {
  return JSON.stringify({
    event: 'SENSOR_READING',
    payload: {
      temperature_c: 18 + random() * 12,
      humidity_pct: 35 + random() * 40,
      pressure_hpa: Math.round(995 + random() * 25),
      battery_pct: Math.round(random() * 100),
    },
  })
}

const SESSION_EVENTS = [
  {
    event: 'DEVICE_LINKED',
    payload: {
      device: {
        uuid: '2f7a-11ee-9c11',
        name: 'Probe 14',
        firmware: '2.4.1',
        hardware: { serial: 'PB-002345', model: 'Probe Mini', revision: 'C' },
      },
      warmup_seconds: 4,
    },
  },
  {
    event: 'DEVICE_ONLINE',
    payload: { idle_seconds: 0 },
  },
  {
    event: 'STREAM_STARTED',
    payload: { window: { samples: 640, duration_min: 17 } },
  },
  {
    event: 'QUOTA_RENEWED',
    payload: {
      units: 500,
      plan: 'standard',
      period: 'monthly',
      breakdown: { included: 400, overage: 60, credits: 40 },
    },
  },
]

let sessionEventIndex = 0

/**
 * Brings the connection up and attaches the standard channel set. Subscribing
 * is what installs the plugin's passive spy, so the app must do it exactly as a
 * real app would.
 */
export function connectScenario(client: MockClient): void {
  client.setConnectionState('connecting')

  setTimeout(() => {
    ;(client.connection as { id?: string }).id = 'Kf3p9QzXmA'
    client.setConnectionState('connected')

    for (const name of [SESSION_CHANNEL, DEVICE_CHANNEL, GLOBAL_CHANNEL]) {
      const channel = channelOf(client, name)
      channel.subscribe(() => {})
      channel.setState('attaching')
      setTimeout(() => channel.setState('attached'), 200 + random() * 300)
    }

    const presence = channelOf(client, PRESENCE_CHANNEL)
    presence.presence.subscribe(() => {})
    presence.setState('attaching')
    setTimeout(() => presence.setState('attached'), 400)
  }, 400)
}

/**
 * Starts the continuous background traffic (sensor readings and chat). Returns a
 * stop function.
 */
export function startTraffic(client: MockClient): () => void {
  const readings = setInterval(() => {
    channelOf(client, DEVICE_CHANNEL).deliver({
      name: 'SENSOR_READING',
      id: `rd-${Math.floor(random() * 1e9).toString(36)}`,
      timestamp: Date.now(),
      data: readingPayload(),
    })
  }, 900)

  const chat = setInterval(() => {
    channelOf(client, DEVICE_CHANNEL).deliver({
      name: 'CHAT_MESSAGE',
      id: `chat-${Math.floor(random() * 1e6)}`,
      clientId: 'operator-2f7a',
      timestamp: Date.now(),
      data: JSON.stringify({
        event: 'CHAT_MESSAGE',
        payload: { text: 'Restarting the probe now.', sender: 'operator' },
      }),
    })
  }, 7000)

  return () => {
    clearInterval(readings)
    clearInterval(chat)
  }
}

export type ScenarioAction =
  | 'session-event'
  | 'burst'
  | 'publish'
  | 'presence'
  | 'raw-payload'
  | 'huge-payload'
  | 'fail-channel'
  | 'reconnect'
  | 'release-channel'

export const SCENARIO_ACTIONS: { id: ScenarioAction; label: string; hint: string }[] =
  [
    { id: 'session-event', label: 'Session event', hint: 'Nested JSON to expand' },
    { id: 'burst', label: 'Burst ×25', hint: 'Exercise the ring buffer' },
    { id: 'publish', label: 'Publish', hint: 'Outgoing message' },
    { id: 'presence', label: 'Presence', hint: 'enter / leave' },
    { id: 'raw-payload', label: 'Raw string', hint: 'Non-JSON payload' },
    { id: 'huge-payload', label: 'Huge payload', hint: 'Truncation path' },
    { id: 'fail-channel', label: 'Fail channel', hint: 'Error code 40160' },
    { id: 'reconnect', label: 'Reconnect', hint: 'Drop + recover' },
    { id: 'release-channel', label: 'Release', hint: 'Released channel row' },
  ]

/** Drives a one-off scenario, wired to the example app's buttons. */
export function runAction(client: MockClient, action: ScenarioAction): void {
  switch (action) {
    case 'session-event': {
      const body = SESSION_EVENTS[sessionEventIndex % SESSION_EVENTS.length]
      sessionEventIndex++
      channelOf(client, SESSION_CHANNEL).deliver({
        name: 'SESSION_EVENT',
        id: `sess-${sessionEventIndex}`,
        timestamp: Date.now(),
        data: JSON.stringify(body),
      })
      break
    }

    case 'burst': {
      const channel = channelOf(client, DEVICE_CHANNEL)
      for (let i = 0; i < 25; i++) {
        channel.deliver({
          name: 'SENSOR_READING',
          id: `burst-${i}-${Date.now()}`,
          timestamp: Date.now(),
          data: readingPayload(),
        })
      }
      break
    }

    case 'publish':
      channelOf(client, DEVICE_CHANNEL).publish('CHAT_MESSAGE', {
        text: 'Acknowledged, watching the next window',
        sender: 'console',
      })
      break

    case 'presence': {
      const entering = random() > 0.5
      channelOf(client, PRESENCE_CHANNEL).presence.deliver({
        action: entering ? 'enter' : 'leave',
        clientId: `operator-${Math.floor(random() * 900 + 100)}`,
        timestamp: Date.now(),
        data: JSON.stringify({ shift: 'day', available: entering }),
      })
      break
    }

    case 'raw-payload':
      channelOf(client, GLOBAL_CHANNEL).deliver({
        name: 'RAW_NOTICE',
        timestamp: Date.now(),
        data: 'maintenance window 02:00-03:00 UTC',
      })
      break

    case 'huge-payload':
      channelOf(client, GLOBAL_CHANNEL).deliver({
        name: 'BULK_SYNC',
        timestamp: Date.now(),
        data: JSON.stringify({
          event: 'BULK_SYNC',
          payload: {
            rows: Array.from({ length: 4000 }, (_, i) => ({
              id: i,
              name: `record-${i}`,
              blob: 'x'.repeat(40),
            })),
          },
        }),
      })
      break

    case 'fail-channel':
      channelOf(client, GLOBAL_CHANNEL).setState('failed', {
        message: 'permission denied for channel system_notices',
        code: 40160,
        statusCode: 401,
      })
      break

    case 'reconnect': {
      client.setConnectionState('disconnected', {
        message: 'connection closed abnormally',
        code: 80003,
      })
      for (const name of [SESSION_CHANNEL, DEVICE_CHANNEL]) {
        channelOf(client, name).setState('suspended')
      }
      setTimeout(() => {
        client.setConnectionState('connecting')
        setTimeout(() => {
          client.setConnectionState('connected')
          for (const name of [SESSION_CHANNEL, DEVICE_CHANNEL]) {
            const channel = channelOf(client, name)
            channel.setState('attaching')
            setTimeout(() => channel.setState('attached'), 300)
          }
        }, 900)
      }, 2500)
      break
    }

    case 'release-channel': {
      channelOf(client, PRESENCE_CHANNEL).setState('detached')
      ;(client.channels as unknown as { release: (n: string) => void }).release(
        PRESENCE_CHANNEL,
      )
      break
    }

    default:
      break
  }
}
