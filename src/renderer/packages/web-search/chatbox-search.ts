import { searchNativeWeb } from '@shared/services/native-web-search'
import type { SearchResult } from '@shared/types'
import { getChatboxWebSearchRequestOptions } from '@/packages/remote'
import WebSearch from './base'

export class ChatboxSearch extends WebSearch {
  private licenseKey: string

  // Chatbox AI supports parse_link via the dedicated remote API.
  // The actual parse_link execution path lives in `parseLinkTool.execute` (build-in branch),
  // not in this class, because it requires a Pro license check that is policy-level.
  // This flag is informational and keeps PROVIDERS_WITH_PARSE_LINK consistent.
  override supportsParseLink = true

  constructor(licenseKey: string) {
    super()
    this.licenseKey = licenseKey
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    if (!this.licenseKey) {
      return { items: [] }
    }
    // Single implementation shared with the native shell. The request seam injects an
    // afetch fetchFn (retry + Chatbox error parsing) plus the Chatbox platform headers,
    // preserving the behavior of the old `webBrowsing` remote call.
    const items = await searchNativeWeb(query, {
      provider: 'build-in',
      licenseKey: this.licenseKey,
      signal,
      ...(await getChatboxWebSearchRequestOptions()),
    })
    return { items }
  }
}
