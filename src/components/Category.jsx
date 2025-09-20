'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getCategory } from '../util/api'
import styles from './Category.module.scss'

export default function Category() {
  const [data, setData] = useState([])

  useEffect(() => {
    getCategory().then((res) => {
      setData(res)
    })
  }, [])

  return (
    <div className={styles.page}>
      <div className={`__container`} data-width={`xlarge`}>
        <div className={`${styles.category}`}>
          {data &&
            data.length > 0 &&
            data.map((item, i) => {
              return (
                <Link key={i} href={`./product?category=${item.id}`} className={`${styles['category__item']}`}>
                  <div className={`${styles.item} card`}>
                    <div className={`card__body d-f-c flex-column`}>
                      <Image alt={item.name} src={item.icon} width={120} height={90} priority />
                      <b className={`text-center ff-vazir`}>{item.name}</b>
                    </div>
                  </div>
                </Link>
              )
            })}
        </div>
      </div>
    </div>
  )
}
