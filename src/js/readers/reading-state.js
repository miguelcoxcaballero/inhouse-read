import { bookDataModule } from '../book-data-native.js'

// Reader and cloud callers already own a loaded UI/shelf module. Rust owns
// validation and locator rules; records and their UTF-16 strings stay host values.
export const clonePlace = place => bookDataModule().record_clone_place(place)
export const cleanPlaces = (value, limit = 20) => bookDataModule().record_clean_places(value, limit, false)
export const cleanQuotes = (value, limit = 200) => bookDataModule().record_clean_places(value, limit, true)
