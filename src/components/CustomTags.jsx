'use client' // Important for Next.js App Router

/**
How to use
import HupMintTag from "@/components/CustomTags";
<HupMintTag/>
<hup-mint contract={`0x188eeC07287D876a23565c3c568cbE0bb1984b83`}></hup-mint>
 */

import { useEffect } from 'react'

export default function HupMintTag() {
  useEffect(() => {
    // Only run this in the browser
    if (typeof window !== 'undefined' && !customElements.get('hup-mint')) {
      const style = `
      :host {
        background: #FFFFFF;
      }

      .btn {
        width: 100%;
        height: 50px;
      }`

      let tmpl = document.createElement('template')
      tmpl.innerHTML = `
      <style>${style}</style>
      <button class="btn">Mint</button>
      `

      class HupMint extends HTMLElement {
        static observedAttributes = ['contract']

        constructor() {
          super()

          this.attachShadow({
            mode: 'open',
          })
          this.shadowRoot.appendChild(tmpl.content.cloneNode(true))

          // Bind the handler so 'this' refers to the class
          this.handleMintClick = this.handleMintClick.bind(this)
        }

        attributeChangedCallback(name, oldValue, newValue) {
          console.log(`Attribute ${name} has changed from ${oldValue} to ${newValue}.`)
          this.contract = newValue
          // this.readProfile()
        }

        getTmpl() {
          return tmpl
        }

        getTmplRaw() {
          return tmpl.innerHTML
        }

        // 1. Define the handler logic
        handleMintClick(event) {
          console.log('Minting for address:', this.contract)

          // You can trigger a custom event that Next.js can listen to
          this.dispatchEvent(
            new CustomEvent('onMint', {
              detail: { address: this.contract },
              bubbles: true,
              composed: true,
            })
          )
        }

        connectedCallback() {
          // 2. Attach the listener when the element enters the DOM
          const mintBtn = this.shadowRoot.querySelector('.btn')
          if (mintBtn) {
            mintBtn.addEventListener('click', this.handleMintClick)
          }
        }

        disconnectedCallback() {
          // Clean up to prevent memory leaks
          const mintBtn = this.shadowRoot.querySelector('.btn')
          if (mintBtn) {
            mintBtn.removeEventListener('click', this.handleMintClick)
          }
        }
      }

      customElements.define('hup-mint', HupMint)
    }
  }, [])

  return null
}
