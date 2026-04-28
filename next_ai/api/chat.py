import frappe
import json
from frappe import _
from openai import OpenAI

from next_ai.api.tools import get_tools, execute_tool


# ---------------------------------------------------------------------------
# Public API endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def send_message(session_id, message):
	"""
	Process a user message and return the AI response.
	Creates a new session if session_id == 'new'.
	"""
	settings = frappe.get_cached_doc("Next AI Settings")

	if not settings.openai_api_key:
		frappe.throw(
			_("OpenAI API key is not configured. Please add it in Next AI Settings."),
			frappe.ValidationError,
		)

	client = OpenAI(api_key=settings.get_password("openai_api_key"))

	# Resolve session
	if not session_id or session_id == "new":
		session = _create_session(message)
	else:
		session = frappe.get_doc("AI Chat Session", session_id)
		if session.user != frappe.session.user and not frappe.has_permission(
			"AI Chat Session", "write", doc=session_id
		):
			frappe.throw(_("Access denied."), frappe.PermissionError)

	# Load history and append new user turn
	history = json.loads(session.messages_json or "[]")
	history.append({"role": "user", "content": message})

	# Persist the user message for the display log
	_save_message(session.name, "User", message)

	# Run AI conversation loop
	system_prompt = _build_system_prompt(settings)
	response_text, tokens = _run_ai_loop(client, history, system_prompt, settings)

	# Persist AI response for the display log
	_save_message(session.name, "Assistant", response_text, tokens)

	# Keep history bounded to last 40 messages to manage token cost
	if len(history) > 40:
		history = history[-40:]

	session.messages_json = json.dumps(history, ensure_ascii=False)
	session.last_message_at = frappe.utils.now_datetime()
	session.message_count = (session.message_count or 0) + 1
	session.save(ignore_permissions=True)
	frappe.db.commit()

	return {
		"session_id": session.name,
		"session_title": session.session_title or message[:60],
		"response": response_text,
		"tokens_used": tokens,
	}


@frappe.whitelist()
def get_sessions():
	"""Return the current user's chat sessions, most recent first."""
	return frappe.get_list(
		"AI Chat Session",
		filters={"user": frappe.session.user},
		fields=["name", "session_title", "last_message_at", "message_count"],
		order_by="last_message_at desc",
		limit=50,
	)


@frappe.whitelist()
def get_messages(session_id):
	"""Return display messages for a session."""
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
	"""Delete a session and all its messages."""
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
def clear_session(session_id):
	"""Clear all messages from a session but keep the session itself."""
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
# Internal helpers
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


def _build_system_prompt(settings):
	"""Compose the AI system prompt with live ERP context."""
	user = frappe.session.user
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

	doctype_list = _get_doctype_list()
	dt_summary = ", ".join(doctype_list[:100])
	if len(doctype_list) > 100:
		dt_summary += f" … and {len(doctype_list) - 100} more"

	prompt = f"""You are Next AI, an intelligent assistant embedded in ERPNext/Frappe.
You help users understand their business data, query records, and navigate the ERP system through natural conversation.

Context:
- Today: {frappe.utils.today()}
- User: {user_name} ({user})
- Company: {company}

DocTypes available in this system:
{dt_summary}

You have live tools to query the database. Always use them to fetch real data before making factual statements.

Guidelines:
- Use tools before stating facts about specific records or counts
- Format data with markdown: tables for comparisons, bullet lists for enumerations
- Include currency when showing monetary values
- Use navigate_to and embed the URL as a markdown link when referencing a record
- If initial filters yield no results, try broadening the search
- Keep responses concise but complete
- You only see data the current user is permitted to access"""

	if settings.custom_system_prompt:
		prompt += f"\n\nAdditional instructions:\n{settings.custom_system_prompt}"

	return prompt


def _get_doctype_list():
	"""Cached list of queryable (non-table, non-single) doctypes."""
	cache_key = "next_ai:doctype_list"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	result = frappe.db.get_all(
		"DocType",
		filters={"istable": 0, "issingle": 0, "module": ["!=", "Core"]},
		pluck="name",
		order_by="name asc",
		limit=500,
	)
	frappe.cache().set_value(cache_key, result, expires_in_sec=3600)
	return result


def _run_ai_loop(client, history, system_prompt, settings):
	"""
	Send messages to OpenAI, execute any tool calls, and loop until
	a final text response is produced or the tool-call cap is reached.
	"""
	messages = [{"role": "system", "content": system_prompt}] + history
	tools = get_tools(bool(settings.enable_write_actions))
	cap = min(int(settings.max_tool_calls or 5), 10)
	total_tokens = 0

	for iteration in range(cap + 1):
		response = client.chat.completions.create(
			model=settings.openai_model or "gpt-4o",
			messages=messages,
			tools=tools,
			tool_choice="auto",
			max_tokens=int(settings.max_tokens or 4096),
			temperature=float(settings.temperature or 0.3),
		)

		choice = response.choices[0]
		if response.usage:
			total_tokens += response.usage.total_tokens

		# ── Final text response ──────────────────────────────────────────
		if choice.finish_reason == "stop" or not choice.message.tool_calls:
			final = choice.message.content or ""
			history.append({"role": "assistant", "content": final})
			return final, total_tokens

		# ── Tool calls ───────────────────────────────────────────────────
		tool_calls_data = [
			{
				"id": tc.id,
				"type": "function",
				"function": {
					"name": tc.function.name,
					"arguments": tc.function.arguments,
				},
			}
			for tc in choice.message.tool_calls
		]

		assistant_msg = {
			"role": "assistant",
			"content": choice.message.content,
			"tool_calls": tool_calls_data,
		}
		messages.append(assistant_msg)
		history.append(assistant_msg)

		for tc in choice.message.tool_calls:
			try:
				args = json.loads(tc.function.arguments)
			except json.JSONDecodeError:
				args = {}

			result = execute_tool(tc.function.name, args)
			tool_msg = {
				"role": "tool",
				"tool_call_id": tc.id,
				"content": json.dumps(result, ensure_ascii=False, default=str),
			}
			messages.append(tool_msg)
			history.append(tool_msg)

		# After hitting the cap, ask for a final answer
		if iteration == cap:
			messages.append({
				"role": "user",
				"content": "Please provide your final response based on the information gathered.",
			})

	return "I was unable to complete the request within the allowed steps. Please try again.", total_tokens
