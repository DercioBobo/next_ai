import frappe


def extend_bootinfo(bootinfo):
	"""Expose minimal settings to the frontend at boot time."""
	try:
		settings = frappe.get_cached_doc("Next AI Settings")

		# get_single_value returns None when the DB column is NULL (field added
		# after the document was first created). Treat NULL as True so direct
		# mode is on by default without requiring a manual settings save.
		direct_mode_raw = frappe.db.get_single_value("Next AI Settings", "direct_mode")
		direct_mode = True if direct_mode_raw is None else bool(direct_mode_raw)

		bootinfo.next_ai = {
			"float_enabled": bool(settings.enable_float_widget),
			"model": settings.openai_model or "gpt-4o",
			"api_configured": bool(settings.openai_api_key),
			"direct_mode": direct_mode,
		}
	except Exception:
		bootinfo.next_ai = {
			"float_enabled": False,
			"model": "gpt-4o",
			"api_configured": False,
			"direct_mode": True,
		}
