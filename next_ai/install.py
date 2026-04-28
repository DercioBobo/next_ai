import frappe


def after_install():
	"""Create default Next AI Settings document on first install."""
	if not frappe.db.exists("Next AI Settings", "Next AI Settings"):
		settings = frappe.new_doc("Next AI Settings")
		settings.openai_model = "gpt-4o"
		settings.max_tokens = 4096
		settings.temperature = 0.3
		settings.max_tool_calls = 5
		settings.enable_float_widget = 1
		settings.enable_write_actions = 0
		settings.insert(ignore_permissions=True)
		frappe.db.commit()
