# 📥 ESE Welcomer

A professional, fully configurable welcome and leave system for **Open Ticket v4**. Automatically greet new members or say goodbye to departing ones with beautiful embeds and custom message content.

## ✨ Features
* **Welcome & Leave Messages:** Separate configurations for both join and leave events.
* **Custom Embeds:** Full control over titles, descriptions, colors, and footers for both events.
* **Author Settings:** Configure the author field (name, icon, and URL) for both embeds.
* **Dynamic Placeholders:** Use `{user}` and `{server}` to personalize messages.
* **Admin Commands:** Test your setup or reload changes without restarting the bot.
* **Console Logging:** Keeps track of admin actions with a clean, color-coded log.

---

## ⚙️ Configuration
The `config.json` file can be found in `./plugins/ese-welcomer/`. Below is a breakdown of the available options:

### 📍 General Settings
| Key | Description | Format |
| :--- | :--- | :--- |
| `welcomeChannelId` | Channel ID where the welcome message will be posted. | 18+ digits |
| `leaveChannelId` | Channel ID where the leave message will be posted. | 18+ digits |
| `testTitle` | Prefix shown during `/welcome test`. | String |
| `leaveTestTitle` | Prefix shown during `/leave test`. | String |
| `messageContent` | Text sent above the welcome embed. | String |
| `leaveMessageContent` | Text sent above the leave embed. | String |

### 🖼️ Embed Settings (for `embed` and `leaveEmbed`)
| Key | Description | Format |
| :--- | :--- | :--- |
| `author.name` | Small text at the very top. | String |
| `author.icon` | URL to a small image next to the author name. | URL |
| `author.url` | A clickable link for the author name. | URL |
| `title` | The main bold title of the embed. | String |
| `description` | The main body text of the message. | String |
| `color` | The side-strip color in Hex format. | Hex (#ffffff) |
| `thumbnail` | Image in the top-right. Set to `"user-icon"` for member avatar. | "user-icon" / URL |
| `image` | A large banner image at the bottom. | URL |
| `footer` | Small text at the bottom. | String |
| `timestamp` | Shows the exact time of the event. | Boolean (true/false) |

---

## 🏷️ Placeholders
You can use these tags in almost any string field:
* `{user}`: Mentions the member (e.g., @User).
* `{server}`: Displays the name of your Discord server.

---

## 🛠️ Commands
These commands require **Administrator** permissions within the Open Ticket system.

* `/welcome test` - Sends a preview of your welcome message.
* `/welcome reload` - Reloads the configuration for welcome messages.
* `/leave test` - Sends a preview of your leave message.
* `/leave reload` - Reloads the configuration for leave messages.

---

## 📥 Installation
1. Download the plugin folder.
2. Place the `ese-welcomer` folder inside your Open Ticket `plugins` directory.
3. Configure your `welcomeChannelId` and `leaveChannelId` in `config.json`.
4. Restart your bot.

---

## 📝 Example Config
```json
{
  "welcomeChannelId": "YOUR_CHANNEL_ID",
  "testTitle": "Welcome preview:\n\n",
  "messageContent": "Welcome {user} to {server}!",
  "embed": {
    "color": "#ffffff",
    "title": "New Member!",
    "description": "Welcome {user}, we are glad to have you here!",
    "footer": "ESE Welcomer",
    "thumbnail": "user-icon",
    "image": "",
    "timestamp": true,
    "author": {
      "name": "Welcome",
      "icon": "",
      "url": ""
    }
  },
  "leaveChannelId": "YOUR_CHANNEL_ID",
  "leaveTestTitle": "Goodbye preview:\n\n",
  "leaveMessageContent": "{user} has left the server.",
  "leaveEmbed": {
    "color": "#ff0000",
    "title": "Member Left",
    "description": "Goodbye {user}, we hope to see you back soon!",
    "footer": "ESE Welcomer",
    "thumbnail": "user-icon",
    "image": "",
    "timestamp": true,
    "author": {
      "name": "Goodbye",
      "icon": "",
      "url": ""
    }
  }
}
