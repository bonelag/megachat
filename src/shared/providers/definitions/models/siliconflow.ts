import OpenAICompatible, { type OpenAICompatibleSettings } from '../../../models/openai-compatible'
import type { ToolUseScope } from '../../../types'
import { isDeepSeekWeakToolUse } from '../../../models/utils/deepseek'
import type { ModelDependencies } from '../../../types/adapters'

interface Options extends OpenAICompatibleSettings {}

export default class SiliconFlow extends OpenAICompatible {
  public name = 'SiliconFlow'
  public options: Options
  constructor(options: Omit<Options, 'apiHost'>, dependencies: ModelDependencies) {
    const apiHost = 'https://api.siliconflow.cn/v1'
    super(
      {
        apiKey: options.apiKey,
        apiHost,
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
      },
      dependencies
    )
    this.options = {
      ...options,
      apiHost,
    }
  }

  isSupportToolUse(scope?: ToolUseScope) {
    if (isDeepSeekWeakToolUse(this.options.model.modelId, scope)) return false
    return super.isSupportToolUse()
  }
}
