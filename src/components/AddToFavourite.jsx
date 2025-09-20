'use client'
import { Component, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getCategory } from '../util/api'
import { toast } from 'react-hot-toast'
import Icon from '../helper/MaterialIcon'
import styles from './AddToFavourite.module.scss'

export default function AddToFavourite(props) {
  const [data, setData] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isInFavourite, setIsInFavourite] = useState()

  /**
   * Get favourite from localstorage
   * @returns
   */
  const getFavourite = async () => JSON.parse(typeof window !== 'undefined' ? window.localStorage.getItem('favourite') : '[{}]')

  /**
   * Add to favourite
   * @param {Component} e
   * @param {Int} id
   */
  const addToFavourite = (e, id) => {
    document.querySelector(`#btnFavourite${id}`).setAttribute(`data-btn`, 'add')
    getFavourite().then((favourite) => {
      let newValue = []

      // Check if the favourite is not empty
      if (favourite !== null && favourite.length > 0) {
        if (favourite.filter((item) => item.id === id).length > 0) {
          newValue = favourite.filter((item) => item.id !== id)
          toast.success(`Removed from favourite list.`)
          document.querySelector(`#btnFavourite${id}`).innerHTML = `F`
          document.querySelector(`#btnFavourite${id}`).setAttribute(`data-btn`, 'add')
        } else {
          // Add a new item
          newValue = [...favourite, { id: id, count: 1 }]
          toast.success(`Added to favourite list.`)
          document.querySelector(`#btnFavourite${id}`).innerHTML = `NF`
          document.querySelector(`#btnFavourite${id}`).setAttribute(`data-btn`, 'remove')
        }
      } else {
        // Initial the favourite variable with the first item
        newValue = [{ id: id, count: 1 }]
        toast.success(`Added to favourite list.`)
        document.querySelector(`#btnFavourite${id}`).innerHTML = `NF`
        document.querySelector(`#btnFavourite${id}`).setAttribute(`data-btn`, 'remove')
      }
      localStorage.setItem('favourite', JSON.stringify(newValue))
    })
  }

  useEffect(() => {
    getFavourite().then((list) => {
      if (list === null) setIsInFavourite(false)
      else if (list.filter((item) => item.id === props.productId).length > 0) setIsInFavourite(true)
    })
  }, [])

  return (
    <button id={`btnFavourite${props.productId}`} className={`${styles.button} d-f-c`} 
    onClick={(e) => addToFavourite(e, props.productId)} data-btn={isInFavourite ? `remove` : `add`}>
      {isInFavourite ? <>VF</> : <>F</>}
    </button>
  )
}
