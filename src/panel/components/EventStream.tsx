import { useEffect, useLayoutEffect, useRef } from 'react'

import type { AblyEvent, EventKind } from '../../shared/types'
import {
  directionGlyph,
  eventTone,
  formatBytes,
  formatTime,
  kindLabel,
} from '../format'

export const ALL_KINDS: EventKind[] = [
  'message',
  'presence',
  'channel-state',
  'connection-state',
  'error',
  'protocol',
]

type EventStreamProps = {
  events: AblyEvent[]
  selectedId: number | null
  onSelect: (event: AblyEvent) => void
  kinds: Set<EventKind>
  onToggleKind: (kind: EventKind) => void
  query: string
  onQueryChange: (query: string) => void
  follow: boolean
  onToggleFollow: () => void
  totalCount: number
  droppedCount: number
}

/**
 * The event table.
 *
 * Rows are rendered plainly rather than virtualised: retention is already
 * bounded by the device ring buffer, and `content-visibility: auto` in the CSS
 * lets the browser skip layout for off-screen rows. That keeps the component
 * simple and, crucially, keeps text selection and browser find working — both
 * of which windowing libraries break, and both of which matter a lot when the
 * thing you are debugging is a payload.
 */
export function EventStream({
  events,
  selectedId,
  onSelect,
  kinds,
  onToggleKind,
  query,
  onQueryChange,
  follow,
  onToggleFollow,
  totalCount,
  droppedCount,
}: EventStreamProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Keep the newest row pinned while following. useLayoutEffect avoids the
  // visible jump you get scrolling after paint.
  useLayoutEffect(() => {
    if (!follow) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [events.length, follow])

  // Turning follow back on should immediately catch up.
  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [follow])

  return (
    <section className="stream">
      <div className="stream-head">
        <div className="chips">
          {ALL_KINDS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={`chip${kinds.has(kind) ? ' chip-on' : ''}`}
              onClick={() => onToggleKind(kind)}
            >
              {kindLabel(kind)}
            </button>
          ))}
        </div>

        <input
          className="input input-grow"
          placeholder="Search name, channel, payload…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />

        <label className="checkbox" title="Auto-scroll to newest">
          <input type="checkbox" checked={follow} onChange={onToggleFollow} />
          Follow
        </label>
      </div>

      <div className="stream-count">
        {events.length === totalCount
          ? `${totalCount} events`
          : `${events.length} of ${totalCount} events`}
        {droppedCount > 0 ? (
          <span
            className="stream-dropped"
            title="Older events were discarded because the on-device buffer is full. Raise maxEvents to retain more."
          >
            · {droppedCount} dropped
          </span>
        ) : null}
      </div>

      <div className="stream-body" ref={scrollRef}>
        {events.length === 0 ? (
          <div className="empty">No events match the current filters.</div>
        ) : (
          <table className="table">
            <tbody>
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={event.id === selectedId}
                  onSelect={() => onSelect(event)}
                />
              ))}
            </tbody>
          </table>
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  )
}

function EventRow({
  event,
  selected,
  onSelect,
}: {
  event: AblyEvent
  selected: boolean
  onSelect: () => void
}) {
  const tone = eventTone(event)

  return (
    <tr
      className={`row row-${tone}${selected ? ' row-selected' : ''}`}
      onClick={onSelect}
    >
      <td className="cell cell-time">{formatTime(event.ts)}</td>
      <td className={`cell cell-dir cell-dir-${event.dir}`}>
        {directionGlyph(event)}
      </td>
      <td className="cell cell-kind">
        <span className={`kind kind-${tone}`}>{kindLabel(event.kind)}</span>
      </td>
      <td className="cell cell-channel" title={event.channel}>
        {event.channel ?? <span className="muted">—</span>}
      </td>
      <td className="cell cell-name" title={event.summary}>
        {event.name ?? <span className="muted">{event.summary}</span>}
      </td>
      <td className="cell cell-size">
        {event.payload?.byteLength !== undefined
          ? formatBytes(event.payload.byteLength)
          : ''}
      </td>
    </tr>
  )
}
