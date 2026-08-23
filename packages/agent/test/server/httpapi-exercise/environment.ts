import { Flag } from "@hannah/core/flag/flag"
import { Effect } from "effect"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.HANNAH_AGENT_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.HANNAH_AGENT_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
process.env.HANNAH_AGENT_DISABLE_SHARE = "true"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "opencode")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "opencode")

const preserveExerciseDatabase = !!process.env.HANNAH_AGENT_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.HANNAH_AGENT_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `opencode-httpapi-exercise-${process.pid}.db`)
process.env.HANNAH_AGENT_DB = exerciseDatabasePath
Flag.HANNAH_AGENT_DB = exerciseDatabasePath

export const original = {
  HANNAH_AGENT_SERVER_PASSWORD: Flag.HANNAH_AGENT_SERVER_PASSWORD,
  HANNAH_AGENT_SERVER_USERNAME: Flag.HANNAH_AGENT_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})
