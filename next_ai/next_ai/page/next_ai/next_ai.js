frappe.pages["next-ai"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Next AI"),
		single_column: true,
	});

	_injectPageStyles();
	frappe.next_ai_page = new NextAIPage(wrapper);
};

frappe.pages["next-ai"].on_page_show = function (wrapper) {
	if (frappe.next_ai_page) frappe.next_ai_page.on_show();
};

// ─────────────────────────────────────────────────────────────────────────────
// Main page controller
// ─────────────────────────────────────────────────────────────────────────────
class NextAIPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.session_id = null;
		this.is_loading = false;

		this._render();
		this._bind();
		this.load_sessions();
	}

	on_show() {
		this.$input().focus();
	}

	// ── DOM helpers ────────────────────────────────────────────────────────
	$el(sel) { return $(this.wrapper).find(sel); }
	$input()  { return this.$el("#nai-input"); }
	$send()   { return this.$el("#nai-send"); }
	$msgs()   { return this.$el("#nai-messages"); }

	// ── Layout ─────────────────────────────────────────────────────────────
	_render() {
		$(this.wrapper).find(".layout-main-section").html(`
<div class="nai-page">
  <aside class="nai-sidebar">
    <div class="nai-sidebar-top">
      <button class="nai-new-btn" id="nai-new-chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        ${__("New Chat")}
      </button>
    </div>
    <div class="nai-sessions" id="nai-sessions">
      <p class="nai-empty-hint">${__("No conversations yet")}</p>
    </div>
    <div class="nai-sidebar-footer">
      <a href="/app/next-ai-settings" class="nai-settings-link">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        ${__("Settings")}
      </a>
    </div>
  </aside>

  <main class="nai-main">
    <div class="nai-welcome" id="nai-welcome">
      <div class="nai-welcome-inner">
        <div class="nai-welcome-logo">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect width="40" height="40" rx="12" fill="#6366f1"/><path d="M13 20h14M20 13v14" stroke="white" stroke-width="2.5" stroke-linecap="round"/><circle cx="20" cy="20" r="4" stroke="white" stroke-width="2"/></svg>
        </div>
        <h2>${__("Next AI")}</h2>
        <p class="nai-tagline">${__("Your ERP data, in plain language.")}</p>
        <div class="nai-chips" id="nai-chips">
          <button class="nai-chip">${__("Show recent sales invoices")}</button>
          <button class="nai-chip">${__("How many customers do we have?")}</button>
          <button class="nai-chip">${__("What are our top selling items?")}</button>
          <button class="nai-chip">${__("Outstanding payments this month")}</button>
          <button class="nai-chip">${__("Summarise stock levels")}</button>
          <button class="nai-chip">${__("Which employees joined this year?")}</button>
        </div>
      </div>
    </div>

    <div class="nai-messages" id="nai-messages" style="display:none"></div>

    <div class="nai-input-bar">
      <div class="nai-input-wrap">
        <textarea id="nai-input" class="nai-textarea" rows="1"
          placeholder="${__("Ask anything about your ERP data…")}"></textarea>
        <button class="nai-send" id="nai-send" title="${__("Send")}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      <p class="nai-hint">${__("Enter to send · Shift+Enter for new line")}</p>
    </div>
  </main>
</div>`);
	}

	// ── Events ─────────────────────────────────────────────────────────────
	_bind() {
		const self = this;

		// Auto-resize textarea
		this.$input().on("input", function () {
			this.style.height = "auto";
			this.style.height = Math.min(this.scrollHeight, 160) + "px";
		});

		// Send on Enter (not Shift+Enter)
		this.$input().on("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.send();
			}
		});

		this.$send().on("click", () => this.send());

		// New chat
		this.$el("#nai-new-chat").on("click", () => this.new_chat());

		// Session click (delegated)
		this.$el("#nai-sessions").on("click", ".nai-session-item", function (e) {
			if ($(e.target).closest(".nai-session-del").length) return;
			self.load_session($(this).data("id"));
		});

		// Delete session
		this.$el("#nai-sessions").on("click", ".nai-session-del", function (e) {
			e.stopPropagation();
			const id = $(this).closest(".nai-session-item").data("id");
			self.delete_session(id);
		});

		// Suggestion chips
		this.$el("#nai-chips").on("click", ".nai-chip", function () {
			self.$input().val($(this).text().trim());
			self.send();
		});

		// Links in AI responses → in-app navigation
		$(this.wrapper).on("click", ".nai-bubble a[href^='/app/']", function (e) {
			e.preventDefault();
			const path = $(this).attr("href").replace(/^\/app\//, "");
			frappe.set_route(path.split("/"));
		});

		// Copy button
		$(this.wrapper).on("click", ".nai-copy", function () {
			const text = $(this).closest(".nai-bubble").find(".nai-content").text();
			navigator.clipboard.writeText(text).then(() => {
				const $btn = $(this);
				$btn.html(_copyDoneIcon());
				setTimeout(() => $btn.html(_copyIcon()), 2000);
			});
		});
	}

	// ── Session list ───────────────────────────────────────────────────────
	load_sessions() {
		frappe.call({
			method: "next_ai.api.chat.get_sessions",
			callback: (r) => {
				const sessions = (r.message || []);
				const $list = this.$el("#nai-sessions");
				$list.empty();

				if (!sessions.length) {
					$list.html(`<p class="nai-empty-hint">${__("No conversations yet")}</p>`);
					return;
				}

				sessions.forEach((s) => {
					const active = s.name === this.session_id ? " active" : "";
					const date = frappe.datetime.prettyDate(s.last_message_at || s.creation);
					$list.append(`
<div class="nai-session-item${active}" data-id="${s.name}">
  <span class="nai-session-title">${frappe.utils.escape_html(s.session_title || __("Untitled"))}</span>
  <span class="nai-session-meta">${date}</span>
  <button class="nai-session-del" title="${__("Delete")}">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
  </button>
</div>`);
				});
			},
		});
	}

	load_session(session_id) {
		this.session_id = session_id;
		this.$el(".nai-session-item").removeClass("active");
		this.$el(`.nai-session-item[data-id="${session_id}"]`).addClass("active");

		frappe.call({
			method: "next_ai.api.chat.get_messages",
			args: { session_id },
			callback: (r) => {
				if (!r.message) return;
				const { messages } = r.message;

				this.$el("#nai-welcome").hide();
				this.$msgs().show().empty();

				messages.forEach((m) => {
					this._append_msg(m.role.toLowerCase(), m.content);
				});
				this._scroll_bottom();
			},
		});
	}

	new_chat() {
		this.session_id = null;
		this.$el(".nai-session-item").removeClass("active");
		this.$el("#nai-welcome").show();
		this.$msgs().hide().empty();
		this.$input().val("").css("height", "auto").focus();
	}

	delete_session(session_id) {
		frappe.confirm(__("Delete this conversation?"), () => {
			frappe.call({
				method: "next_ai.api.chat.delete_session",
				args: { session_id },
				callback: () => {
					if (this.session_id === session_id) this.new_chat();
					this.load_sessions();
				},
			});
		});
	}

	// ── Messaging ──────────────────────────────────────────────────────────
	send() {
		if (this.is_loading) return;
		const message = this.$input().val().trim();
		if (!message) return;

		this.$input().val("").css("height", "auto");
		this.$el("#nai-welcome").hide();
		this.$msgs().show();

		this._append_msg("user", message);
		const $thinking = this._append_thinking();
		this.is_loading = true;
		this._update_send();

		frappe.call({
			method: "next_ai.api.chat.send_message",
			args: { session_id: this.session_id || "new", message },
			callback: (r) => {
				$thinking.remove();
				if (r.message) {
					const data = r.message;
					this.session_id = data.session_id;
					this._append_msg("assistant", data.response);
					this.load_sessions();
				}
			},
			error: () => {
				$thinking.remove();
				this._append_error(__("Failed to get a response. Please try again."));
			},
			always: () => {
				this.is_loading = false;
				this._update_send();
			},
		});
	}

	_append_msg(role, content) {
		const is_user = role === "user";
		const avatar = is_user
			? `<div class="nai-av nai-av-user">${_userAvatar()}</div>`
			: `<div class="nai-av nai-av-ai"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></div>`;

		const body = is_user
			? `<div class="nai-content">${frappe.utils.escape_html(content).replace(/\n/g, "<br>")}</div>`
			: `<div class="nai-content">${_renderMd(content)}</div>
         <div class="nai-bubble-actions">
           <button class="nai-copy" title="${__("Copy response")}">${_copyIcon()}</button>
         </div>`;

		const $msg = $(`
<div class="nai-msg ${is_user ? "nai-msg-user" : "nai-msg-ai"}">
  ${is_user ? "" : avatar}
  <div class="nai-bubble">${body}</div>
  ${is_user ? avatar : ""}
</div>`);

		this.$msgs().append($msg);
		this._scroll_bottom();
		return $msg;
	}

	_append_thinking() {
		const $t = $(`
<div class="nai-msg nai-msg-ai nai-thinking">
  <div class="nai-av nai-av-ai"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg></div>
  <div class="nai-bubble">
    <div class="nai-dots"><span></span><span></span><span></span></div>
  </div>
</div>`);
		this.$msgs().append($t);
		this._scroll_bottom();
		return $t;
	}

	_append_error(msg) {
		this.$msgs().append(`
<div class="nai-msg nai-msg-error">
  <div class="nai-bubble">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    ${frappe.utils.escape_html(msg)}
  </div>
</div>`);
		this._scroll_bottom();
	}

	_scroll_bottom() {
		const el = this.$msgs()[0];
		if (el) el.scrollTop = el.scrollHeight;
	}

	_update_send() {
		this.$send()
			.prop("disabled", this.is_loading)
			.toggleClass("loading", this.is_loading);
	}
}


