// Threads 公式API クライアント（投稿の全自動化）
//
// 公式API仕様（2026年時点の確認結果）:
//   - 投稿: 1プロフィールあたり24時間で250件まで
//   - 返信: 24時間で1,000件まで
//   - 長期アクセストークンの寿命は60日 → 期限前に更新が必要
//   - **DM送信はAPIに存在しない**（コメント自動返信も不可）
//
// 投稿は2ステップ:
//   1) POST /v1.0/{user-id}/threads          … メディアコンテナを作る
//   2) POST /v1.0/{user-id}/threads_publish  … 公開する

const BASE = 'https://graph.threads.net/v1.0';

class ThreadsClient {
  constructor({ userId, accessToken }) {
    if (!userId || !accessToken) throw new Error('userId と accessToken が必要です');
    this.userId = userId;
    this.accessToken = accessToken;
  }

  async _post(path, params) {
    const url = new URL(`${BASE}/${path}`);
    const body = new URLSearchParams({ ...params, access_token: this.accessToken });
    const res = await fetch(url, { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || res.statusText;
      const code = json?.error?.code;
      throw new Error(`Threads API ${res.status} (code=${code}): ${msg}`);
    }
    return json;
  }

  async _get(path, params = {}) {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', this.accessToken);
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || res.statusText;
      const code = json?.error?.code;
      throw new Error(`Threads API ${res.status} (code=${code}): ${msg}`);
    }
    return json;
  }

  /** テキスト投稿を公開する。画像を付ける場合は imageUrl（公開URL必須）を渡す */
  async publishText(text, imageUrl) {
    const params = imageUrl
      ? { media_type: 'IMAGE', image_url: imageUrl, text }
      : { media_type: 'TEXT', text };
    const container = await this._post(`${this.userId}/threads`, params);
    // 公式ガイダンスに沿ってコンテナ作成後に短く待つ
    await new Promise(r => setTimeout(r, 3000));
    const published = await this._post(`${this.userId}/threads_publish`, {
      creation_id: container.id,
    });
    return { containerId: container.id, postId: published.id };
  }

  /** 返信を公開する（reply_to_id 指定の2段階フロー。返信は24hで1,000件まで） */
  async publishReply(replyToId, text) {
    const container = await this._post(`${this.userId}/threads`, {
      media_type: 'TEXT', text, reply_to_id: replyToId,
    });
    await new Promise(r => setTimeout(r, 3000));
    const published = await this._post(`${this.userId}/threads_publish`, {
      creation_id: container.id,
    });
    return { containerId: container.id, postId: published.id };
  }

  /** メディアの会話（リプライ一覧）を取得する。未返信判定は replied_to の突き合わせで行う */
  async conversation(mediaId, fields = 'id,text,username,timestamp,replied_to,is_reply_owned_by_me') {
    return this._get(`${mediaId}/conversation`, { fields });
  }

  /** 自分の投稿（スレッド上位）一覧を取得する。返信runで「当日の投稿ID」を自動解決するために使う */
  async listThreads(fields = 'id,timestamp,permalink,media_type') {
    return this._get(`${this.userId}/threads`, { fields });
  }

  /** 残りの投稿枠を確認する（24時間で250件） */
  async publishingLimit() {
    const url = new URL(`${BASE}/${this.userId}/threads_publishing_limit`);
    url.searchParams.set('fields', 'quota_usage,config');
    url.searchParams.set('access_token', this.accessToken);
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`limit取得失敗: ${json?.error?.message || res.statusText}`);
    return json;
  }

  /** 長期トークンを更新する（寿命60日なので定期実行が必要） */
  async refreshToken() {
    const url = new URL(`${BASE}/refresh_access_token`);
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', this.accessToken);
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`token更新失敗: ${json?.error?.message || res.statusText}`);
    return json; // { access_token, token_type, expires_in }
  }
}

module.exports = { ThreadsClient };
