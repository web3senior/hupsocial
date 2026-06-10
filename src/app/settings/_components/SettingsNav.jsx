'use client'

import { useState } from 'react'
import {
  Wallet,
  Lock,
  Sliders,
  UserCheck,
  SlidersHorizontal,
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  AtSign,
  Radio,
  Send,
  UserX,
  Ban,
} from 'lucide-react'
import styles from './SettingsNav.module.scss'
import InAppWallet from './InAppWallet'

export default function SettingsNav() {
  // Manage whether we see the menu list or the active detail pane on mobile viewports
  const [view, setView] = useState('menu')
  const [activeTab, setActiveTab] = useState('in-app-wallet')

  // Sidebar primary navigation mapping with disabled options added
  const navItems = [
    {
      id: 'in-app-wallet',
      label: 'In-app wallet',
      desc: 'Manage your background transaction settings and automatic signing approvals on Hub.',
      icon: <Wallet size={20} />,
    },
    {
      id: 'privacy',
      desc: 'Manage your visibility and digital footprint options',
      label: 'Privacy',
      icon: <Lock size={20} />,
      disabled: true,
    },
    {
      id: 'content',
      desc: 'Tailor your feed and notification settings',
      label: 'Content preferences',
      icon: <Sliders size={20} />,
      disabled: true,
    },
    { id: 'status', label: 'Account status', icon: <UserCheck size={20} />, disabled: true },
    { id: 'more', label: 'More settings', icon: <SlidersHorizontal size={20} />, disabled: true },
    { id: 'help', label: 'Help & Support', icon: <HelpCircle size={20} />, disabled: true },
  ]

  // Submenu configuration with disabled options added
  const subMenuContent = {
    'in-app-wallet': [
      { id: 'auto-sign', label: 'Automatic signing', desc: 'Allow background transactions', icon: <Sliders size={20} /> , disabled: true},
      { id: 'export-key', label: 'Export private key', icon: <Lock size={20} />, disabled: true},
    ],
    privacy: [
      { id: 'private-profile', label: 'Private profile', badge: 'Public', icon: <Lock size={20} /> },
      { id: 'tags', label: 'Tags and mentions', icon: <AtSign size={20} /> },
      { id: 'online', label: 'Online status', icon: <Radio size={20} />, disabled: true },
      { id: 'messages', label: 'Messages', icon: <Send size={20} /> },
      { id: 'restricted', label: 'Restricted profiles', icon: <UserX size={20} /> },
      { id: 'blocked', label: 'Blocked profiles', icon: <Ban size={20} /> },
    ],
    accounts: [{ id: 'password', label: 'Password & Security', icon: <Lock size={20} /> }],
  }

  // Handle setting active navigation tabs and pushing the viewport forward on small screens
  const handleTabSelect = (id) => {
    setActiveTab(id)
    setView('detail')
  }

  return (
    <div className={`${styles.settingsContainer} ${styles[view]}`}>
      {/* Structural layout representing left column navigation controls */}
      <aside className={styles.sidebar}>
        <nav className={styles.navMenu}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => !item.disabled && handleTabSelect(item.id)}
              className={`${styles.navItem} ${activeTab === item.id ? styles.isActive : ''} ${item.disabled ? styles.isDisabled : ''}`}
              type="button"
              disabled={item.disabled}
              aria-disabled={item.disabled}
            >
              <span className={styles.iconWrapper}>{item.icon}</span>
              <div className={styles.textWrapper}>
                <span className={styles.label}>{item.label}</span>
                {item.desc && <p className={styles.description}>{item.desc}</p>}
              </div>
            </button>
          ))}
        </nav>
      </aside>

      {/* Structural layout representing the right detail presentation viewport */}
      <main className={styles.contentPane}>
        {/* Mobile top action header bar to clear current viewport details */}
        <div className={styles.mobileHeader}>
          <button 
            type="button" 
            className={styles.backButton} 
            onClick={() => setView('menu')}
          >
            <ChevronLeft size={20} />
            <span>Settings</span>
          </button>
        </div>

        {activeTab === 'in-app-wallet' && <InAppWallet />}
        <div className={styles.subMenuList}>
          {subMenuContent[activeTab]?.map((subItem) => (
            <button
              key={subItem.id}
              className={`${styles.subMenuItem} ${subItem.disabled ? styles.isDisabled : ''}`}
              type="button"
              disabled={subItem.disabled}
              aria-disabled={subItem.disabled}
            >
              <div className={styles.subMenuLeft}>
                <span className={styles.subIconWrapper}>{subItem.icon}</span>
                <span className={styles.subMenuLabel}>{subItem.label}</span>
              </div>
              <div className={styles.subMenuRight}>
                {subItem.badge && <span className={styles.badge}>{subItem.badge}</span>}
                <ChevronRight size={18} className={styles.arrow} />
              </div>
            </button>
          ))}
          {!subMenuContent[activeTab] && <div className={styles.emptyState}>Content for this tab is coming soon.</div>}
        </div>
      </main>
    </div>
  )
}