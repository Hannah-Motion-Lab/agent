#!/bin/sh
# Boot matrix (ROADMAP M0.1 / M1.1 acceptance): start the headless server under
# a scratch HOME in each supported configuration and assert it comes up healthy.
#
# Each case runs with an empty environment except the variables it needs, so a
# stray ANTHROPIC_API_KEY or proxy setting in the developer's shell cannot make
# a failing configuration look like it passes.
#
#   scripts/boot-matrix.sh            # run every case
#   scripts/boot-matrix.sh offline    # run one case by name
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
bun=${BUN:-bun}
port=${PORT:-8021}
want=${1:-all}
status=0

run_case() {
  name=$1
  profile=$2
  shift 2 # remaining args are VAR=VALUE pairs for the server environment

  [ "$want" = all ] || [ "$want" = "$name" ] || return 0

  home=$(mktemp -d "/tmp/hannah-boot-$name.XXXXXX")
  log="$home/serve.log"
  HOME="$home" sh "$root/scripts/install-profile.sh" $profile >"$home/install.log" 2>&1

  # env -i gives each case a clean slate; PATH is needed to find bun itself.
  if [ "${isolate:-0}" = 1 ]; then
    # Run the server AND its health probe inside an unprivileged network
    # namespace: loopback is the only reachable network, so a pass is the
    # strongest form of the "runs with no egress" claim (ADR-0009). The probe
    # must live inside the namespace too — its loopback is not ours.
    unshare -rn sh -c "
      ip link set lo up 2>/dev/null
      env -i HOME='$home' PATH='$PATH' $* '$bun' run --cwd '$root/packages/agent' \
        --conditions=browser src/index.ts serve --port '$port' >'$log' 2>&1 &
      inner=\$!
      i=0
      while [ \$i -lt 40 ]; do
        curl -fsS -m 2 'http://127.0.0.1:$port/global/health' >'$home/health.json' 2>/dev/null && break
        kill -0 \$inner 2>/dev/null || break
        i=\$((i + 1)); sleep 0.5
      done
      kill \$inner 2>/dev/null || true
    " >/dev/null 2>&1
    ok=0
    [ -s "$home/health.json" ] && ok=1
  else
    env -i HOME="$home" PATH="$PATH" "$@" \
      "$bun" run --cwd "$root/packages/agent" --conditions=browser src/index.ts \
      serve --port "$port" >"$log" 2>&1 &
    pid=$!

    ok=0
    i=0
    while [ "$i" -lt 40 ]; do
      if curl -fsS -m 2 "http://127.0.0.1:$port/global/health" >"$home/health.json" 2>/dev/null; then
        ok=1
        break
      fi
      kill -0 "$pid" 2>/dev/null || break
      i=$((i + 1))
      sleep 0.5
    done

    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi

  leaked=$(find "$home" -iname '*opencode*' | wc -l | tr -d ' ')

  # SECURITY §7: the server must listen on loopback only. Anything bound to a
  # routable address would expose the agent's full tool surface to the LAN (T5).
  exposed=0
  if [ "${isolate:-0}" != 1 ] && command -v ss >/dev/null 2>&1; then
    exposed=$(ss -tlnH 2>/dev/null | awk -v p=":$port" '$4 ~ p && $4 !~ /^(127\.|\[::1\])/ {n++} END {print n+0}')
  fi

  if [ "$ok" = 1 ] && [ "$leaked" = 0 ] && [ "$exposed" = 0 ]; then
    echo "PASS  $name  $(cat "$home/health.json")"
    rm -rf "$home"
  else
    status=1
    [ "$ok" = 1 ] || echo "FAIL  $name  server never became healthy"
    [ "$leaked" = 0 ] || echo "FAIL  $name  created $leaked opencode-named path(s)"
    [ "$exposed" = 0 ] || echo "FAIL  $name  listening on a non-loopback address"
    echo "      log: $log"
    tail -5 "$log" | sed 's/^/      /'
  fi
}

# name        profile   environment for the server process
run_case offline "" HANNAH_AGENT_DISABLE_MODELS_FETCH=1
run_case anthropic "" ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-ant-boot-matrix-placeholder}"
run_case ollama --local HANNAH_AGENT_DISABLE_MODELS_FETCH=1

# Same as `offline`, but with the network genuinely removed rather than merely
# unused. Skipped where unprivileged network namespaces are unavailable.
if unshare -rn true 2>/dev/null; then
  isolate=1 run_case airgap "" HANNAH_AGENT_DISABLE_MODELS_FETCH=1
  isolate=0
elif [ "$want" = all ] || [ "$want" = airgap ]; then
  echo "SKIP  airgap  unprivileged network namespaces unavailable on this host"
fi

exit $status
