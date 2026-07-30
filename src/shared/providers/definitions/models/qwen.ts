import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {
  name: string
}

export default class Qwen extends OpenAICompatible {
  public name: string
  public options: Options

  constructor(options: Options, dependencies: ModelDependencies) {
    super(options, dependencies)
    this.name = options.name
    this.options = options
  }
}
