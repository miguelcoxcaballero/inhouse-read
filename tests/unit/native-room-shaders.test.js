import { describe, expect, it } from 'vitest'
import { needRustShelf } from '../../src/js/rust-shelf.js'
import { referenceRoomShaders } from './helpers/reference-native-room-shaders.js'

// rust-ui/src/native_room_shaders.rs builds the room replay program's sources; three.js keys its
// program cache on the text, so it must be the template's, byte for byte.
describe('native room replay shaders', () => {
  it('are the frozen template for every layer count', () => {
    for (let layers = 0; layers <= 6; layers++) {
      const [vertexShader, fragmentShader] = needRustShelf().native_room_shaders(layers)
      const frozen = referenceRoomShaders(layers)
      expect(vertexShader).toBe(frozen.vertexShader)
      expect(fragmentShader).toBe(frozen.fragmentShader)
    }
  })
})
