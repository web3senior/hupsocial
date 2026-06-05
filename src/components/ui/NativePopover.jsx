'use client'

import React, { cloneElement, isValidElement, useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import styles from './NativePopover.module.scss'

export default function NativePopover({
  trigger,
  children,
  type = 'auto',
  action = 'toggle',
  placement = 'bottom-start',
  onBeforeToggle,
  onToggle,
  className,
}) {
  const rawId = useId()
  const popoverId = `popover-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const popoverRef = useRef(null)

  useEffect(() => {
    const node = popoverRef.current
    if (!node) return

    if (onBeforeToggle) node.addEventListener('beforetoggle', onBeforeToggle)
    if (onToggle) node.addEventListener('toggle', onToggle)

    return () => {
      if (onBeforeToggle) node.removeEventListener('beforetoggle', onBeforeToggle)
      if (onToggle) node.removeEventListener('toggle', onToggle)
    }
  }, [onBeforeToggle, onToggle])

  const close = () => {
    if (popoverRef.current?.matches(':popover-open')) {
      popoverRef.current.hidePopover()
    }
  }

  const open = () => {
    if (popoverRef.current && !popoverRef.current.matches(':popover-open')) {
      popoverRef.current.showPopover()
    }
  }

  {/* Fixed: Converted target attributes to camelCase properties for React */}
  const triggerProps = {
    popoverTarget: popoverId,
    popoverTargetAction: action,
    'aria-controls': popoverId,
  }

  const triggerNode = isValidElement(trigger) ? (
    cloneElement(trigger, {
      ...triggerProps,
      type: trigger.props.type ?? 'button',
    })
  ) : (
    <button type="button" {...triggerProps} className={styles.trigger}>
      {trigger}
    </button>
  )

  return (
    <>
      {triggerNode}

      <div
        id={popoverId}
        ref={popoverRef}
        popover={type}
        data-placement={placement}
        className={clsx(styles.panel, className)}
      >
        {typeof children === 'function' ? children({ close, open }) : children}
      </div>
    </>
  )
}