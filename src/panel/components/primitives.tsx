import type { ReactNode } from 'react'
import { Label, Switch, Tooltip } from '@rozenite/ui'

import type { Tone } from '../format'
import { toneTextClass } from '../format'

/**
 * Small local compositions over `@rozenite/ui`.
 *
 * HeroUI's field components are deliberately unopinionated and composed from
 * parts (`Switch` needs a Content/Control/Thumb triplet, tooltips need an
 * explicit trigger). These wrappers assemble them once so the panel's own
 * components stay about Ably rather than about markup.
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
    // The hint rides on a wrapper rather than a `Tooltip`: the switch is
    // already focusable, and `Tooltip.Trigger` would wrap it in a second
    // focusable element.
    <span title={hint}>
      <Switch
        aria-label={label}
        isSelected={isSelected}
        onChange={onChange}
        size="sm"
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label className="cursor-pointer text-xs text-muted">{label}</Label>
        </Switch.Content>
      </Switch>
    </span>
  )
}

/**
 * Tooltip for a control that is already focusable. The control is the trigger,
 * so it keeps its own role and stays a single tab stop.
 */
export function ControlTooltip({
  content,
  children,
}: {
  content: ReactNode
  children: ReactNode
}) {
  return (
    <Tooltip>
      {children}
      <Tooltip.Content className="max-w-xs text-xs">{content}</Tooltip.Content>
    </Tooltip>
  )
}

/**
 * Tooltip for static text. `Tooltip.Trigger` wraps the content in a focusable
 * element so the hint is reachable by keyboard — which is why it must not be
 * used around something that is focusable already.
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
      <Tooltip.Trigger className="contents">{children}</Tooltip.Trigger>
      <Tooltip.Content className="max-w-xs text-xs">{content}</Tooltip.Content>
    </Tooltip>
  )
}

/** A tone-coloured status dot, for rows too dense to carry a `Chip`. */
export function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full bg-current ${toneTextClass(tone)}`}
    />
  )
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
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted">
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
