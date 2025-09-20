'use client'
import { Component, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getCategory } from '../util/api'
import { toast } from 'react-hot-toast'
import Icon from './MaterialIcon'

export default function Convertor({ price, token = '0x0000000000000000000000000000000000000000' ,type = 'lyx' }) {
  const [data, setData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isInFavourite, setIsInFavourite] = useState()

  const getLYXPrice = async () => {
    let requestOptions = {
      method: 'GET',
      redirect: 'follow',
    }

    const response = await fetch(`https://api.diadata.org/v1/assetQuotation/Lukso/0x0000000000000000000000000000000000000000`, requestOptions)
    if (!response.ok) throw new Response('Failed to get data', { status: 500 })
    return response.json()
  }

    const getLSP7Price = async () => {
    let requestOptions = {
      method: 'GET',
      redirect: 'follow',
    }

    const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/lukso/tokens/${token}`, requestOptions)
    if (!response.ok) throw new Response('Failed to get data', { status: 500 })
    return response.json()
  }

  


  useEffect(() => {
if (type===`lyx`) {
      getLYXPrice().then((data) => {
      console.log(data)
      setData(data)
      setIsLoading(!isLoading)
    })
}else {
     getLSP7Price().then((data) => {
      console.log(data)
      setData(data)
      setIsLoading(!isLoading)
    })
}
  }, [])

  if (isLoading) return <>Reading...</>
  return (
    <>
    {type===`lyx` ?<span>{new Intl.NumberFormat('en-US').format(data && price / data.Price)}</span> :
    <span>{new Intl.NumberFormat('en-US').format(data && price / data.data.attributes.price_usd)}</span> }
      
    </>
  )
}
