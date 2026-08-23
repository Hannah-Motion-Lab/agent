import { AgentV2 } from "@hannah/core/agent"
import { AISDK } from "@hannah/core/aisdk"
import { Catalog } from "@hannah/core/catalog"
import { CommandV2 } from "@hannah/core/command"
import { Credential } from "@hannah/core/credential"
import { AppNodeBuilder } from "@hannah/core/effect/app-node-builder"
import { LayerNodePlatform } from "@hannah/core/effect/app-node-platform"
import { LayerNode } from "@hannah/core/effect/layer-node"
import { EventV2 } from "@hannah/core/event"
import { FileSystem } from "@hannah/core/filesystem"
import { FSUtil } from "@hannah/core/fs-util"
import { Integration } from "@hannah/core/integration"
import { Location } from "@hannah/core/location"
import { Npm } from "@hannah/core/npm"
import { PluginV2 } from "@hannah/core/plugin"
import { Reference } from "@hannah/core/reference"
import { SkillV2 } from "@hannah/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
