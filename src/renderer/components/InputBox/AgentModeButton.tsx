import { Popover, UnstyledButton } from '@mantine/core'
import type { AgentModeValue, KnowledgeBase } from '@shared/types'
import { IconRobot } from '@tabler/icons-react'
import { useLocation } from '@tanstack/react-router'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionAgentMode } from '@/stores/session/agent-mode'
import AgentModePanel from './AgentModePanel'
import { getAgentModeUIState } from './agentModeState'

interface AgentModeButtonProps {
  sessionId: string
  providerId?: string
  modelId?: string
  iconSize?: number
  modelSupportsAgentMode?: boolean
  webBrowsingMode: boolean
  onWebBrowsingChange: (enabled: boolean) => void
  currentKnowledgeBaseId?: number
  onKnowledgeBaseSelect: (kb: KnowledgeBase | null) => void
  onSkillSelect: (skillName: string) => void
}

const MODE_COLORS: Record<AgentModeValue, string> = {
  on: 'var(--chatbox-tint-brand)',
  off: 'var(--chatbox-tint-secondary)',
  auto: 'var(--chatbox-tint-secondary)',
}

const OPEN_DELAY = 100
const CLOSE_DELAY = 250

const AgentModeButton: FC<AgentModeButtonProps> = ({
  sessionId,
  providerId,
  modelId,
  iconSize = 18,
  modelSupportsAgentMode = true,
  webBrowsingMode,
  onWebBrowsingChange,
  currentKnowledgeBaseId,
  onKnowledgeBaseSelect,
  onSkillSelect,
}) => {
  const { t } = useTranslation()
  const location = useLocation()
  const [opened, setOpened] = useState(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const entry = useSessionAgentMode(sessionId)
  const settingsOpened =
    Boolean((location.search as Record<string, unknown>)?.settings) || location.pathname.startsWith('/settings')

  const agentModeUIState = useMemo(
    () => getAgentModeUIState(entry, modelSupportsAgentMode),
    [entry, modelSupportsAgentMode]
  )
  const disabled = agentModeUIState.modelUnsupported

  const color = useMemo(() => {
    return MODE_COLORS[agentModeUIState.displayValue]
  }, [agentModeUIState.displayValue])

  const modeLabel = useMemo(() => {
    switch (agentModeUIState.displayValue) {
      case 'on':
        return t('Work Mode')
      default:
        return t('Chat Mode')
    }
  }, [agentModeUIState.displayValue, t])

  // Hover open/close with delays, matching Menu trigger="hover" behavior
  const handleMouseEnter = useCallback(() => {
    clearTimeout(closeTimerRef.current)
    openTimerRef.current = setTimeout(() => setOpened(true), OPEN_DELAY)
  }, [])

  const handleMouseLeave = useCallback(() => {
    clearTimeout(openTimerRef.current)
    closeTimerRef.current = setTimeout(() => setOpened(false), CLOSE_DELAY)
  }, [])

  const handleClose = useCallback(() => {
    clearTimeout(openTimerRef.current)
    clearTimeout(closeTimerRef.current)
    setOpened(false)
  }, [])

  useEffect(() => {
    return () => {
      clearTimeout(openTimerRef.current)
      clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (settingsOpened) {
      handleClose()
    }
  }, [settingsOpened, handleClose])

  return (
    <Popover
      position="top-start"
      withArrow
      shadow="md"
      opened={opened && !settingsOpened && !disabled}
      onChange={setOpened}
      keepMounted
      transitionProps={{ transition: 'pop', duration: 200 }}
    >
      <Popover.Target>
        <UnstyledButton
          disabled={disabled}
          title={disabled ? t('This model does not support Agent Mode') : undefined}
          onMouseEnter={disabled ? undefined : handleMouseEnter}
          onMouseLeave={disabled ? undefined : handleMouseLeave}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ${disabled ? '' : 'hover:bg-[var(--chatbox-background-tertiary)]'}`}
          style={{ color, opacity: disabled ? 0.5 : undefined }}
        >
          <IconRobot size={iconSize} strokeWidth={1.8} />
          <span className="text-xs font-medium whitespace-nowrap">{modeLabel}</span>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown
        p={0}
        style={{ overflow: 'visible' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <AgentModePanel
          sessionId={sessionId}
          providerId={providerId}
          modelId={modelId}
          modelSupportsAgentMode={modelSupportsAgentMode}
          webBrowsingMode={webBrowsingMode}
          onWebBrowsingChange={onWebBrowsingChange}
          currentKnowledgeBaseId={currentKnowledgeBaseId}
          onKnowledgeBaseSelect={onKnowledgeBaseSelect}
          onSkillSelect={onSkillSelect}
          onClose={handleClose}
        />
      </Popover.Dropdown>
    </Popover>
  )
}

export default AgentModeButton
