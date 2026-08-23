/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeOpencodeContent from "./skill/customize-hannah-agent.md" with { type: "text" }

export const CustomizeOpencodeContent = customizeOpencodeContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-hannah-agent",
            description:
              "Use ONLY when the user is editing or creating hannah-agent's own configuration: hannah-agent.json, hannah-agent.jsonc, files under .hannah-agent/, or files under ~/.config/hannah-agent/. Also use when creating or fixing hannah-agent agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring hannah-agent itself.",
            location: AbsolutePath.make("/builtin/customize-hannah-agent.md"),
            content: CustomizeOpencodeContent,
          }),
        }),
      )
    })
  }),
})
