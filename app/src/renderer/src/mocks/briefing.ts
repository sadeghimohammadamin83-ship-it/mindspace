import type { Lang } from '@/lib/format'

/**
 * Hand-written briefing prose. It illustrates where a generated briefing will
 * appear (Phase 7) and is always labelled as sample text in the UI.
 */
export const sampleBriefingText: Record<Lang, string[]> = {
  fa: [
    'امروز دو کار پایان‌نامه وقت بیشتری می‌خواهند: گزارش پیشرفت که یک روز عقب افتاده، و اجرای baseline BM25 که نتیجه‌اش باید در همان گزارش بیاید. شاید بهتر باشد اول BM25 را تمام کنید.',
    'در پروژه‌ی پرتال، تصمیم دیروز درباره‌ی اولویت صفحه‌ی صورت‌حساب‌ها با جلسه‌ی امروز با سارا مرتبط است.'
  ],
  en: [
    'Two thesis tasks need the most attention today: the progress report, which is a day overdue, and the BM25 baseline whose results belong in that report. Finishing BM25 first may make the report easier.',
    'On the portal project, yesterday’s decision to ship invoices first is relevant to today’s sync with Sara.'
  ]
}
