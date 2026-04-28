import frappe


def refresh_schema_cache():
	"""Nightly job: bust the doctype list cache so new doctypes appear in context."""
	frappe.cache().delete_value("next_ai:doctype_list")

	# Record the refresh time on the settings doc
	try:
		settings = frappe.get_doc("Next AI Settings")
		settings.schema_last_updated = frappe.utils.now_datetime()
		settings.save(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		pass
