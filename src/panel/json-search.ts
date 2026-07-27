/**
 * Search support for the payload tree.
 *
 * The point of a payload inspector is that search *reveals* rather than
 * filters: matching a deep key should open the path to it, leaving the
 * surrounding structure that gives it meaning visible. `JsonInspector` has no
 * notion of a query, but it accepts an initial-expansion predicate — so the
 * query is applied by expanding any subtree that contains a hit.
 */

/** Depth expanded when there is no active query. */
export const DEFAULT_EXPAND_DEPTH = 2

/** Bounds the walk so a deeply nested payload cannot stall the panel. */
const MAX_SEARCH_DEPTH = 12

function isExpandable(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/** Does this subtree contain the query anywhere in a key or a scalar value? */
export function subtreeMatches(
  value: unknown,
  query: string,
  depth = 0,
): boolean {
  if (!query || depth > MAX_SEARCH_DEPTH) return false

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

/**
 * Predicate for `JsonInspector`'s `shouldExpandNodeInitially`: shallow nodes are
 * open by default, and anything containing a search hit is opened regardless of
 * depth.
 */
export function expandForQuery(query: string) {
  return (_keyPath: readonly (string | number)[], data: unknown, level: number) =>
    level < DEFAULT_EXPAND_DEPTH || subtreeMatches(data, query)
}
