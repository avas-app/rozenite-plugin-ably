import { useMemo, useState } from 'react'

import type { AblyEvent, EventKind } from '../shared/types'
import { ChannelList } from './components/ChannelList'
import { ConnectionBar } from './components/ConnectionBar'
import { ALL_KINDS, EventStream } from './components/EventStream'
import { PayloadViewer } from './components/PayloadViewer'
import { matches } from './format'
import { useAblyPanel } from './store'
import './styles.css'

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
      <div className="app">
        <div className="empty empty-page">Connecting to React Native…</div>
      </div>
    )
  }

  if (!state.hydrated) {
    return (
      <div className="app">
        <div className="empty empty-page">
          <p>Waiting for an instrumented Ably client.</p>
          <pre className="raw raw-hint">
            {`import { useAblyDevTools } from '@avasapp/rozenite-plugin-ably'

useAblyDevTools(ablyRealtimeClient)`}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <ConnectionBar
        connection={state.connection}
        stats={state.stats}
        options={state.options}
        capabilities={state.capabilities}
        channelCount={state.channels.length}
        attachedCount={attachedCount}
        onClear={() => {
          actions.clear()
          setSelectedEventId(null)
        }}
        onTogglePause={() => actions.setOptions({ paused: !state.options.paused })}
        onToggleProtocol={() => {
          const next = !state.options.captureProtocol
          actions.setOptions({ captureProtocol: next })
          // Enabling capture with the filter off would look like nothing
          // happened, so reveal protocol rows at the same time.
          if (next) {
            setKinds((prev) => new Set(prev).add('protocol'))
          }
        }}
      />

      <div className="body">
        <ChannelList
          channels={state.channels}
          selected={selectedChannel}
          onSelect={setSelectedChannel}
          onAction={actions.channelAction}
        />

        <main className="main">
          <EventStream
            events={filteredEvents}
            selectedId={selectedEventId}
            onSelect={(event) => setSelectedEventId(event.id)}
            kinds={kinds}
            onToggleKind={toggleKind}
            query={query}
            onQueryChange={setQuery}
            follow={follow}
            onToggleFollow={() => setFollow((f) => !f)}
            totalCount={state.events.length}
            droppedCount={state.stats.dropped}
          />
          <PayloadViewer event={selectedEvent} query={query} />
        </main>
      </div>
    </div>
  )
}
