/**
 * Small SYNTHETIC evaluation set for the real embedding model: notes in
 * English and Persian, and queries that avoid the notes' wording. Used by
 * tests/unit/semantic-real.test.ts and scripts/semantic-eval.mts.
 */
export interface EvalNote {
  key: string
  title: string
  body: string
}

export const EVAL_NOTES: EvalNote[] = [
  { key: 'sqlite', title: 'Why we chose SQLite', body: 'We picked SQLite because the whole knowledge base lives in one local file, needs no server, and a backup is a simple file copy.' },
  { key: 'car', title: 'Car service', body: 'The automobile needs new winter tyres and an oil change before the trip in December.' },
  { key: 'sleep', title: 'Sleep log', body: 'I have been waking up at 3am most nights; cutting coffee after noon seemed to help me rest.' },
  { key: 'garden', title: 'Balcony garden', body: 'Tomato seedlings went into bigger pots; the basil keeps wilting in the afternoon sun.' },
  { key: 'billing', title: 'Billing interviews', body: 'Users found the checkout confusing: three people could not find where to enter a discount code, and two abandoned the payment.' },
  { key: 'thesis', title: 'Thesis metric', body: 'For the thesis evaluation we will report nDCG@10 instead of plain accuracy, because ranking quality matters more.' },
  { key: 'offsite', title: 'Team offsite', body: 'Offsite agenda: morning retrospective, afternoon planning for the Q3 roadmap, dinner at the harbour.' },
  { key: 'normalize', title: 'نرمال‌سازی متن فارسی', body: 'قبل از جست‌وجو باید ي و ك عربی را به ی و ک فارسی تبدیل کنیم و نیم‌فاصله‌ها را یکدست کنیم.' },
  { key: 'shiraz', title: 'سفر شیراز', body: 'برای سفر بهاری به شیراز، بلیت قطار را دو هفته زودتر بخریم و حافظیه را صبح زود ببینیم.' },
  { key: 'budget', title: 'بودجه‌ی ماهانه', body: 'اجاره و قبض‌ها نیمی از درآمد ماهانه را می‌گیرند؛ باید هزینه‌ی رستوران را کم کنم.' },
  { key: 'german', title: 'یادگیری زبان آلمانی', body: 'هر روز بیست دقیقه واژه‌های آلمانی را با فلش‌کارت مرور می‌کنم و هفته‌ای یک بار با معلم صحبت می‌کنم.' },
  { key: 'backup', title: 'پشتیبان‌گیری', body: 'هر جمعه از پوشه‌ی پروژه روی هارد خارجی نسخه‌ی پشتیبان می‌گیرم.' }
]

export type EvalKind = 'en-en' | 'fa-fa' | 'fa-en' | 'en-fa' | 'none'

export const EVAL_QUERIES: { q: string; expect: string | null; kind: EvalKind }[] = [
  { q: 'car maintenance before winter', expect: 'car', kind: 'en-en' },
  { q: 'why a single-file local database?', expect: 'sqlite', kind: 'en-en' },
  { q: 'trouble sleeping through the night', expect: 'sleep', kind: 'en-en' },
  { q: 'growing vegetables in containers', expect: 'garden', kind: 'en-en' },
  { q: 'problems customers had when paying', expect: 'billing', kind: 'en-en' },
  { q: 'which ranking measure for my dissertation', expect: 'thesis', kind: 'en-en' },
  { q: 'schedule for the company retreat', expect: 'offsite', kind: 'en-en' },
  { q: 'تبدیل حروف عربی به فارسی', expect: 'normalize', kind: 'fa-fa' },
  { q: 'چطور خرج‌هایم را کم کنم', expect: 'budget', kind: 'fa-fa' },
  { q: 'تمرین روزانه‌ی لغت', expect: 'german', kind: 'fa-fa' },
  { q: 'کپی امنیتی از فایل‌ها', expect: 'backup', kind: 'fa-fa' },
  { q: 'مسافرت به شیراز', expect: 'shiraz', kind: 'fa-fa' },
  { q: 'دلیل انتخاب پایگاه داده', expect: 'sqlite', kind: 'fa-en' },
  { q: 'مشکل بی‌خوابی', expect: 'sleep', kind: 'fa-en' },
  { q: 'تعویض لاستیک ماشین', expect: 'car', kind: 'fa-en' },
  { q: 'learning German words every day', expect: 'german', kind: 'en-fa' },
  { q: 'spring trip to Shiraz', expect: 'shiraz', kind: 'en-fa' },
  { q: 'rent and monthly spending', expect: 'budget', kind: 'en-fa' },
  { q: 'weekly backup to an external drive', expect: 'backup', kind: 'en-fa' },
  { q: 'quantum chromodynamics lecture notes', expect: null, kind: 'none' },
  { q: 'recipe for chocolate cake', expect: null, kind: 'none' },
  { q: 'best football team in Spain', expect: null, kind: 'none' },
  { q: 'فیزیک ذرات بنیادی', expect: null, kind: 'none' }
]
