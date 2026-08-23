import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerHannahSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
