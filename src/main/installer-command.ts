export const QUIT_FOR_INSTALL_ARGUMENT = '--quit-for-install'

export function isQuitForInstallRequested(commandLine: readonly string[]): boolean {
  return commandLine.includes(QUIT_FOR_INSTALL_ARGUMENT)
}
