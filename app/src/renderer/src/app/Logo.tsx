/** Text-based identity with a small geometric mark (two orbits: mind and space). */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="6" className="fill-raised stroke-line-strong" strokeWidth="1" />
      <circle cx="12" cy="12" r="5.25" className="stroke-accent" strokeWidth="1.6" />
      <circle cx="15.6" cy="8.4" r="1.9" className="fill-accent" />
    </svg>
  )
}
