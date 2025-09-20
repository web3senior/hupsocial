'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/Toaster'
import { getAllProduct, getIsValidToken, newComment } from '../util/api'
import FilledStar from './../public/filled-start.svg'
import UnFilledStar from './../public/unfilled-start.svg'
import styles from './Search.module.scss'

export default function Page({ setVisibleSearch }) {
  const [status, setStatus] = useState()
  const [data, setData] = useState([])
  const [searchData, setSearchData] = useState([])
  const [noResult, setNoResult] = useState(false)
  const router = useRouter()

  const handleSeach = async (e) => {
    e.preventDefault()
    setStatus('loading')

    const q = e.target.value.trim()
    const filteredData=data.filter((item) => item.name.trim().search(q) > -1)
    if(filteredData.length > 0) {
      setSearchData(filteredData)
      setNoResult(false)
    }
      else setNoResult(true)
  }

  const slugify = (str) => {
    str = str.replace(/^\s+|\s+$/g, '') // trim leading/trailing white space
    str = str.toLowerCase() // convert string to lowercase
    str = str
      .replace(/\s+/g, '-') // replace spaces with hyphens
      .replace(/-+/g, '-') // remove consecutive hyphens
    return str
  }

  useEffect(() => {
    getAllProduct().then((res) => {
      console.log(res)
      setData(res)
    })
  }, [])

  return (
    <div className={`${styles.page}`}>
      <div className={`__container d-flex flex-column`} data-width={`large`}>
        <div className={`d-flex align-items-center justify-content-between`}>
          <h3>جستجو در محصولات نارشین</h3>
          <button className={`btn rounded`} onClick={() => setVisibleSearch(false)}>
            بستن
          </button>
        </div>
        <div className={`mt-10`}>
          <input type={`text`} name={`q`} id={`q`} list={`products`} placeholder={` نام محصول یا برند را وارد کنید`} onChange={(e) => handleSeach(e)} />
        </div>

        {data && data.length > 0 && (
          <>
            <datalist id={`products`}>
              {data.map((item, i) => (
                <option key={i}>{item.name}</option>
              ))}
            </datalist>
          </>
        )}

        {noResult && <p className={`text-center`}>محصولی  یافت نشد</p>}

        {searchData && searchData.length > 0 && (
          <div className={`grid grid--fill ${styles['product']} mt-10`} style={{ '--data-width': `160px` }}>
            {searchData.map((item, i) => {
              return (
                <div key={`p${i}`} className={`${styles['product__item']}`}>
                  <div
                    className={`card pointer`}
                    onClick={() => {
                      setVisibleSearch(false)
                      router.push(`/product/${item.id}/${slugify(item.name)}`)
                    }}
                  >
                    <figure className={`d-f-c`}>
                      <Image alt={item.name} src={item.img1} width={200} height={0} priority />
                    </figure>
                    <div className={`card__body`}>
                      <h1 className={`text-center`}>{item.name}</h1>
                      <ul className={`d-f-c d-flex`}>
                        <li className={`d-flex flex-column`}>
                          <span className={`${styles['product__item__price']}`}>
                            <small>{new Intl.NumberFormat('fa-IR', { maximumSignificantDigits: 3 }).format(item.price)}</small>
                            <small className={`mr-10`}>تومان</small>
                          </span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
