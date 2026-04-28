import frappe
import json
import uuid
from frappe import _
from openai import OpenAI

from next_ai.api.tools import get_tools, execute_tool


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@frappe.whitelist()
def send_message(session_id, message):
	"""
	Save the user message immediately, enqueue the AI job, and return a
	stream_key. The client listens on frappe.realtime for 'next_ai_stream'
	events keyed on that stream_key. Returns in ~50ms — does not hold a worker.
	"""
	settings = frappe.get_cached_doc("Next AI Settings")

	if not settings.openai_api_key:
		frappe.throw(
			_("OpenAI API key is not configured. Please add it in Next AI Settings."),
			frappe.ValidationError,
		)

	# Resolve session
	if not session_id or session_id == "new":
		session = _create_session(message)
	else:
		session = frappe.get_doc("AI Chat Session", session_id)
		if session.user != frappe.session.user and not frappe.has_permission(
			"AI Chat Session", "write", doc=session_id
		):
			frappe.throw(_("Access denied."), frappe.PermissionError)

	# Persist user message immediately so it shows up if the page refreshes
	_save_message(session.name, "User", message)

	# Extend conversation history
	history = json.loads(session.messages_json or "[]")
	history.append({"role": "user", "content": message})
	session.messages_json = json.dumps(history, ensure_ascii=False)
	session.last_message_at = frappe.utils.now_datetime()
	session.message_count = (session.message_count or 0) + 1
	session.save(ignore_permissions=True)
	frappe.db.commit()

	# Unique key the frontend uses to filter its own stream
	stream_key = f"nai_{uuid.uuid4().hex[:16]}"

	# Enqueue — runs in a background worker, completely separate from web workers
	frappe.enqueue(
		"next_ai.api.chat._process_ai_message",
		queue="default",
		timeout=180,
		session_id=session.name,
		stream_key=stream_key,
		user=frappe.session.user,
	)

	return {
		"session_id": session.name,
		"session_title": session.session_title or message[:60],
		"stream_key": stream_key,
	}


@frappe.whitelist()
def get_sessions():
	return frappe.get_list(
		"AI Chat Session",
		filters={"user": frappe.session.user},
		fields=["name", "session_title", "last_message_at", "message_count"],
		order_by="last_message_at desc",
		limit=50,
	)


@frappe.whitelist()
def get_messages(session_id):
	session = frappe.get_doc("AI Chat Session", session_id)
	if session.user != frappe.session.user and not frappe.has_permission(
		"AI Chat Session", "read"
	):
		frappe.throw(_("Access denied."), frappe.PermissionError)

	messages = frappe.get_list(
		"AI Chat Message",
		filters={"session": session_id},
		fields=["name", "role", "content", "tokens_used", "creation"],
		order_by="creation asc",
		limit=200,
	)
	return {
		"session_title": session.session_title,
		"messages": messages,
	}


@frappe.whitelist()
def delete_session(session_id):
	session = frappe.get_doc("AI Chat Session", session_id)
	if session.user != frappe.session.user and not frappe.has_permission(
		"AI Chat Session", "delete"
	):
		frappe.throw(_("Access denied."), frappe.PermissionError)

	frappe.db.delete("AI Chat Message", {"session": session_id})
	frappe.delete_doc("AI Chat Session", session_id, ignore_permissions=True)
	frappe.db.commit()
	return {"success": True}


@frappe.whitelist()
def send_message_sync(session_id, message):
	"""
	Synchronous variant — runs the full AI loop inline in the web worker.
	No background queue, no Redis, no socket.io needed. Works out of the box.
	"""
	settings = frappe.get_cached_doc("Next AI Settings")
	if not settings.openai_api_key:
		frappe.throw(_("OpenAI API key is not configured."), frappe.ValidationError)

	if not session_id or session_id == "new":
		session = _create_session(message)
	else:
		session = frappe.get_doc("AI Chat Session", session_id)
		if session.user != frappe.session.user and not frappe.has_permission(
			"AI Chat Session", "write", doc=session_id
		):
			frappe.throw(_("Access denied."), frappe.PermissionError)

	_save_message(session.name, "User", message)

	history = json.loads(session.messages_json or "[]")
	history.append({"role": "user", "content": message})
	session.messages_json = json.dumps(history, ensure_ascii=False)
	session.last_message_at = frappe.utils.now_datetime()
	session.message_count = (session.message_count or 0) + 1
	session.save(ignore_permissions=True)
	frappe.db.commit()

	client = OpenAI(api_key=settings.get_password("openai_api_key"))
	system_prompt = _build_system_prompt(settings, frappe.session.user)

	response_text, tokens = _run_ai_loop_sync(client, history, system_prompt, settings)

	_save_message(session.name, "Assistant", response_text, tokens)

	history.append({"role": "assistant", "content": response_text})
	if len(history) > 40:
		history = history[-40:]
	session.messages_json = json.dumps(history, ensure_ascii=False)
	session.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"session_id": session.name,
		"session_title": session.session_title,
		"response": response_text,
		"tokens": tokens,
	}


