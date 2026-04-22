# ✨ OT Glassy Dashboard

A **password-protected**, fully animated, glass-morphism web dashboard for [Open Ticket](https://github.com/open-discord-bots/open-ticket) bot. Customize every aspect of your bot and all its plugins through a beautiful aesthetic interface.

![License](https://img.shields.io/badge/license-MIT-60a5fa)

---

## 🎨 Features

- 🔒 **Password-protected** login (change anytime in config)
- 💎 **Glass morphism UI** with animated gradient backgrounds & floating blobs
- 📊 **Live stats** — guilds, users, ping, memory, uptime (auto-refresh)
- ⚙️ **Edit all main bot configs** — general, panels, options, questions, transcripts
- 🧩 **Edit every plugin's config** — auto-detects all plugins in your folder
- ✨ **JSON editor** with validation, auto-format, and safety checks
- 📱 **Fully responsive** — works on mobile, tablet, desktop
- 🎨 **Customizable theme** — change colors from config
- 🚀 **Zero-config** — drop in and go

---

## 📦 Installation

### 1. Drop the plugin folder
Place `ot-glassy-dashboard/` inside your bot's `plugins/` directory:

your-bot/
└── plugins/
└── ot-glassy-dashboard/   ← here

### 2. Install dependencies
From your **bot's root folder**, run:
```bash
npm install express express-session ejs
npm install --save-dev @types/express @types/express-session

### 3. Configure 
Open `plugins/ot-glassy-dashboard/config.json` and change:

{
    "password": "your_strong_password_here",
    "sessionSecret": "some-long-random-string-here"
}

### 4. Disable old dashboard (important!)

If you have the default ot-dashboard plugin, disable it to avoid port conflicts:

# Option A: delete it
rm -rf plugins/ot-dashboard

# Option B: edit plugins/ot-dashboard/plugin.json → "enabled": false

### 5. Start The Bot 

npm start

### 🧩 Supported Plugins

This dashboard auto-detects and lets you configure any plugin inside your plugins/ folder that has a config.json file. Currently, it works out-of-the-box with all these plugins:


1. ot-feedback - Collect feedback after tickets close
2. ot-embeds - Customize all bot embeds
3. ot-customise - buttons	Customize button labels & styles
4. ot-sticky-messages - Pin recurring messages in channels
5. ot-jump-to-top - Quick-jump buttons in tickets
6. ot-config realod - Reload configs without restart
7. ot-shutdown - Graceful shutdown command
8. ot-kill-switch - Emergency kill switch
9. ot-hosting-status - Show hosting/uptime status
10. ese-welcomer - Welcome new members

💡 Any plugin with a `config.json` will automatically appear in the Plugins page — no code changes needed!

📂 What You Can Edit
Main Bot Configs (config/ folder)

    🏠 general.json — bot token, intents, colors, language, system settings
    📋 panels.json — ticket panels (buttons/dropdowns with options)
    🎫 options.json — ticket types, permissions, categories
    ❓ questions.json — form fields before opening a ticket
    📜 transcripts.json — transcript generation settings

Plugin Configs (plugins/*/config.json) - Any plugin's individual settings