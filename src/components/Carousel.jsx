'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { getCarousel } from './../util/api'
import './../node_modules/react-responsive-carousel/lib/styles/carousel.min.css'
import { Carousel } from 'react-responsive-carousel'
import useEmblaCarousel from 'embla-carousel-react'
import styles from './Carousel.module.scss'

export default function CarouselSlider() {
  const [data, setData] = useState([])
  const [emblaRef] = useEmblaCarousel()

  useEffect(() => {
    getCarousel().then((res) => {
      setData(res)
    })
  }, [])

  return (
    <div className={styles.page} dir={`ltr`}>
      <div className="embla" ref={emblaRef}>
        <div className="embla__container">
          {data &&
            data.length > 0 &&
            data.map((item, i) => {
              if (item.image === '' && !product.image) return
              return (
                <div key={i} className={`embla__slide ${styles.item}`}>
                  <Image alt={item.title} src={`${process.env.NEXT_PUBLIC_UPLOAD_IMAGE_URL}${item.image}`} width={1024} height={0} priority />
                  <b>{item.title}</b>
                </div>
              )
            })}
        </div>
      </div>
      {/* {data && data.length > 0 && (
        <Carousel>
          {data.map((item, i) => {
            return (
              <div key={i} className={`${styles.item}`}>
                <Image alt={item.title} src={`${process.env.NEXT_PUBLIC_UPLOAD_IMAGE_URL}${item.image}`} width={1024} height={0} priority />
                <b>{item.title}</b>
              </div>
            )
          })}
        </Carousel>
      )} */}
    </div>
  )
}
