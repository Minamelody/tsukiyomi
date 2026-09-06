#!/bin/bash
# Threads自動投稿ランナー（スケジュールから呼ばれる）
# 必ずドライランを経てから実投稿する。--live フラグが無い限り投稿しない。
# 使い方: ./run-post.sh <slot> [--live]
#
# 失敗通知: 実投稿が失敗（トークンエラー・API拒否・投稿枠切れなど）したら
# スレッドに1行だけ通知する。成功時は無言（運用を邪魔しない）。
# 通知文はLLM生成を一切はさまない固定文（クレジット枯渇時でも飛ぶ）。
# テスト用フック: AUTOPOST_NOTIFY_SILENT_TEST=1 で通知を出さずログに記録する。
#               AUTOPOST_NOTIFY_TARGET で通知先を差し替え可能。
cd "$(dirname "$0")"

# out/ は .gitignore 対象なので clone 直後には存在しない。
# ログのリダイレクトが先に走って失敗するので、必ず先に作る。
mkdir -p out
if [ ! -f .env.threads ]; then
  echo ".env.threads がありません（トークンの再配置が必要です）" >&2
  exit 1
fi
set -a; source .env.threads; set +a
SLOT="${1:-0}"
ARGS=(--slot "$SLOT" --per-day 3)
LIVE=0
for a in "$@"; do [ "$a" = "--live" ] && LIVE=1; done
NOTIFY_TARGET="${AUTOPOST_NOTIFY_TARGET:-#channel-186445d0:ch_26eaf45e17c0b652207fa215c03e7b85}"

notify_fail() {  # $1=slot $2=reason（固定文・LLM不使用）
  local slot="$1" reason="$2"
  if [ -n "$AUTOPOST_NOTIFY_SILENT_TEST" ]; then
    echo "[notify-test] slot=$slot reason=$reason" >> out/autopost.log
    return 0
  fi
  de message-send --target "$NOTIFY_TARGET" <<GENTEAMMSG
⚠️ Threads自動投稿が失敗しました（slot=${slot}）: ${reason}
GENTEAMMSG
  echo "[notify-sent] slot=$slot reason=$reason" >> out/autopost.log
}

if [ "$LIVE" = "0" ]; then
  echo "[$(date -u +%FT%TZ)] DRY-RUN slot=$SLOT（--live なしのため投稿しません）" >> out/autopost.log
  exec node src/autopost.js "${ARGS[@]}" --dry-run
fi
TMPLOG="out/autopost-run.log"
node src/autopost.js "${ARGS[@]}" > "$TMPLOG" 2>&1
RC=$?
cat "$TMPLOG" >> out/autopost.log
if [ "$RC" -ne 0 ]; then
  REASON="$(grep -E '失敗|中止|設定してください|error|Error' "$TMPLOG" | tail -1 | cut -c1-160)"
  [ -z "$REASON" ] && REASON="exit code ${RC}"
  notify_fail "$SLOT" "$REASON"
fi
rm -f "$TMPLOG"
echo "exit=$RC date=$(date -u +%FT%TZ) slot=$SLOT LIVE" >> out/autopost.log
exit "$RC"
