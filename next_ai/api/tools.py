import frappe
import json
from frappe import _


# ---------------------------------------------------------------------------
# Tool definitions (OpenAI function-calling format)
# ---------------------------------------------------------------------------

def get_tools(enable_write=False):
	"""Return the list of tool definitions to send to OpenAI."""
	tools = [
		{
			"type": "function",
			"function": {
				"name": "search_records",
				"description": (
					"Search and list records from any ERPNext/Frappe DocType. "
					"Use this to query data, get lists, and find records matching filters."
				),
				"parameters": {
					"type": "object",
					"properties": {
						"doctype": {
							"type": "string",
							"description": "DocType name, e.g. 'Sales Invoice', 'Customer', 'Item', 'Employee'"
						},
						"filters": {
							"type": "object",
							"description": (
								"Filter conditions as field:value pairs. "
								"Example: {\"status\": \"Open\", \"customer\": \"Acme Corp\"}"
							)
						},
						"fields": {
							"type": "array",
							"items": {"type": "string"},
							"description": "Fields to return. Omit for sensible defaults."
						},
						"limit": {
							"type": "integer",
							"description": "Max records to return (default 20, max 100)"
						},
						"order_by": {
							"type": "string",
							"description": "Sort order, e.g. 'grand_total desc' or 'posting_date desc'"
						}
					},
					"required": ["doctype"]
				}
			}
		},
		{
			"type": "function",
			"function": {
				"name": "get_record",
				"description": "Fetch full details of a specific record by its name/ID.",
				"parameters": {
					"type": "object",
					"properties": {
						"doctype": {"type": "string"},
						"name": {"type": "string", "description": "The record name or document ID"}
					},
					"required": ["doctype", "name"]
				}
			}
		},
		{
			"type": "function",
			"function": {
				"name": "get_schema",
				"description": "Get the field structure of a DocType to understand what data it holds before querying.",
				"parameters": {
					"type": "object",
					"properties": {
						"doctype": {"type": "string"}
					},
					"required": ["doctype"]
				}
			}
		},
		{
			"type": "function",
			"function": {
				"name": "get_count",
				"description": "Count records in a DocType matching optional filters.",
				"parameters": {
					"type": "object",
					"properties": {
						"doctype": {"type": "string"},
						"filters": {"type": "object"}
					},
					"required": ["doctype"]
				}
			}
		},
		{
			"type": "function",
			"function": {
				"name": "get_report",
				"description": "Run a saved Frappe/ERPNext report and return its results.",
				"parameters": {
					"type": "object",
					"properties": {
						"report_name": {"type": "string", "description": "Exact report name"},
						"filters": {"type": "object", "description": "Report filter values"}
					},
					"required": ["report_name"]
				}
			}
		},
		{
			"type": "function",
			"function": {
				"name": "navigate_to",
				"description": (
					"Generate a navigation URL to a record or list view. "
					"Always include the returned URL as a markdown link in your response."
				),
				"parameters": {
					"type": "object",
					"properties": {
						"doctype": {"type": "string"},
						"name": {
							"type": "string",
							"description": "Optional: record name for a direct link. Omit for list view."
						}
					},
					"required": ["doctype"]
				}
			}
		}
	]

	if enable_write:
		tools.extend([
			{
				"type": "function",
				"function": {
					"name": "create_record",
					"description": "Create a new record. Only call when the user explicitly asks to create something.",
					"parameters": {
						"type": "object",
						"properties": {
							"doctype": {"type": "string"},
							"data": {
								"type": "object",
								"description": "Field values for the new record"
							}
						},
						"required": ["doctype", "data"]
					}
				}
			},
			{
				"type": "function",
				"function": {
					"name": "update_record",
					"description": "Update fields on an existing record. Only call when explicitly asked.",
					"parameters": {
						"type": "object",
						"properties": {
							"doctype": {"type": "string"},
							"name": {"type": "string"},
							"data": {
								"type": "object",
								"description": "Fields and values to update"
							}
						},
						"required": ["doctype", "name", "data"]
					}
				}
			}
		])

	return tools


# ---------------------------------------------------------------------------
# Tool dispatcher
# ---------------------------------------------------------------------------

def execute_tool(tool_name, args):
	"""Execute a named tool and return a JSON-serialisable result."""
	handlers = {
		"search_records": _search_records,
		"get_record":     _get_record,
		"get_schema":     _get_schema,
		"get_count":      _get_count,
		"get_report":     _get_report,
		"navigate_to":    _navigate_to,
		"create_record":  _create_record,
		"update_record":  _update_record,
	}

	handler = handlers.get(tool_name)
	if not handler:
		return {"error": f"Unknown tool: {tool_name}"}

	try:
		return handler(**args)
	except frappe.PermissionError as e:
		return {"error": f"Permission denied: {e}"}
	except Exception as e:
		frappe.log_error(title=f"Next AI – tool error: {tool_name}", message=frappe.get_traceback())
		return {"error": str(e)}


# ---------------------------------------------------------------------------
# Individual tool implementations
# ---------------------------------------------------------------------------

