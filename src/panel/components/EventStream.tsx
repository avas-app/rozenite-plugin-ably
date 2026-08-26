import { useEffect, useLayoutEffect, useRef } from 'react'
import { Button, SearchField } from '@rozenite/ui'
import { ArrowDown, ArrowUp, Minus, SearchX } from 'lucide-react'

import type { AblyEvent, EventKind } from '../../shared/types'
import {
  eventTone,
  formatBytes,
  formatTime,
  kindLabel,
  toneTextClass,
} from '../format'
import { LabeledSwitch, ToneBadge, WithTooltip } from './primitives'

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
  onToggleFollow: (next: boolean) => void
  totalCount: number
  droppedCount: number
}

/**
 * The event table.
 *
 * Rows are a plain table rather than `VirtualizedDataTable` from
 * `@rozenite/ui`. Retention is already bounded by the device ring buffer, and
 * the `row-skip-offscreen` utility lets the browser skip layout for off-screen
 * rows. That keeps text selection and browser find working — both of which
 * windowing breaks, and both of which matter a lot when the thing you are
 * debugging is a payload. Everything around the table (filters, search,
 * chrome) uses the shared components.
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
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {ALL_KINDS.map((kind) => (
            <Button
              key={kind}
              onClick={() => onToggleKind(kind)}
              size="sm"
              variant={kinds.has(kind) ? 'soft' : 'ghost'}
            >
              {kindLabel(kind)}
            </Button>
          ))}
        </div>

        {/* `SearchField` puts `className` on the input, so the growth has to
            go on a wrapper for the field to fill the row. */}
        <div className="min-w-48 flex-1">
          <SearchField
            aria-label="Search events"
            onChange={(event) => onQueryChange(event.target.value)}
            onClear={() => onQueryChange('')}
            placeholder="Search name, channel, payload…"
            value={query}
          />
        </div>

        <LabeledSwitch
          hint="Auto-scroll to newest"
          isSelected={follow}
          label="Follow"
          onChange={onToggleFollow}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {events.length === totalCount
            ? `${totalCount} events`
            : `${events.length} of ${totalCount} events`}
        </span>
        {droppedCount > 0 ? (
          <WithTooltip content="Older events were discarded because the on-device buffer is full. Raise maxEvents to retain more.">
            <span className="tabular-nums text-warning">
              · {droppedCount} dropped
            </span>
          </WithTooltip>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <SearchX className="size-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              No events match the current filters.
            </span>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <tbody>
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onSelect={() => onSelect(event)}
                  selected={event.id === selectedId}
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

function DirectionGlyph({ event }: { event: AblyEvent }) {
  if (event.dir === 'in') return <ArrowDown className="size-3 text-success" />
  if (event.dir === 'out') return <ArrowUp className="size-3 text-primary" />
  return <Minus className="size-3 text-muted-foreground" />
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
      className={`row-skip-offscreen cursor-pointer border-b border-border/40 transition-colors ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
      onClick={onSelect}
    >
      <td className="w-24 px-2 py-1 font-mono tabular-nums text-muted-foreground">
        {formatTime(event.ts)}
      </td>
      <td className="w-6 px-1 py-1">
        <DirectionGlyph event={event} />
      </td>
      <td className="w-20 px-2 py-1">
        <ToneBadge tone={tone}>{kindLabel(event.kind)}</ToneBadge>
      </td>
      <td
        className="max-w-48 truncate px-2 py-1 font-mono text-foreground"
        title={event.channel}
      >
        {event.channel ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="truncate px-2 py-1" title={event.summary}>
        {event.name ? (
          <span className={toneTextClass(tone)}>{event.name}</span>
        ) : (
          <span className="text-muted-foreground">{event.summary}</span>
        )}
      </td>
      <td className="w-20 px-2 py-1 text-right tabular-nums text-muted-foreground">
        {event.payload?.byteLength !== undefined
          ? formatBytes(event.payload.byteLength)
          : ''}
      </td>
    </tr>
  )
}
