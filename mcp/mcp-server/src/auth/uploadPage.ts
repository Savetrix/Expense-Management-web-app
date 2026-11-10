const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/**
 * The invoice upload page a remote Claude user lands on.
 *
 * Claude connects to this connector from Anthropic's cloud, so it can never
 * read a file off the user's machine, and the MCP client truncates large tool
 * arguments long before a real PDF could be inlined as base64. So the file has
 * to travel over a normal browser upload instead: a tool hands the user a
 * ticketed link, and this page POSTs the bytes straight back to /upload.
 *
 * The bytes are sent as the raw request body (not multipart) so the server can
 * read them with express.raw() and needs no multipart dependency.
 */
export const uploadPage = (opts: {
  ticket: string;
  webUrl: string;
  maxBytes: number;
  email?: string;
}): string => {
  const maxMb = Math.floor(opts.maxBytes / (1024 * 1024));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Upload an invoice to ScanTrix</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background: #f8fafc; color: #0f172a; padding: 24px;
  }
  .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; text-decoration: none; }
  .logo-mark {
    width: 40px; height: 40px; background: #1fb6aa; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .logo-text { font-size: 22px; font-weight: 700; color: #1f3a5f; letter-spacing: -0.3px; }
  .card {
    width: 100%; max-width: 460px; background: #fff;
    border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px;
    box-shadow: 0 4px 6px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  }
  h1 { font-size: 22px; font-weight: 700; color: #1f3a5f; margin-bottom: 6px; line-height: 1.3; }
  .sub { font-size: 14px; color: #475569; line-height: 1.5; margin-bottom: 22px; }
  .sub strong { color: #1f3a5f; }
  .drop {
    border: 2px dashed #cbd5e1; border-radius: 12px; padding: 28px 20px;
    text-align: center; cursor: pointer; transition: border-color .15s, background .15s;
    background: #f8fafc;
  }
  .drop:hover, .drop.over { border-color: #1fb6aa; background: rgba(31,182,170,.06); }
  .drop-icon { color: #1fb6aa; margin-bottom: 10px; }
  .drop-main { font-size: 15px; font-weight: 600; color: #1f3a5f; margin-bottom: 4px; }
  .drop-hint { font-size: 12px; color: #94a3b8; }
  input[type="file"] { display: none; }
  .btn {
    width: 100%; height: 50px; margin-top: 20px; border: none; border-radius: 10px;
    background: #1fb6aa; color: #fff; font-size: 15px; font-weight: 600;
    font-family: inherit; cursor: pointer; transition: background .15s;
  }
  .btn:hover { background: #17998f; }
  .btn:disabled { background: #a3e2da; cursor: not-allowed; }
  .msg { margin-top: 18px; padding: 12px 14px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
  .err { border-left: 4px solid #dc2626; background: rgba(220,38,38,.06); color: #dc2626; }
  .ok { border-left: 4px solid #1fb6aa; background: rgba(31,182,170,.06); color: #1f3a5f; }
  .foot { margin-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5; }
  .foot a { color: #1fb6aa; font-weight: 600; text-decoration: none; }
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
    <span class="logo-text">ScanTrix</span>
  </a>

  <div class="card">
    <h1>Upload an invoice</h1>
    <p class="sub">
      ${opts.email ? `Uploading to <strong>${esc(opts.email)}</strong>. ` : ""}Pick a photo or PDF and it will be scanned straight into your account. Then go back to your chat and ask for the invoice list.
    </p>

    <div class="drop" id="drop">
      <div class="drop-icon">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div class="drop-main" id="dropMain">Choose a file or drag it here</div>
      <div class="drop-hint">PDF, JPG, PNG, HEIC or TIFF &middot; up to ${maxMb} MB</div>
    </div>
    <input type="file" id="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff,application/pdf,image/*" />

    <button class="btn" id="send" disabled>Upload invoice</button>
    <div id="msg"></div>

    <div class="foot">
      This link expires shortly and works only for your account.<br />
      <a href="${esc(opts.webUrl)}/" target="_blank" rel="noopener">scantrix.ai</a>
    </div>
  </div>

<script>
  var TICKET = ${JSON.stringify(opts.ticket)};
  var MAX = ${opts.maxBytes};
  var drop = document.getElementById("drop");
  var input = document.getElementById("file");
  var send = document.getElementById("send");
  var msg = document.getElementById("msg");
  var main = document.getElementById("dropMain");
  var chosen = null;

  function show(kind, html) { msg.className = "msg " + kind; msg.innerHTML = html; }

  function pick(f) {
    if (!f) return;
    if (f.size > MAX) {
      show("err", "That file is larger than ${maxMb} MB. Go back to your chat and ask Claude to fetch it from a link instead (e.g. a Google Drive or Dropbox share link) \\u2014 that path isn't limited to ${maxMb} MB.");
      return;
    }
    chosen = f;
    main.textContent = f.name;
    send.disabled = false;
    msg.className = ""; msg.innerHTML = "";
  }

  drop.addEventListener("click", function () { input.click(); });
  input.addEventListener("change", function () { pick(input.files[0]); });
  ["dragenter", "dragover"].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (ev) {
    if (ev.dataTransfer && ev.dataTransfer.files) pick(ev.dataTransfer.files[0]);
  });

  send.addEventListener("click", async function () {
    if (!chosen) return;
    send.disabled = true;
    send.textContent = "Uploading\\u2026";
    try {
      var res = await fetch("/upload?t=" + encodeURIComponent(TICKET), {
        method: "POST",
        headers: {
          "Content-Type": chosen.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(chosen.name)
        },
        body: chosen
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.message || ("Upload failed (" + res.status + ")"));
      show("ok", "<strong>Uploaded \\u2713</strong><br />Go back to your chat and ask for your invoice list \\u2014 it will be there once scanning finishes.");
      send.textContent = "Uploaded";
      main.textContent = "Choose another file";
      chosen = null;
    } catch (err) {
      show("err", (err && err.message) || "Upload failed. Please try again.");
      send.disabled = false;
      send.textContent = "Upload invoice";
    }
  });
</script>
</body>
</html>`;
};
