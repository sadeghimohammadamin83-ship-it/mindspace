/**
 * Sample workspace. This is the ONLY place sample records are defined. The
 * main process inserts it once into a brand-new database (see main/db/seed.ts);
 * the Ask screen still reads its illustration conversations from here.
 * Timestamps are relative to `now`, so a fresh workspace looks current.
 */
import type {
  ActivityEvent,
  Conversation,
  Decision,
  KnowledgeItem,
  Project,
  Tag,
  Task
} from './domain'
import { addDays, toIsoDate } from './dates'

export interface WorkspaceData {
  tags: Tag[]
  projects: Project[]
  items: KnowledgeItem[]
  tasks: Task[]
  conversations: Conversation[]
  decisions: Decision[]
  activity: ActivityEvent[]
}

export function createSeed(now: Date): WorkspaceData {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()
  const daysAgo = (d: number, hour = 10) => {
    const at = addDays(now, -d)
    at.setHours(hour, 15, 0, 0)
    return at.toISOString()
  }
  const dueIn = (d: number) => toIsoDate(addDays(now, d))

  const tags: Tag[] = [
    { id: 'tag-research', label: 'پژوهش' },
    { id: 'tag-design', label: 'طراحی' },
    { id: 'tag-electron', label: 'Electron' },
    { id: 'tag-sqlite', label: 'SQLite' },
    { id: 'tag-search', label: 'جست‌وجو' },
    { id: 'tag-meeting', label: 'جلسه' },
    { id: 'tag-reading', label: 'خواندنی' },
    { id: 'tag-ux', label: 'UX' },
    { id: 'tag-persian-nlp', label: 'پردازش فارسی' },
    { id: 'tag-finance', label: 'مالی' },
    { id: 'tag-home', label: 'خانه' },
    { id: 'tag-privacy', label: 'حریم خصوصی' }
  ]

  const projects: Project[] = [
    {
      id: 'proj-mindspace',
      name: 'ساخت MINDSPACE',
      description:
        'اپ دسکتاپ شخصی برای ثبت، سازمان‌دهی و پرسیدن از دانش خودم. اکنون در مرحله‌ی نمونه‌ی اولیه‌ی رابط کاربری.',
      status: 'active',
      createdAt: daysAgo(40),
      updatedAt: hoursAgo(2),
      origin: 'sample'
    },
    {
      id: 'proj-thesis',
      name: 'پایان‌نامه: جست‌وجوی معنایی متون فارسی',
      description:
        'مقایسه‌ی BM25، embeddingهای چندزبانه و روش ترکیبی روی پیکره‌ی خبری فارسی، با تمرکز بر نرمال‌سازی متن.',
      status: 'active',
      createdAt: daysAgo(120),
      updatedAt: hoursAgo(20),
      origin: 'sample'
    },
    {
      id: 'proj-portal',
      name: 'Client portal redesign',
      description:
        'Redesigning onboarding and billing for a logistics customer portal. Current focus: the invoices page and payment methods.',
      status: 'active',
      createdAt: daysAgo(35),
      updatedAt: daysAgo(1, 16),
      origin: 'sample'
    },
    {
      id: 'proj-finance',
      name: 'برنامه‌ی مالی سال ۱۴۰۵',
      description: 'بودجه‌بندی ماهانه، صندوق اضطراری سه‌ماهه و مرور اشتراک‌های ماهانه.',
      status: 'planning',
      createdAt: daysAgo(9),
      updatedAt: daysAgo(4),
      origin: 'sample'
    },
    {
      id: 'proj-kitchen',
      name: 'بازسازی آشپزخانه',
      description: 'انتخاب پیمانکار، تعیین بودجه و زمان‌بندی کار. تا پایان فصل بارندگی متوقف است.',
      status: 'on_hold',
      createdAt: daysAgo(60),
      updatedAt: daysAgo(12),
      origin: 'sample'
    },
    {
      id: 'proj-talk',
      name: 'ارائه: نرم‌افزار local-first',
      description: 'ارائه‌ی ۲۰ دقیقه‌ای در دورهمی برنامه‌نویسان درباره‌ی مالکیت داده و همگام‌سازی.',
      status: 'completed',
      createdAt: daysAgo(70),
      updatedAt: daysAgo(21),
      origin: 'sample'
    }
  ]

  const item = (
    id: string,
    kind: KnowledgeItem['kind'],
    title: string,
    body: string,
    tagIds: string[],
    projectId: string | null,
    createdAt: string,
    updatedAt: string = createdAt,
    url?: string
  ): KnowledgeItem => ({
    id,
    kind,
    title,
    body,
    tagIds,
    projectId,
    createdAt,
    updatedAt,
    origin: 'sample',
    ...(url ? { url } : {})
  })

  const items: KnowledgeItem[] = [
    item(
      'item-sqlite-decision',
      'decision',
      'منبع حقیقت: SQLite به‌جای خزانه‌ی Markdown',
      'تصمیم: داده‌ها در یک پایگاه‌داده‌ی SQLite نگه داشته شوند و خروجی Markdown فقط به‌عنوان قابلیت export باشد.\n\nدلیل: رابطه‌ی یادداشت‌ها، پروژه‌ها، کارها و تصمیم‌ها در فایل‌های جدا سخت نگه داشته می‌شود. SQLite تراکنش، migration و پشتیبان‌گیری یک‌فایلی می‌دهد و FTS5 هم داخلش هست.\n\nگزینه‌ی ردشده: فقط فایل Markdown، چون همگام نگه داشتن پیوندها و وضعیت کارها شکننده است.',
      ['tag-sqlite'],
      'proj-mindspace',
      daysAgo(6),
      hoursAgo(26)
    ),
    item(
      'item-ai-default',
      'decision',
      'پیش‌فرض ارائه‌دهنده‌ی هوش مصنوعی: هیچ',
      'اپ باید بدون هیچ کلید API و بدون اتصال به اینترنت کامل کار کند. Ollama و Claude فقط با فعال‌سازی صریح روشن می‌شوند و هرگاه ارائه‌دهنده‌ی ابری فعال باشد، نشانی دائمی در رابط دیده شود.',
      ['tag-privacy'],
      'proj-mindspace',
      daysAgo(6, 11)
    ),
    item(
      'item-electron-security',
      'note',
      'Electron security checklist: takeaways',
      'Keep contextIsolation on, nodeIntegration off and the sandbox enabled for every window. Expose only named functions through the preload bridge, never ipcRenderer itself.\n\nServe the UI from a custom protocol rather than file://, set a strict Content-Security-Policy, deny permission requests by default and block navigation and new windows to unknown origins.\n\nValidate every IPC message in the main process; treat the renderer as untrusted.',
      ['tag-electron', 'tag-privacy'],
      'proj-mindspace',
      daysAgo(3),
      hoursAgo(2)
    ),
    item(
      'item-electron-link',
      'link',
      'Electron documentation: Security',
      'The official checklist. Sections 3 (context isolation), 4 (sandbox), 7 (CSP) and 18 (custom protocols) matter most for MINDSPACE.',
      ['tag-electron', 'tag-reading'],
      'proj-mindspace',
      daysAgo(3, 9),
      daysAgo(3, 9),
      'https://www.electronjs.org/docs/latest/tutorial/security'
    ),
    item(
      'item-weekly-review',
      'idea',
      'حالت «مرور هفتگی» برای یادداشت‌های قدیمی',
      'هر جمعه پنج یادداشت قدیمی که مدتی سراغشان نرفته‌ام نمایش داده شود تا یا به‌روز شوند، یا به پروژه‌ای وصل شوند، یا بایگانی شوند. شاید بخشی از گزارش روزانه باشد.',
      ['tag-ux'],
      'proj-mindspace',
      hoursAgo(5)
    ),
    item(
      'item-thesis-meeting',
      'note',
      'جلسه با دکتر رحیمی: بازخورد فصل سوم',
      'فصل سوم باید روش ارزیابی را دقیق‌تر توضیح دهد. پیشنهاد استاد: MRR@10 معیار اصلی باشد و nDCG@10 کمکی.\n\nکارهای بعدی:\n- اجرای baseline BM25 روی کل پیکره\n- گزارش اثر نرمال‌سازی (ی/ک و نیم‌فاصله) به‌طور جداگانه\n- ارسال گزارش پیشرفت تا آخر هفته',
      ['tag-meeting', 'tag-research'],
      'proj-thesis',
      daysAgo(5, 14),
      daysAgo(5, 15)
    ),
    item(
      'item-thesis-metric',
      'decision',
      'معیار اصلی ارزیابی پایان‌نامه: MRR@10',
      'MRR@10 معیار اصلی است، چون در سناریوی ما کاربر معمولاً فقط به اولین نتیجه‌ی درست نیاز دارد. nDCG@10 به‌عنوان معیار کمکی گزارش می‌شود تا کیفیت رتبه‌بندی کامل هم دیده شود.',
      ['tag-research'],
      'proj-thesis',
      daysAgo(5, 16)
    ),
    item(
      'item-normalization',
      'note',
      'نرمال‌سازی متن فارسی پیش از ایندکس',
      'مرحله‌ها: تبدیل «ي» و «ك» عربی به «ی» و «ک» فارسی، حذف اعراب و کشیده، یکسان‌سازی نیم‌فاصله، و تبدیل ارقام فارسی و عربی به لاتین.\n\nنکته: همین نرمال‌سازی باید روی پرسش کاربر هم اجرا شود، وگرنه «پایان‌نامه» با «پایان نامه» تطبیق پیدا نمی‌کند.',
      ['tag-persian-nlp', 'tag-search'],
      'proj-thesis',
      daysAgo(14),
      hoursAgo(20)
    ),
    item(
      'item-bge-link',
      'link',
      'BGE M3-Embedding (arXiv 2402.03216)',
      'مدل embedding چندزبانه با پشتیبانی از بازیابی متراکم، پراکنده و چندبرداری. نامزد اصلی برای آزمایش روی متون فارسی.',
      ['tag-reading', 'tag-research', 'tag-persian-nlp'],
      'proj-thesis',
      daysAgo(8),
      daysAgo(8),
      'https://arxiv.org/abs/2402.03216'
    ),
    item(
      'item-trigram-idea',
      'idea',
      'جدول trigram برای غلط‌های تایپی',
      'وقتی FTS5 نتیجه‌ای برنمی‌گرداند، یک جست‌وجوی trigram کمکی می‌تواند غلط‌های تایپی رایج فارسی را پوشش دهد. اثرش روی دقت باید جدا اندازه‌گیری شود.',
      ['tag-search', 'tag-persian-nlp'],
      'proj-thesis',
      daysAgo(2, 22)
    ),
    item(
      'item-billing-findings',
      'note',
      'Billing flow: usability test findings',
      'Five participants, 30-minute sessions.\n\n- 3 of 5 could not find past invoices; they looked under "Account" rather than "Billing".\n- Everyone understood the new plan comparison table.\n- Two participants expected to download invoices as PDF directly from the list.\n\nRecommendation: move invoices to the top level of navigation and add a download action on each row.',
      ['tag-ux', 'tag-meeting'],
      'proj-portal',
      daysAgo(4, 15),
      daysAgo(1, 16)
    ),
    item(
      'item-invoices-first',
      'decision',
      'Ship the invoices page before payment methods',
      'Invoices caused the most support tickets last quarter and the usability test confirmed the navigation problem. Payment methods can follow in the next release without blocking anyone.',
      ['tag-ux'],
      'proj-portal',
      daysAgo(1, 11)
    ),
    item(
      'item-nng-link',
      'link',
      'Progressive disclosure (Nielsen Norman Group)',
      'Show the most important options first and move advanced ones to a secondary screen. Relevant to the payment settings page.',
      ['tag-ux', 'tag-reading'],
      'proj-portal',
      daysAgo(10),
      daysAgo(10),
      'https://www.nngroup.com/articles/progressive-disclosure/'
    ),
    item(
      'item-contractors',
      'note',
      'مقایسه‌ی پیشنهاد سه پیمانکار',
      'پیمانکار اول: قیمت مناسب، ولی زمان شروع نامشخص.\nپیمانکار دوم: نمونه‌کارهای خوب، دو هفته دیرتر شروع می‌کند.\nپیمانکار سوم: گران‌تر، ولی کابینت را خودش می‌سازد.\n\nفعلاً تصمیم نگرفته‌ام؛ باید از پیمانکار دوم بازدید حضوری بگیرم.',
      ['tag-home', 'tag-finance'],
      'proj-kitchen',
      daysAgo(13),
      daysAgo(12)
    ),
    item(
      'item-subscriptions',
      'note',
      'اشتراک‌های ماهانه‌ی فعلی',
      'موسیقی، فضای ابری ۲ ترابایتی، دو سرویس فیلم، اشتراک مجله و میزبانی وب. دست‌کم یکی از سرویس‌های فیلم و اشتراک مجله را ماه‌هاست استفاده نکرده‌ام.',
      ['tag-finance'],
      'proj-finance',
      daysAgo(4)
    ),
    item(
      'item-local-first-link',
      'link',
      'Local-first software: you own your data, in spite of the cloud',
      'Seven ideals for local-first apps: fast, multi-device, offline, collaboration, longevity, privacy and user control. The basis of my talk.',
      ['tag-reading', 'tag-privacy'],
      'proj-talk',
      daysAgo(50),
      daysAgo(50),
      'https://www.inkandswitch.com/essay/local-first/'
    ),
    item(
      'item-talk-feedback',
      'note',
      'بازخورد ارائه‌ی local-first',
      'بیشترین پرسش‌ها درباره‌ی همگام‌سازی بین دستگاه‌ها و حل تعارض بود. دفعه‌ی بعد یک نمونه‌ی زنده‌ی CRDT نشان بدهم و بخش تاریخچه را کوتاه‌تر کنم.',
      ['tag-privacy'],
      'proj-talk',
      daysAgo(21)
    ),
    item(
      'item-deep-work',
      'note',
      'خلاصه‌ی کتاب «کار عمیق»',
      'ایده‌ی اصلی: توانایی تمرکز طولانی بدون حواس‌پرتی کمیاب و ارزشمند است. چهار قاعده: کار عمیق را زمان‌بندی کن، ملال را بپذیر، شبکه‌های اجتماعی را رها کن، کارهای سطحی را کم کن.\n\nبرای خودم: صبح‌ها دو ساعت بدون پیام‌رسان.',
      ['tag-reading'],
      null,
      daysAgo(30),
      daysAgo(7)
    ),
    item(
      'item-reading-log',
      'idea',
      'دفترچه‌ی کتاب‌های خوانده‌شده با نقل‌قول‌ها',
      'برای هر کتاب: تاریخ پایان، سه ایده‌ی اصلی و نقل‌قول‌های مهم با شماره‌ی صفحه. بعداً از همین‌جا بپرسم «کجا درباره‌ی تمرکز خوانده بودم؟».',
      ['tag-reading'],
      null,
      daysAgo(2, 9)
    ),
    item(
      'item-decision-journal',
      'idea',
      'Weekly decision journal prompt',
      'Every Sunday: list the decisions made this week, what I expected to happen, and how confident I was. Revisit after a month to calibrate.',
      ['tag-ux'],
      null,
      hoursAgo(30)
    )
  ]

  const task = (
    id: string,
    title: string,
    status: Task['status'],
    priority: Task['priority'],
    dueDate: string | null,
    projectId: string | null,
    createdAt: string,
    notes = ''
  ): Task => ({
    id,
    title,
    notes,
    status,
    priority,
    dueDate,
    projectId,
    createdAt,
    updatedAt: createdAt,
    completedAt: status === 'done' ? hoursAgo(30) : null,
    origin: 'sample'
  })

  const tasks: Task[] = [
    task('task-shell', 'پیاده‌سازی پوسته‌ی امن Electron', 'done', 'high', dueIn(-2), 'proj-mindspace', daysAgo(9)),
    task('task-tokens', 'تعریف توکن‌های رنگ و تایپوگرافی', 'done', 'medium', dueIn(-1), 'proj-mindspace', daysAgo(8)),
    task(
      'task-layout-test',
      'آزمودن چیدمان در اندازه‌ی ۱۳۶۶×۷۶۸',
      'in_progress',
      'high',
      dueIn(0),
      'proj-mindspace',
      daysAgo(2),
      'در مقیاس ۱۲۵٪ و ۱۵۰٪ ویندوز هم بررسی شود.'
    ),
    task('task-search-adr', 'نوشتن ADR برای لایه‌ی جست‌وجو', 'todo', 'medium', dueIn(3), 'proj-mindspace', daysAgo(2)),
    task(
      'task-sqlite-windows',
      'بررسی build شدن better-sqlite3 روی ویندوز',
      'todo',
      'high',
      dueIn(6),
      'proj-mindspace',
      daysAgo(1),
      'اولین قدم فاز ۲. با @electron/rebuild و prebuildهای Electron 44.'
    ),
    task('task-bm25', 'اجرای baseline BM25 روی کل پیکره', 'in_progress', 'high', dueIn(1), 'proj-thesis', daysAgo(5)),
    task('task-read-bge', 'خواندن مقاله‌ی BGE-M3 و یادداشت‌برداری', 'todo', 'medium', dueIn(2), 'proj-thesis', daysAgo(8)),
    task(
      'task-progress-report',
      'ارسال گزارش پیشرفت به دکتر رحیمی',
      'todo',
      'high',
      dueIn(-1),
      'proj-thesis',
      daysAgo(5),
      'شامل نتایج اولیه‌ی BM25 و برنامه‌ی فصل چهارم.'
    ),
    task(
      'task-invoices-proto',
      'Prepare the invoices page prototype for review',
      'in_progress',
      'high',
      dueIn(1),
      'proj-portal',
      daysAgo(1)
    ),
    task('task-sara-sync', 'Sync with Sara on payment edge cases', 'todo', 'medium', dueIn(0), 'proj-portal', daysAgo(3)),
    task('task-release-notes', 'Write release notes for billing v2', 'todo', 'low', dueIn(8), 'proj-portal', daysAgo(3)),
    task('task-cancel-subs', 'لغو اشتراک‌های بی‌استفاده', 'todo', 'medium', dueIn(4), 'proj-finance', daysAgo(4)),
    task('task-contractor-visit', 'هماهنگی بازدید پیمانکار دوم', 'todo', 'low', null, 'proj-kitchen', daysAgo(12)),
    task('task-insurance', 'تمدید بیمه‌ی بدنه‌ی خودرو', 'todo', 'high', dueIn(2), null, daysAgo(6)),
    task('task-dentist', 'Book a dentist appointment', 'todo', 'low', dueIn(10), null, daysAgo(3)),
    task('task-slides', 'ارسال اسلایدها برای برگزارکنندگان', 'done', 'medium', dueIn(-20), 'proj-talk', daysAgo(25))
  ]

  const conversations: Conversation[] = [
    {
      id: 'conv-sample',
      title: 'معیار ارزیابی پایان‌نامه',
      createdAt: daysAgo(1, 18),
      origin: 'sample',
      messages: [
        {
          id: 'msg-sample-1',
          role: 'user',
          text: 'درباره‌ی معیار ارزیابی پایان‌نامه چه تصمیمی گرفتم؟',
          createdAt: daysAgo(1, 18)
        },
        {
          id: 'msg-sample-2',
          role: 'assistant',
          mode: 'illustration',
          text: 'شما MRR@10 را معیار اصلی ارزیابی انتخاب کردید و nDCG@10 را به‌عنوان معیار کمکی [1]. دلیلش این بود که در سناریوی شما کاربر معمولاً فقط به اولین نتیجه‌ی درست نیاز دارد. این پیشنهاد در جلسه‌ی بازخورد فصل سوم با دکتر رحیمی مطرح شده بود [2].',
          sources: [
            { type: 'item', id: 'item-thesis-metric' },
            { type: 'item', id: 'item-thesis-meeting' }
          ],
          createdAt: daysAgo(1, 18)
        }
      ]
    }
  ]

  const activity: ActivityEvent[] = [
    {
      id: 'act-1',
      kind: 'item_captured',
      subject: 'حالت «مرور هفتگی» برای یادداشت‌های قدیمی',
      ref: { type: 'item', id: 'item-weekly-review' },
      projectId: 'proj-mindspace',
      at: hoursAgo(5),
      origin: 'sample'
    },
    {
      id: 'act-2',
      kind: 'task_completed',
      subject: 'تعریف توکن‌های رنگ و تایپوگرافی',
      ref: { type: 'task', id: 'task-tokens' },
      projectId: 'proj-mindspace',
      at: hoursAgo(30),
      origin: 'sample'
    },
    {
      id: 'act-3',
      kind: 'item_captured',
      subject: 'Ship the invoices page before payment methods',
      ref: { type: 'item', id: 'item-invoices-first' },
      projectId: 'proj-portal',
      at: daysAgo(1, 11),
      origin: 'sample'
    },
    {
      id: 'act-4',
      kind: 'project_created',
      subject: 'برنامه‌ی مالی سال ۱۴۰۵',
      ref: { type: 'project', id: 'proj-finance' },
      projectId: 'proj-finance',
      at: daysAgo(9),
      origin: 'sample'
    }
  ]

  const decisions: Decision[] = [
    {
      id: 'dec-sqlite',
      projectId: 'proj-mindspace',
      title: 'منبع حقیقت: SQLite به‌جای خزانه‌ی Markdown',
      context: 'داده‌های برنامه (یادداشت، پروژه، کار و تصمیم) باید به‌هم مرتبط بمانند و هیچ‌وقت نیمه‌ذخیره نشوند.',
      decision: 'داده‌ها در یک پایگاه‌داده‌ی SQLite محلی نگه داشته می‌شوند. Markdown فقط خروجی export است.',
      rationale: 'SQLite تراکنش، migration و پشتیبان‌گیری یک‌فایلی می‌دهد و جست‌وجوی متنی هم داخلش هست.',
      alternatives: 'فقط فایل‌های Markdown: همگام نگه داشتن پیوندها و وضعیت کارها شکننده است.',
      consequences: 'همه‌ی نوشتن‌ها از لایه‌ی داده‌ی برنامه می‌گذرند؛ ویرایش مستقیم فایل‌ها پشتیبانی نمی‌شود.',
      status: 'accepted',
      decidedOn: toIsoDate(addDays(now, -6)),
      supersededById: null,
      noteIds: ['item-sqlite-decision'],
      taskIds: ['task-sqlite-windows'],
      tagIds: ['tag-sqlite'],
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
      origin: 'sample'
    },
    {
      id: 'dec-ai-default',
      projectId: 'proj-mindspace',
      title: 'پیش‌فرض ارائه‌دهنده‌ی هوش مصنوعی: هیچ',
      context: 'برنامه با داده‌های شخصی کار می‌کند و باید بدون اینترنت و بدون کلید API هم کامل باشد.',
      decision: 'در حالت پیش‌فرض هیچ ارائه‌دهنده‌ی هوش مصنوعی فعال نیست؛ فعال‌سازی فقط صریح و با اجازه‌ی کاربر است.',
      rationale: 'حریم خصوصی پیش‌فرض و رفتار قابل‌پیش‌بینی.',
      alternatives: '',
      consequences: 'قابلیت‌های هوش مصنوعی باید بدون ارائه‌دهنده هم حالت خالی معنادار داشته باشند.',
      status: 'proposed',
      decidedOn: null,
      supersededById: null,
      noteIds: ['item-ai-default'],
      taskIds: [],
      tagIds: ['tag-privacy'],
      createdAt: daysAgo(6, 11),
      updatedAt: daysAgo(6, 11),
      origin: 'sample'
    }
  ]

  return { tags, projects, items, tasks, conversations, decisions, activity }
}
