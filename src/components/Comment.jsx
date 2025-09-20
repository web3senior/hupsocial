'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { toast } from '@/components/Toaster'
import { getComment, getIsValidToken, newComment } from '../util/api'
import FilledStar from './../public/filled-start.svg'
import UnFilledStar from './../public/unfilled-start.svg'
import styles from './Comment.module.scss'

export default function Page({ productId }) {
  const [status, setStatus] = useState()
  const [data, setData] = useState([])
  const [isUserSignedIn, setIsUserSignedIn] = useState()

 const handleForm = async (e) => {
    e.preventDefault()
    setStatus('loading')

    const formData = new FormData(e.target)
    const content = formData.get('content')
    const star = formData.get('star')
    const errors = {}

    if (content.length < 0) {
      errors.content = 'Please try again'
      toast(errors.content ,'error')
    }

    const post = {
      content: content,
      star: star
    }

    newComment(post,productId).then((res) => {
      console.log(res)
      toast(`${res.message}`, 'success')
      setStatus('')
      e.target.reset()
    })
  }
  
  useEffect(() => {
    getComment(productId).then((res) => {
      console.log(res)
      setData(res)
    })

    getIsValidToken().then((result) => {
      if (result) setIsUserSignedIn(true)
      else setIsUserSignedIn(true)
    })
  }, [])

  return (
    <div id={`comment`} className={`${styles.comment} card mb-20`}>
      <div className={`card__header`}>Comments</div>
      <div className={`card__body`}>
        <div className={`text-justify`} style={{ lineHeight: `2`, opacity: '.8' }}>
          {data.length > 0 ? (
            <ul>
              {data.map((item, i) => {
                return (
                  <li key={`c${i}`} className={`mt-20`}>
                    <div className={`d-flex align-items-center justify-content-between`}>
                      <p className={`d-f-c`} style={{ columnGap: `.5rem` }}>
                        <b>{item.user_fullname}</b>
                        <small dir={`ltr`} className={`text-warning`}>
                          {item.dt}
                        </small>
                      </p>
                      <div className={`d-flex flex flex-row`} dir={`ltr`}>
                        <Star count={item.star} />
                      </div>
                    </div>
                    <div className={`mt-20`}>{item.content}</div>
                    <p className={`${styles['comment__respond']}`}>{item.respond}</p>
                  </li>
                )
              })}
            </ul>
          ) : (
            <small className={``} style={{ color: `var(--orange-300)` }}>
              🗨️ No comments
            </small>
          )}
        </div>

        <div className={`mt-40`} style={{ columnGap: `.5rem` }}>
          <div className={` d-flex flex-row align-items-center`}>
            <figure>
              <Image alt={`Default PFP`} src={`/default-pfp.svg`} width={32} height={32} />
            </figure>
            <div className={`d-flex flex-column`}>
              <b>New comment</b>
              {isUserSignedIn && <p>Your comment will be shown publicly right after admin's confirmation.</p>}
              {!isUserSignedIn && (
                <>
                  <p>
                    <small>برای ارسال نظر بایستی به پنل کاربری خود وارد شوید.</small>
                    <Link href={`/sign-in`} style={{ fontSize: `12px`, color: `var(--color-primary)`, marginRight: `.25rem` }}>
                      ورود
                    </Link>
                  </p>
                </>
              )}
            </div>
          </div>
          {isUserSignedIn && (
            <>
              <form className="form mt-20" method={`post`} onSubmit={handleForm}>
              <div>
                  <textarea name={`content`} placeholder={`Your comment`} required></textarea>
                </div>
                <div>
                  <label htmlFor="">Score:</label>
                  <select name="star" id="" defaultValue={5}>
                    <option value={1}>⭐</option>
                    <option value={2}>⭐⭐</option>
                    <option value={3}>⭐⭐⭐</option>
                    <option value={4}>⭐⭐⭐⭐</option>
                    <option value={5}>⭐⭐⭐⭐⭐</option>
                  </select>
                </div>
                <div className={`mt-10`}>
                  <button className={`btn`} type={`submit`}>{status === `loading` ? 'Sending...' : 'Send'}</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const Star = ({ count }) => {
  let stars = []
  for (let i = 0; i < count; i++) {
    stars.push(<Image key={`filledStar${i}`} src={FilledStar} alt="ستاره" width={12} height={12} priority />)
  }

  for (let i = 0; i < 5 - count; i++) {
    stars.push(<Image key={`unFilledStar${i}`} src={UnFilledStar} alt="ستاره" width={12} height={12} priority />)
  }

  return stars
}
