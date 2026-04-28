frappe.ui.form.on("Next AI Settings", {
	refresh: function (frm) {
		frm.add_custom_button(__("Test Connection"), function () {
			frappe.show_alert({ message: __("Testing OpenAI connection…"), indicator: "blue" });
			frappe.call({
				method: "next_ai.api.chat.test_openai_connection",
				callback: function (r) {
					if (r.message && r.message.success) {
						frappe.msgprint({
							title: __("Connection Successful ✓"),
							message: [
								`<b>${__("Active model:")}</b> ${r.message.model}`,
								`<b>${__("Available GPT models:")}</b> ${r.message.available_gpt_models}`,
							].join("<br>"),
							indicator: "green",
						});
					}
				},
			});
		}, __("Actions"));

		frm.add_custom_button(__("Refresh DocType Cache"), function () {
			frappe.call({
				method: "next_ai.api.chat.clear_doctype_cache",
				callback: function () {
					frappe.show_alert({ message: __("DocType cache cleared — AI will pick up new custom doctypes on the next message."), indicator: "green" });
				},
			});
		}, __("Actions"));
	},
});
