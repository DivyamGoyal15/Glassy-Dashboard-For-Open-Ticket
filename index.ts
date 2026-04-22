import { opendiscord } from "#opendiscord";
import express from "express";
import session from "express-session";
import path from "path";
import fs from "fs";

const pluginPath = path.join(process.cwd(), "plugins", "ot-glassy-dashboard");
const config = JSON.parse(fs.readFileSync(path.join(pluginPath, "config.json"), "utf-8"));

if (!config.enabled) {
    console.log("[ot-glassy-dashboard] Dashboard disabled in config.");
} else {
    startDashboard();
}

function startDashboard() {
    const app = express();

    app.set("view engine", "ejs");
    app.set("views", path.join(pluginPath, "public/views"));
    app.use(express.static(path.join(pluginPath, "public")));
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true }));

    app.use(session({
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 * 24 }
    }));

    // ===== AUTH =====
    const requireAuth = (req: any, res: any, next: any) => {
        if (req.session?.authed) return next();
        return res.redirect("/login");
    };

    // ===== DISCORD CLIENT =====
    const getClient = (): any => {
        try {
            const od: any = opendiscord;
            return od.client?.client ?? od.client ?? null;
        } catch {
            return null;
        }
    };

    // ===== PLUGINS =====
    const readPluginsFromDisk = () => {
        const pluginsDir = path.join(process.cwd(), "plugins");
        if (!fs.existsSync(pluginsDir)) return [];

        return fs.readdirSync(pluginsDir)
            .filter(f => fs.statSync(path.join(pluginsDir, f)).isDirectory())
            .map(folder => {
                const configPath = path.join(pluginsDir, folder, "config.json");
                const metaPath = path.join(pluginsDir, folder, "plugin.json");

                let meta: any = {};
                if (fs.existsSync(metaPath)) {
                    try {
                        meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                    } catch {}
                }

                return {
                    folder,
                    id: meta.id || folder,
                    name: meta.name || folder,
                    version: meta.version || "?",
                    description: meta.shortDescription || meta.description || "",
                    hasConfig: fs.existsSync(configPath),
                    enabled: meta.enabled !== false
                };
            });
    };

    // ===== CONFIG DIR =====
    const configDir = path.join(process.cwd(), "config");

    // ===== SETUP DETECTION =====
    const checkSetupStatus = () => {
        const files = ["general", "panels", "options", "questions", "transcripts"];
        const missing: string[] = [];

        for (const f of files) {
            const fp = path.join(configDir, f + ".json");

            if (!fs.existsSync(fp)) {
                missing.push(f);
                continue;
            }

            try {
                const content = fs.readFileSync(fp, "utf-8").trim();
                if (!content || content === "{}" || content === "[]") {
                    missing.push(f);
                }
            } catch {
                missing.push(f);
            }
        }

        return missing;
    };

    // ===== APPLY TEMPLATE =====
    app.post("/setup/apply/:file", requireAuth, (req, res) => {
        const file = req.params.file;
        const allowed = ["general", "panels", "options", "questions", "transcripts"];

        if (!allowed.includes(file)) {
            return res.status(400).json({ success: false, message: "Invalid file" });
        }

        const templatePath = path.join(pluginPath, "templates", file + ".json");
        const targetPath = path.join(configDir, file + ".json");

        if (!fs.existsSync(templatePath)) {
            return res.status(404).json({ success: false, message: "Template missing" });
        }

        try {
            const tpl = fs.readFileSync(templatePath, "utf-8");

            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            fs.writeFileSync(targetPath, tpl);

            res.json({
                success: true,
                message: `✅ ${file}.json created from template!`
            });
        } catch (e: any) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // ===== FAVICON =====
    app.get("/favicon.ico", async (req, res) => {
        try {
            const client = getClient();
            const avatarURL = client?.user?.displayAvatarURL?.({
                extension: "png",
                size: 256
            });

            if (avatarURL) return res.redirect(avatarURL);
        } catch {}

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <text y=".9em" font-size="90">✨</text>
        </svg>`;

        res.setHeader("Content-Type", "image/svg+xml");
        res.send(svg);
    });

    // ===== BOT INFO =====
    app.get("/api/bot-info", requireAuth, (req, res) => {
        const client = getClient();

        res.json({
            avatar: client?.user?.displayAvatarURL?.({
                extension: "png",
                size: 256
            }) || null,
            username: client?.user?.username || "Bot",
            tag: client?.user?.tag || "Bot#0000"
        });
    });

    // ===== AUTH ROUTES =====
    app.get("/login", (req: any, res) => {
        res.render("login", {
            error: req.query.error,
            title: config.siteTitle,
            theme: config.theme
        });
    });

    app.post("/login", (req: any, res) => {
        if (req.body.password === config.password) {
            req.session.authed = true;
            return res.redirect("/");
        }
        res.redirect("/login?error=1");
    });

    app.get("/logout", (req: any, res) => {
        req.session.destroy(() => res.redirect("/login"));
    });

    // ===== DASHBOARD =====
    app.get("/", requireAuth, (req, res) => {
        const client = getClient();

        const stats = {
            guilds: client?.guilds?.cache?.size || 0,
            users: client?.users?.cache?.size || 0,
            uptime: process.uptime(),
            ping: client?.ws?.ping || 0,
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        };

        const plugins = readPluginsFromDisk();
        const missingSetup = checkSetupStatus();

        res.render("dashboard", {
            stats,
            plugins,
            missingSetup,
            title: config.siteTitle,
            theme: config.theme,
            page: "dashboard",
            features: config.features
        });
    });

    // ===== CONFIG EDITOR =====
    app.get("/config/:file", requireAuth, (req, res) => {
        const file = req.params.file + ".json";
        const filePath = path.join(configDir, file);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("Config not found");
        }

        const content = fs.readFileSync(filePath, "utf-8");

        res.render("editor", {
            title: config.siteTitle,
            theme: config.theme,
            page: req.params.file,
            fileName: file,
            fileContent: content,
            saveUrl: `/config/${req.params.file}/save`,
            features: config.features
        });
    });

    app.post("/config/:file/save", requireAuth, (req, res) => {
        const filePath = path.join(configDir, req.params.file + ".json");

        try {
            const parsed = JSON.parse(req.body.content);
            fs.writeFileSync(filePath, JSON.stringify(parsed, null, 4));
            res.json({ success: true, message: "Saved!" });
        } catch (e: any) {
            res.status(400).json({ success: false, message: "Invalid JSON: " + e.message });
        }
    });

    // ===== PLUGINS =====
    app.get("/plugins", requireAuth, (req, res) => {
        res.render("plugins", {
            plugins: readPluginsFromDisk(),
            title: config.siteTitle,
            theme: config.theme,
            page: "plugins",
            features: config.features
        });
    });

    // ===== STATS API =====
    app.get("/api/stats", requireAuth, (req, res) => {
        const client = getClient();

        res.json({
            guilds: client?.guilds?.cache?.size || 0,
            users: client?.users?.cache?.size || 0,
            uptime: process.uptime(),
            ping: client?.ws?.ping || 0,
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        });
    });

    // ===== START SERVER =====
    app.listen(config.port, config.host, () => {
        console.log(`\n🎨 Dashboard running at http://${config.host}:${config.port}`);
    });
}