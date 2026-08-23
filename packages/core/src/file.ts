export * as File from "./file"

import { Revert } from "@hannah/schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
