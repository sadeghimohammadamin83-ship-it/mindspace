import type { Origin } from '@shared/domain'

/** Stored origin is 'sample' or 'user'; the UI calls user records 'session'. */
export type StoredOrigin = 'sample' | 'user'
export const toOrigin = (o: StoredOrigin): Origin => (o === 'sample' ? 'sample' : 'session')
export const fromOrigin = (o: Origin): StoredOrigin => (o === 'sample' ? 'sample' : 'user')
