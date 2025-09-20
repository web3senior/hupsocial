'use client'

import styles from './NextToast.module.scss'

export const toast = (message, type) => {
  console.log(message)

  const div = document.createElement(`div`)
  div.classList.add(`${styles['toast']}`, 'animate__animated', 'animate__bounceIn')

  switch (type) {
    case `error`:
      div.classList.add(`${styles.error}`)
      div.innerHTML = `<div class="d-f-c"><span class="text-danger">${message}</span></div>`
      break
    case `success`:
      div.classList.add(`${styles.success}`)
      div.innerHTML = `<div class="d-f-c"><span class="text-success">${message}</span></div>`
      break
    case `info`:
      div.classList.add(`${styles.info}`)
      div.innerHTML = `<div class="d-f-c"><span class="text-info">${message}</span></div>`
      break
    case `light`:
      div.classList.add(`${styles.light}`)
      div.innerHTML = `<div class="d-f-c"><span class="text-light">${message}</span></div>`
      break
    case `primary`:
      div.classList.add(`${styles.primary}`)
      div.innerHTML = `<div class="d-f-c"><span class="text-primary">${message}</span></div>`
      break
    default:
      div.innerHTML = `<div class="d-f-c"><span>${message}</span></div>`
      break
  }

  document.querySelector(`#toast`).appendChild(div)

  window.setTimeout(() => {
    div.remove()
  }, 5000)
}

export default function NextToast() {
  return <div id={`toast`} className={`${styles['next-toast']} d-flex align-items-center flex-column text-center`}></div>
}