@frappe.whitelist()
def clear_doctype_cache():
	"""Bust the doctype list cache — call after installing new custom doctypes."""
	frappe.cache().delete_value("next_ai:doctype_list")
	frappe.cache().delete_value("next_ai:doctype_list_v2")
	return {"success": True}


@frappe.whitelist()
def test_openai_connection():
	"""Quick connectivity check — called from Next AI Settings."""
	settings = frappe.get_cached_doc("Next AI Settings")
	if not settings.openai_api_key:
		frappe.throw(
			_("OpenAI API key is not configured. Add it in Next AI Settings first."),
			frappe.ValidationError,
		)

	try:
		from openai import OpenAI
		client = OpenAI(api_key=settings.get_password("openai_api_key"))
		# Lightweight call: list available models
		models_page = client.models.list()
		chat_models = sorted(
			{
				m.id for m in models_page.data
				if m.id.startswith("gpt") and "realtime" not in m.id and "audio" not in m.id
			},
			reverse=True,
		)
		preview = ", ".join(chat_models[:6]) or "none found"
		return {
			"success": True,
			"model": settings.openai_model or "gpt-4o",
			"available_gpt_models": preview,
		}
	except Exception as exc:
		frappe.throw(str(exc), frappe.ValidationError)


@frappe.whitelist()
def clear_session(session_id):
	session = frappe.get_doc("AI Chat Session", session_id)
	if session.user != frappe.session.user:
		frappe.throw(_("Access denied."), frappe.PermissionError)

	frappe.db.delete("AI Chat Message", {"session": session_id})
	session.messages_json = "[]"
	session.message_count = 0
	session.save(ignore_permissions=True)
	frappe.db.commit()
	return {"success": True}


# ---------------------------------------------------------------------------
# Background job (runs in a separate worker — never blocks web workers)
# ---------------------------------------------------------------------------

def _process_ai_message(session_id, stream_key, user):
	"""
	Entry point for the enqueued job. Runs the AI loop, streams tokens via
	frappe.publish_realtime, then saves the complete response to the DB.
	"""
	try:
		settings = frappe.get_cached_doc("Next AI Settings")
		client = OpenAI(api_key=settings.get_password("openai_api_key"))

		session = frappe.get_doc("AI Chat Session", session_id)
		history = json.loads(session.messages_json or "[]")

		system_prompt = _build_system_prompt(settings, user)

		response_text, tokens = _run_ai_loop_streaming(
			client, history, system_prompt, settings, stream_key, user
		)

		# Save complete response for history / page refresh
		_save_message(session_id, "Assistant", response_text, tokens)

		# Trim and persist updated history
		if len(history) > 40:
			history = history[-40:]
		session.messages_json = json.dumps(history, ensure_ascii=False)
		session.save(ignore_permissions=True)
		frappe.db.commit()

		# Signal the frontend that the stream is finished
		frappe.publish_realtime(
			event="next_ai_stream",
			message={
				"key": stream_key,
				"done": True,
				"session_id": session_id,
				"session_title": session.session_title,
				"tokens_used": tokens,
			},
			user=user,
			after_commit=False,
		)

	except Exception:
		frappe.log_error(title="Next AI streaming error", message=frappe.get_traceback())
		frappe.publish_realtime(
			event="next_ai_stream",
			message={
				"key": stream_key,
				"done": True,
				"error": "An error occurred while processing your request. Check the error log.",
			},
			user=user,
			after_commit=False,
		)


# ---------------------------------------------------------------------------
# AI streaming loop
# ---------------------------------------------------------------------------

