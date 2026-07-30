import type { ChatboxAIModelList } from '@/packages/remote'

export type ChatboxAIPlan = ChatboxAIModelList['license']['plan'] | undefined

export type ChatboxAIGroupView = {
  id: string
  modelIds: string[]
  total: number
  isAdvanced: boolean
  isLocked: boolean
  isFeaturedOnly: boolean
}

export function isChatboxAIProPlan(plan: ChatboxAIPlan): boolean {
  return plan === 'pro' || plan === 'pro_plus'
}

export function isChatboxAIAdvancedGroup(groupId: string): boolean {
  return groupId === 'advanced'
}

export function isChatboxAIModelLocked(groupId: string, plan: ChatboxAIPlan): boolean {
  return isChatboxAIAdvancedGroup(groupId) && !isChatboxAIProPlan(plan)
}

export function getChatboxAIModelName(model: { modelName?: string; modelId: string }): string {
  return model.modelName || model.modelId
}

export function modelMatchesSearch(
  model: { modelId: string; modelName?: string },
  search: string,
  providerName = 'Chatbox AI'
): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return (
    providerName.toLowerCase().includes(query) ||
    model.modelId.toLowerCase().includes(query) ||
    getChatboxAIModelName(model).toLowerCase().includes(query)
  )
}

export function buildChatboxAIGroupViews(params: {
  catalog: ChatboxAIModelList
  search: string
  expandedAdvanced: boolean
  collapsedGroupIds: Set<string>
  modelFilter?: (modelId: string) => boolean
}): ChatboxAIGroupView[] {
  const { catalog, search, expandedAdvanced, collapsedGroupIds, modelFilter } = params
  const isSearching = search.trim().length > 0

  return catalog.groups.map((group) => {
    const isAdvanced = isChatboxAIAdvancedGroup(group.id)
    const isLocked = isChatboxAIModelLocked(group.id, catalog.license.plan)
    const featuredIds = group.featuredModelIds?.length ? group.featuredModelIds : group.modelIds
    const shouldShowFeaturedOnly = isAdvanced && isLocked && !expandedAdvanced && !isSearching
    const sourceIds = shouldShowFeaturedOnly ? featuredIds : group.modelIds
    const visibleIds = collapsedGroupIds.has(group.id)
      ? []
      : sourceIds.filter((modelId) => {
          const model = catalog.models[modelId]
          if (!model) return false
          if (modelFilter && !modelFilter(modelId)) return false
          return modelMatchesSearch(model, search, catalog.provider.name)
        })

    const total = group.modelIds.filter((modelId) => {
      const model = catalog.models[modelId]
      if (!model) return false
      return modelFilter ? modelFilter(modelId) : true
    }).length

    return {
      id: group.id,
      modelIds: visibleIds,
      total,
      isAdvanced,
      isLocked,
      isFeaturedOnly: shouldShowFeaturedOnly,
    }
  })
}
