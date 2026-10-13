/**
 * Light text normalisation so search treats common Persian variants as equal
 * (Arabic yeh/kaf, diacritics, tatweel, ZWNJ, Persian/Arabic digits).
 * Shared by the renderer filters and the main-process search column.
 */
const DIACRITICS = /[ً-ٰٟـ]/g
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export function normalizeText(input: string): string {
  let out = input
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(DIACRITICS, '')
    .replace(/[‌‍ ]/g, ' ')
  out = out.replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = PERSIAN_DIGITS.indexOf(d)
    return String(fa >= 0 ? fa : ARABIC_DIGITS.indexOf(d))
  })
  return out.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}
