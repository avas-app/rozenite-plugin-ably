import type { ReactElement, ReactNode } from 'react'
import { Badge, Switch, Tooltip } from '@rozenite/ui'

import type { Tone } from '../format'
import { toneBadgeClass, toneTextClass } from '../format'

/**
 * Small local compositions over `@rozenite/ui`.
 *
 * The shared components are Base UI primitives with a house style applied, so
 * they stay unopinionated about assembly: `Switch` is a bare control with no
 * label, and a tooltip trigger either wraps or merges into its child depending
 * on whether that child is already focusable. These wrappers make those choices
 * once so the panel's own components stay about Ably rather than about markup.
 */

export function LabeledSwitch({
  label,
  isSelected,
  onChange,
  hint,
}: {
  label: string
  isSelected: boolean
  onChange: (next: boolean) => void
  hint?: string
}) {
  return (
    // `button` is a labelable element, so wrapping the switch makes the text a
    // click target without a second tab stop. The hint rides on the label for
    // the same reason: a `Tooltip.Trigger` here would add one.
    <label
      className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
      title={hint}
    >
      <Switch
        aria-label={label}
        checked={isSelected}
        onCheckedChange={onChange}
      />
      {label}
    </label>
  )
}

/**
 * Tooltip for a control that is already focusable. Base UI's `render` prop
 * merges the trigger into the control rather than wrapping it, so the control
 * keeps its own role and stays a single tab stop.
 */
export function ControlTooltip({
  content,
  children,
}: {
  content: ReactNode
  children: ReactElement<Record<string, unknown>>
}) {
  return (
    <Tooltip>
      <Tooltip.Trigger render={children} />
      <Tooltip.Content>{content}</Tooltip.Content>
    </Tooltip>
  )
}

/**
 * Tooltip for static text. The trigger renders its own element so the hint is
 * reachable by keyboard — which is why it must not be used around something
 * that is focusable already. `contents` keeps it out of the parent's layout.
 */
export function WithTooltip({
  content,
  children,
}: {
  content: ReactNode
  children: ReactNode
}) {
  return (
    <Tooltip>
      <Tooltip.Trigger className="contents cursor-help">
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content>{content}</Tooltip.Content>
    </Tooltip>
  )
}

/** Tone-coloured `Badge`, for states that need to read at a glance. */
export function ToneBadge({
  tone,
  children,
}: {
  tone: Tone
  children: ReactNode
}) {
  return (
    <Badge className={toneBadgeClass(tone)} variant="soft">
      {children}
    </Badge>
  )
}

/** A tone-coloured status dot, for rows too dense to carry a `Badge`. */
export function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full bg-current ${toneTextClass(tone)}`}
    />
  )
}

/** Thin vertical rule between groups in the connection strip. */
export function VerticalRule() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
}

/** `label  value` pair used by the connection strip and the payload metadata. */
export function MetaItem({
  label,
  children,
  mono,
}: {
  label: string
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={`truncate text-xs text-foreground ${mono ? 'font-mono' : ''}`}
      >
        {children}
      </span>
    </div>
  )
}
