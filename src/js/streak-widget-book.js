// El último libro para el widget de la racha: minutos que quedan y una miniatura PNG de la portada
// (la guardada, o una hecha con el título). The minutes, their rounding and the whole cover recipe are
// rust-ui/src/reading_streak.rs (shelf module); these are the same exports as thin calls.
import { needRustShelf } from './rust-shelf.js'

/** Minutos de lectura que quedan, o -1 si no se conoce la longitud del libro. */
export const minutesLeft = record => needRustShelf().streak_minutes_left(record)

/** Redondea para no reescribir el widget por cada página: de 5 en 5 min y de 10 en 10 por encima de 1 h. */
export const roundedMinutes = minutes => needRustShelf().streak_rounded_minutes(minutes)

/** PNG en base64 (sin prefijo) de la portada con esquinas redondeadas. */
export async function coverPng(record, title) { return needRustShelf().streak_cover_png(record, title) }
