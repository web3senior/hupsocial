import styles from './PageTitle.module.scss'

const PageTitle = ({ name }) => {
  return (
    <div className={`${styles.pageTitle} d-f-c`}>
       <p>{name}</p>
    </div>
  )
}

export default PageTitle
