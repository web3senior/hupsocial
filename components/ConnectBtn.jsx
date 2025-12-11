'use client'
import React from 'react'

export default function ConnectBtn() {
  return (
    <div>
      <appkit-connect-button label="d" balance="show" size="sm" />
      {/* Later: you can show modal.AccountButton, modal.NetworkButton, etc. */}
    </div>
  )
}
