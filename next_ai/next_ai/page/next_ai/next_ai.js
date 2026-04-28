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
class NextAIPage {
	constructor(wrapper) {
		this.wrapper         = wrapper;
		this.session_id      = null;
		this.is_loading      = false;
		this._stream_handler = null;
		this._current_stream = null;  // holds bubble refs + accumulated text
		this._timeout_id     = null;  // guards against hung background jobs

		this._render();
		this._bind();
		this.load_sessions();
	}

	on_show() { this.$input().focus(); }

	$el(sel) { return $(this.wrapper).find(sel); }
	$input()  { return this.$el("#nai-input"); }
	$send()   { return this.$el("#nai-send"); }
	$msgs()   { return this.$el("#nai-messages"); }

	// ── Layout ──────────────────────────────────────────────────────────────
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
          ${_sendIcon()}
        </button>
      </div>
      <p class="nai-hint">${__("Enter to send · Shift+Enter for new line")}</p>
    </div>
  </main>
</div>`);
	}

	// ── Events ───────────────────────────────────────────────────────────────
	_bind() {
		this.$input().on("input", function () {
			this.style.height = "auto";
			this.style.height = Math.min(this.scrollHeight, 160) + "px";
		});

		this.$input().on("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				if (this.is_loading) this.stop_stream();
				else this.send();
			}
		});

		this.$send().on("click", () => {
			if (this.is_loading) this.stop_stream();
			else this.send();
		});

		this.$el("#nai-new-chat").on("click", () => this.new_chat());

		this.$el("#nai-sessions").on("click", ".nai-session-item", (e) => {
			if ($(e.target).closest(".nai-session-del").length) return;
			this.load_session($(e.currentTarget).data("id"));
		});

		this.$el("#nai-sessions").on("click", ".nai-session-del", (e) => {
			e.stopPropagation();
			this.delete_session($(e.currentTarget).closest(".nai-session-item").data("id"));
		});

		this.$el("#nai-chips").on("click", ".nai-chip", (e) => {
			this.$input().val($(e.currentTarget).text().trim());
			this.send();
		});

		// In-app navigation for links in AI responses
		$(this.wrapper).on("click", ".nai-bubble a[href^='/app/']", function (e) {
			e.preventDefault();
			frappe.set_route($(this).attr("href").replace(/^\/app\//, "").split("/"));
		});

		// Copy button
		$(this.wrapper).on("click", ".nai-copy", function () {
			const text = $(this).closest(".nai-bubble").find(".nai-content").text();
			navigator.clipboard.writeText(text).then(() => {
				const $b = $(this);
				$b.html(_copyDoneIcon());
				setTimeout(() => $b.html(_copyIcon()), 2000);
			});
		});
	}

	// ── Session management ───────────────────────────────────────────────────
	load_sessions() {
		frappe.call({
			method: "next_ai.api.chat.get_sessions",
			callback: (r) => {
				const sessions = r.message || [];
				const $list = this.$el("#nai-sessions");
				$list.empty();

				if (!sessions.length) {
					$list.html(`<p class="nai-empty-hint">${__("No conversations yet")}</p>`);
					return;
				}
				sessions.forEach((s) => {
					const active = s.name === this.session_id ? " active" : "";
					$list.append(`
<div class="nai-session-item${active}" data-id="${s.name}">
  <span class="nai-session-title">${frappe.utils.escape_html(s.session_title || __("Untitled"))}</span>
  <span class="nai-session-meta">${frappe.datetime.prettyDate(s.last_message_at || s.creation)}</span>
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
				this.$el("#nai-welcome").hide();
				this.$msgs().show().empty();
				(r.message.messages || []).forEach((m) => {
					this._append_msg(m.role.toLowerCase(), m.content);
				});
				this._scroll_bottom();
			},
		});
	}

	new_chat() {
		// Cancel any in-flight stream silently before clearing the UI
		this.stop_stream(true);
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

	// ── Send & streaming ─────────────────────────────────────────────────────
	send() {
		if (this.is_loading) return;
		const message = this.$input().val().trim();
		if (!message) return;

		this.$input().val("").css("height", "auto");
		this.$el("#nai-welcome").hide();
		this.$msgs().show();

		this._append_msg("user", message);

		// Create the AI bubble that tokens will stream into
		const { $bubble, $content, $tool_row, $actions } = this._create_stream_bubble();

		// Store refs immediately so stop_stream() can access them
		this._current_stream = { $bubble, $content, $tool_row, $actions, raw_text: "" };

		this.is_loading = true;
		this._update_send();

		frappe.call({
			method: "next_ai.api.chat.send_message",
			args: { session_id: this.session_id || "new", message },

			callback: (r) => {
				if (!r.message) {
					this._stream_error($bubble, $content, __("No response from server."));
					this._reset_loading();
					return;
				}

				const { session_id, stream_key } = r.message;
				this.session_id = session_id;

				// Show session in sidebar immediately — don't wait for streaming to finish
				this.load_sessions();

				let raw_text  = "";
				let got_token = false;

				// Clean up any previous listener
				if (this._stream_handler) {
					frappe.realtime.off("next_ai_stream", this._stream_handler);
				}

				// Safety net: if the background worker is not running or Redis/socketio
				// is unavailable, the dots would spin forever. Surface a clear error.
				this._timeout_id = setTimeout(() => {
					if (!this.is_loading) return;
					frappe.realtime.off("next_ai_stream", this._stream_handler);
					this._stream_handler = null;
					this._stream_error($bubble, $content,
						__("No response after 45 seconds. Make sure the Frappe worker is running: bench worker") +
						(got_token ? "" : __(" — also check that Redis and socket.io are running."))
					);
					this._reset_loading();
				}, 45000);

				this._stream_handler = (data) => {
					if (data.key !== stream_key) return;

					if (data.token) {
						if (!got_token) {
							$content.empty();
							got_token = true;
						}
						raw_text += data.token;
						// Keep current_stream in sync for stop_stream()
						if (this._current_stream) this._current_stream.raw_text = raw_text;
						$content.text(raw_text);
						this._scroll_bottom();
					}

					if (data.tool_start) {
						$tool_row.show();
						this._scroll_bottom();
					}

					if (data.tool_end) {
						$tool_row.hide();
					}

					if (data.done) {
						clearTimeout(this._timeout_id);
						this._timeout_id = null;
						frappe.realtime.off("next_ai_stream", this._stream_handler);
						this._stream_handler = null;
						this._current_stream = null;

						if (data.error) {
							this._stream_error($bubble, $content, data.error);
						} else {
							$content.html(_renderMd(raw_text || ""));
							$actions.show();
							this._scroll_bottom();
							this.load_sessions();
						}

						this._reset_loading();
					}
				};

				frappe.realtime.on("next_ai_stream", this._stream_handler);
			},

			error: () => {
				this._stream_error($bubble, $content, __("Failed to send message. Please try again."));
				this._reset_loading();
			},
		});
	}

	// ── Stop / interrupt ─────────────────────────────────────────────────────
	// silent=true when called from new_chat() — don't try to render into a cleared DOM
	stop_stream(silent = false) {
		if (!this.is_loading) return;

		if (this._timeout_id) { clearTimeout(this._timeout_id); this._timeout_id = null; }

		if (this._stream_handler) {
			frappe.realtime.off("next_ai_stream", this._stream_handler);
			this._stream_handler = null;
		}

		if (!silent) {
			const s = this._current_stream;
			if (s) {
				if (s.raw_text) {
					s.$content.html(
						_renderMd(s.raw_text) +
						`<p class="nai-stopped-hint">${__("— generation stopped —")}</p>`
					);
				} else {
					s.$content.html(
						`<span class="nai-stopped-hint">${__("— stopped before response —")}</span>`
					);
				}
				s.$actions.show();
			}
		}

		this._current_stream = null;
		this._reset_loading();
	}

	// ── DOM helpers ──────────────────────────────────────────────────────────
	_reset_loading() {
		if (this._timeout_id) { clearTimeout(this._timeout_id); this._timeout_id = null; }
		this.is_loading = false;
		this._update_send();
	}

	_append_msg(role, content) {
		const is_user = role === "user";
		const av = is_user
			? `<div class="nai-av nai-av-user">${_userAvatar()}</div>`
			: `<div class="nai-av nai-av-ai">${_aiIcon()}</div>`;

		const body = is_user
			? `<div class="nai-content">${frappe.utils.escape_html(content).replace(/\n/g, "<br>")}</div>`
			: `<div class="nai-content">${_renderMd(content)}</div>
         <div class="nai-bubble-actions">
           <button class="nai-copy" title="${__("Copy")}">${_copyIcon()}</button>
         </div>`;

		const $msg = $(`
<div class="nai-msg ${is_user ? "nai-msg-user" : "nai-msg-ai"}">
  ${is_user ? "" : av}
  <div class="nai-bubble">${body}</div>
  ${is_user ? av : ""}
</div>`);
		this.$msgs().append($msg);
		this._scroll_bottom();
		return $msg;
	}

	_create_stream_bubble() {
		const $msg = $(`
<div class="nai-msg nai-msg-ai">
  <div class="nai-av nai-av-ai">${_aiIcon()}</div>
  <div class="nai-bubble">
    <div class="nai-tool-row" style="display:none">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <span>${__("Querying data…")}</span>
    </div>
    <div class="nai-content">
      <div class="nai-dots"><span></span><span></span><span></span></div>
    </div>
    <div class="nai-bubble-actions" style="display:none">
      <button class="nai-copy" title="${__("Copy")}">${_copyIcon()}</button>
    </div>
  </div>
</div>`);
		this.$msgs().append($msg);
		this._scroll_bottom();

		return {
			$bubble:   $msg.find(".nai-bubble"),
			$content:  $msg.find(".nai-content"),
			$tool_row: $msg.find(".nai-tool-row"),
			$actions:  $msg.find(".nai-bubble-actions"),
		};
	}

	_stream_error($bubble, $content, msg) {
		$content.html(
			`<span class="nai-error-text">${frappe.utils.escape_html(msg)}</span>`
		);
	}

	_scroll_bottom() {
		const el = this.$msgs()[0];
		if (el) el.scrollTop = el.scrollHeight;
	}

	_update_send() {
		const $btn = this.$send();
		if (this.is_loading) {
			$btn
				.prop("disabled", false)
				.addClass("nai-send-stop")
				.attr("title", __("Stop generation"))
				.html(_stopIcon());
		} else {
			$btn
				.prop("disabled", false)
				.removeClass("nai-send-stop")
				.attr("title", __("Send"))
				.html(_sendIcon());
		}
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
	const esc = (s) =>
		s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return esc(text)
		.replace(/```[\s\S]*?```/g, (m) =>
			`<pre><code>${m.slice(3, -3).replace(/^[^\n]*\n/, "")}</code></pre>`)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/^#{3} (.+)$/gm, "<h4>$1</h4>")
		.replace(/^#{2} (.+)$/gm, "<h3>$1</h3>")
		.replace(/^# (.+)$/gm, "<h2>$1</h2>")
		.replace(/^- (.+)$/gm, "<li>$1</li>")
		.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		.replace(/\n\n/g, "</p><p>")
		.replace(/\n/g, "<br>");
}


// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────
function _sendIcon() {
	return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
}

function _stopIcon() {
	return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`;
}

function _aiIcon() {
	return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>`;
}

function _userAvatar() {
	if (frappe.session.user_image)
		return `<img src="${frappe.session.user_image}" alt="">`;
	return `<span>${(frappe.session.user || "?")[0].toUpperCase()}</span>`;
}

function _copyIcon() {
	return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
}

function _copyDoneIcon() {
	return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
}


// ─────────────────────────────────────────────────────────────────────────────
// Page styles
// ─────────────────────────────────────────────────────────────────────────────
function _injectPageStyles() {
	if (document.getElementById("nai-page-css")) return;
	const s = document.createElement("style");
	s.id = "nai-page-css";
	s.textContent = `
/* ── Layout shell ─────────────────────────────────────────── */
.nai-page {
  display: flex;
  height: calc(100vh - 110px);
  min-height: 500px;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
}

/* ── Sidebar ──────────────────────────────────────────────── */
.nai-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #e8eaee;
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}
/* Dark-mode override – Frappe uses data-theme-mode or .dark-theme */
html[data-theme-mode="dark"] .nai-sidebar,
body.dark-theme .nai-sidebar,
[data-theme="dark"] .nai-sidebar { background: #1a1d2e; }

.nai-sidebar-top { padding: 12px; }

.nai-new-btn {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 8px 12px;
  border: 1px solid rgba(99,102,241,0.3); border-radius: 8px;
  background: rgba(99,102,241,0.08); color: #6366f1;
  font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.15s;
}
.nai-new-btn:hover { background: rgba(99,102,241,0.15); }

.nai-sessions { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.nai-empty-hint { font-size: 12px; color: var(--text-muted); text-align: center; padding: 20px 8px; }

.nai-session-item {
  position: relative; padding: 9px 32px 9px 10px;
  border-radius: 8px; cursor: pointer; margin-bottom: 2px; transition: background 0.12s;
}
.nai-session-item:hover  { background: rgba(0,0,0,0.06); }
html[data-theme-mode="dark"] .nai-session-item:hover,
body.dark-theme .nai-session-item:hover { background: rgba(255,255,255,0.07); }
.nai-session-item.active { background: rgba(99,102,241,0.18); }

.nai-session-title {
  display: block; font-size: 13px; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: var(--text-color);
}
.nai-session-item.active .nai-session-title { color: #6366f1; }
.nai-session-meta { display: block; font-size: 11px; color: var(--text-muted); margin-top: 1px; }

.nai-session-del {
  position: absolute; top: 50%; right: 8px; transform: translateY(-50%);
  display: none; background: none; border: none; cursor: pointer;
  color: var(--text-muted); padding: 2px; line-height: 1;
}
.nai-session-item:hover .nai-session-del { display: block; }
.nai-session-del:hover { color: var(--red); }

.nai-sidebar-footer { padding: 10px 12px; border-top: 1px solid var(--border-color); }
.nai-settings-link {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--text-muted); text-decoration: none;
}
.nai-settings-link:hover { color: var(--text-color); }

/* ── Main chat area ───────────────────────────────────────── */
.nai-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; background: var(--bg-color); }
.nai-welcome { flex: 1; display: flex; align-items: center; justify-content: center; overflow-y: auto; }
.nai-welcome-inner { text-align: center; max-width: 520px; padding: 24px; }
.nai-welcome-logo { margin-bottom: 16px; }
.nai-welcome-inner h2 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
.nai-tagline { color: var(--text-muted); margin-bottom: 28px; font-size: 14px; }
.nai-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.nai-chip {
  padding: 7px 14px; border: 1px solid var(--border-color); border-radius: 20px;
  background: var(--bg-color); font-size: 13px; cursor: pointer; color: var(--text-color); transition: all 0.12s;
}
.nai-chip:hover { border-color: #6366f1; color: #6366f1; background: rgba(99,102,241,0.06); }

/* ── Messages ─────────────────────────────────────────────── */
.nai-messages { flex: 1; overflow-y: auto; padding: 20px 20px 8px; display: flex; flex-direction: column; gap: 16px; }
.nai-msg { display: flex; align-items: flex-start; gap: 10px; max-width: 85%; }
.nai-msg-user { align-self: flex-end; flex-direction: row-reverse; }
.nai-msg-ai   { align-self: flex-start; }

.nai-av {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
}
.nai-av-ai   { background: #6366f1; color: white; }
.nai-av-user { background: var(--primary); color: white; overflow: hidden; }
.nai-av-user img  { width: 100%; height: 100%; object-fit: cover; }
.nai-av-user span { font-size: 13px; font-weight: 600; }

/* User bubble – indigo pill */
.nai-msg-user .nai-bubble {
  padding: 10px 14px; border-radius: 14px; border-bottom-right-radius: 4px;
  font-size: 14px; line-height: 1.6; word-break: break-word;
  background: #6366f1; color: white;
}

/* AI bubble – white card, clearly distinct from gray sidebar */
.nai-msg-ai .nai-bubble {
  padding: 10px 14px; border-radius: 14px; border-bottom-left-radius: 4px;
  font-size: 14px; line-height: 1.6; word-break: break-word;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 4px rgba(0,0,0,0.07);
  min-width: 120px;
}

.nai-tool-row { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }

/* Markdown content */
.nai-content h2 { font-size: 15px; font-weight: 600; margin: 12px 0 6px; }
.nai-content h3, .nai-content h4 { font-size: 14px; font-weight: 600; margin: 10px 0 4px; }
.nai-content p  { margin: 0 0 8px; }
.nai-content p:last-child { margin-bottom: 0; }
.nai-content ul, .nai-content ol { padding-left: 20px; margin: 6px 0; }
.nai-content li { margin-bottom: 3px; }
.nai-content code { font-family: var(--monospace-font, monospace); font-size: 12px; background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px; }
.nai-content pre { background: #1e1e2e; color: #cdd6f4; border-radius: 8px; padding: 12px; overflow-x: auto; margin: 8px 0; }
.nai-content pre code { background: none; padding: 0; color: inherit; font-size: 12px; }
.nai-content table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0; }
.nai-content th, .nai-content td { border: 1px solid var(--border-color); padding: 6px 10px; text-align: left; }
.nai-content th { background: var(--control-bg); font-weight: 600; }
.nai-content tr:nth-child(even) { background: var(--subtle-bg); }
.nai-content a { color: #6366f1; text-decoration: underline; }

.nai-bubble-actions { margin-top: 6px; display: flex; gap: 6px; }
.nai-copy { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px; line-height: 1; }
.nai-copy:hover { color: var(--text-color); }

/* Stopped / error indicators */
.nai-stopped-hint { font-size: 11px; color: var(--text-muted); margin: 8px 0 0; font-style: italic; }
.nai-error-text { color: var(--red); }

/* Loading dots */
.nai-dots { display: flex; gap: 5px; padding: 4px 2px; }
.nai-dots span { width: 7px; height: 7px; background: var(--text-muted); border-radius: 50%; animation: nai-bounce 1.2s infinite; }
.nai-dots span:nth-child(2) { animation-delay: 0.2s; }
.nai-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes nai-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

/* ── Input bar ────────────────────────────────────────────── */
.nai-input-bar { padding: 12px 20px 16px; border-top: 1px solid var(--border-color); background: var(--bg-color); }
.nai-input-wrap {
  display: flex; align-items: flex-end; gap: 8px;
  background: var(--control-bg); border: 1px solid var(--border-color);
  border-radius: 12px; padding: 8px 8px 8px 14px; transition: border-color 0.15s;
}
.nai-input-wrap:focus-within { border-color: #6366f1; }
.nai-textarea {
  flex: 1; border: none; background: transparent; resize: none; outline: none;
  font-size: 14px; line-height: 1.5; max-height: 160px; overflow-y: auto; color: var(--text-color);
}

/* Send button – indigo; becomes red stop button while streaming */
.nai-send {
  width: 34px; height: 34px; border-radius: 8px; border: none;
  background: #6366f1; color: white;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: background 0.15s;
}
.nai-send:hover { background: #4f46e5; }
.nai-send:disabled { opacity: 0.5; cursor: not-allowed; }
.nai-send.nai-send-stop { background: #ef4444; }
.nai-send.nai-send-stop:hover { background: #dc2626; }

.nai-hint { font-size: 11px; color: var(--text-muted); text-align: center; margin: 6px 0 0; }
`;
	document.head.appendChild(s);
}
