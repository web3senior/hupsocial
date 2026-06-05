'use client'

import React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import styles from './NewPostButton.module.scss'

export default function NewPostButton({ onClick, className }) {
  // The sizing is now handled dynamically via CSS variables in the stylesheet
  return (
    <Link 
      href="/new" 
      className={`${styles.newButton} ${className || ''}`} 
      onClick={onClick} 
      aria-label="Create new post"
    >
      <Plus />
    </Link>
  )
}