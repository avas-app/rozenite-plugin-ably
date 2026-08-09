import { useMemo, useState } from 'react'
import { EmptyState, PluginHeader, PluginShell, Tooltip } from '@rozenite/ui'
import { Loader2, PlugZap } from 'lucide-react'

import type { AblyEvent, EventKind } from '../shared/types'
import { CaptureControls } from './components/CaptureControls'
import { ChannelList } from './components/ChannelList'
import { ConnectionBar } from './components/ConnectionBar'
import { ALL_KINDS, EventStream } from './components/EventStream'
import { PayloadViewer } from './components/PayloadViewer'
import { matches } from './format'
import { useAblyPanel } from './store'
import './globals.css'

const SUBTITLE =
  'Inspect channels, stream live events, and preview decoded payloads.'

export default function AblyPanel() {
  const { state, actions, bridgeReady } = useAblyPanel()

  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [kinds, setKinds] = useState<Set<EventKind>>(
    // Protocol frames are opt-in and extremely chatty, so they start hidden
    // even when capture is enabled.
    () => new Set(ALL_KINDS.filter((k) => k !== 'protocol')),
  )

  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.events.filter((event) => {
      if (!kinds.has(event.kind)) return false
      if (selectedChannel && event.channel !== selectedChannel) return false
      if (!q) return true

      if (
        matches(event.name, q) ||
        matches(event.channel, q) ||
        matches(event.summary, q) ||
        matches(event.messageId, q) ||
        matches(event.clientId, q)
      ) {
        return true
      }

      // Searching payload text is the point of a payload inspector, so it is
      // included despite the cost; retention is bounded so the scan stays small.
      const payload = event.payload
      if (!payload) return false
      if (payload.raw && payload.raw.toLowerCase().includes(q)) return true
      if (payload.value !== undefined) {
        try {
          return JSON.stringify(payload.value).toLowerCase().includes(q)
        } catch {
          return false
        }
      }
      return false
    })
  }, [state.events, kinds, selectedChannel, query])

  const selectedEvent: AblyEvent | null = useMemo(() => {
    if (selectedEventId === null) return null
    return state.events.find((e) => e.id === selectedEventId) ?? null
  }, [state.events, selectedEventId])

  const attachedCount = useMemo(
    () => state.channels.filter((c) => c.state === 'attached').length,
    [state.channels],
  )

  const toggleKind = (kind: EventKind) => {
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  if (!bridgeReady) {
    return (
      <Shell>
        <Header />
        <EmptyState
          icon={ConnectingSpinner}
          title="Connecting to React Native…"
        />
      </Shell>
    )
  }

  if (!state.hydrated) {
    return (
      <Shell>
        <Header />
        <EmptyState
          description={
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-foreground">
              {`import { useAblyDevTools } from '@avasapp/rozenite-plugin-ably'

useAblyDevTools(ablyRealtimeClient)`}
            </pre>
          }
          icon={PlugZap}
          title="Waiting for an instrumented Ably client."
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <Header>
        <CaptureControls
          capabilities={state.capabilities}
          onClear={() => {
            actions.clear()
            setSelectedEventId(null)
          }}
          onTogglePause={() =>
            actions.setOptions({ paused: !state.options.paused })
          }
          onToggleProtocol={() => {
            const next = !state.options.captureProtocol
            actions.setOptions({ captureProtocol: next })
            // Enabling capture with the filter off would look like nothing
            // happened, so reveal protocol rows at the same time.
            if (next) {
              setKinds((prev) => new Set(prev).add('protocol'))
            }
          }}
          options={state.options}
        />
      </Header>

      <ConnectionBar
        attachedCount={attachedCount}
        channelCount={state.channels.length}
        connection={state.connection}
        stats={state.stats}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ChannelList
          channels={state.channels}
          onAction={actions.channelAction}
          onSelect={setSelectedChannel}
          selected={selectedChannel}
        />

        <main className="flex min-h-0 flex-1 overflow-hidden">
          <EventStream
            droppedCount={state.stats.dropped}
            events={filteredEvents}
            follow={follow}
            kinds={kinds}
            onQueryChange={setQuery}
            onSelect={(event) => setSelectedEventId(event.id)}
            onToggleFollow={setFollow}
            onToggleKind={toggleKind}
            query={query}
            selectedId={selectedEventId}
            totalCount={state.events.length}
          />
          <PayloadViewer event={selectedEvent} query={query} />
        </main>
      </div>
    </Shell>
  )
}

/**
 * `PluginShell` owns the theme class and the portal container that Select,
 * Tooltip and friends mount into — without it those surfaces escape to
 * `document.body` and render with light tokens. `Tooltip.Provider` sits inside
 * it so the panel's tooltips share one open/close delay.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PluginShell>
      <Tooltip.Provider>{children}</Tooltip.Provider>
    </PluginShell>
  )
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <PluginHeader>
      <div className="flex min-w-0 flex-col">
        <PluginHeader.Title>Ably</PluginHeader.Title>
        <PluginHeader.Subtitle>{SUBTITLE}</PluginHeader.Subtitle>
      </div>
      <PluginHeader.Actions>
        {children}
        <PluginHeader.ThemeSwitcher />
      </PluginHeader.Actions>
    </PluginHeader>
  )
}

function ConnectingSpinner({ className }: { className?: string }) {
  return <Loader2 className={`${className ?? ''} animate-spin text-primary`} />
}
