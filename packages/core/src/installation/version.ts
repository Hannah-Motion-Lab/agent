declare global {
  const HANNAH_AGENT_VERSION: string
  const HANNAH_AGENT_CHANNEL: string
}

export const InstallationVersion = typeof HANNAH_AGENT_VERSION === "string" ? HANNAH_AGENT_VERSION : "local"
export const InstallationChannel = typeof HANNAH_AGENT_CHANNEL === "string" ? HANNAH_AGENT_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
