'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AtIcon, BroadcastIcon, CaretLeftIcon, CaretRightIcon, EnvelopeSimpleIcon, FadersHorizontalIcon, FadersIcon, GlobeIcon, KeyIcon, LockIcon, PaperPlaneTiltIcon, PlayCircleIcon, ProhibitIcon, QuestionIcon, UserCheckIcon, UserMinusIcon, WalletIcon } from '@phosphor-icons/react'
import styles from './SettingsNav.module.scss'
import InAppWallet from './InAppWallet'
import SecurityVault from './SecurityVault'
import LanguagePreference from './LanguagePreference'
import PlaybackPreference from './PlaybackPreference'
import EmailNotifications from './EmailNotifications'
import EmailWallet from './EmailWallet'
import PushNotificationManager from '@/components/ui/PushNotificationManager'

// The tabs that render a real pane — everything else in navItems is a disabled placeholder
const VALID_TABS = ['security', 'in-app-wallet', 'email-wallet', 'notification', 'email-notifications', 'language', 'playback']

export default function SettingsNav() {
  // Deep-linkable: other pages send users here with /settings?tab=security instead of
  // running their own PIN prompts — this tab is the app's single PIN entry point.
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab = VALID_TABS.includes(requestedTab) ? requestedTab : 'security'

  // Manage whether we see the menu list or the active detail pane on mobile viewports
  const [view, setView] = useState(requestedTab ? 'detail' : 'menu')
  const [activeTab, setActiveTab] = useState(initialTab)

  // Sidebar primary navigation mapping with disabled options added
  const navItems = [
    {
      id: 'security',
      label: 'Security Vault',
      desc: 'One PIN that protects private communities and your in-app wallet keys.',
      icon: <KeyIcon size={20} />,
    },
    {
      id: 'in-app-wallet',
      label: 'In-app wallet',
      desc: 'Manage your background transaction settings and automatic signing approvals on Hub.',
      icon: <WalletIcon size={20} />,
    },
    {
      id: 'email-wallet',
      label: 'Email wallet',
      desc: 'Recovery password, key export and device controls for your email login wallet.',
      icon: <KeyIcon size={20} />,
    },
    {
      id: 'notification',
      desc: 'Get notifications',
      label: 'Push Notification',
      icon: <LockIcon size={20} />,
    },
    {
      id: 'email-notifications',
      label: 'Email notifications',
      desc: 'Get your notifications as email digests.',
      icon: <EnvelopeSimpleIcon size={20} />,
    },
    {
      id: 'language',
      label: 'Language',
      desc: 'Pick the language posts are translated into.',
      icon: <GlobeIcon size={20} />,
    },
    {
      id: 'playback',
      label: 'Playback',
      desc: 'Choose whether videos start on their own.',
      icon: <PlayCircleIcon size={20} />,
    },
        {
      id: 'privacy',
      desc: 'Manage your visibility and digital footprint options',
      label: 'Privacy',
      icon: <LockIcon size={20} />,
      disabled: true,
    },
    {
      id: 'content',
      desc: 'Tailor your feed and notification settings',
      label: 'Content preferences',
      icon: <FadersIcon size={20} />,
      disabled: true,
    },
    { id: 'status', label: 'Account status', icon: <UserCheckIcon size={20} />, disabled: true },
    { id: 'more', label: 'More settings', icon: <FadersHorizontalIcon size={20} />, disabled: true },
    { id: 'help', label: 'Help & Support', icon: <QuestionIcon size={20} />, disabled: true },
  ]

  // Submenu configuration with disabled options added
  const subMenuContent = {
    'in-app-wallet': [
      { id: 'auto-sign', label: 'Automatic signing', desc: 'Allow background transactions', icon: <FadersIcon size={20} /> , disabled: true},
      { id: 'export-key', label: 'Export private key', icon: <LockIcon size={20} />, disabled: true},
    ],
        'Notification': [
      { id: 'auto-sign', label: 'Automatic signing', desc: 'Allow background transactions', icon: <FadersIcon size={20} /> , disabled: true},
      { id: 'export-key', label: 'Export private key', icon: <LockIcon size={20} />, disabled: true},
    ],
    privacy: [
      { id: 'private-profile', label: 'Private profile', badge: 'Public', icon: <LockIcon size={20} /> },
      { id: 'tags', label: 'Tags and mentions', icon: <AtIcon size={20} /> },
      { id: 'online', label: 'Online status', icon: <BroadcastIcon size={20} />, disabled: true },
      { id: 'messages', label: 'Messages', icon: <PaperPlaneTiltIcon size={20} /> },
      { id: 'restricted', label: 'Restricted profiles', icon: <UserMinusIcon size={20} /> },
      { id: 'blocked', label: 'Blocked profiles', icon: <ProhibitIcon size={20} /> },
    ],
    accounts: [{ id: 'password', label: 'Password & Security', icon: <LockIcon size={20} /> }],
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
            <CaretLeftIcon size={20} />
            <span>Settings</span>
          </button>
        </div>

        {activeTab === 'security' && <SecurityVault />}
        {activeTab === 'in-app-wallet' && <InAppWallet onOpenSecurity={() => handleTabSelect('security')} />}
        {activeTab === 'email-wallet' && <EmailWallet />}
        {activeTab === 'notification' && <PushNotificationManager />}
        {activeTab === 'email-notifications' && <EmailNotifications />}
        {activeTab === 'language' && <LanguagePreference />}
        {activeTab === 'playback' && <PlaybackPreference />}

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
                <CaretRightIcon size={18} className={styles.arrow} />
              </div>
            </button>
          ))}
          {/* Tabs that render their own pane above are already showing content, so the placeholder is only for the disabled ones */}
          {!subMenuContent[activeTab] && !VALID_TABS.includes(activeTab) && <div className={styles.emptyState}>Content for this tab is coming soon.</div>}
        </div>
      </main>
    </div>
  )
}