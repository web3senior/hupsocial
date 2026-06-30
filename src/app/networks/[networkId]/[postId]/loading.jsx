export default function Loading() {
  return (
     <div className={`__container`} data-width={`small`}>
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '1rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="shimmer" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
            <div className="shimmer" style={{ width: '35%', height: 12, borderRadius: 6 }} />
            <div className="shimmer" style={{ width: '20%', height: 10, borderRadius: 6 }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '3rem' }}>
          <div className="shimmer" style={{ width: '90%', height: 12, borderRadius: 6 }} />
          <div className="shimmer" style={{ width: '80%', height: 12, borderRadius: 6 }} />
          <div className="shimmer" style={{ width: '60%', height: 12, borderRadius: 6 }} />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', paddingLeft: '3rem', marginTop: '0.25rem' }}>
          {[48, 40, 40, 36].map((w, i) => (
            <div key={i} className="shimmer" style={{ width: w, height: 28, borderRadius: 999 }} />
          ))}
        </div>
      </section>

      {[1, 2, 3].map((i) => (
        <section
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="shimmer" style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }} />
            <div className="shimmer" style={{ width: '28%', height: 10, borderRadius: 6 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingLeft: '2.6rem' }}>
            <div className="shimmer" style={{ width: `${70 + i * 7}%`, height: 11, borderRadius: 6 }} />
            {i < 3 && <div className="shimmer" style={{ width: `${50 + i * 5}%`, height: 11, borderRadius: 6 }} />}
          </div>
        </section>
      ))}
    </div></div>
  )
}
