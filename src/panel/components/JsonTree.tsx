import { useMemo, useState } from 'react'

/**
 * A collapsible JSON viewer built for payload inspection.
 *
 * Two behaviours that a generic pretty-printer does not give you, and which are
 * the whole point of "parse & preview":
 *
 *  - **Collapsed nodes still describe themselves.** `{…}` tells you nothing, so
 *    collapsed objects show a preview of their first few keys and arrays show
 *    their length. You can usually identify a payload without expanding it.
 *  - **Search reveals rather than filters.** Matching a deep key auto-expands
 *    the path to it and highlights the hit, instead of hiding the surrounding
 *    structure that gives it meaning.
 */

type JsonTreeProps = {
  value: unknown
  /** Depth to expand automatically when there is no active query. */
  defaultExpandDepth?: number
  /** Lower-cased search query; empty string disables highlighting. */
  query?: string
}

export function JsonTree({
  value,
  defaultExpandDepth = 2,
  query = '',
}: JsonTreeProps) {
  return (
    <div className="json-tree">
      <JsonNode
        nodeKey={null}
        value={value}
        depth={0}
        defaultExpandDepth={defaultExpandDepth}
        query={query}
        isLast
      />
    </div>
  )
}

type JsonNodeProps = {
  nodeKey: string | null
  value: unknown
  depth: number
  defaultExpandDepth: number
  query: string
  isLast: boolean
}

function isExpandable(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/** Does this subtree contain the query anywhere in a key or a scalar value? */
function subtreeMatches(value: unknown, query: string, depth = 0): boolean {
  if (!query || depth > 12) return false

  if (!isExpandable(value)) {
    return String(value).toLowerCase().includes(query)
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)

  return entries.some(
    ([key, child]) =>
      key.toLowerCase().includes(query) ||
      subtreeMatches(child, query, depth + 1),
  )
}

/** One-line summary shown when a node is collapsed. */
function collapsedPreview(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[ ${value.length} items ]`
  }
  const keys = Object.keys(value as Record<string, unknown>)
  if (keys.length === 0) return '{}'
  const shown = keys.slice(0, 3).join(', ')
  return `{ ${shown}${keys.length > 3 ? `, +${keys.length - 3}` : ''} }`
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const index = text.toLowerCase().indexOf(query)
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark className="json-hit">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

function ScalarValue({ value, query }: { value: unknown; query: string }) {
  if (value === null) return <span className="json-null">null</span>
  if (value === undefined) return <span className="json-null">undefined</span>

  switch (typeof value) {
    case 'string':
      return (
        <span className="json-string">
          "<Highlight text={value} query={query} />"
        </span>
      )
    case 'number':
      return (
        <span className="json-number">
          <Highlight text={String(value)} query={query} />
        </span>
      )
    case 'boolean':
      return (
        <span className="json-boolean">
          <Highlight text={String(value)} query={query} />
        </span>
      )
    default:
      return (
        <span className="json-other">
          <Highlight text={String(value)} query={query} />
        </span>
      )
  }
}

function JsonNode({
  nodeKey,
  value,
  depth,
  defaultExpandDepth,
  query,
  isLast,
}: JsonNodeProps) {
  const expandable = isExpandable(value)

  const hasMatch = useMemo(
    () => (query ? subtreeMatches(value, query) : false),
    [value, query],
  )

  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null)

  // A match forces the path open so the hit is visible, unless the user has
  // explicitly collapsed this node since.
  const expanded =
    manuallyToggled ?? (hasMatch || depth < defaultExpandDepth)

  const keyMatches = Boolean(
    query && nodeKey && nodeKey.toLowerCase().includes(query),
  )

  if (!expandable) {
    return (
      <div className="json-row" style={{ paddingLeft: depth * 14 }}>
        {nodeKey !== null ? (
          <>
            <span className={`json-key${keyMatches ? ' json-key-hit' : ''}`}>
              <Highlight text={nodeKey} query={query} />
            </span>
            <span className="json-colon">:</span>
          </>
        ) : null}
        <ScalarValue value={value} query={query} />
        {!isLast ? <span className="json-comma">,</span> : null}
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)

  const open = Array.isArray(value) ? '[' : '{'
  const close = Array.isArray(value) ? ']' : '}'

  return (
    <div className="json-branch">
      <div
        className="json-row json-row-toggle"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setManuallyToggled(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setManuallyToggled(!expanded)
          }
        }}
      >
        <span className={`json-caret${expanded ? ' json-caret-open' : ''}`}>
          ▶
        </span>
        {nodeKey !== null ? (
          <>
            <span className={`json-key${keyMatches ? ' json-key-hit' : ''}`}>
              <Highlight text={nodeKey} query={query} />
            </span>
            <span className="json-colon">:</span>
          </>
        ) : null}
        {expanded ? (
          <span className="json-brace">{open}</span>
        ) : (
          <span className="json-preview">{collapsedPreview(value)}</span>
        )}
      </div>

      {expanded ? (
        <>
          {entries.map(([key, child], index) => (
            <JsonNode
              key={key}
              nodeKey={key}
              value={child}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
              query={query}
              isLast={index === entries.length - 1}
            />
          ))}
          <div className="json-row" style={{ paddingLeft: depth * 14 }}>
            <span className="json-brace">{close}</span>
            {!isLast ? <span className="json-comma">,</span> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
