import frappe


def extend_bootinfo(bootinfo):
	"""Expose minimal settings to the frontend at boot time."""
	try:
		settings = frappe.get_cached_doc("Next AI Settings")
		bootinfo.next_ai = {
			"float_enabled": bool(settings.enable_float_widget),
			"model": settings.openai_model or "gpt-4o",
			"api_configured": bool(settings.openai_api_key),
		}
	except Exception:
		bootinfo.next_ai = {
			"float_enabled": False,
			"model": "gpt-4o",
			"api_configured": False,
		}
