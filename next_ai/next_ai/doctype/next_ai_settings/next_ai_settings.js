frappe.ui.form.on("Next AI Settings", {
	refresh: function (frm) {
		frm.add_custom_button(__("Test Connection"), function () {
			const btn = frm.get_field ? undefined : null;
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
				error: function () {
					// frappe.throw in the backend surfaces here as a red alert automatically
				},
			});
		}, __("Actions"));
	},
});
