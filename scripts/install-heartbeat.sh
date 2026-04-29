#!/bin/bash
#
# M-Team HEARTBEAT 安装脚本
# 将 m-team 心跳模板追加到各 agent workspace 的 HEARTBEAT.md
#
# 用法: bash scripts/install-heartbeat.sh [--dry-run]
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FRAGMENT_EXECUTOR="$PROJECT_ROOT/templates/HEARTBEAT-executor-fragment.md"
FRAGMENT_PUBLISHER="$PROJECT_ROOT/templates/HEARTBEAT-publisher-fragment.md"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"

echo "=== M-Team HEARTBEAT 安装 ==="

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN 模式，不实际修改文件]"
fi

# 通用追加函数
# $1 = 源文件路径
# $2 = 目标 workspace 路径
# $3 = agent 角色描述
append_heartbeat() {
  local src="$1"
  local workspace="$2"
  local role="$3"
  local target="$workspace/HEARTBEAT.md"

  if [[ ! -f "$src" ]]; then
    echo "  [跳过] $role: 源文件不存在 $src"
    return
  fi

  if [[ ! -d "$workspace" ]]; then
    echo "  [跳过] $role: workspace 不存在 $workspace"
    return
  fi

  echo "" >> "$target"
  echo "--- m-team: $role ---" >> "$target"
  cat "$src" >> "$target"
  echo "--- m-team end ---" >> "$target"
  echo "" >> "$target"

  echo "  [OK] $role → $target"
}

# Executor agents
for agent in maker fixer scholar captain; do
  workspace="$OPENCLAW_ROOT/workspace-$agent"
  append_heartbeat "$FRAGMENT_EXECUTOR" "$workspace" "Executor: $agent"
done

# Publisher agents (Manager)
workspace="$OPENCLAW_ROOT/workspace-manager"
append_heartbeat "$FRAGMENT_PUBLISHER" "$workspace" "Publisher: manager"

echo ""
echo "完成。各 agent 心跳模板已追加到对应 HEARTBEAT.md。"
echo "重启 Gateway 生效: openclaw gateway restart"
