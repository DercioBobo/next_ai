import frappe


def execute():
	"""Set direct_mode = 1 on existing Next AI Settings documents.

	The field was added after initial install so the DB value is NULL/0 on
	existing sites. We want the default to be ON (direct mode) so the AI
	works out of the box without requiring a background worker.
	"""
	if not frappe.db.table_exists("tabSingles"):
		return

	current = frappe.db.get_single_value("Next AI Settings", "direct_mode")
	if not current:
		frappe.db.set_single_value("Next AI Settings", "direct_mode", 1)
		frappe.db.commit()
