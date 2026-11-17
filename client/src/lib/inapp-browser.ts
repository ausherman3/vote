// App 內建瀏覽器（LINE／FB／IG／Messenger…）偵測與 Google 登入引導
//
// Google 安全政策禁止在 App 內建瀏覽器做 Google 登入（403 disallowed_useragent）。
// 這個網站學生不需要登入，所以不擋整個頁面：
// - LINE：index.html 開頭已用官方參數 openExternalBrowser=1 自動改用系統瀏覽器開啟
// - 其他 App：只有按「Google 登入」時才顯示引導；Android 另外嘗試用 intent:// 叫出 Chrome

export const INAPP_ERROR_CODE = "app/inapp-browser";

const GUIDE_ID = "inapp-browser-guide";

export function isInAppBrowser(ua: string = navigator.userAgent || ""): boolean {
    return /\bLine\//i.test(ua) || /FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|KAKAOTALK/i.test(ua);
}

function chromeIntentUrl(): string {
    const fallback =
        location.href.split("#")[0] + (location.search ? "&" : "?") + "iabEscape=1" + location.hash;
    return (
        "intent://" + location.host + location.pathname + location.search + location.hash +
        "#Intent;scheme=" + location.protocol.replace(":", "") +
        ";package=com.android.chrome" +
        ";S.browser_fallback_url=" + encodeURIComponent(fallback) + ";end"
    );
}

/** 顯示「請改用瀏覽器開啟」引導（可關閉，關閉後仍可匿名使用） */
export function showInAppBrowserGuide(): void {
    if (document.getElementById(GUIDE_ID)) return;
    const isAndroid = /Android/i.test(navigator.userAgent || "");
    const intent = isAndroid ? chromeIntentUrl() : "";

    const wrap = document.createElement("div");
    wrap.id = GUIDE_ID;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText =
        "position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;" +
        "padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));" +
        "font-family:Nunito,'PingFang TC','Microsoft JhengHei',system-ui,sans-serif;";

    const chromeBtn = intent
        ? `<a id="inapp-open-chrome" href="${intent.replace(/"/g, "&quot;")}" style="display:block;margin:20px 0 6px;padding:14px 18px;border-radius:999px;background:#22c55e;color:#052e16;font-size:17px;font-weight:800;text-decoration:none;">用 Chrome 開啟</a>` +
          `<p style="font-size:13px;color:#94a3b8;margin:6px 0 14px;">按了沒反應，再照下面的方法</p>`
        : "";

    wrap.innerHTML =
        `<div style="max-width:420px;width:100%;box-sizing:border-box;text-align:center;background:#1e293b;color:#fff;border-radius:20px;padding:28px 24px;">` +
        `<div style="font-size:48px;line-height:1;">🌐</div>` +
        `<h2 style="font-size:20px;font-weight:800;margin:14px 0 10px;">請改用瀏覽器開啟再登入</h2>` +
        `<p style="font-size:15px;line-height:1.8;color:#cbd5e1;margin:0;">您目前在 <b style="color:#fbbf24;">LINE／FB 等 App 的內建瀏覽器</b>，Google 基於安全規定<b>不允許在這裡登入</b>。</p>` +
        chromeBtn +
        `<p style="font-size:15px;line-height:1.8;color:#cbd5e1;margin:${intent ? "0" : "14px 0 0"};">請點右上／右下角「<b>⋯</b>」→ 選「<b style="color:#4ade80;">用預設瀏覽器開啟</b>」</p>` +
        `<p style="font-size:14px;line-height:1.7;color:#94a3b8;margin:14px 0 0;">不登入也能繼續出題與投票，只是題目不會存進題庫</p>` +
        `<button id="inapp-guide-close" type="button" style="margin-top:18px;padding:12px 22px;min-height:44px;border-radius:999px;border:1px solid #475569;background:transparent;color:#e2e8f0;font-size:15px;font-weight:700;cursor:pointer;">先不登入，繼續使用</button>` +
        `</div>`;

    document.body.appendChild(wrap);
    wrap.querySelector("#inapp-guide-close")?.addEventListener("click", () => wrap.remove());

    // Android：先畫好引導再自動叫 Chrome（每個分頁只試一次；沒裝 Chrome 會帶 iabEscape=1 回來，不再重試）
    if (intent && location.search.indexOf("iabEscape=1") === -1) {
        let tried = false;
        try {
            tried = sessionStorage.getItem("iabEscapeTried") === "1";
            sessionStorage.setItem("iabEscapeTried", "1");
        } catch {
            /* 無法存取 sessionStorage 時照樣試一次 */
        }
        if (!tried) setTimeout(() => { location.href = intent; }, 300);
    }
}

/** 在 App 內建瀏覽器時顯示引導並丟出可辨識的錯誤，讓呼叫端安靜略過 */
export function guardInAppBrowserLogin(): void {
    if (!isInAppBrowser()) return;
    showInAppBrowserGuide();
    const err = new Error("請改用瀏覽器開啟再登入（App 內建瀏覽器不支援 Google 登入）") as Error & { code: string };
    err.code = INAPP_ERROR_CODE;
    throw err;
}
