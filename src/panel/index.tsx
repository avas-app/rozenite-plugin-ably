import { useMemo, useState } from 'react'
import { PluginHeader, PluginTheme, Surface } from '@rozenite/ui'
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
        <PluginHeader subtitle={SUBTITLE} title="Ably" />
        <EmptyState
          icon={<Loader2 className="size-8 animate-spin text-accent" />}
          message="Connecting to React Native…"
        />
      </Shell>
    )
  }

  if (!state.hydrated) {
    return (
      <Shell>
        <PluginHeader subtitle={SUBTITLE} title="Ably" />
        <EmptyState
          icon={<PlugZap className="size-8 text-muted" />}
          message="Waiting for an instrumented Ably client."
        >
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-tertiary p-3 text-left font-mono text-xs text-foreground">
            {`import { useAblyDevTools } from '@avasapp/rozenite-plugin-ably'

useAblyDevTools(ablyRealtimeClient)`}
          </pre>
        </EmptyState>
      </Shell>
    )
  }

  return (
    <Shell>
      <PluginHeader
        actions={
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
        }
        subtitle={SUBTITLE}
        title="Ably"
      />

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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PluginTheme
      className="flex h-screen flex-col bg-background text-foreground"
      defaultTheme="dark"
    >
      {children}
    </PluginTheme>
  )
}

function EmptyState({
  icon,
  message,
  children,
}: {
  icon: React.ReactNode
  message: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Surface
        className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-border/70 px-6 py-8 text-center shadow-sm"
        variant="secondary"
      >
        {icon}
        <p className="text-sm font-medium text-foreground">{message}</p>
        {children}
      </Surface>
    </div>
  )
}
