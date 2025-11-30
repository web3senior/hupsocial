'use client'

import { Component, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getCategory } from './../../util/api'
import { toast } from './../../components/Toaster'
import Icon from './../../helper/MaterialIcon'
import { useSearchParams, usePathname, useRouter } from 'next/navigation'
import styles from './category.module.scss'

export default function AddToCartButton(props) {
  const [data, setData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [category, setCategory] = useState([])

  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { replace } = useRouter()
  const params = new URLSearchParams(searchParams)
  const router = useRouter()

  const goTo = (e) => router.push(`product?category=${e.target.value}`)

  const handleCheckCategory = (e, value) => {
    if (value !== null) params.set('category', value)
    else params.delete(`category`)
    replace(`${pathname}?${params.toString()}`)
  }

  useEffect(() => {
    getCategory().then((res) => {
      setCategory(res)
      setIsLoading(false)
    })
  }, [])

  if (isLoading) return <>Loading...</>

  return (
    <div>
      <select className={`${styles['miniCategory']}`} onChange={(e) => goTo(e)}>
        <option value={``}>All</option>

        {category.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>

      <div className={`${styles['category']} d-flex grid--gap-1`}>
        <div className={`item`}>
          <div className={`item__body d-flex pt-10 pb-10`} style={{ gap: `.25rem` }}>
            <button onClick={(e) => handleCheckCategory(e, null)} data-active={params.get(`category`) === null}>
              All
            </button>
          </div>
        </div>

        {category.map((item) => (
          <div key={item.id}>
            <div className={`item`}>
              <div className={`item__body d-flex pt-10 pb-10`} style={{ gap: `.25rem` }}>
                <button onClick={(e) => handleCheckCategory(e, item.id)} data-active={params.get(`category`) === item.id.toString()}>
                  {item.name}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
