// A device's sync checkpoints live in IndexedDB: rust-ui/src/backup_state.rs, in the sync module,
// whose library backup is their only caller.
import { loadedCloudModule } from './cloud-native.js'
export const readBackupCheckpoint = key => loadedCloudModule().backup_checkpoint_read(key)
export const saveBackupCheckpoint = (key, value) => loadedCloudModule().backup_checkpoint_save(key, value)
export const mergeBackupCheckpoint = (key, value) => loadedCloudModule().backup_checkpoint_merge(key, value)
