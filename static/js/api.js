// ローカルサーバー（127.0.0.1）との通信。起動ごとのトークンを付けて送る。

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : (detail?.message || `エラー（${status}）`));
    this.status = status;
    this.detail = detail;
  }
}

/** サーバーへの要求に付ける見出し。トークンと、このタブが開いているプロジェクトのフォルダ（別のタブで別のプロジェクトを
 * 開いたとき、このタブの保存などが、そちらを上書きしないように、サーバーが照らし合わせる）。 */
export function appHeaders(extra = {}) {
  const h = { "X-App-Token": window.APP_TOKEN, ...extra };
  if (window.PROJECT_FOLDER) h["X-Project"] = encodeURIComponent(window.PROJECT_FOLDER);
  return h;
}

/** 別のプロジェクトが開かれていて断られたとき、画面に知らせる（1 回だけ）。 */
export function checkMismatch(status, detail) {
  if (status === 409 && detail?.code === "project_mismatch") {
    window.dispatchEvent(new CustomEvent("project-mismatch", { detail: detail.message }));
    return true;
  }
  return false;
}

async function request(method, path, body) {
  const opts = { method, headers: appHeaders() };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new ApiError(0, "サーバーに接続できません。アプリ（run.py）が起動しているか確認してください。");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    checkMismatch(res.status, data?.detail);
    throw new ApiError(res.status, data?.detail ?? data ?? res.statusText);
  }
  return data;
}

export const api = {
  /** プレビュー用: 一時的に混んでいる（503。描画の最中など）ときは、少し待って 1 回だけやり直す。 */
  postRetry: async (p, b = {}) => {
    try { return await request("POST", p, b); } catch (e) {
      if (e.status !== 503) throw e;
      await new Promise((r) => setTimeout(r, 2500));
      return request("POST", p, b);
    }
  },
  get: (p) => request("GET", p),
  post: (p, b = {}) => request("POST", p, b),
  put: (p, b = {}) => request("PUT", p, b),
};
