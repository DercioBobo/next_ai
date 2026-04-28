/* Next AI — floating chat widget */
(function () {
	"use strict";

	function tryInit() {
		if (typeof frappe === "undefined" || !frappe.boot) {
			setTimeout(tryInit, 300);
			return;
		}
		const cfg = frappe.boot.next_ai || {};
		if (!cfg.float_enabled) return;
		if (window.location.pathname.includes("/next-ai")) return;
		if (document.getElementById("nai-float-btn")) return;

		new NextAIWidget(cfg);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => setTimeout(tryInit, 400));
	} else {
		setTimeout(tryInit, 400);
	}

	// ── Widget ────────────────────────────────────────────────────────────────
	class NextAIWidget {
		constructor(cfg) {
			this.cfg             = cfg;
			this.open            = false;
			this.session         = null;
			this.loading         = false;
			this._stream_handler = null;

			this._buildDOM();
			this._bind();
		}

		// ── DOM ────────────────────────────────────────────────────────────────
		_buildDOM() {
			this.$btn = _el("div", { id: "nai-float-btn", title: "Next AI" });
			this.$btn.innerHTML = `
<div class="nai-float-circle" id="nai-float-circle">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
  </svg>
</div>`;

			this.$panel = _el("div", { id: "nai-float-panel" });
			this.$panel.innerHTML = `
<div class="nai-panel-header">
  <div class="nai-panel-title">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
    </svg>
    Next AI
  </div>
  <div class="nai-panel-actions">
    <button class="nai-panel-btn" id="nai-w-new" title="New chat">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <button class="nai-panel-btn" id="nai-w-expand" title="Open full chat">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
    </button>
    <button class="nai-panel-btn" id="nai-w-close" title="Close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  </div>
</div>
<div class="nai-panel-messages" id="nai-w-msgs">
  <div class="nai-panel-welcome" id="nai-w-welcome">
    <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="12" fill="#6366f1"/>
      <path d="M13 20h14M20 13v14" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="20" cy="20" r="4" stroke="white" stroke-width="2"/>
    </svg>
    <p>Ask anything about your ERP data</p>
  </div>
</div>
<div class="nai-panel-input-wrap">
  <textarea id="nai-w-input" class="nai-panel-textarea" rows="1" placeholder="Ask a question…"></textarea>
  <button class="nai-panel-send" id="nai-w-send">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
  </button>
</div>`;

			document.body.appendChild(this.$btn);
			document.body.appendChild(this.$panel);

			this.$circle  = document.getElementById("nai-float-circle");
			this.$msgs    = document.getElementById("nai-w-msgs");
			this.$welcome = document.getElementById("nai-w-welcome");
			this.$input   = document.getElementById("nai-w-input");
			this.$sendBtn = document.getElementById("nai-w-send");
		}

		// ── Events ─────────────────────────────────────────────────────────────
		_bind() {
			this.$btn.addEventListener("click", () => this._toggle());

			document.getElementById("nai-w-close").addEventListener("click", () => this._close());
			document.getElementById("nai-w-expand").addEventListener("click", () => {
				this._close();
				frappe.set_route("next-ai");
			});
			document.getElementById("nai-w-new").addEventListener("click", () => this._newChat());

			this.$input.addEventListener("input", () => {
				this.$input.style.height = "auto";
				this.$input.style.height = Math.min(this.$input.scrollHeight, 100) + "px";
			});
			this.$input.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._send(); }
			});
			this.$sendBtn.addEventListener("click", () => this._send());

			// In-app navigation
			this.$msgs.addEventListener("click", (e) => {
				const a = e.target.closest("a");
				if (a && (a.getAttribute("href") || "").startsWith("/app/")) {
					e.preventDefault();
					this._close();
					frappe.set_route(a.getAttribute("href").replace(/^\/app\//, "").split("/"));
				}
			});
		}

		// ── Open / close ───────────────────────────────────────────────────────
		_toggle() { this.open ? this._close() : this._openPanel(); }

		_openPanel() {
			this.open = true;
			this.$panel.classList.add("open");
			this.$circle.classList.add("open");
			setTimeout(() => this.$input.focus(), 250);
		}

		_close() {
			this.open = false;
			this.$panel.classList.remove("open");
			this.$circle.classList.remove("open");
		}

		_newChat() {
			this.session = null;
			this.$msgs.innerHTML = `
<div class="nai-panel-welcome" id="nai-w-welcome">
  <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="12" fill="#6366f1"/>
    <path d="M13 20h14M20 13v14" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="20" cy="20" r="4" stroke="white" stroke-width="2"/>
  </svg>
  <p>Ask anything about your ERP data</p>
</div>`;
			this.$welcome = document.getElementById("nai-w-welcome");
			this.$input.value = "";
			this.$input.style.height = "auto";
			this.$input.focus();
		}

		// ── Send & streaming ───────────────────────────────────────────────────
		_send() {
			if (this.loading) return;
			const msg = this.$input.value.trim();
			if (!msg) return;

			if (this.$welcome) { this.$welcome.remove(); this.$welcome = null; }

			this.$input.value = "";
			this.$input.style.height = "auto";

			this._appendMsg("user", msg);

			// AI bubble that tokens will stream into
			const { $content, $tool_row } = this._createStreamBubble();

			this.loading = true;
			this.$sendBtn.disabled = true;

			frappe.call({
				method: "next_ai.api.chat.send_message",
				args: { session_id: this.session || "new", message: msg },

				callback: (r) => {
					if (!r.message) {
						$content.innerHTML = `<span style="color:var(--red)">No response from server.</span>`;
						this._done();
						return;
					}

					const { session_id, stream_key } = r.message;
					this.session = session_id;
					let raw_text  = "";
					let got_token = false;

					if (this._stream_handler) {
						frappe.realtime.off("next_ai_stream", this._stream_handler);
					}

					this._stream_handler = (data) => {
						if (data.key !== stream_key) return;

						if (data.token) {
							if (!got_token) { $content.innerHTML = ""; got_token = true; }
							raw_text += data.token;
							$content.textContent = raw_text;
							this._scrollBottom();
						}

						if (data.tool_start) { $tool_row.style.display = "flex"; this._scrollBottom(); }
						if (data.tool_end)   { $tool_row.style.display = "none"; }

						if (data.done) {
							frappe.realtime.off("next_ai_stream", this._stream_handler);
							this._stream_handler = null;

							if (data.error) {
								$content.innerHTML = `<span style="color:var(--red)">${_escHtml(data.error)}</span>`;
							} else {
								$content.innerHTML = _renderMdW(raw_text || "");
							}
							this._scrollBottom();
							this._done();
						}
					};

					frappe.realtime.on("next_ai_stream", this._stream_handler);
				},

				error: () => {
					$content.innerHTML = `<span style="color:var(--red)">Failed to send. Please try again.</span>`;
					this._done();
				},
			});
		}

		_done() {
			this.loading = false;
			this.$sendBtn.disabled = false;
		}

		// ── DOM helpers ────────────────────────────────────────────────────────
		_appendMsg(role, content) {
			const isUser = role === "user";
			const av = isUser
				? `<div class="nai-w-av nai-w-av-user">${_wUserAv()}</div>`
				: `<div class="nai-w-av nai-w-av-ai">${_wAiIcon()}</div>`;

			const body = isUser
				? _escHtml(content).replace(/\n/g, "<br>")
				: _renderMdW(content);

			const div = document.createElement("div");
			div.className = `nai-w-msg ${isUser ? "nai-w-msg-user" : "nai-w-msg-ai"}`;
			div.innerHTML = `
${isUser ? "" : av}
<div class="nai-w-bubble"><div class="nai-w-content">${body}</div></div>
${isUser ? av : ""}`;
			this.$msgs.appendChild(div);
			this._scrollBottom();
			return div;
		}

		_createStreamBubble() {
			const div = document.createElement("div");
			div.className = "nai-w-msg nai-w-msg-ai";
			div.innerHTML = `
<div class="nai-w-av nai-w-av-ai">${_wAiIcon()}</div>
<div class="nai-w-bubble">
  <div class="nai-w-tool-row" style="display:none;align-items:center;gap:5px;font-size:11px;color:var(--text-muted);margin-bottom:5px">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    Querying data…
  </div>
  <div class="nai-w-content">
    <div class="nai-w-dots"><span></span><span></span><span></span></div>
  </div>
</div>`;
			this.$msgs.appendChild(div);
			this._scrollBottom();
			return {
				$content:  div.querySelector(".nai-w-content"),
				$tool_row: div.querySelector(".nai-w-tool-row"),
			};
		}

		_scrollBottom() { this.$msgs.scrollTop = this.$msgs.scrollHeight; }
	}


	// ── Markdown renderer ──────────────────────────────────────────────────────
	function _renderMdW(text) {
		if (window.marked) {
			marked.setOptions({ breaks: true, gfm: true });
			return marked.parse(text);
		}
		const e = _escHtml(text);
		return e
			.replace(/```[\s\S]*?```/g, (m) =>
				`<pre><code>${m.slice(3, -3).replace(/^[^\n]*\n/, "")}</code></pre>`)
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/\*(.+?)\*/g, "<em>$1</em>")
			.replace(/^#{1,3} (.+)$/gm, "<strong>$1</strong>")
			.replace(/^- (.+)$/gm, "<li>$1</li>")
			.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
			.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
			.replace(/\n\n/g, "</p><p>")
			.replace(/\n/g, "<br>");
	}


	// ── Utilities ──────────────────────────────────────────────────────────────
	function _el(tag, attrs) {
		const el = document.createElement(tag);
		Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
		return el;
	}

	function _escHtml(s) {
		return String(s)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;")
			.replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	function _wAiIcon() {
		return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>`;
	}

	function _wUserAv() {
		if (frappe.session && frappe.session.user_image)
			return `<img src="${frappe.session.user_image}" alt="">`;
		return `<span>${(frappe.session && frappe.session.user || "?")[0].toUpperCase()}</span>`;
	}

})();