def _search_records(doctype, filters=None, fields=None, limit=20, order_by=None):
	if not frappe.has_permission(doctype, "read"):
		return {"error": f"No read permission for {doctype}"}

	limit = min(int(limit or 20), 100)

	kwargs = {
		"doctype": doctype,
		"filters": filters or {},
		"fields": fields or _default_fields(doctype),
		"limit_page_length": limit,
		"ignore_permissions": False,
	}
	if order_by:
		kwargs["order_by"] = order_by

	try:
		records = frappe.get_list(**kwargs)
	except Exception:
		# Fallback: try with just name
		kwargs["fields"] = ["name"]
		try:
			records = frappe.get_list(**kwargs)
		except Exception as e:
			return {"error": str(e)}

	return {
		"doctype": doctype,
		"total_returned": len(records),
		"records": [dict(r) for r in records],
	}


def _default_fields(doctype):
	"""Return a sensible set of display fields for a doctype."""
	try:
		meta = frappe.get_meta(doctype)
		fields = ["name"]
		if meta.title_field and meta.title_field != "name":
			fields.append(meta.title_field)
		existing = {f.fieldname for f in meta.fields}
		for candidate in ["status", "grand_total", "total", "customer", "supplier",
						   "employee", "item_code", "posting_date", "transaction_date",
						   "due_date", "company", "modified"]:
			if candidate in existing and len(fields) < 8:
				fields.append(candidate)
		return list(dict.fromkeys(fields))
	except Exception:
		return ["name", "modified"]


def _get_record(doctype, name):
	if not frappe.has_permission(doctype, "read", doc=name):
		return {"error": f"No permission to read {doctype} '{name}'"}

	try:
		doc = frappe.get_doc(doctype, name)
	except frappe.DoesNotExistError:
		return {"error": f"{doctype} '{name}' not found"}

	data = doc.as_dict()
	skip = {"docstatus", "idx", "__islocal", "__unsaved", "doctype", "amended_from"}
	cleaned = {
		k: v for k, v in data.items()
		if k not in skip and not k.startswith("_") and v not in (None, "", [])
	}

	# Truncate long child tables for readability
	for k, v in list(cleaned.items()):
		if isinstance(v, list) and len(v) > 5:
			cleaned[k] = v[:5]
			cleaned[f"_{k}_total_rows"] = len(v)

	return cleaned


def _get_schema(doctype):
	try:
		meta = frappe.get_meta(doctype)
	except Exception:
		return {"error": f"DocType '{doctype}' not found"}

	skip_types = {"Section Break", "Column Break", "HTML", "Fold", "Heading", "Tab Break", "Break"}
	fields = []
	for f in meta.fields:
		if f.fieldtype in skip_types:
			continue
		entry = {
			"fieldname": f.fieldname,
			"label": f.label,
			"type": f.fieldtype,
		}
		if f.reqd:
			entry["required"] = True
		if f.fieldtype == "Link":
			entry["links_to"] = f.options
		elif f.fieldtype == "Select" and f.options:
			entry["options"] = [o for o in f.options.split("\n") if o]
		fields.append(entry)

	return {
		"doctype": doctype,
		"single": bool(meta.issingle),
		"submittable": bool(meta.is_submittable),
		"title_field": meta.title_field,
		"fields": fields[:60],
	}


def _get_count(doctype, filters=None):
	if not frappe.has_permission(doctype, "read"):
		return {"error": f"No read permission for {doctype}"}
	count = frappe.db.count(doctype, filters=filters or {})
	return {"doctype": doctype, "count": count}


def _get_report(report_name, filters=None):
	try:
		if not frappe.db.exists("Report", report_name):
			return {"error": f"Report '{report_name}' not found"}

		from frappe.desk.query_report import run as run_report
		result = run_report(report_name, filters=filters or {})

		columns = [
			c.get("label") or c.get("fieldname", "")
			for c in (result.get("columns") or [])
		]
		data = result.get("result") or []

		return {
			"report": report_name,
			"columns": columns,
			"row_count": len(data),
			"data": data[:50],
		}
	except Exception as e:
		return {"error": f"Could not run report: {e}"}


def _navigate_to(doctype, name=None):
	route = frappe.scrub(doctype).replace("_", "-")
	if name:
		return {
			"url": f"/app/{route}/{name}",
			"label": f"{doctype}: {name}",
		}
	return {
		"url": f"/app/{route}",
		"label": f"{doctype} list",
	}


def _create_record(doctype, data):
	_require_write_actions()
	if not frappe.has_permission(doctype, "create"):
		return {"error": f"No create permission for {doctype}"}

	doc = frappe.new_doc(doctype)
	doc.update(data)
	doc.insert(ignore_permissions=False)
	frappe.db.commit()

	route = frappe.scrub(doctype).replace("_", "-")
	return {
		"success": True,
		"doctype": doctype,
		"name": doc.name,
		"url": f"/app/{route}/{doc.name}",
	}


def _update_record(doctype, name, data):
	_require_write_actions()
	if not frappe.has_permission(doctype, "write", doc=name):
		return {"error": f"No write permission for {doctype} '{name}'"}

	doc = frappe.get_doc(doctype, name)
	doc.update(data)
	doc.save(ignore_permissions=False)
	frappe.db.commit()

	return {"success": True, "doctype": doctype, "name": name}


def _require_write_actions():
	settings = frappe.get_cached_doc("Next AI Settings")
	if not settings.enable_write_actions:
		frappe.throw(_("Write actions are disabled. Enable them in Next AI Settings."))
