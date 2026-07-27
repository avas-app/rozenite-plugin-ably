import { expect, mock, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { PluginTheme } from '@rozenite/ui'

import type {
  AblyEvent,
  ChannelSnapshot,
  ConnectionSnapshot,
  SessionStats,
} from '../../shared/types'
import { CaptureControls } from '../components/CaptureControls'
import { ChannelList } from '../components/ChannelList'
import { ConnectionBar } from '../components/ConnectionBar'
import { ALL_KINDS, EventStream } from '../components/EventStream'
import { PayloadViewer } from '../components/PayloadViewer'

/**
 * Render smoke tests for the panel.
 *
 * These exist because the panel is assembled from `@rozenite/ui`, whose
 * components are *composed* — `Tabs.Indicator` has to sit inside a `Tabs.Tab`,
 * `Switch` needs a Content/Control/Thumb triplet, `Select` needs a `ListBox`.
 * Getting one of those wrong type-checks cleanly and then throws at render, so
 * the whole surface is rendered once here. This is the cheapest thing that
 * catches a `@rozenite/ui` upgrade changing a composition contract.
 */

const render = (node: React.ReactNode) =>
  renderToString(<PluginTheme>{node}</PluginTheme>)

const connection: ConnectionSnapshot = {
  state: 'failed',
  previous: 'connected',
  since: 1_700_000_000_000,
  id: 'conn-1',
  clientId: 'client-1',
  reason: { message: 'token expired', code: 40142, statusCode: 401 },
}

const stats: SessionStats = {
  totalEvents: 12,
  dropped: 3,
  messagesIn: 8,
  messagesOut: 2,
  presence: 1,
  errors: 1,
  startedAt: 1_700_000_000_000,
}

const channels: ChannelSnapshot[] = [
  {
    name: 'device:42',
    state: 'attached',
    since: 1_700_000_000_000,
    firstSeen: 1_700_000_000_000,
    lastActivity: 1_700_000_005_000,
    subscriberCount: 2,
    listeners: [{ label: 'TelemetryScreen', subscribedAt: 1 }],
    counters: { in: 5, out: 1, presence: 0, errors: 1 },
    released: false,
    everAttached: true,
    labels: ['telemetry'],
    reason: { message: 'capability denied', code: 40160 },
  },
  {
    name: 'presence:lobby',
    state: 'suspended',
    since: 1_700_000_000_000,
    firstSeen: 1_700_000_000_000,
    subscriberCount: 0,
    listeners: [],
    counters: { in: 0, out: 0, presence: 0, errors: 0 },
    released: true,
    everAttached: false,
  },
]

const events: AblyEvent[] = [
  {
    id: 1,
    ts: 1_700_000_001_000,
    kind: 'message',
    dir: 'in',
    channel: 'device:42',
    name: 'position',
    summary: 'position update',
    messageId: 'msg-1',
    clientId: 'client-1',
    connectionId: 'conn-1',
    timestamp: 1_700_000_000_900,
    payload: {
      kind: 'json',
      value: { temp: 1, humidity: 2, nested: { deep: { hit: 'needle' } } },
      raw: '{"lat":1}',
      byteLength: 42,
      encoding: 'json/utf-8',
    },
  },
  {
    id: 2,
    ts: 1_700_000_002_000,
    kind: 'error',
    dir: 'none',
    summary: 'channel failed',
    error: {
      message: 'capability denied',
      code: 40160,
      statusCode: 401,
      href: 'https://help.ably.io/error/40160',
    },
  },
  {
    id: 3,
    ts: 1_700_000_003_000,
    kind: 'protocol',
    dir: 'out',
    summary: 'raw frame',
    payload: { kind: 'string', value: 'plain', truncated: true, byteLength: 5 },
  },
]

test('ConnectionBar shows state, identity and the failure reason', () => {
  const html = render(
    <ConnectionBar
      attachedCount={1}
      channelCount={2}
      connection={connection}
      stats={stats}
    />,
  )
  expect(html).toContain('failed')
  expect(html).toContain('token expired')
  expect(html).toContain('conn-1')
})

test('CaptureControls renders both capture states', () => {
  const paused = render(
    <CaptureControls
      capabilities={{ protocol: true, labels: false }}
      onClear={() => {}}
      onTogglePause={() => {}}
      onToggleProtocol={() => {}}
      options={{ paused: true, captureProtocol: true, maxEvents: 1000 }}
    />,
  )
  expect(paused).toContain('Resume')

  const running = render(
    <CaptureControls
      capabilities={{ protocol: false, labels: false }}
      onClear={() => {}}
      onTogglePause={() => {}}
      onToggleProtocol={() => {}}
      options={{ paused: false, captureProtocol: false, maxEvents: 1000 }}
    />,
  )
  expect(running).toContain('Pause')
  expect(running).toContain('Protocol')
})

test('ChannelList renders rows, labels and the sort/filter controls', () => {
  const html = render(
    <ChannelList
      channels={channels}
      onAction={() => {}}
      onSelect={() => {}}
      selected="device:42"
    />,
  )
  expect(html).toContain('device:42')
  expect(html).toContain('presence:lobby')
  expect(html).toContain('released')
  expect(html).toContain('capability denied')
  expect(html).toContain('Clear channel filter')
  expect(html).toContain('Inactive')
})

test('ChannelList renders its empty state', () => {
  const html = render(
    <ChannelList
      channels={[]}
      onAction={() => {}}
      onSelect={() => {}}
      selected={null}
    />,
  )
  expect(html).toContain('No channels yet.')
})

test('EventStream renders rows, kind filters and the dropped-event notice', () => {
  const html = render(
    <EventStream
      droppedCount={3}
      events={events}
      follow
      kinds={new Set(ALL_KINDS)}
      onQueryChange={() => {}}
      onSelect={() => {}}
      onToggleFollow={() => {}}
      onToggleKind={() => {}}
      query=""
      selectedId={1}
      totalCount={12}
    />,
  )
  expect(html).toContain('position')
  expect(html).toContain('3 of 12 events')
  expect(html).toContain('dropped')
  expect(html).toContain('Follow')
  expect(html).toContain('proto')
})

test('EventStream renders its empty state', () => {
  const html = render(
    <EventStream
      droppedCount={0}
      events={[]}
      follow={false}
      kinds={new Set(ALL_KINDS)}
      onQueryChange={() => {}}
      onSelect={() => {}}
      onToggleFollow={() => {}}
      onToggleKind={() => {}}
      query="x"
      selectedId={null}
      totalCount={0}
    />,
  )
  expect(html).toContain('No events match the current filters.')
})

test('PayloadViewer renders a JSON payload behind tree/raw tabs', () => {
  const html = render(<PayloadViewer event={events[0]!} query="needle" />)
  expect(html).toContain('position')
  expect(html).toContain('Tree')
  expect(html).toContain('Raw')
  expect(html).toContain('json/utf-8')
})

test('PayloadViewer renders an error event with its docs link', () => {
  const html = render(<PayloadViewer event={events[1]!} query="" />)
  expect(html).toContain('capability denied')
  expect(html).toContain('docs')
})

test('PayloadViewer flags a truncated payload', () => {
  const html = render(<PayloadViewer event={events[2]!} query="" />)
  expect(html).toContain('truncated')
})

test('PayloadViewer renders the no-selection state', () => {
  const html = render(<PayloadViewer event={null} query="" />)
  expect(html).toContain('Select an event to inspect its payload.')
})

// The panel shell pulls in `globals.css`, `PluginTheme` and `PluginHeader`, so
// it is rendered through its real entry point rather than piecemeal.
mock.module('@rozenite/plugin-bridge', () => ({
  useRozeniteDevToolsClient: () => null,
}))

test('AblyPanel renders the shell while the bridge is connecting', async () => {
  const { default: AblyPanel } = await import('../index')
  const html = renderToString(<AblyPanel />)
  expect(html).toContain('Connecting to React Native')
  expect(html).toContain('Ably')
  // PluginHeader's theme switcher — confirms the shared header is mounted.
  expect(html).toContain('Theme switcher')
})
