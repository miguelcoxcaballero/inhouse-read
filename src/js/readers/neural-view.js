import {getRustUI} from '../rust-ui.js'
import {LegacyNeuralView} from './neural-view-legacy.js'

export class NeuralView {
  constructor(panel) {
    const View=getRustUI()?.RustNeuralView || LegacyNeuralView
    return new View(panel)
  }
}
