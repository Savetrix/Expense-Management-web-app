const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

export const loginPage = (opts: {
  reqToken: string;
  webUrl: string;
  clientName?: string;
  /** Shows "Continue with Google" when set (see Config.googleClientId). */
  googleClientId?: string;
  error?: string;
}): string => {
  const app = opts.clientName ? esc(opts.clientName) : "an application";
  // Embedded in a <script>: JSON gives a valid JS string, and escaping "<"
  // stops a stray "</script>" from ending the block early.
  const googleClientIdJs = opts.googleClientId
    ? JSON.stringify(opts.googleClientId).replace(/</g, "\\u003c")
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in to Scantrix</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f8fafc;
    color: #0f172a;
    padding: 24px;
  }
  .logo {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 28px; text-decoration: none;
  }
  .logo-mark {
    width: 40px; height: 40px; background: #1fb6aa; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .logo-mark svg { display: block; }
  .logo-text { font-size: 22px; font-weight: 700; color: #1f3a5f; letter-spacing: -0.3px; }
  .card {
    width: 100%; max-width: 420px; background: #ffffff;
    border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;
    box-shadow: 0 4px 6px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  }
  .card-header { margin-bottom: 24px; }
  .card-title { font-size: 22px; font-weight: 700; color: #1f3a5f; margin-bottom: 6px; line-height: 1.3; }
  .card-sub { font-size: 14px; color: #475569; line-height: 1.5; }
  .card-sub strong { color: #1f3a5f; }
  .field { margin-bottom: 16px; }
  .field-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  label { display: block; font-size: 13px; font-weight: 600; color: #1f3a5f; margin-bottom: 6px; }
  .field-row label { margin-bottom: 0; }
  .show-toggle {
    background: none; border: none; cursor: pointer;
    font-size: 12px; font-weight: 600; color: #1fb6aa; padding: 0;
    display: flex; align-items: center; gap: 3px; line-height: 1;
  }
  .show-toggle:hover { color: #17998f; }
  input[type="email"], input[type="password"], input[type="text"] {
    width: 100%; height: 48px; padding: 0 14px; border: 1px solid #e2e8f0;
    border-radius: 10px; background: #ffffff; color: #0f172a; font-size: 15px;
    font-family: inherit; transition: border-color 0.15s, box-shadow 0.15s;
    -webkit-appearance: none;
  }
  input::placeholder { color: #94a3b8; }
  input:focus { outline: none; border-color: #1fb6aa; box-shadow: 0 0 0 3px rgba(31,182,170,.15); }
  .btn {
    width: 100%; height: 50px; margin-top: 8px; border: none; border-radius: 10px;
    background: #1fb6aa; color: #ffffff; font-size: 15px; font-weight: 600;
    font-family: inherit; cursor: pointer; transition: background 0.15s, transform 0.1s;
    letter-spacing: 0.01em;
  }
  .btn:hover { background: #17998f; }
  .btn:active { background: #107b73; transform: scale(0.99); }
  .btn:disabled { background: #a3e2da; cursor: not-allowed; transform: none; }
  .err {
    margin-bottom: 16px; padding: 12px 14px; border-radius: 10px;
    border-left: 4px solid #dc2626; background: rgba(220,38,38,.06);
    font-size: 13px; color: #dc2626; line-height: 1.5;
  }
  .info {
    margin-bottom: 16px; padding: 12px 14px; border-radius: 10px;
    border-left: 4px solid #1fb6aa; background: rgba(31,182,170,.06);
    font-size: 13px; color: #1f3a5f; line-height: 1.5;
  }
  .info a { color: #1fb6aa; font-weight: 600; }
  .info a:hover { color: #17998f; }
  .google { display: flex; justify-content: center; min-height: 44px; }
  .google-status { font-size: 13px; color: #475569; text-align: center; margin-top: 8px; display: none; }
  .divider {
    display: flex; align-items: center; gap: 12px; margin: 20px 0;
    font-size: 12px; color: #94a3b8;
  }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: #e2e8f0; }
  .foot { margin-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5; }
  .foot a { color: #1fb6aa; font-weight: 600; text-decoration: none; }
  .foot a:hover { color: #17998f; }
</style>
</head>
<body>
  <a class="logo" href="${esc(opts.webUrl)}/" target="_blank" rel="noopener">
    <div class="logo-mark">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 7h14M4 11h10M4 15h7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="18" cy="15" r="2.5" stroke="#fff" stroke-width="1.8"/>
        <path d="M18 17.5v2.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </div>
    <span class="logo-text">Scantrix</span>
  </a>

  <div class="card">
    <div class="card-header">
      <h1 class="card-title">Welcome back</h1>
      <p class="card-sub">Sign in to connect <strong>${app}</strong> to your Scantrix account.</p>
    </div>

    ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}

    ${
      googleClientIdJs
        ? `<div class="google" id="googleButton"></div>
    <p class="google-status" id="googleStatus">Signing in with Google…</p>
    <form method="POST" action="/login/google" id="googleForm">
      <input type="hidden" name="req" value="${esc(opts.reqToken)}" />
      <input type="hidden" name="credential" id="googleCredential" />
    </form>
    <div class="divider">or sign in with email</div>`
        : ""
    }

  <form method="POST" action="/login" id="loginForm">
    <div class="info">
      Use your <strong>Scantrix email &amp; password</strong>.${
        googleClientIdJs ? " Signed up with Google? Use <strong>Continue with Google</strong> above." : ""
      } If you signed up with ${googleClientIdJs ? "Microsoft or Apple" : "Google, Microsoft, or Apple"},
      you&apos;ll need to <a href="${esc(opts.webUrl)}/forgot-password" target="_blank" rel="noopener">set a password first</a>.
    </div>

    <input type="hidden" name="req" value="${esc(opts.reqToken)}" />

    <div class="field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username"
        placeholder="you@company.com" required autofocus />
    </div>

    <div class="field">
      <div class="field-row">
        <label for="password">Password</label>
        <button type="button" class="show-toggle" onclick="togglePw()">
          <svg id="eyeIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span id="pwLabel">Show</span>
        </button>
      </div>
      <input id="password" name="password" type="password"
        autocomplete="current-password" placeholder="Your password" required />
      <div style="text-align:right;margin-top:6px;">
        <a href="${esc(opts.webUrl)}/forgot-password" target="_blank" rel="noopener"
          style="font-size:12px;font-weight:600;color:#1fb6aa;text-decoration:none;">Forgot password?</a>
      </div>
    </div>

    <button type="submit" class="btn" id="submitBtn">Sign in to Scantrix</button>

    <div class="foot">
      No account?
      <a href="${esc(opts.webUrl)}/register" target="_blank" rel="noopener">Sign up free</a>
      &nbsp;&bull;&nbsp;
      <a href="${esc(opts.webUrl)}/" target="_blank" rel="noopener">scantrix.ai</a>
    </div>
  </form>
  </div>
${
  googleClientIdJs
    ? `
<script>
  // Google Identity Services, the same button the website uses. Google
  // returns an ID token to the callback; we post it to /login/google, which
  // exchanges it with Scantrix's /auth/google.
  function initGoogle() {
    var el = document.getElementById("googleButton");
    if (!el || !window.google || !google.accounts || !google.accounts.id) return;
    google.accounts.id.initialize({
      client_id: ${googleClientIdJs},
      ux_mode: "popup",
      context: "signin",
      callback: function (response) {
        if (!response || !response.credential) return;
        document.getElementById("googleCredential").value = response.credential;
        el.style.display = "none";
        document.getElementById("googleStatus").style.display = "block";
        document.getElementById("googleForm").submit();
      }
    });
    google.accounts.id.renderButton(el, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      width: Math.max(240, Math.min(356, el.offsetWidth || 356))
    });
  }
</script>
<script src="https://accounts.google.com/gsi/client" async defer onload="initGoogle()"></script>`
    : ""
}

<script>
  function togglePw() {
    var i = document.getElementById("password");
    var l = document.getElementById("pwLabel");
    var ic = document.getElementById("eyeIcon");
    if (i.type === "password") {
      i.type = "text"; l.textContent = "Hide";
      ic.innerHTML = "<path d=\\"M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24\\"/><line x1=\\"1\\" y1=\\"1\\" x2=\\"23\\" y2=\\"23\\"/>";
    } else {
      i.type = "password"; l.textContent = "Show";
      ic.innerHTML = "<path d=\\"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z\\"/><circle cx=\\"12\\" cy=\\"12\\" r=\\"3\\"/>";
    }
  }
  document.getElementById("loginForm").addEventListener("submit", function() {
    var b = document.getElementById("submitBtn");
    b.disabled = true; b.textContent = "Signing in…";
  });
</script>
</body>
</html>`;
};