// ─────────────────────────────────────────────────────────────────────────────
// Markdown renderer
// ─────────────────────────────────────────────────────────────────────────────
function _renderMd(text) {
	if (window.marked) {
		marked.setOptions({ breaks: true, gfm: true });
		return marked.parse(text);
	}
	// Lightweight fallback
	const esc = (s) =>
		s.replace(/&/g, "&amp;")
		 .replace(/</g, "&lt;")
		 .replace(/>/g, "&gt;");

	return esc(text)
		.replace(/```[\s\S]*?```/g, (m) =>
			`<pre><code>${m.slice(3, -3).replace(/^[^\n]*\n/, "")}</code></pre>`)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/^#{3} (.+)$/gm, "<h4>$1</h4>")
		.replace(/^#{2} (.+)$/gm, "<h3>$1</h3>")
		.replace(/^# (.+)$/gm, "<h2>$1</h2>")
		.replace(/^\| (.+)$/gm, (m) => {
			const cells = m.slice(2).split(" | ").map((c) => `<td>${c}</td>`).join("");
			return `<tr>${cells}</tr>`;
		})
		.replace(/(<tr>.*<\/tr>)/gs, "<table>$1</table>")
		.replace(/^[-*] (.+)$/gm, "<li>$1</li>")
		.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		.replace(/\n\n/g, "</p><p>")
		.replace(/\n/g, "<br>");
}


// ─────────────────────────────────────────────────────────────────────────────
// Micro helpers
// ─────────────────────────────────────────────────────────────────────────────
function _userAvatar() {
	if (frappe.session.user_image) {
		return `<img src="${frappe.session.user_image}" alt="">`;
	}
	const initial = (frappe.session.user || "?")[0].toUpperCase();
	return `<span>${initial}</span>`;
}

function _copyIcon() {
	return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}

function _copyDoneIcon() {
	return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// Page-scoped styles (injected once)
// ─────────────────────────────────────────────────────────────────────────────
function _injectPageStyles() {
	if (document.getElementById("nai-page-css")) return;
	const s = document.createElement("style");
	s.id = "nai-page-css";
	s.textContent = `
/* ── Layout ─────────────────────────────────────────────────── */
.nai-page {
  display: flex;
  height: calc(100vh - 110px);
  min-height: 500px;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
}

/* ── Sidebar ─────────────────────────────────────────────────── */
.nai-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--subtle-bg);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}
.nai-sidebar-top { padding: 12px; }
.nai-new-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}
.nai-new-btn:hover { background: var(--control-bg); }
.nai-sessions {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.nai-empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 20px 8px;
}
.nai-session-item {
  position: relative;
  padding: 9px 32px 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.12s;
}
.nai-session-item:hover  { background: var(--control-bg); }
.nai-session-item.active { background: var(--highlight-color, #e8e6ff); }
.nai-session-title {
  display: block;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-color);
}
.nai-session-meta {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 1px;
}
.nai-session-del {
  position: absolute;
  top: 50%; right: 8px;
  transform: translateY(-50%);
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  line-height: 1;
}
.nai-session-item:hover .nai-session-del { display: block; }
.nai-session-del:hover { color: var(--red); }
.nai-sidebar-footer {
  padding: 10px 12px;
  border-top: 1px solid var(--border-color);
}
.nai-settings-link {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
}
.nai-settings-link:hover { color: var(--text-color); }

/* ── Main area ───────────────────────────────────────────────── */
.nai-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* ── Welcome screen ──────────────────────────────────────────── */
.nai-welcome {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
}
.nai-welcome-inner { text-align: center; max-width: 520px; padding: 24px; }
.nai-welcome-logo  { margin-bottom: 16px; }
.nai-welcome-inner h2 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
.nai-tagline { color: var(--text-muted); margin-bottom: 28px; font-size: 14px; }
.nai-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.nai-chip {
  padding: 7px 14px;
  border: 1px solid var(--border-color);
  border-radius: 20px;
  background: var(--bg-color);
  font-size: 13px;
  cursor: pointer;
  color: var(--text-color);
  transition: all 0.12s;
}
.nai-chip:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: #f0f0ff;
}

/* ── Messages ────────────────────────────────────────────────── */
.nai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 20px 8px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.nai-msg {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 85%;
}
.nai-msg-user {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.nai-msg-ai   { align-self: flex-start; }
.nai-msg-error {
  align-self: center;
  max-width: 100%;
}
.nai-msg-error .nai-bubble {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--error-bg, #fff5f5);
  color: var(--red);
  font-size: 13px;
}

/* Avatars */
.nai-av {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}
.nai-av-ai {
  background: #6366f1;
  color: white;
}
.nai-av-user {
  background: var(--primary);
  color: white;
  overflow: hidden;
}
.nai-av-user img { width: 100%; height: 100%; object-fit: cover; }
.nai-av-user span { font-size: 13px; font-weight: 600; }

/* Bubbles */
.nai-bubble {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}
.nai-msg-user .nai-bubble {
  background: #6366f1;
  color: white;
  border-bottom-right-radius: 4px;
}
.nai-msg-ai .nai-bubble {
  background: var(--subtle-bg);
  border: 1px solid var(--border-color);
  border-bottom-left-radius: 4px;
  min-width: 120px;
}

/* Markdown inside AI bubble */
.nai-content h1, .nai-content h2, .nai-content h3, .nai-content h4 {
  margin: 12px 0 6px; font-weight: 600;
}
.nai-content h2 { font-size: 15px; }
.nai-content h3, .nai-content h4 { font-size: 14px; }
.nai-content p  { margin: 0 0 8px; }
.nai-content p:last-child { margin-bottom: 0; }
.nai-content ul, .nai-content ol { padding-left: 20px; margin: 6px 0; }
.nai-content li { margin-bottom: 3px; }
.nai-content code {
  font-family: var(--monospace-font, monospace);
  font-size: 12px;
  background: rgba(0,0,0,0.06);
  padding: 1px 5px;
  border-radius: 4px;
}
.nai-content pre {
  background: #1e1e2e;
  color: #cdd6f4;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.nai-content pre code { background: none; padding: 0; color: inherit; font-size: 12px; }
.nai-content table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
  margin: 8px 0;
}
.nai-content th, .nai-content td {
  border: 1px solid var(--border-color);
  padding: 6px 10px;
  text-align: left;
}
.nai-content th { background: var(--control-bg); font-weight: 600; }
.nai-content tr:nth-child(even) { background: var(--subtle-bg); }
.nai-content a { color: #6366f1; text-decoration: underline; }

/* Bubble actions (copy btn) */
.nai-bubble-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}
.nai-copy {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  line-height: 1;
}
.nai-copy:hover { color: var(--text-color); }

/* Thinking dots */
.nai-dots { display: flex; gap: 5px; padding: 4px 2px; }
.nai-dots span {
  width: 7px; height: 7px;
  background: var(--text-muted);
  border-radius: 50%;
  animation: nai-bounce 1.2s infinite;
}
.nai-dots span:nth-child(2) { animation-delay: 0.2s; }
.nai-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes nai-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}

/* ── Input bar ───────────────────────────────────────────────── */
.nai-input-bar {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-color);
}
.nai-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--control-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 8px 8px 8px 14px;
  transition: border-color 0.15s;
}
.nai-input-wrap:focus-within { border-color: #6366f1; }
.nai-textarea {
  flex: 1;
  border: none;
  background: transparent;
  resize: none;
  outline: none;
  font-size: 14px;
  line-height: 1.5;
  max-height: 160px;
  overflow-y: auto;
  color: var(--text-color);
}
.nai-send {
  width: 34px; height: 34px;
  border-radius: 8px;
  border: none;
  background: #6366f1;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, opacity 0.15s;
}
.nai-send:hover    { background: #4f46e5; }
.nai-send:disabled { opacity: 0.5; cursor: not-allowed; }
.nai-hint {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin: 6px 0 0;
}
`;
	document.head.appendChild(s);
}
