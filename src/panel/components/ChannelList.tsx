import { useMemo, useState } from 'react'
import { Badge, Button, SearchField, Select } from '@rozenite/ui'
import { ArrowDown, ArrowUp, Inbox, X } from 'lucide-react'

import type { ChannelAction, ChannelSnapshot } from '../../shared/types'
import { channelTone, formatDuration } from '../format'
import {
  ControlTooltip,
  LabeledSwitch,
  StatusDot,
  ToneBadge,
} from './primitives'

type ChannelListProps = {
  channels: ChannelSnapshot[]
  selected: string | null
  onSelect: (channel: string | null) => void
  onAction: (action: ChannelAction, channel: string) => void
}

type SortKey = 'activity' | 'name' | 'traffic'

const SORT_LABELS: Record<SortKey, string> = {
  activity: 'Recent',
  traffic: 'Traffic',
  name: 'Name',
}

const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[]

/**
 * The channel registry.
 *
 * The reason this panel exists: a websocket inspector shows you frames, but not
 * *which channels are currently attached*, how many subscribers each has, or
 * which ones quietly went `suspended` an hour ago. Detached and released
 * channels are deliberately retained (behind a toggle) because "the channel I
 * expected is missing" is the most common realtime bug, and you cannot see that
 * from a list that only shows healthy channels.
 */
export function ChannelList({
  channels,
  selected,
  onSelect,
  onAction,
}: ChannelListProps) {
  const [showInactive, setShowInactive] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('activity')
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()

    const filtered = channels.filter((channel) => {
      if (!showInactive && (channel.released || channel.state === 'detached')) {
        return false
      }
      if (!query) return true
      return (
        channel.name.toLowerCase().includes(query) ||
        channel.labels?.some((l) => l.toLowerCase().includes(query)) ||
        channel.listeners.some((l) => l.label?.toLowerCase().includes(query))
      )
    })

    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'traffic') {
        const at = a.counters.in + a.counters.out
        const bt = b.counters.in + b.counters.out
        if (at !== bt) return bt - at
        return a.name.localeCompare(b.name)
      }
      // activity: attached channels first, then most recently active.
      const aLive = a.state === 'attached' ? 1 : 0
      const bLive = b.state === 'attached' ? 1 : 0
      if (aLive !== bLive) return bLive - aLive
      const aTime = a.lastActivity ?? a.since
      const bTime = b.lastActivity ?? b.since
      return bTime - aTime
    })
    return sorted
  }, [channels, filter, showInactive, sortKey])

  const hiddenCount = channels.length - visible.length

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <SearchField
          aria-label="Filter channels"
          onChange={(event) => setFilter(event.target.value)}
          onClear={() => setFilter('')}
          placeholder="Filter channels…"
          value={filter}
        />

        <div className="flex items-center justify-between gap-2">
          <Select
            onValueChange={(value) => {
              if (value != null) setSortKey(value)
            }}
            value={sortKey}
          >
            <Select.Trigger aria-label="Sort channels" className="w-32">
              <Select.Value>
                {(value: SortKey) => SORT_LABELS[value]}
              </Select.Value>
            </Select.Trigger>
            <Select.Content>
              {SORT_KEYS.map((key) => (
                <Select.Item key={key} value={key}>
                  {SORT_LABELS[key]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>

          <LabeledSwitch
            hint="Include detached and released channels"
            isSelected={showInactive}
            label="Inactive"
            onChange={setShowInactive}
          />
        </div>
      </div>

      {selected ? (
        <Button
          className="m-2 justify-start"
          onClick={() => onSelect(null)}
          size="sm"
          variant="ghost"
        >
          <X />
          Clear channel filter
        </Button>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <Inbox className="size-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {channels.length === 0
                ? 'No channels yet.'
                : `No channels match. ${hiddenCount} hidden.`}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map((channel) => (
              <ChannelRow
                key={channel.name}
                channel={channel}
                onAction={onAction}
                onSelect={() =>
                  onSelect(channel.name === selected ? null : channel.name)
                }
                selected={channel.name === selected}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function ChannelRow({
  channel,
  selected,
  onSelect,
  onAction,
}: {
  channel: ChannelSnapshot
  selected: boolean
  onSelect: () => void
  onAction: (action: ChannelAction, channel: string) => void
}) {
  const tone = channelTone(channel.state, channel.released)
  const traffic = channel.counters.in + channel.counters.out

  // Prefer app-supplied labels; fall back to per-listener labels so the row
  // still says something useful when only the subscribe sites are annotated.
  const labels =
    channel.labels && channel.labels.length > 0
      ? channel.labels
      : Array.from(
          new Set(
            channel.listeners
              .map((l) => l.label)
              .filter((l): l is string => Boolean(l)),
          ),
        )

  const isAttached = channel.state === 'attached'

  return (
    <div
      className={`w-full cursor-pointer rounded-md border p-2 text-left transition-colors ${
        selected
          ? 'border-primary/60 bg-accent'
          : 'border-border/70 bg-card hover:bg-accent/50'
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot tone={tone} />
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          title={channel.name}
        >
          {channel.name}
        </span>
        {channel.released ? <Badge variant="outline">released</Badge> : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ToneBadge tone={tone}>{channel.state}</ToneBadge>
        <span className="text-xs text-muted-foreground">
          {channel.subscriberCount}{' '}
          {channel.subscriberCount === 1 ? 'listener' : 'listeners'}
        </span>
        {traffic > 0 ? (
          <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <ArrowDown className="size-3" />
            {channel.counters.in}
            <ArrowUp className="size-3" />
            {channel.counters.out}
          </span>
        ) : null}
        {channel.counters.errors > 0 ? (
          <span className="text-xs tabular-nums text-danger">
            {channel.counters.errors} err
          </span>
        ) : null}
      </div>

      {labels.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {labels.map((label) => (
            <Badge
              className="bg-primary/15 text-primary"
              key={label}
              variant="soft"
            >
              {label}
            </Badge>
          ))}
        </div>
      ) : null}

      {channel.reason ? (
        <div
          className="mt-1.5 truncate text-xs text-danger"
          title={channel.reason.message}
        >
          {channel.reason.code ? `${channel.reason.code} · ` : ''}
          {channel.reason.message}
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {channel.lastActivity
            ? `active ${formatDuration(Date.now() - channel.lastActivity)} ago`
            : `${channel.state} ${formatDuration(Date.now() - channel.since)}`}
        </span>
        {/* Swallow the click so the action does not also toggle row selection. */}
        <span onClick={(e) => e.stopPropagation()}>
          <ControlTooltip
            content={isAttached ? 'Detach this channel' : 'Attach this channel'}
          >
            <Button
              onClick={() =>
                onAction(isAttached ? 'detach' : 'attach', channel.name)
              }
              size="sm"
              variant="ghost"
            >
              {isAttached ? 'detach' : 'attach'}
            </Button>
          </ControlTooltip>
        </span>
      </div>
    </div>
  )
}
