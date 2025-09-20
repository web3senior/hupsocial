'use client'
import { Component, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getCategory } from '../util/api'
import { toast } from 'react-hot-toast'
import Icon from './../helper/MaterialIcon'
import styles from './AddToCartButton.module.scss'

export default function AddToCartButton(props) {
  const [data, setData] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isInCart, setIsInCart] = useState()
  const [cartIcon, setCartIcon] = useState('-')

  /**
   * Get cart from localstorage
   * @returns
   */
  const getCart = async () => JSON.parse(typeof window !== 'undefined' ? window.localStorage.getItem('cart') : '[{}]')

  /**
   * Add to cart
   * @param {Component} e
   * @param {Int} id
   */
  const addToCart = (e, id) => {
    document.querySelector(`#btnCart${id}`).setAttribute(`data-btn`, 'add')
    getCart().then((cart) => {
      let newValue = []

      // Check if the cart is not empty
      if (cart !== null && cart.length > 0) {
        if (cart.filter((item) => item.id === id).length > 0) {
          newValue = cart.filter((item) => item.id !== id)
          toast.success(`Removed from cart.`)
          document.querySelector(`#btnCart${id}`).innerHTML = `+`
          document.querySelector(`#btnCart${id}`).setAttribute(`data-btn`, 'add')
        } else {
          // Add a new item
          newValue = [...cart, { id: id, count: 1 }]
          toast.success(`Added to cart.`)
          document.querySelector(`#btnCart${id}`).innerHTML = `-`
          document.querySelector(`#btnCart${id}`).setAttribute(`data-btn`, 'remove')
        }
      } else {
        // Initial the cart variable with the first item
        newValue = [{ id: id, count: 1 }]
        toast.success(`Added to cart.`)
        document.querySelector(`#btnCart${id}`).innerHTML = `-`
        document.querySelector(`#btnCart${id}`).setAttribute(`data-btn`, 'remove')
      }
      localStorage.setItem('cart', JSON.stringify(newValue))
      document.querySelector(`#cartCount`).innerText = newValue.length
    })
  }

  useEffect(() => {
    getCart().then((cart) => {
      if (cart === null) setIsInCart(false)
      else if (cart.filter((item) => item.id === props.productId).length > 0) setIsInCart(true)
    })
  }, [])

  return (
    <button id={`btnCart${props.productId}`} className={`${styles.button} d-f-c`} 
    onClick={(e) => addToCart(e, props.productId)} data-btn={isInCart ? `remove` : `add`}>
      {isInCart ? <>-</> : <>+</>}
    </button>
  )
}
