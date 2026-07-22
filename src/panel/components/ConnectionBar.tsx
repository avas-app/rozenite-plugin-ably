import type { Capabilities, ConnectionSnapshot, SdkOptions, SessionStats } from '../../shared/types'
import { connectionTone, formatDuration } from '../format'

type ConnectionBarProps = {
  connection: ConnectionSnapshot
  stats: SessionStats
  options: SdkOptions
  capabilities: Capabilities
  channelCount: number
  attachedCount: number
  onClear: () => void
  onTogglePause: () => void
  onToggleProtocol: () => void
}

/**
 * The always-visible status strip. Its job is to answer "is realtime healthy
 * right now?" at a glance, so the connection state and any error reason are the
 * only things allowed to be visually loud.
 */
export function ConnectionBar({
  connection,
  stats,
  options,
  capabilities,
  channelCount,
  attachedCount,
  onClear,
  onTogglePause,
  onToggleProtocol,
}: ConnectionBarProps) {
  const tone = connectionTone(connection.state)
  const elapsed = formatDuration(Date.now() - connection.since)

  return (
    <header className="bar">
      <div className="bar-group">
        <span className={`pill pill-${tone}`}>
          <span className="dot" />
          {connection.state}
        </span>
        <span className="bar-elapsed" title="Time in current state">
          {elapsed}
        </span>
      </div>

      {connection.id ? (
        <div className="bar-group bar-meta">
          <span className="bar-label">id</span>
          <code className="bar-code" title={connection.id}>
            {connection.id}
          </code>
        </div>
      ) : null}

      {connection.clientId ? (
        <div className="bar-group bar-meta">
          <span className="bar-label">client</span>
          <code className="bar-code" title={connection.clientId}>
            {connection.clientId}
          </code>
        </div>
      ) : null}

      <div className="bar-group bar-meta">
        <span className="bar-label">channels</span>
        <span className="bar-value">
          {attachedCount}
          <span className="bar-dim"> / {channelCount}</span>
        </span>
      </div>

      <div className="bar-group bar-meta">
        <span className="bar-label">in</span>
        <span className="bar-value">{stats.messagesIn}</span>
        <span className="bar-label">out</span>
        <span className="bar-value">{stats.messagesOut}</span>
        {stats.errors > 0 ? (
          <>
            <span className="bar-label">err</span>
            <span className="bar-value bar-value-bad">{stats.errors}</span>
          </>
        ) : null}
      </div>

      {connection.reason ? (
        <div className="bar-reason" title={connection.reason.message}>
          <strong>
            {connection.reason.code ? `${connection.reason.code} ` : ''}
          </strong>
          {connection.reason.message}
        </div>
      ) : null}

      <div className="bar-spacer" />

      <div className="bar-group bar-actions">
        <button
          type="button"
          className={`btn${options.paused ? ' btn-active' : ''}`}
          onClick={onTogglePause}
          title={options.paused ? 'Resume capture' : 'Pause capture'}
        >
          {options.paused ? '▶ Resume' : '⏸ Pause'}
        </button>

        <button
          type="button"
          className={`btn${options.captureProtocol ? ' btn-active' : ''}`}
          onClick={onToggleProtocol}
          disabled={!capabilities.protocol}
          title={
            capabilities.protocol
              ? 'Capture raw ably-js protocol frames (verbose, slows the SDK)'
              : 'This ably-js build does not expose a runtime log handler'
          }
        >
          Protocol
        </button>

        <button type="button" className="btn" onClick={onClear} title="Clear captured events">
          Clear
        </button>
      </div>
    </header>
  )
}
