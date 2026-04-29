const NAI_MODEL_HINTS = {
	"gpt-4.1-mini": {
		badge: "Chat geral / assistente ERP",
		note:  "Melhor equilíbrio custo/desempenho da família 4.1. Contexto até 1 M tokens — também ideal para documentos muito longos.",
		color: "#10b981",
	},
	"gpt-4.1": {
		badge: "Análise complexa / raciocínio",
		note:  "Máxima capacidade da família 4.1. Use para respostas detalhadas, análises financeiras e tarefas multi-passo.",
		color: "#6366f1",
	},
	"gpt-4.1-nano": {
		badge: "Respostas rápidas / simples",
		note:  "O mais rápido e económico. Ideal para consultas simples, contagens e perguntas diretas.",
		color: "#f59e0b",
	},
	"gpt-4o": {
		badge: "Geração anterior — ainda muito capaz",
		note:  "Boa capacidade geral. Considere migrar para gpt-4.1-mini para melhor custo-benefício.",
		color: "#64748b",
	},
	"gpt-4o-mini": {
		badge: "Geração anterior compacta",
		note:  "Versão económica do gpt-4o. O gpt-4.1-nano oferece desempenho similar a menor custo.",
		color: "#64748b",
	},
	"gpt-4-turbo": {
		badge: "Legado",
		note:  "Modelo antigo. Migre para gpt-4.1 para melhor desempenho e menor custo.",
		color: "#ef4444",
	},
	"gpt-4": {
		badge: "Legado",
		note:  "Modelo antigo. Migre para gpt-4.1.",
		color: "#ef4444",
	},
	"gpt-3.5-turbo": {
		badge: "Legado — não recomendado",
		note:  "Muito limitado para uso com ERP. Troque para gpt-4.1-nano como mínimo.",
		color: "#ef4444",
	},
};

function _render_model_hint(frm) {
	const model = frm.doc.openai_model;
	const h = NAI_MODEL_HINTS[model];
	const $wrap = frm.get_field("model_hint_html").$wrapper;
	if (!h) { $wrap.empty(); return; }
	$wrap.html(`
		<div style="
			display:flex; align-items:flex-start; gap:10px;
			margin: 4px 0 10px;
			padding: 10px 14px;
			border-radius: 8px;
			border-left: 4px solid ${h.color};
			background: ${h.color}14;
			font-size: 13px;
			line-height: 1.5;
		">
			<div>
				<span style="font-weight:600; color:${h.color}">${h.badge}</span>
				<span style="color:var(--text-muted)"> — ${h.note}</span>
			</div>
		</div>
	`);
}

frappe.ui.form.on("Next AI Settings", {
	openai_model: _render_model_hint,

	refresh: function (frm) {
		_render_model_hint(frm);
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
