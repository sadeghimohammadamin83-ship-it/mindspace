export const features = [
  { icon: 'pen', title: 'Quick Capture', body: 'Save notes, ideas and links in a keystroke, then file them under a project and tags when you have time.' },
  { icon: 'library', title: 'Knowledge Library', body: 'One searchable library for everything you keep, with tags, links between notes, tasks, decisions and projects.' },
  { icon: 'folder', title: 'Project Memory', body: 'Each project has its own workspace: overview, notes, tasks, decisions and an activity timeline.' },
  { icon: 'scale', title: 'Tasks & Decision Records', body: 'Track what to do, and record what you decided and why, so the reasoning is still there months later.' },
  { icon: 'file', title: 'Documents & PDF text', body: 'Import documents and extract text from text-based PDFs so their content becomes searchable. Scanned, image-only PDFs are not read (no OCR).' },
  { icon: 'search', title: 'Keyword & semantic search', body: 'Fast full-text search, plus optional on-device semantic search that finds related passages by meaning. The embedding model is downloaded once from Settings.' },
  { icon: 'quote', title: 'Source-cited answers', body: 'Ask a question and get an answer built from retrieved passages in your own library, with the sources shown so you can check them.' },
  { icon: 'shield', title: 'Backup & restore', body: 'Create .msbak backups with optional password encryption, verify them, and restore with automatic rollback if something fails.' }
] as const

export const steps = [
  ['Capture', 'Write notes or import documents.'],
  ['Organize', 'Tag, link, and attach knowledge to projects.'],
  ['Search', 'Find it by keyword, or by meaning.'],
  ['Ask', 'Ask a question and inspect the cited sources.'],
  ['Grow', 'Keep adding; your library compounds over time.']
] as const

export const shots = [
  { src: 'dashboard-en', title: 'Dashboard', alt: 'MINDSPACE dashboard with upcoming tasks, today’s briefing, active projects and recent activity', cap: 'Today at a glance: tasks, projects, a rule-based briefing and recent activity.' },
  { src: 'documents-en', title: 'Documents', alt: 'MINDSPACE documents page listing imported files', cap: 'Imported documents and their extracted text.' },
  { src: 'briefing-en', title: 'Daily Briefing', alt: 'MINDSPACE daily briefing page', cap: 'A daily briefing assembled from simple rules over your tasks and notes, without AI.' },
  { src: 'library-fa', title: 'Library (Persian, RTL)', alt: 'MINDSPACE knowledge library shown in Persian with right-to-left layout', cap: 'The same interface in Persian with right-to-left layout.' },
  { src: 'decisions-fa', title: 'Decisions (Persian, RTL)', alt: 'MINDSPACE decisions page shown in Persian', cap: 'Structured decision records.' }
] as const

export const faq = [
  ['What is MINDSPACE?', 'A Windows desktop app for keeping notes, documents, projects, tasks and decisions in one local workspace, with search and source-cited AI answers.'],
  ['Which operating systems are supported?', 'Windows (x64) only. The installer has been built but, at the time of writing, has not been run on a real Windows machine by the author, so expect rough edges. There is no macOS, Linux, web or mobile version.'],
  ['Is MINDSPACE free?', 'There is no pricing or paid plan. Licensing terms have not been published yet, so check the repository before redistributing. Using a cloud AI provider may cost money with that provider.'],
  ['Where is my data stored?', 'In a local SQLite database under %APPDATA%\\MINDSPACE on your PC. There is no account and no sync.'],
  ['Does AI require an internet connection?', 'Cloud providers (Anthropic, OpenAI) need one. Ollama runs on your own machine, so answers can be generated locally if you set it up. Provider connections have been tested with simulated services only, not yet against the real ones.'],
  ['Can I use a local language model?', 'Yes, the app supports Ollama on this computer (loopback address). You install and run Ollama and a model yourself.'],
  ['How do I download and install it?', 'Use the Download section above once a release is published. The installer is unsigned, so Windows SmartScreen may warn about an unknown publisher.'],
  ['What happens if I uninstall it?', 'Uninstalling does not delete your data folder in %APPDATA%\\MINDSPACE. Delete it yourself if you want it gone.'],
  ['Where can I report bugs?', 'Open an issue on the GitHub repository. Please don’t paste private notes or API keys into an issue.']
] as const
