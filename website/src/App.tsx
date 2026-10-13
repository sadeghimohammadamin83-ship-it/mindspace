import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PenLine, Library, FolderKanban, Scale, FileText, Search, Quote, ShieldCheck, Download, Menu, X, ChevronDown, Clock, HardDrive, Cloud, Cpu, type LucideIcon } from 'lucide-react'
import { downloadUrl, site } from './config'
import { features, steps, shots, faq } from './content'

const icons: Record<string, LucideIcon> = { pen: PenLine, library: Library, folder: FolderKanban, scale: Scale, file: FileText, search: Search, quote: Quote, shield: ShieldCheck }
const GhMark = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.5 15.6c.4.1.55-.17.55-.38v-1.4c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg>
const base = import.meta.env.BASE_URL
const nav = [['Features', '#features'], ['How it works', '#how'], ['Privacy', '#privacy'], ['Download', '#download']] as const

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) { setOn(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect() } }, { threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className={`reveal ${on ? 'in' : ''} ${className}`}>{children}</div>
}

function DownloadButton({ big }: { big?: boolean }) {
  const cls = `btn btn-primary ${big ? 'btn-lg' : ''}`
  if (site.released) {
    return <a className={cls} href={downloadUrl}><Download size={18} aria-hidden /> Download for Windows</a>
  }
  return <a className={`${cls} is-soon`} href="#download"><Clock size={18} aria-hidden /> Release in preparation</a>
}

