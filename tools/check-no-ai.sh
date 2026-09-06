#!/usr/bin/env bash
# dist の HTML から AI 表記が消えていることを確認する。
#
# 方針: 「消したい語」を列挙するのではなく、単語としての AI が現れたら落とす。
# 列挙方式は列挙漏れがそのまま検査の穴になるため（例: 「AIが同時に」は
# 「無料AI占い|AI FORTUNE|AI占い」のどれにも一致せずすり抜ける）。
#
# 使い方:
#   ./check-no-ai.sh dist
#   ./check-no-ai.sh dist '外部のAIサービスへ送信することもありません'
#
# 第2引数以降は「意図的に残す行」の許可パターン（部分一致・複数可）。
# 許可した行が存在しなくなった場合も失敗する（許可の陳腐化を検出）。
set -u

DIST="${1:-dist}"
shift || true

PAT='(^|[^A-Za-z])AI([^A-Za-z]|$)|ＡＩ'
fail=0
allow_n=$#

# 検出行を一時ファイルへ（file:line:text 形式）
hits=$(mktemp)
trap 'rm -f "$hits"' EXIT
grep -rnE "$PAT" --include='*.html' "$DIST" > "$hits" 2>/dev/null || true

# 1) 許可されていないAI表記があれば失敗
unexpected=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  allowed=0
  for pat in "$@"; do
    case "$line" in *"$pat"*) allowed=1; break ;; esac
  done
  if [ "$allowed" -eq 0 ]; then
    if [ "$unexpected" -eq 0 ]; then
      echo "NG: HTML に想定外のAI表記が残っています"
      unexpected=1; fail=1
    fi
    echo "    $line"
  fi
done < "$hits"

# 2) 許可パターンが実在しなければ失敗（許可の陳腐化）
for pat in "$@"; do
  if ! grep -qF -- "$pat" "$hits"; then
    echo "NG: 許可パターンに一致する行がありません（許可が古い可能性）: $pat"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  if [ "$allow_n" -gt 0 ]; then
    echo "OK: AI表記なし（意図的に許可した $allow_n 件のみ存在）"
  else
    echo "OK: AI表記なし"
  fi
fi
exit "$fail"
