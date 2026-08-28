'use client'

import { GridNineIcon, ListDashesIcon, SquaresFourIcon } from '@phosphor-icons/react'
import SegmentedControl from './SegmentedControl'

// Ordered loosest to tightest, so the control reads as one axis rather than three moods
const LAYOUTS = [
  { value: 'comfortable', label: 'Large grid', icon: SquaresFourIcon },
  { value: 'compact', label: 'Small grid', icon: GridNineIcon },
  { value: 'list', label: 'List', icon: ListDashesIcon },
]

/**
 * Layout Toggle
 * A SegmentedControl cut to one job: a grid's density. Named rather than inlined at each call
 * site because the three values are a contract — useGridLayout stores them and every grid reads
 * the same three back.
 *
 * The choice changes nothing but presentation, so it stays a group of pressed buttons rather than
 * a tablist: there is no panel below it being swapped, only the same items re-laid out.
 * @param {Object} props
 * @param {string} props.value Current layout — 'comfortable' | 'compact' | 'list'.
 * @param {Function} props.onChange Called with the chosen layout.
 * @param {string} [props.label='Layout'] Accessible name for the group.
 * @param {string} [props.className] Extra class for toolbar placement.
 */
export default function LayoutToggle({ value, onChange, label = 'Layout', className }) {
  return <SegmentedControl options={LAYOUTS} value={value} onChange={onChange} label={label} className={className} iconOnly />
}