export default function App() {
  const [open, setOpen] = useState(false)
  const [shot, setShot] = useState(0)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const s = shots[shot]
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="wrap bar">
          <a className="brand" href="#top" aria-label="MINDSPACE home"><span className="ring" aria-hidden />MINDSPACE</a>
          <nav aria-label="Primary" className={`links ${open ? 'open' : ''}`}>
            {nav.map(([l, h]) => <a key={h} href={h} onClick={() => setOpen(false)}>{l}</a>)}
            <a href={site.repo} onClick={() => setOpen(false)}><GhMark /> GitHub</a>
          </nav>
          <button className="menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      <main id="main">
        <section className="hero wrap" id="top">
          <p className="eyebrow">Local-first second brain · Windows</p>
          <h1>Your Mind, <em>With Room to Think.</em></h1>
          <p className="lead">MINDSPACE brings your notes, documents, projects and decisions into one connected workspace, with search that finds what matters and answers that show their sources.</p>
          <div className="cta">
            <DownloadButton big />
            <a className="btn btn-ghost btn-lg" href="#features">Explore features</a>
            <a className="btn btn-link" href={site.repo}><GhMark /> View on GitHub</a>
          </div>
          {!site.released && <p className="note">The Windows installer isn’t published yet. This button will turn into a download once a release exists.</p>}
          <figure className="hero-shot">
            <img src={`${base}screens/dashboard-en.webp`} width={1440} height={900} alt={shots[0].alt} fetchPriority="high" />
            <figcaption>Screenshot from an early build, shown with sample data.</figcaption>
          </figure>
        </section>

        <section className="wrap sec" id="preview" aria-labelledby="preview-h">
          <Reveal>
            <h2 id="preview-h">See the workspace</h2>
            <p className="sub">Real screenshots from an early build with sample data (a mix of English and Persian). The interface may change before release.</p>
          </Reveal>
          <div className="tabs" role="group" aria-label="Screenshots">
            {shots.map((x, i) => <button key={x.src} aria-pressed={i === shot} onClick={() => setShot(i)}>{x.title}</button>)}
          </div>
          <figure className="frame">
            <img key={s.src} src={`${base}screens/${s.src}.webp`} width={1440} height={900} alt={s.alt} loading="lazy" />
            <figcaption>{s.cap}</figcaption>
          </figure>
        </section>

        <section className="wrap sec" id="features" aria-labelledby="features-h">
          <Reveal>
            <h2 id="features-h">What it does today</h2>
            <p className="sub">Everything below is implemented in the current build. Limits are stated plainly.</p>
          </Reveal>
          <div className="grid">
            {features.map((f) => {
              const I = icons[f.icon]
              return <Reveal key={f.title} className="feat"><I size={22} aria-hidden /><h3>{f.title}</h3><p>{f.body}</p></Reveal>
            })}
          </div>
          <p className="fine">Not included: OCR for scanned documents, automatic sync, multi-device support, or a web/mobile version.</p>
        </section>

        <section className="wrap sec" id="how" aria-labelledby="how-h">
          <Reveal><h2 id="how-h">How it works</h2></Reveal>
          <ol className="steps">
            {steps.map(([t, d], i) => <li key={t}><span className="n">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>)}
          </ol>
        </section>

        <section className="wrap sec" id="privacy" aria-labelledby="privacy-h">
          <Reveal>
            <h2 id="privacy-h">Where your data goes</h2>
            <p className="sub">Local by default. The one exception is an AI provider you choose to connect, and it’s worth understanding exactly what that sends.</p>
          </Reveal>
          <div className="priv">
            <Reveal className="p"><HardDrive size={20} aria-hidden /><h3>On your PC</h3><p>Notes, projects, tasks, decisions and imported documents are stored in a local database in <code>%APPDATA%\MINDSPACE</code>. There are no accounts, no sync and no analytics in the app.</p></Reveal>
            <Reveal className="p"><Cpu size={20} aria-hidden /><h3>Local search</h3><p>Keyword search runs in the app. Semantic search runs on-device once you download its embedding model from Settings. The download itself is a network request to the model host.</p></Reveal>
            <Reveal className="p warn"><Cloud size={20} aria-hidden /><h3>Cloud AI providers</h3><p>If you connect Anthropic or OpenAI, your question and the passages retrieved from your library are sent to that provider to produce an answer. Their own data policies apply. API keys are stored with the operating system’s secure storage.</p></Reveal>
            <Reveal className="p"><ShieldCheck size={20} aria-hidden /><h3>Local models</h3><p>With Ollama running on your own machine, answers can be generated without sending data to a third party. You set up and run Ollama yourself.</p></Reveal>
          </div>
          <p className="fine">MINDSPACE makes no guarantee of absolute privacy. Backups are unencrypted unless you set a password, and API keys are never included in backups. This website uses no analytics, cookies or third-party scripts.</p>
        </section>

        <section className="wrap sec" id="download" aria-labelledby="dl-h">
          <Reveal className="dl">
            <h2 id="dl-h">Download MINDSPACE</h2>
            {site.released ? (
              <>
                <p className="sub">Windows installer{site.version ? `, version ${site.version}` : ''}. No account required.</p>
                <div className="cta"><DownloadButton big /><a className="btn btn-ghost btn-lg" href={site.releasesUrl}>All releases</a></div>
              </>
            ) : (
              <>
                <p className="sub"><strong>Coming soon.</strong> A Windows (x64) installer has been built but isn’t published yet, so there is nothing to download today.</p>
                <div className="cta"><DownloadButton big /><a className="btn btn-ghost btn-lg" href={site.releasesUrl}>Releases page</a><a className="btn btn-link" href={site.repo}>Repository</a></div>
              </>
            )}
            <ul className="fine list">
              <li>Windows x64 only. The installer is unsigned, so SmartScreen may show an “unknown publisher” warning.</li>
              <li>It has not yet been run on a real Windows machine by the author, so treat early versions as experimental and keep backups.</li>
            </ul>
          </Reveal>
        </section>

        <section className="wrap sec narrow" id="faq" aria-labelledby="faq-h">
          <Reveal><h2 id="faq-h">Questions</h2></Reveal>
          {faq.map(([q, a]) => (
            <details key={q}><summary>{q}<ChevronDown size={18} aria-hidden /></summary><p>{a}</p></details>
          ))}
        </section>

        <section className="wrap sec narrow" id="support" aria-labelledby="support-h">
          <h2 id="support-h">Support &amp; bug reports</h2>
          <p className="sub">Found a bug or have a suggestion? <a href={site.issuesUrl}>Open an issue on GitHub</a>. Include your Windows version and what you did; leave out private notes and API keys.</p>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap fgrid">
          <div><a className="brand" href="#top"><span className="ring" aria-hidden />MINDSPACE</a><p>Room to think, kept on your own machine.</p></div>
          <nav aria-label="Footer">
            {nav.map(([l, h]) => <a key={h} href={h}>{l}</a>)}
            <a href="#faq">FAQ</a>
          </nav>
          <nav aria-label="Project">
            <a href={site.repo}>GitHub repository</a>
            <a href={site.releasesUrl}>Releases</a>
            <a href={site.issuesUrl}>Report a bug</a>
            {site.released && <a href={downloadUrl}>Download installer</a>}
          </nav>
        </div>
        <p className="wrap copy">© {new Date().getFullYear()} MINDSPACE</p>
      </footer>
    </>
  )
}
