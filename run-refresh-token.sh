#!/bin/bash
# Threadsアクセストークン自動更新ランナー（月1・保存検証つき）
# 使い方:
#   ./run-refresh-token.sh            # 実更新 → 新トークン検証 → atomicsave
#   ./run-refresh-token.sh --check    # 確認のみ（現在有効か表示）
#
# 設計（Engineer 指摘 faed396 を反映）:
#   - 更新は必ず新しいトークンを返す。保存を忘れると有効なトークンを失うため、
#     新トークンを「検証してから」保存する。
#   - 検証が通るまで .env.threads は書き換えない（失敗時は旧トークンのまま）。
#   - 失敗時のみスレッドに1行通知（固定文・LLM不使用）。成功時はログのみ。
#   - ※Meta仕様: 長期トークンは「発行/更新から24時間以上経過」しないと更新不可。
#     毎日更新は初回で必ず失敗するため、頻度は週1（7日間隔）を下限とする。
cd "$(dirname "$0")"

# out/ は .gitignore 対象なので clone 直後には存在しない。
# ログのリダイレクトが先に走って失敗するので、必ず先に作る。
mkdir -p out
if [ ! -f .env.threads ]; then
  # 再構築直後など。通知を投げても復旧できないので、ここで明示的に落とす。
  echo ".env.threads がありません（トークンの再配置が必要です）" >&2
  exit 1
fi
set -a; source .env.threads; set +a
LOG=out/token-refresh.log
NOTIFY_TARGET="${NOTIFY_TARGET:-#channel-186445d0:ch_26eaf45e17c0b652207fa215c03e7b85}"

notify() {
  # run-post.sh と同じフック。これが無いと検証のたびに本物の通知がスレッドに飛ぶ。
  if [ -n "$TOKEN_NOTIFY_SILENT_TEST" ]; then
    echo "[notify-test] token refresh failure" >> "$LOG"
    return 0
  fi
  de message-send --target "$NOTIFY_TARGET" <<'GENTEAMMSG'
⚠️ Threadsアクセストークンの自動更新に失敗しました。run-refresh-token.sh の再実行か手動確認が必要です（out/token-refresh.log・期限はここから再設定）。
GENTEAMMSG
}

if [ "$1" = "--check" ]; then
  exec node tools/refresh-token.js
fi

# 1) 現在のトークンを先に確認（無効なら失敗して通知）
node tools/refresh-token.js > out/token-refresh.check 2>&1 || {
  echo "[$(date -u +%FT%TZ)] CHECK FAILED" >> "$LOG"; cat out/token-refresh.check >> "$LOG"; notify; exit 1;
}

# 2) 実更新
node tools/refresh-token.js --refresh > out/token-refresh.out 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "[$(date -u +%FT%TZ)] REFRESH FAILED rc=$RC" >> "$LOG"; cat out/token-refresh.out >> "$LOG"; notify; exit 1;
fi
NEWTOKEN="$(sed -n '/=== 新しいトークン/,/^===/p' out/token-refresh.out | grep -v '===' | head -1 | tr -d ' \r')"
if [ -z "$NEWTOKEN" ]; then
  echo "[$(date -u +%FT%TZ)] NEWTOKEN EMPTY" >> "$LOG"; cat out/token-refresh.out >> "$LOG"; notify; exit 1;
fi

# 3) 新トークンを検証してから保存（検証が通るまで .env.threads は触らない）
if [ -n "${THREADS_USER_ID:-}" ]; then export THREADS_USER_ID; fi
export THREADS_ACCESS_TOKEN="$NEWTOKEN"
node tools/refresh-token.js > out/token-refresh.verify 2>&1
if [ "$?" -ne 0 ]; then
  echo "[$(date -u +%FT%TZ)] VERIFY FAILED（保存せず旧トークン維持）" >> "$LOG"; cat out/token-refresh.verify >> "$LOG"; notify; exit 1;
fi

# 4) atomic save（THREADS_ACCESS_TOKEN 行だけ差し替え・権限600を維持）
awk -v nt="$NEWTOKEN" 'BEGIN{FS=OFS="="} $1=="THREADS_ACCESS_TOKEN"{$2=nt} {print}' .env.threads > .env.threads.new
if ! grep -q "^THREADS_ACCESS_TOKEN=$NEWTOKEN$" .env.threads.new; then
  echo "[$(date -u +%FT%TZ)] SAVE FAILED（書き出し不一致）" >> "$LOG"; notify; exit 1;
fi
mv .env.threads.new .env.threads && chmod 600 .env.threads
echo "[$(date -u +%FT%TZ)] refresh OK（期限再設定: 現在+60日）" >> "$LOG"
