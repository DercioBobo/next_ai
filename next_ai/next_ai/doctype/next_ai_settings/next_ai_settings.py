import frappe
from frappe.model.document import Document


class NextAISettings(Document):
	def validate(self):
		if self.temperature is not None:
			self.temperature = max(0.0, min(1.0, float(self.temperature)))
		if self.max_tool_calls is not None:
			self.max_tool_calls = max(1, min(10, int(self.max_tool_calls)))

	def on_update(self):
		# Bust boot cache so the new float_enabled value propagates
		frappe.cache().delete_value("bootinfo")
		frappe.cache().delete_value("next_ai:doctype_list")

	@frappe.whitelist()
	def refresh_schema_cache(self):
		from next_ai.tasks import refresh_schema_cache
		refresh_schema_cache()
		frappe.msgprint(frappe._("Schema cache refreshed successfully."))
