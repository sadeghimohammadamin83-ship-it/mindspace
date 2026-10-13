/**
 * Normalisation applied to text BEFORE it is embedded (queries and passages
 * alike). Stored text and excerpts are never changed. Only variants that
 * carry no meaning are unified: NFKC presentation forms, Arabic yeh/kaf vs
 * Persian, harakat and tatweel, and runs of whitespace. ZWNJ is kept because
 * it is part of correct Persian spelling the model has seen in training.
 */
const DIACRITICS = /[ً-ٰٟـ]/g

export function embedNormalize(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(DIACRITICS, '')
    .replace(/[^\S\n‌]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}
