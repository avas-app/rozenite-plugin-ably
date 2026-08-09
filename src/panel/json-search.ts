/**
 * Search support for the payload tree.
 *
 * The point of a payload inspector is that search *reveals* rather than
 * filters: matching a deep key should open the path to it, leaving the
 * surrounding structure that gives it meaning visible.
 *
 * `@rozenite/ui` v2's `JsonInspector` replaced its per-node expansion predicate
 * with a single `defaultExpandedDepth`, so reveal is now approximated by
 * expanding to the depth of the deepest hit. That opens some non-matching
 * siblings along the way — the alternative would be re-implementing the tree
 * here, which is not worth losing the shared component over.
 */

/** Depth expanded when there is no active query. */
export const DEFAULT_EXPAND_DEPTH = 2

/** Bounds the walk so a deeply nested payload cannot stall the panel. */
const MAX_SEARCH_DEPTH = 12

function isExpandable(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function entriesOf(value: object): (readonly [string, unknown])[] {
  return Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)
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

  return entriesOf(value).some(
    ([key, child]) =>
      key.toLowerCase().includes(query) ||
      subtreeMatches(child, query, depth + 1),
  )
}

/**
 * Depth of the deepest node matching `query`, or 0 when nothing matches.
 *
 * A node at depth `d` is visible once its parent is expanded, and
 * `JsonInspector` expands every node above `defaultExpandedDepth` — so
 * returning `d` is exactly the depth that reveals it.
 */
function deepestMatchDepth(value: unknown, query: string, depth = 0): number {
  if (depth > MAX_SEARCH_DEPTH || !isExpandable(value)) return 0

  let deepest = 0
  for (const [key, child] of entriesOf(value)) {
    const childDepth = depth + 1
    if (
      key.toLowerCase().includes(query) ||
      (!isExpandable(child) && String(child).toLowerCase().includes(query))
    ) {
      deepest = Math.max(deepest, childDepth)
    }
    deepest = Math.max(deepest, deepestMatchDepth(child, query, childDepth))
  }
  return deepest
}

/**
 * `defaultExpandedDepth` for `JsonInspector`: the usual shallow depth, opened
 * further when a search hit is buried below it.
 */
export function expandDepthForQuery(value: unknown, query: string): number {
  if (!query) return DEFAULT_EXPAND_DEPTH
  return Math.max(DEFAULT_EXPAND_DEPTH, deepestMatchDepth(value, query))
}
