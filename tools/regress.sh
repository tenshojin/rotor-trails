#!/usr/bin/env bash
# 自动驾驶回归：所有地图 × 所有路线组合（晴天），以及各地图的非晴天天气 × 2 种路线组合。
# 用法（Git Bash / Linux / macOS）：bash tools/regress.sh [clear|weather|all]，结果写到 tmp/runs/
set -u
cd "$(dirname "$0")/.."
mkdir -p tmp/runs
mode=${1:-all}

run() { # MAP PATHS [WEATHER]
  local out="tmp/runs/$1_${2/,/_}${3:+_$3}.txt"
  MAP=$1 PATHS=$2 WEATHER=${3:-} MAXT=1500 npx vitest run --config vitest.tools.config.ts tools/autorun.tool.ts --silent=false > "$out" 2>&1
}

if [ "$mode" = clear ] || [ "$mode" = all ]; then
  for m in japan canyon amazon fjord himalaya; do
    for p in 0,0 1,1 0,1 1,0; do run "$m" "$p" & done
    wait
  done
fi

if [ "$mode" = weather ] || [ "$mode" = all ]; then
  for mw in japan:rain japan:breeze canyon:gusty canyon:windy amazon:rain amazon:storm amazon:dynamic fjord:fog fjord:crosswind himalaya:lowcloud himalaya:windy; do
    m=${mw%%:*}
    w=${mw##*:}
    run "$m" 0,0 "$w" &
    run "$m" 1,1 "$w" &
    wait
  done
fi

total=0
ok=0
for f in tmp/runs/*.txt; do
  line=$(grep -h -E '^\[[a-z]+\] paths' "$f" | sed 's/ wall=.*//')
  [ -z "$line" ] && { echo "无结果：$f"; continue; }
  total=$((total + 1))
  echo "$(basename "$f" .txt): $line"
  if echo "$line" | grep -q 'completed=true crashed=false.*collisions=0'; then ok=$((ok + 1)); fi
done
echo "完成且无碰撞：$ok / $total"
