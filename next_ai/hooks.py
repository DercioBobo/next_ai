app_name = "next_ai"
app_title = "Next AI"
app_publisher = "Dércio Bobo"
app_description = "Natural Language Interface for ERPNext — query, navigate and understand your ERP data through conversation"
app_email = "derciobob@gmail.com"
app_license = "MIT"

# Included on every desk page
app_include_css = ["/assets/next_ai/css/next_ai_widget.css"]
app_include_js = ["/assets/next_ai/js/next_ai_widget.js"]

# Inject settings into Frappe boot so the widget can read them without an API call
extend_bootinfo = "next_ai.boot.extend_bootinfo"

# Post-install setup
after_install = "next_ai.install.after_install"

# Scheduled tasks
scheduler_events = {
	"daily": [
		"next_ai.tasks.refresh_schema_cache"
	]
}
