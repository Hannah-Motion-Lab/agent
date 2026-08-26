#!/bin/sh
# Install a Hannah profile into the engine's global config directory.
# Never overwrites an existing config without --force; prints what it did.
#
#   scripts/install-profile.sh            # Anthropic profile (default)
#   scripts/install-profile.sh --local    # local-only Ollama profile
#   scripts/install-profile.sh --openrouter  # OpenRouter profile (GLM 5.3 Flash, remote)
#   scripts/install-profile.sh --force    # replace an existing config
#   scripts/install-profile.sh --print    # write nothing, dump to stdout
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
source_file="$root/profile/hannah-agent.jsonc"
force=0
print_only=0

for arg in "$@"; do
  case "$arg" in
  --local) source_file="$root/profile/hannah-agent.local.jsonc" ;;
  --openrouter) source_file="$root/profile/hannah-agent.openrouter.jsonc" ;;
  --force) force=1 ;;
  --print) print_only=1 ;;
  -h | --help)
    sed -n "2,8p" "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "unknown argument: $arg" >&2
    exit 2
    ;;
  esac
done

[ -f "$source_file" ] || {
  echo "missing profile template: $source_file" >&2
  exit 1
}

if [ "$print_only" = 1 ]; then
  cat "$source_file"
  exit 0
fi

# Mirrors packages/core/src/global.ts: XDG_CONFIG_HOME, else ~/.config.
config_dir="${HANNAH_AGENT_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/hannah-agent}"
target="$config_dir/hannah-agent.jsonc"

if [ -f "$target" ] && [ "$force" = 0 ]; then
  echo "config already exists: $target"
  echo "diff against the template you asked for:"
  diff -u "$target" "$source_file" || true
  echo
  echo "re-run with --force to replace it, or merge the changes by hand."
  exit 1
fi

mkdir -p "$config_dir"
[ -f "$target" ] && cp "$target" "$target.bak.$(date +%Y%m%d%H%M%S)" && echo "backed up previous config"
cp "$source_file" "$target"
echo "installed $(basename "$source_file") -> $target"

# Macro skills (M3.2). The engine scans `{skill,skills}/**/SKILL.md` under its
# config directories, so copying them here is all the wiring there is — no
# `skills.paths` entry, and nothing pointing back at this checkout.
if [ -d "$root/profile/skills" ]; then
  mkdir -p "$config_dir/skill"
  cp -R "$root/profile/skills/." "$config_dir/skill/"
  echo "installed $(find "$root/profile/skills" -name SKILL.md | wc -l | tr -d ' ') macro skills -> $config_dir/skill/"
fi

case "$source_file" in
*local*) echo "next: ollama serve, then 'hannah-agent serve --port 8006'" ;;
*) echo "next: export ANTHROPIC_API_KEY=..., then 'hannah-agent serve --port 8006'" ;;
esac
