import { useMemo, useState } from 'react'

import type { ChannelAction, ChannelSnapshot } from '../../shared/types'
import { channelTone, formatDuration } from '../format'

type ChannelListProps = {
  channels: ChannelSnapshot[]
  selected: string | null
  onSelect: (channel: string | null) => void
  onAction: (action: ChannelAction, channel: string) => void
}

type SortKey = 'activity' | 'name' | 'traffic'

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
    <aside className="channels">
      <div className="channels-head">
        <input
          className="input"
          placeholder="Filter channels…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="channels-controls">
          <select
            className="select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="Sort channels"
          >
            <option value="activity">Recent</option>
            <option value="traffic">Traffic</option>
            <option value="name">Name</option>
          </select>
          <label className="checkbox" title="Include detached and released channels">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Inactive
          </label>
        </div>
      </div>

      {selected ? (
        <button type="button" className="channels-clear" onClick={() => onSelect(null)}>
          ✕ Clear channel filter
        </button>
      ) : null}

      <div className="channels-list">
        {visible.length === 0 ? (
          <div className="empty empty-small">
            {channels.length === 0
              ? 'No channels yet.'
              : `No channels match. ${hiddenCount} hidden.`}
          </div>
        ) : (
          visible.map((channel) => (
            <ChannelRow
              key={channel.name}
              channel={channel}
              selected={channel.name === selected}
              onSelect={() =>
                onSelect(channel.name === selected ? null : channel.name)
              }
              onAction={onAction}
            />
          ))
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

  return (
    <div
      className={`channel${selected ? ' channel-selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="channel-main">
        <span className={`dot dot-${tone}`} />
        <span className="channel-name" title={channel.name}>
          {channel.name}
        </span>
        {channel.released ? <span className="tag tag-muted">released</span> : null}
      </div>

      <div className="channel-meta">
        <span className={`channel-state channel-state-${tone}`}>
          {channel.state}
        </span>
        <span className="channel-dim">
          {channel.subscriberCount}{' '}
          {channel.subscriberCount === 1 ? 'listener' : 'listeners'}
        </span>
        {traffic > 0 ? (
          <span className="channel-dim">
            ↓{channel.counters.in} ↑{channel.counters.out}
          </span>
        ) : null}
        {channel.counters.errors > 0 ? (
          <span className="channel-dim channel-dim-bad">
            {channel.counters.errors} err
          </span>
        ) : null}
      </div>

      {labels.length > 0 ? (
        <div className="channel-labels">
          {labels.map((label) => (
            <span className="tag" key={label}>
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {channel.reason ? (
        <div className="channel-error" title={channel.reason.message}>
          {channel.reason.code ? `${channel.reason.code} · ` : ''}
          {channel.reason.message}
        </div>
      ) : null}

      <div className="channel-foot">
        <span className="channel-dim">
          {channel.lastActivity
            ? `active ${formatDuration(Date.now() - channel.lastActivity)} ago`
            : `${channel.state} ${formatDuration(Date.now() - channel.since)}`}
        </span>
        <span className="channel-actions">
          {channel.state === 'attached' ? (
            <button
              type="button"
              className="mini"
              onClick={(e) => {
                e.stopPropagation()
                onAction('detach', channel.name)
              }}
              title="Detach this channel"
            >
              detach
            </button>
          ) : (
            <button
              type="button"
              className="mini"
              onClick={(e) => {
                e.stopPropagation()
                onAction('attach', channel.name)
              }}
              title="Attach this channel"
            >
              attach
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
