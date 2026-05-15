'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import PageTitle from '@/components/PageTitle';
import Post from '@/components/Post'; // Ensure path is correct
import styles from './page.module.scss';

export default function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  /* Handle clicking a post to navigate to its details */
  const handlePostClick = (id, chainId) => {
    router.push(`/networks/${chainId}/${id}`);
  };

  useEffect(() => {
    // URL Sync Logic... (previously discussed)
    if (query.trim().length < 2) return setResults([]);

    const fetchData = async () => {
      setIsLoading(true);
      const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (json.success) setResults(json.data);
      setIsLoading(false);
    };

    const timer = setTimeout(fetchData, 400);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      <PageTitle name="Search" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="medium">
          
          <div className={styles.searchBox}>
            <input 
              type="text" 
              className={styles.searchBox__input}
              placeholder="Search the multichain..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)} 
            />
          </div>

          <div className={styles.results}>
            {results.map((item, i) => (
              <section
                key={item.id} 
                className={`${styles.postWrapper} animate fade`}
                onClick={() => handlePostClick(item.id, item.chain_id)}
              >
                <Post
                  item={item} 
                  networkName={item.network_name}
                  /* Enable the standard social actions */
                  actions={['like', 'comment', 'share', 'repost', 'hash', 'tip']} 
                />
                {i < results.length - 1 && <hr className={styles.divider} />}
              </section>
            ))}
            
            {!isLoading && query.length > 2 && results.length === 0 && (
              <p className={styles.emptyState}>No posts found matching "{query}"</p>
            )}
          </div>

        </div>
      </div>
    </>
  );
}