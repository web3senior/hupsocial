'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { DotButton, useDotButton } from './EmblaCarouselDotButton'
import { PrevButton, NextButton, usePrevNextButtons } from './EmblaCarouselArrowButtons'
import useEmblaCarousel from 'embla-carousel-react'
import './embla.css'
import styles from './gallery.module.scss'

export default function CarouselSlider({ product }) {
  const [data, setData] = useState([])
  const options = {loop: true}
  const [emblaRef, emblaApi] = useEmblaCarousel(options)
  const { selectedIndex, scrollSnaps, onDotButtonClick } = useDotButton(emblaApi)
  const { prevBtnDisabled, nextBtnDisabled, onPrevButtonClick, onNextButtonClick } = usePrevNextButtons(emblaApi)

  useEffect(() => {
    console.log(product)
  }, [])

  return (
    <div className={styles.page}>
      <div className="embla" ref={emblaRef}>
        <div className="embla__container">
          {product.img1 !== '' && product.img1 && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img1} width={1080} height={1080} priority />
            </div>
          )}

          {product.img2 !== '' && product.img2 !== null && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img2} width={1080} height={1080} priority />
            </div>
          )}

          {product.img3 !== '' && product.img3 && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img3} width={1080} height={1080} priority />
            </div>
          )}

          {product.img4 !== '' && product.img4 && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img4} width={1080} height={1080} priority />
            </div>
          )}

        
          {product.img5 !== '' && product.img5 && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img5} width={1080} height={1080} priority />
            </div>
          )}

          {product.img6 !== '' && product.img6 && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img6} width={1080} height={1080} priority />
            </div>
          )}

          {product.img7 !== '' && product.img7 && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img7} width={1080} height={1080} priority />
            </div>
          )}

          {/* img8 is a .gif for NFT */}
          {/* {product.img8 !== '' && product.img8 && (
            <div className="embla__slide">
              <Image alt={product.name} src={product.img8} width={1080} height={1080} priority />
            </div>
          )} */}

          {/* {product.video !== '' && product.video && (
            <div className="embla__slide">
              <video autoPlay muted loop>
                <source src={product.video} type="video/webm" />
                Your browser does not support HTML video.
              </video>
            </div>
          )} */}
        </div>

        <div className="embla__controls">
          <div className="embla__buttons">
            <PrevButton onClick={onPrevButtonClick} disabled={prevBtnDisabled} />
            <NextButton onClick={onNextButtonClick} disabled={nextBtnDisabled} />
          </div>

          <div className="embla__dots">
            {scrollSnaps.map((_, index) => (
              <DotButton key={index} onClick={() => onDotButtonClick(index)} className={'embla__dot'.concat(index === selectedIndex ? ' embla__dot--selected' : '')} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
