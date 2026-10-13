/** While a restore is being prepared, the renderer-facing write channels refuse requests so nothing is lost between the safety backup and the restart. */
let on = false
export const setMaintenance = (v: boolean): void => {
  on = v
}
export const isMaintenance = (): boolean => on
export const MAINTENANCE_MESSAGE = 'MINDSPACE is preparing a restore and will restart in a moment.'