def _run_ai_loop_sync(client, history, system_prompt, settings):
	"""Non-streaming AI loop — runs in the web request, no realtime needed."""
	messages = [{"role": "system", "content": system_prompt}] + history
	tools = get_tools(bool(settings.enable_write_actions))
	cap = min(int(settings.max_tool_calls or 5), 10)
	total_tokens = 0

	for iteration in range(cap + 1):
		resp = client.chat.completions.create(
			model=settings.openai_model or "gpt-4o",
			messages=messages,
			tools=tools,
			tool_choice="auto",
			max_tokens=int(settings.max_tokens or 4096),
			temperature=float(settings.temperature or 0.3),
		)

		if resp.usage:
			total_tokens += resp.usage.total_tokens

		choice = resp.choices[0]
		full_content = choice.message.content or ""
		tool_calls_obj = choice.message.tool_calls or []

		if not tool_calls_obj:
			history.append({"role": "assistant", "content": full_content})
			return full_content, total_tokens

		tool_calls_data = [
			{
				"id": tc.id,
				"type": "function",
				"function": {"name": tc.function.name, "arguments": tc.function.arguments},
			}
			for tc in tool_calls_obj
		]
		assistant_msg = {
			"role": "assistant",
			"content": full_content or None,
			"tool_calls": tool_calls_data,
		}
		messages.append(assistant_msg)
		history.append(assistant_msg)

		for tc in tool_calls_data:
			try:
				args = json.loads(tc["function"]["arguments"])
			except json.JSONDecodeError:
				args = {}
			result = execute_tool(tc["function"]["name"], args)
			tool_msg = {
				"role": "tool",
				"tool_call_id": tc["id"],
				"content": json.dumps(result, ensure_ascii=False, default=str),
			}
			messages.append(tool_msg)
			history.append(tool_msg)

		if iteration == cap:
			messages.append({
				"role": "user",
				"content": "Please provide your final response based on the information gathered.",
			})

	return "Could not complete within the allowed steps. Please try again.", total_tokens


def _run_ai_loop_streaming(client, history, system_prompt, settings, stream_key, user):
	"""
	Call OpenAI with stream=True. Push text tokens via publish_realtime as they
	arrive. Execute tool calls (non-streaming) between turns, then stream the
	final answer.
	"""
	messages = [{"role": "system", "content": system_prompt}] + history
	tools = get_tools(bool(settings.enable_write_actions))
	cap = min(int(settings.max_tool_calls or 5), 10)
	total_tokens = 0

	for iteration in range(cap + 1):
		full_content = ""
		tool_calls_raw = {}

		stream = client.chat.completions.create(
			model=settings.openai_model or "gpt-4o",
			messages=messages,
			tools=tools,
			tool_choice="auto",
			max_tokens=int(settings.max_tokens or 4096),
			temperature=float(settings.temperature or 0.3),
			stream=True,
			stream_options={"include_usage": True},
		)

		for chunk in stream:
			# Usage-only chunk arrives last when stream_options include_usage=True
			if not chunk.choices:
				if chunk.usage:
					total_tokens += chunk.usage.total_tokens
				continue

			delta = chunk.choices[0].delta

			# ── Text token ────────────────────────────────────────────────
			if delta.content:
				full_content += delta.content
				frappe.publish_realtime(
					event="next_ai_stream",
					message={"key": stream_key, "token": delta.content, "done": False},
					user=user,
					after_commit=False,
				)

			# ── Tool call chunks (accumulate across chunks) ───────────────
			if delta.tool_calls:
				for tc_delta in delta.tool_calls:
					i = tc_delta.index
					if i not in tool_calls_raw:
						tool_calls_raw[i] = {"id": "", "name": "", "arguments": ""}
					if tc_delta.id:
						tool_calls_raw[i]["id"] = tc_delta.id
					if tc_delta.function:
						if tc_delta.function.name:
							tool_calls_raw[i]["name"] += tc_delta.function.name
						if tc_delta.function.arguments:
							tool_calls_raw[i]["arguments"] += tc_delta.function.arguments

		# ── No tool calls → final response ───────────────────────────────
		if not tool_calls_raw:
			history.append({"role": "assistant", "content": full_content})
			return full_content, total_tokens

		# ── Tool calls present ────────────────────────────────────────────
		tool_calls_data = [
			{
				"id": tool_calls_raw[i]["id"],
				"type": "function",
				"function": {
					"name": tool_calls_raw[i]["name"],
					"arguments": tool_calls_raw[i]["arguments"],
				},
			}
			for i in sorted(tool_calls_raw.keys())
		]

		assistant_msg = {
			"role": "assistant",
			"content": full_content or None,
			"tool_calls": tool_calls_data,
		}
		messages.append(assistant_msg)
		history.append(assistant_msg)

		# Tell the frontend the AI is now querying data
		frappe.publish_realtime(
			event="next_ai_stream",
			message={"key": stream_key, "tool_start": True, "done": False},
			user=user,
			after_commit=False,
		)

		for tc in tool_calls_data:
			try:
				args = json.loads(tc["function"]["arguments"])
			except json.JSONDecodeError:
				args = {}

			result = execute_tool(tc["function"]["name"], args)
			tool_msg = {
				"role": "tool",
				"tool_call_id": tc["id"],
				"content": json.dumps(result, ensure_ascii=False, default=str),
			}
			messages.append(tool_msg)
			history.append(tool_msg)

		frappe.publish_realtime(
			event="next_ai_stream",
			message={"key": stream_key, "tool_end": True, "done": False},
			user=user,
			after_commit=False,
		)

		# Force final answer after hitting the cap
		if iteration == cap:
			messages.append({
				"role": "user",
				"content": "Please provide your final response based on the information gathered.",
			})

	return "Could not complete within the allowed steps. Please try again.", total_tokens


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_session(first_message):
	title = (first_message[:57] + "...") if len(first_message) > 60 else first_message
	session = frappe.new_doc("AI Chat Session")
	session.user = frappe.session.user
	session.session_title = title
	session.messages_json = "[]"
	session.message_count = 0
	session.insert(ignore_permissions=True)
	return session


