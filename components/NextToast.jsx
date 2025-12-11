'use client'

import styles from './NextToast.module.scss'

export const toast = (message = `Default message`, type) => {
  console.log(message)

  const div = document.createElement(`div`)
  div.classList.add(`${styles['toast']}`, `${styles[type]}`, `animate`, `pop`)
  div.innerHTML = `<span>${message}</span>`

  // switch (type) {
  //   case `error`:
  //     div.classList.add(`${styles.error}`)
  //     div.innerHTML = `<span>${message}</span>`
  //     break
  //   case `success`:
  //     div.classList.add(`${styles.success}`)
  //     div.innerHTML = `<span>${message}</span>`
  //     break
  //   case `info`:
  //     div.classList.add(`${styles.info}`)
  //     div.innerHTML = `<span>${message}</span>`
  //     break
  //   case `light`:
  //     div.classList.add(`${styles.light}`)
  //     div.innerHTML = `<span>${message}</span>`
  //     break
  //   case `primary`:
  //     div.classList.add(`${styles.primary}`)
  //     div.innerHTML = `<span>${message}</span>`
  //     break
  //   default:
  //     div.innerHTML = `<span>${message}</span>`
  //     break
  // }

  document.querySelector(`#toast`).appendChild(div)

  window.setTimeout(() => {
    div.remove()
  }, 5000)
}

export default function NextToast() {
  return <div id={`toast`} className={`${styles['next-toast']} d-flex align-items-center flex-column text-center`} />
}