def _save_message(session_id, role, content, tokens=None):
	msg = frappe.new_doc("AI Chat Message")
	msg.session = session_id
	msg.role = role
	msg.content = content
	msg.creation_time = frappe.utils.now_datetime()
	if tokens:
		msg.tokens_used = tokens
	msg.insert(ignore_permissions=True)


def _build_system_prompt(settings, user=None):
	user = user or frappe.session.user
	try:
		user_name = frappe.get_cached_doc("User", user).full_name or user
	except Exception:
		user_name = user

	try:
		company = (
			frappe.db.get_single_value("Global Defaults", "default_company") or "your company"
		)
	except Exception:
		company = "your company"

	dt = _get_doctype_list()

	custom_section = ""
	if dt["custom"]:
		custom_section = (
			f"\nCUSTOM DocTypes (specific to this company — always check these first):\n"
			+ ", ".join(dt["custom"])
		)

	standard_names = dt["standard"]
	std_summary = ", ".join(standard_names[:120])
	if len(standard_names) > 120:
		std_summary += f" … and {len(standard_names) - 120} more"

	prompt = f"""You are Next AI, an intelligent ERPNext/Frappe assistant.
You help users understand their business data, query records, and navigate the system.

Context:
- Today: {frappe.utils.today()}
- User: {user_name} ({user})
- Company: {company}
{custom_section}

Standard ERPNext/Frappe DocTypes:
{std_summary}

━━━ CRITICAL RULES — follow these exactly ━━━

1. ALWAYS use tools. Never state facts, counts, or record details without querying first.

2. UNKNOWN DOCTYPE? → call find_doctype IMMEDIATELY.
   - User says "posto" → call find_doctype("posto")
   - User says "vigilância" → call find_doctype("vigilancia")
   - User mentions anything not in your lists above → call find_doctype with that term
   - Never assume something doesn't exist without calling find_doctype first.

3. ZERO RESULTS from search_records or get_count?
   → Before saying "no records", call find_doctype to confirm the DocType name is correct.
   → Then try again with the confirmed name.

4. LANGUAGE: Users may speak Portuguese, Spanish, or other languages.
   Their words are often translations of DocType names. Always search.

5. CUSTOM DOCTYPES take priority. If a user's term matches a custom DocType,
   that is almost certainly what they mean.

━━━ Response style ━━━
- Markdown: tables for data, bullet lists for enumerations
- Include currency symbols for monetary values
- Embed navigate_to URLs as markdown links when referencing records
- Be concise but complete"""

	if settings.custom_system_prompt:
		prompt += f"\n\nAdditional instructions:\n{settings.custom_system_prompt}"

	return prompt


def _get_doctype_list():
	cache_key = "next_ai:doctype_list_v2"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	custom = frappe.db.get_all(
		"DocType",
		filters={"istable": 0, "issingle": 0, "custom": 1},
		pluck="name",
		order_by="name asc",
	)
	standard = frappe.db.get_all(
		"DocType",
		filters={"istable": 0, "issingle": 0, "custom": 0, "module": ["!=", "Core"]},
		pluck="name",
		order_by="name asc",
		limit=500,
	)

	result = {"custom": custom, "standard": standard}
	frappe.cache().set_value(cache_key, result, expires_in_sec=3600)
	return result
