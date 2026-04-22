import { api, opendiscord, utilities } from "#opendiscord"
import * as discord from "discord.js"
import * as fjs from "formatted-json-stringify"
import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"

if (utilities.project != "openticket") throw new api.ODPluginError("This plugin only works in Open Ticket!")

const PLUGIN_ROOT = "./plugins/ot-sticky-messages/"
const STORAGE_ROOT = "./plugins/ot-sticky-messages/storage/"
const STICKY_DATABASE_CATEGORY = "ot-sticky-messages:sticky"

type OTStickyPermission = "admin"|"developer"|"owner"
type OTStickyType = "text"|"embed"|"attachment"
type OTStickyMode = "message"|"timed"

interface OTStickyConfigData {
    commandPermission: OTStickyPermission
    autoResendOnBoot: boolean
    deleteStickyMessageWhenDisabled: boolean
}

interface OTStickyEmbedData {
    title: string
    description: string
    color: string
    footer: string
    imageUrl: string
    thumbnailUrl: string
}

interface OTStickyAttachmentData {
    storedName: string
    originalName: string
    contentType: string|null
    spoiler: boolean
}

interface OTStickyEntry {
    version: 1
    channelId: string
    enabled: boolean
    type: OTStickyType
    mode: OTStickyMode
    messageContent: string
    embedData: OTStickyEmbedData|null
    attachmentData: OTStickyAttachmentData|null
    lastStickyMessageId: string|null
    ignoredRoleIds: string[]
    cooldownMessages: number
    timedResendMinutes: number|null
    createdAt: string
    updatedAt: string
}

interface OTStickyReplyData {
    title: string
    description: string
    color?: discord.ColorResolvable
    fields?: discord.EmbedField[]
}

class OTStickyConfig extends api.ODJsonConfig {
    declare data: OTStickyConfigData
}

class OTStickyDatabase extends api.ODFormattedJsonDatabase {
    getEntry(channelId: string): OTStickyEntry|undefined {
        return super.get(STICKY_DATABASE_CATEGORY, channelId) as OTStickyEntry|undefined
    }

    setEntry(channelId: string, value: OTStickyEntry): boolean {
        return super.set(STICKY_DATABASE_CATEGORY, channelId, value) as boolean
    }

    deleteEntry(channelId: string): boolean {
        return super.delete(STICKY_DATABASE_CATEGORY, channelId) as boolean
    }

    getAllEntries(): OTStickyEntry[] {
        const entries = super.getCategory(STICKY_DATABASE_CATEGORY) as {key: string, value: OTStickyEntry}[]|undefined
        return (entries ?? []).map((entry) => entry.value as OTStickyEntry)
    }
}

class OTStickyManager extends api.ODManagerData {
    timers: Map<string, NodeJS.Timeout> = new Map()
    messageCounters: Map<string, number> = new Map()

    constructor(id: api.ODValidId) {
        super(id)
        this.ensureStorageRoot()
    }

    get config(): OTStickyConfig {
        return opendiscord.configs.get("ot-sticky-messages:config")
    }

    get database(): OTStickyDatabase {
        return opendiscord.databases.get("ot-sticky-messages:database")
    }

    ensureStorageRoot() {
        if (!fs.existsSync(STORAGE_ROOT)) fs.mkdirSync(STORAGE_ROOT, { recursive: true })
    }

    normalizeEntry(entry: OTStickyEntry): OTStickyEntry {
        return {
            version: 1,
            channelId: entry.channelId,
            enabled: entry.enabled ?? true,
            type: entry.type,
            mode: entry.mode ?? "message",
            messageContent: entry.messageContent ?? "",
            embedData: entry.embedData ?? null,
            attachmentData: entry.attachmentData ?? null,
            lastStickyMessageId: entry.lastStickyMessageId ?? null,
            ignoredRoleIds: Array.isArray(entry.ignoredRoleIds) ? entry.ignoredRoleIds : [],
            cooldownMessages: Math.max(1, entry.cooldownMessages ?? 1),
            timedResendMinutes: entry.timedResendMinutes ? Math.max(1, entry.timedResendMinutes) : null,
            createdAt: entry.createdAt ?? new Date().toISOString(),
            updatedAt: entry.updatedAt ?? new Date().toISOString()
        }
    }

    getEntry(channelId: string): OTStickyEntry|null {
        const entry = this.database.getEntry(channelId)
        return entry ? this.normalizeEntry(entry) : null
    }

    getAllEntries(): OTStickyEntry[] {
        return this.database.getAllEntries().map((entry) => this.normalizeEntry(entry))
    }

    saveEntry(entry: OTStickyEntry) {
        const normalized = this.normalizeEntry({
            ...entry,
            updatedAt: new Date().toISOString()
        })
        this.database.setEntry(normalized.channelId, normalized)
        this.resetChannelTimer(normalized.channelId)
    }

    async removeEntry(channelId: string, deleteStickyMessage: boolean) {
        const entry = this.getEntry(channelId)
        if (!entry) return false

        this.clearChannelTimer(channelId)
        this.messageCounters.delete(channelId)

        if (deleteStickyMessage) await this.deleteStickyMessage(entry, false)
        this.deleteAttachmentFile(entry.attachmentData)
        this.database.deleteEntry(channelId)
        return true
    }

    async storeAttachment(attachment: discord.Attachment): Promise<OTStickyAttachmentData> {
        this.ensureStorageRoot()

        const response = await fetch(attachment.url)
        if (!response.ok) throw new api.ODPluginError(`Failed to download sticky attachment: ${response.status}`)

        const buffer = Buffer.from(await response.arrayBuffer())
        const originalName = attachment.name ?? "sticky-attachment"
        const safeOriginalName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_")
        const storedName = `${Date.now()}-${randomUUID()}-${safeOriginalName}`
        fs.writeFileSync(path.join(STORAGE_ROOT, storedName), buffer)

        return {
            storedName,
            originalName,
            contentType: attachment.contentType ?? null,
            spoiler: attachment.spoiler ?? false
        }
    }

    deleteAttachmentFile(attachmentData: OTStickyAttachmentData|null) {
        if (!attachmentData) return
        const fullPath = path.join(STORAGE_ROOT, attachmentData.storedName)
        if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { force: true })
    }

    async fetchStickyChannel(channelId: string): Promise<discord.GuildTextBasedChannel|null> {
        const channel = await opendiscord.client.fetchChannel(channelId)
        if (!channel) return null
        if (channel.type !== discord.ChannelType.GuildText && channel.type !== discord.ChannelType.GuildAnnouncement) return null
        return channel
    }

    shouldIgnoreMessage(message: discord.Message, entry: OTStickyEntry): boolean {
        if (message.author.bot) return true
        if (message.webhookId) return true
        if (!message.inGuild()) return true
        if (!message.member) return false

        return entry.ignoredRoleIds.some((roleId) => message.member?.roles.cache.has(roleId))
    }

    buildStickyMessage(entry: OTStickyEntry): discord.MessageCreateOptions {
        const message: discord.MessageCreateOptions = {
            allowedMentions: { parse: [] }
        }

        if (entry.messageContent.length > 0) message.content = entry.messageContent

        if (entry.embedData) {
            const embed = new discord.EmbedBuilder()
            if (entry.embedData.title) embed.setTitle(entry.embedData.title)
            if (entry.embedData.description) embed.setDescription(entry.embedData.description)
            if (entry.embedData.color) embed.setColor(entry.embedData.color as discord.ColorResolvable)
            if (entry.embedData.footer) embed.setFooter({ text: entry.embedData.footer })
            if (entry.embedData.imageUrl) embed.setImage(entry.embedData.imageUrl)
            if (entry.embedData.thumbnailUrl) embed.setThumbnail(entry.embedData.thumbnailUrl)
            message.embeds = [embed]
        }

        if (entry.attachmentData) {
            const attachmentPath = path.join(STORAGE_ROOT, entry.attachmentData.storedName)
            if (!fs.existsSync(attachmentPath)) throw new api.ODPluginError(`Missing stored sticky attachment: ${entry.attachmentData.storedName}`)

            const file = new discord.AttachmentBuilder(attachmentPath)
                .setName(entry.attachmentData.originalName)
                .setSpoiler(entry.attachmentData.spoiler)

            if (entry.attachmentData.contentType) file.setDescription(entry.attachmentData.contentType)
            message.files = [file]
        }

        return message
    }

    async deleteStickyMessage(entry: OTStickyEntry, persist: boolean) {
        if (!entry.lastStickyMessageId) return

        const channel = await this.fetchStickyChannel(entry.channelId)
        if (!channel) {
            entry.lastStickyMessageId = null
            if (persist) this.saveEntry(entry)
            return
        }

        try {
            const previousMessage = await channel.messages.fetch(entry.lastStickyMessageId)
            await previousMessage.delete()
        } catch {}

        entry.lastStickyMessageId = null
        if (persist) this.saveEntry(entry)
    }

    async resendSticky(channelId: string): Promise<{ success: boolean, reason?: string, entry?: OTStickyEntry }> {
        const entry = this.getEntry(channelId)
        if (!entry) return { success: false, reason: "No sticky configured for this channel." }
        if (!entry.enabled) return { success: false, reason: "Sticky is currently disabled for this channel." }

        const channel = await this.fetchStickyChannel(channelId)
        if (!channel) return { success: false, reason: "The configured sticky channel no longer exists or is unsupported." }

        await this.deleteStickyMessage(entry, false)

        try {
            const sentMessage = await channel.send(this.buildStickyMessage(entry))
            entry.lastStickyMessageId = sentMessage.id
            this.messageCounters.set(channelId, 0)
            this.saveEntry(entry)
            return { success: true, entry }
        } catch (error) {
            opendiscord.log(`Failed to resend sticky message in channel ${channelId}: ${error}`,"plugin")
            return { success: false, reason: "The sticky was saved, but the bot could not send the message in that channel." }
        }
    }

    async handleMessage(message: discord.Message) {
        const entry = this.getEntry(message.channel.id)
        if (!entry || !entry.enabled) return
        if (entry.mode !== "message") return
        if (this.shouldIgnoreMessage(message, entry)) return

        const newCount = (this.messageCounters.get(entry.channelId) ?? 0) + 1
        this.messageCounters.set(entry.channelId, newCount)

        if (newCount < Math.max(1, entry.cooldownMessages)) return
        await this.resendSticky(entry.channelId)
    }

    clearChannelTimer(channelId: string) {
        const timer = this.timers.get(channelId)
        if (timer) clearInterval(timer)
        this.timers.delete(channelId)
    }

    resetChannelTimer(channelId: string) {
        this.clearChannelTimer(channelId)

        const entry = this.getEntry(channelId)
        if (!entry || !entry.enabled) return
        if (entry.mode !== "timed") return
        if (!entry.timedResendMinutes || entry.timedResendMinutes < 1) return

        const interval = setInterval(() => {
            utilities.runAsync(async () => {
                await this.resendSticky(channelId)
            })
        }, entry.timedResendMinutes * 60_000)

        this.timers.set(channelId, interval)
    }

    boot() {
        for (const entry of this.getAllEntries()) {
            this.messageCounters.set(entry.channelId, 0)
            this.resetChannelTimer(entry.channelId)

            if (entry.enabled && this.config.data.autoResendOnBoot) {
                utilities.runAsync(async () => {
                    await this.resendSticky(entry.channelId)
                })
            }
        }
    }
}

declare module "#opendiscord-types" {
    export interface ODPluginManagerIds_Default {
        "ot-sticky-messages": api.ODPlugin
    }

    export interface ODConfigManagerIds_Default {
        "ot-sticky-messages:config": OTStickyConfig
    }

    export interface ODDatabaseManagerIds_Default {
        "ot-sticky-messages:database": OTStickyDatabase
    }

    export interface ODCheckerManagerIds_Default {
        "ot-sticky-messages:config": api.ODChecker
    }

    export interface ODPluginClassManagerIds_Default {
        "ot-sticky-messages:manager": OTStickyManager
    }

    export interface ODSlashCommandManagerIds_Default {
        "ot-sticky-messages:sticky": api.ODSlashCommand
    }

    export interface ODCommandResponderManagerIds_Default {
        "ot-sticky-messages:sticky": {source:"slash"|"text",params:{},workers:"ot-sticky-messages:sticky"|"ot-sticky-messages:logs"}
    }

    export interface ODEmbedManagerIds_Default {
        "ot-sticky-messages:reply-embed": {source:"slash"|"text"|"other",params:{data:OTStickyReplyData},workers:"ot-sticky-messages:reply-embed"}
    }

    export interface ODMessageManagerIds_Default {
        "ot-sticky-messages:reply-message": {source:"slash"|"text"|"other",params:{data:OTStickyReplyData},workers:"ot-sticky-messages:reply-message"}
    }
}

const stickyDatabaseFormatter = new fjs.ArrayFormatter(null, true, new fjs.ObjectFormatter(null, false, [
    new fjs.PropertyFormatter("category"),
    new fjs.PropertyFormatter("key"),
    new fjs.DefaultFormatter("value", false)
]))

const getStickyManager = () => opendiscord.plugins.classes.get("ot-sticky-messages:manager")

const getReplyColor = (color?: discord.ColorResolvable): discord.ColorResolvable => {
    return color ?? (opendiscord.configs.get("opendiscord:general").data.mainColor as discord.ColorResolvable)
}

const buildReply = (title: string, description: string, fields?: discord.EmbedField[], color?: discord.ColorResolvable): OTStickyReplyData => ({
    title,
    description,
    fields,
    color: getReplyColor(color)
})

const formatStickyType = (type: OTStickyType) => type.charAt(0).toUpperCase() + type.slice(1)

const formatStickyMode = (entry: OTStickyEntry) => {
    if (entry.mode === "timed" && entry.timedResendMinutes) return `Timed (${entry.timedResendMinutes}m)`
    return `Message (${entry.cooldownMessages} msg)`
}

const formatStickyChannel = async (channelId: string) => {
    const channel = await getStickyManager().fetchStickyChannel(channelId)
    return channel ? channel.toString() : `\`${channelId}\``
}

const sanitizeOptionalUrl = (value: string|null) => value ? value.trim() : ""
const truncateText = (value: string, maxLength: number) => value.length > maxLength ? value.slice(0, Math.max(0, maxLength - 3)) + "..." : value

// REGISTER PLUGIN CLASS
opendiscord.events.get("onPluginClassLoad").listen((classes) => {
    classes.add(new OTStickyManager("ot-sticky-messages:manager"))
})

// REGISTER CONFIG
opendiscord.events.get("onConfigLoad").listen((configs) => {
    configs.add(new OTStickyConfig("ot-sticky-messages:config", "config.json", PLUGIN_ROOT))
})

// REGISTER DATABASE
opendiscord.events.get("onDatabaseLoad").listen((databases) => {
    databases.add(new OTStickyDatabase("ot-sticky-messages:database", "database.json", stickyDatabaseFormatter, PLUGIN_ROOT))
})

// REGISTER CONFIG CHECKER
opendiscord.events.get("onCheckerLoad").listen((checkers) => {
    const config = opendiscord.configs.get("ot-sticky-messages:config")
    const structure = new api.ODCheckerObjectStructure("ot-sticky-messages:config", { children: [
        { key: "commandPermission", optional: false, priority: 0, checker: new api.ODCheckerStringStructure("ot-sticky-messages:command-permission", { choices: ["admin", "developer", "owner"] }) },
        { key: "autoResendOnBoot", optional: false, priority: 0, checker: new api.ODCheckerBooleanStructure("ot-sticky-messages:auto-resend", {}) },
        { key: "deleteStickyMessageWhenDisabled", optional: false, priority: 0, checker: new api.ODCheckerBooleanStructure("ot-sticky-messages:delete-disabled", {}) }
    ]})
    checkers.add(new api.ODChecker("ot-sticky-messages:config", checkers.storage, 0, config, structure))
})

// REGISTER SLASH COMMAND
opendiscord.events.get("onSlashCommandLoad").listen((slash) => {
    const acot = discord.ApplicationCommandOptionType

    slash.add(new api.ODSlashCommand("ot-sticky-messages:sticky", {
        name: "sticky",
        description: "Create and manage sticky messages in channels.",
        type: discord.ApplicationCommandType.ChatInput,
        contexts: [discord.InteractionContextType.Guild],
        integrationTypes: [discord.ApplicationIntegrationType.GuildInstall],
        options: [
            {
                type: acot.Subcommand,
                name: "set-text",
                description: "Create or replace a text sticky in a channel.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] },
                    { type: acot.String, name: "content", description: "The sticky message content.", required: true, maxLength: 2000 }
                ]
            },
            {
                type: acot.Subcommand,
                name: "set-embed",
                description: "Create or replace an embed sticky in a channel.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] },
                    { type: acot.String, name: "description", description: "The embed description.", required: true, maxLength: 4096 },
                    { type: acot.String, name: "title", description: "The embed title.", required: false, maxLength: 256 },
                    { type: acot.String, name: "content", description: "Optional normal text above the embed.", required: false, maxLength: 2000 },
                    { type: acot.String, name: "color", description: "Hex color like #ffaa00.", required: false, maxLength: 7 },
                    { type: acot.String, name: "footer", description: "Embed footer text.", required: false, maxLength: 2048 },
                    { type: acot.String, name: "image_url", description: "Optional embed image URL.", required: false },
                    { type: acot.String, name: "thumbnail_url", description: "Optional embed thumbnail URL.", required: false }
                ]
            },
            {
                type: acot.Subcommand,
                name: "set-attachment",
                description: "Create or replace an attachment sticky in a channel.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] },
                    { type: acot.Attachment, name: "attachment", description: "The file or image to resend.", required: true },
                    { type: acot.String, name: "content", description: "Optional normal text above the attachment.", required: false, maxLength: 2000 },
                    { type: acot.Boolean, name: "spoiler", description: "Send the attachment as a spoiler.", required: false }
                ]
            },
            {
                type: acot.Subcommand,
                name: "mode",
                description: "Switch between message-triggered and timed sticky mode.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] },
                    { type: acot.String, name: "mode", description: "How the sticky should resend.", required: true, choices: [{ name: "Message", value: "message" }, { name: "Timed", value: "timed" }] },
                    { type: acot.Integer, name: "minutes", description: "Required for timed mode.", required: false, minValue: 1, maxValue: 1440 }
                ]
            },
            {
                type: acot.Subcommand,
                name: "cooldown",
                description: "Only resend a message-mode sticky every X user messages.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] },
                    { type: acot.Integer, name: "messages", description: "How many user messages before resending.", required: true, minValue: 1, maxValue: 250 }
                ]
            },
            {
                type: acot.Subcommand,
                name: "ignore-role",
                description: "Add or remove a role that should not trigger the sticky resend.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] },
                    { type: acot.String, name: "action", description: "Add or remove a role.", required: true, choices: [{ name: "Add", value: "add" }, { name: "Remove", value: "remove" }] },
                    { type: acot.Role, name: "role", description: "The role to update.", required: true }
                ]
            },
            {
                type: acot.Subcommand,
                name: "enable",
                description: "Enable the sticky for a channel.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] }
                ]
            },
            {
                type: acot.Subcommand,
                name: "disable",
                description: "Disable the sticky for a channel.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] }
                ]
            },
            {
                type: acot.Subcommand,
                name: "resend",
                description: "Delete the current sticky and send a fresh one now.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] }
                ]
            },
            {
                type: acot.Subcommand,
                name: "show",
                description: "Show the saved sticky settings for one channel.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] }
                ]
            },
            {
                type: acot.Subcommand,
                name: "remove",
                description: "Remove a sticky configuration completely.",
                options: [
                    { type: acot.Channel, name: "channel", description: "The target channel.", required: true, channelTypes: [discord.ChannelType.GuildText, discord.ChannelType.GuildAnnouncement] }
                ]
            },
            {
                type: acot.Subcommand,
                name: "list",
                description: "List all configured sticky channels."
            }
        ]
    }))
})

// REGISTER HELP MENU
opendiscord.events.get("onHelpMenuComponentLoad").listen((menu) => {
    menu.get("opendiscord:extra").add(new api.ODHelpMenuCommandComponent("ot-sticky-messages:sticky", 0, {
        slashName: "sticky",
        slashDescription: "Create and manage sticky messages in channels."
    }))
})

// REGISTER BUILDERS
opendiscord.events.get("onEmbedBuilderLoad").listen((embeds) => {
    embeds.add(new api.ODEmbed("ot-sticky-messages:reply-embed"))
    embeds.get("ot-sticky-messages:reply-embed").workers.add(
        new api.ODWorker("ot-sticky-messages:reply-embed", 0, (instance, params) => {
            const { data } = params
            instance.setTitle(data.title)
            instance.setDescription(data.description)
            instance.setColor(getReplyColor(data.color))
            if (data.fields && data.fields.length > 0) instance.setFields(data.fields)
        })
    )
})

opendiscord.events.get("onMessageBuilderLoad").listen((messages) => {
    messages.add(new api.ODMessage("ot-sticky-messages:reply-message"))
    messages.get("ot-sticky-messages:reply-message").workers.add(
        new api.ODWorker("ot-sticky-messages:reply-message", 0, async (instance, params, source) => {
            instance.addEmbed(await opendiscord.builders.embeds.getSafe("ot-sticky-messages:reply-embed").build(source, params))
            instance.setEphemeral(true)
        })
    )
})

// REGISTER COMMAND RESPONDER
opendiscord.events.get("onCommandResponderLoad").listen((commands) => {
    const generalConfig = opendiscord.configs.get("opendiscord:general")
    const manager = getStickyManager()

    commands.add(new api.ODCommandResponder("ot-sticky-messages:sticky", generalConfig.data.prefix, "sticky"))
    commands.get("ot-sticky-messages:sticky").workers.add([
        new api.ODWorker("ot-sticky-messages:sticky", 0, async (instance, params, source, cancel) => {
            const { guild, channel, user } = instance

            if (!guild) {
                instance.reply(await opendiscord.builders.messages.getSafe("opendiscord:error-not-in-guild").build(source, { channel, user }))
                return cancel()
            }

            const requiredPermission = manager.config.data.commandPermission
            const userPermissions = await opendiscord.permissions.getPermissions(user, channel, guild, {
                allowChannelRoleScope: false,
                allowChannelUserScope: false,
                allowGlobalRoleScope: true,
                allowGlobalUserScope: true
            })

            if (!opendiscord.permissions.hasPermissions(requiredPermission, userPermissions)) {
                instance.reply(await opendiscord.builders.messages.getSafe("opendiscord:error-no-permissions").build(source, {
                    guild,
                    channel,
                    user,
                    permissions: [requiredPermission]
                }))
                return cancel()
            }

            const subcommand = instance.options.getSubCommand()
            if (!subcommand) {
                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Sticky Messages", "No sticky subcommand was provided.", [], "Red")
                }))
                return cancel()
            }

            await instance.defer(true)

            const targetChannel = subcommand === "list" ? null : instance.options.getChannel("channel", true)
            const targetChannelId = targetChannel?.id ?? null

            if (targetChannel && targetChannel.type !== discord.ChannelType.GuildText && targetChannel.type !== discord.ChannelType.GuildAnnouncement) {
                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Unsupported Channel", "Sticky messages only support normal text and announcement channels.", [], "Red")
                }))
                return cancel()
            }

            if (subcommand === "set-text" && targetChannelId) {
                const content = instance.options.getString("content", true)
                const existing = manager.getEntry(targetChannelId)

                if (existing?.attachmentData) manager.deleteAttachmentFile(existing.attachmentData)

                const entry: OTStickyEntry = {
                    version: 1,
                    channelId: targetChannelId,
                    enabled: true,
                    type: "text",
                    mode: existing?.mode ?? "message",
                    messageContent: content,
                    embedData: null,
                    attachmentData: null,
                    lastStickyMessageId: existing?.lastStickyMessageId ?? null,
                    ignoredRoleIds: existing?.ignoredRoleIds ?? [],
                    cooldownMessages: existing?.cooldownMessages ?? 1,
                    timedResendMinutes: existing?.timedResendMinutes ?? null,
                    createdAt: existing?.createdAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }

                manager.saveEntry(entry)
                const resendResult = await manager.resendSticky(targetChannelId)
                const channelLabel = await formatStickyChannel(targetChannelId)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: resendResult.success
                        ? buildReply("Sticky Saved", `A text sticky is now active in ${channelLabel}.`)
                        : buildReply("Sticky Saved With Warning", `The sticky was saved for ${channelLabel}, but it could not be resent immediately.\n\n${resendResult.reason ?? "Unknown error."}`, [], "Yellow")
                }))
                return cancel()
            }

            if (subcommand === "set-embed" && targetChannelId) {
                const existing = manager.getEntry(targetChannelId)
                if (existing?.attachmentData) manager.deleteAttachmentFile(existing.attachmentData)

                const entry: OTStickyEntry = {
                    version: 1,
                    channelId: targetChannelId,
                    enabled: true,
                    type: "embed",
                    mode: existing?.mode ?? "message",
                    messageContent: instance.options.getString("content", false) ?? "",
                    embedData: {
                        title: instance.options.getString("title", false) ?? "",
                        description: instance.options.getString("description", true),
                        color: instance.options.getString("color", false) ?? String(opendiscord.configs.get("opendiscord:general").data.mainColor),
                        footer: instance.options.getString("footer", false) ?? "",
                        imageUrl: sanitizeOptionalUrl(instance.options.getString("image_url", false)),
                        thumbnailUrl: sanitizeOptionalUrl(instance.options.getString("thumbnail_url", false))
                    },
                    attachmentData: null,
                    lastStickyMessageId: existing?.lastStickyMessageId ?? null,
                    ignoredRoleIds: existing?.ignoredRoleIds ?? [],
                    cooldownMessages: existing?.cooldownMessages ?? 1,
                    timedResendMinutes: existing?.timedResendMinutes ?? null,
                    createdAt: existing?.createdAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }

                manager.saveEntry(entry)
                const resendResult = await manager.resendSticky(targetChannelId)
                const channelLabel = await formatStickyChannel(targetChannelId)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: resendResult.success
                        ? buildReply("Embed Sticky Saved", `An embed sticky is now active in ${channelLabel}.`)
                        : buildReply("Sticky Saved With Warning", `The embed sticky was saved for ${channelLabel}, but it could not be resent immediately.\n\n${resendResult.reason ?? "Unknown error."}`, [], "Yellow")
                }))
                return cancel()
            }

            if (subcommand === "set-attachment" && targetChannelId) {
                const existing = manager.getEntry(targetChannelId)
                const interaction = instance.interaction

                if (!(interaction instanceof discord.ChatInputCommandInteraction)) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Attachment Sticky", "Attachment stickies can only be configured from slash commands.", [], "Red")
                    }))
                    return cancel()
                }

                const attachment = interaction.options.getAttachment("attachment", true)
                const attachmentData = await manager.storeAttachment(attachment)

                if (existing?.attachmentData) manager.deleteAttachmentFile(existing.attachmentData)

                const entry: OTStickyEntry = {
                    version: 1,
                    channelId: targetChannelId,
                    enabled: true,
                    type: "attachment",
                    mode: existing?.mode ?? "message",
                    messageContent: instance.options.getString("content", false) ?? "",
                    embedData: null,
                    attachmentData: {
                        ...attachmentData,
                        spoiler: instance.options.getBoolean("spoiler", false) ?? attachmentData.spoiler
                    },
                    lastStickyMessageId: existing?.lastStickyMessageId ?? null,
                    ignoredRoleIds: existing?.ignoredRoleIds ?? [],
                    cooldownMessages: existing?.cooldownMessages ?? 1,
                    timedResendMinutes: existing?.timedResendMinutes ?? null,
                    createdAt: existing?.createdAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }

                manager.saveEntry(entry)
                const resendResult = await manager.resendSticky(targetChannelId)
                const channelLabel = await formatStickyChannel(targetChannelId)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: resendResult.success
                        ? buildReply("Attachment Sticky Saved", `An attachment sticky is now active in ${channelLabel}.`)
                        : buildReply("Sticky Saved With Warning", `The attachment sticky was saved for ${channelLabel}, but it could not be resent immediately.\n\n${resendResult.reason ?? "Unknown error."}`, [], "Yellow")
                }))
                return cancel()
            }

            if (subcommand === "mode" && targetChannelId) {
                const entry = manager.getEntry(targetChannelId)
                if (!entry) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Sticky Not Found", "Create a sticky first before changing its mode.", [], "Red")
                    }))
                    return cancel()
                }

                const mode = instance.options.getString("mode", true) as OTStickyMode
                const minutes = instance.options.getNumber("minutes", false)

                if (mode === "timed" && (!minutes || minutes < 1)) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Missing Minutes", "Timed mode requires a valid `minutes` value of at least 1.", [], "Red")
                    }))
                    return cancel()
                }

                entry.mode = mode
                entry.timedResendMinutes = mode === "timed" ? Math.floor(minutes ?? 1) : null
                manager.saveEntry(entry)

                if (entry.enabled) await manager.resendSticky(entry.channelId)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Sticky Mode Updated", `The sticky mode is now **${formatStickyMode(entry)}**.`)
                }))
                return cancel()
            }

            if (subcommand === "cooldown" && targetChannelId) {
                const entry = manager.getEntry(targetChannelId)
                if (!entry) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Sticky Not Found", "Create a sticky first before changing its cooldown.", [], "Red")
                    }))
                    return cancel()
                }

                entry.cooldownMessages = Math.max(1, Math.floor(instance.options.getNumber("messages", true)))
                manager.saveEntry(entry)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Cooldown Updated", `The sticky will now resend every **${entry.cooldownMessages}** user message(s) while in message mode.`)
                }))
                return cancel()
            }

            if (subcommand === "ignore-role" && targetChannelId) {
                const entry = manager.getEntry(targetChannelId)
                if (!entry) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Sticky Not Found", "Create a sticky first before editing ignored roles.", [], "Red")
                    }))
                    return cancel()
                }

                const action = instance.options.getString("action", true)
                const role = instance.options.getRole("role", true)

                if (action === "add" && !entry.ignoredRoleIds.includes(role.id)) entry.ignoredRoleIds.push(role.id)
                if (action === "remove") entry.ignoredRoleIds = entry.ignoredRoleIds.filter((roleId) => roleId !== role.id)
                manager.saveEntry(entry)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Ignored Roles Updated", `${role.toString()} has been ${action === "add" ? "added to" : "removed from"} the ignored role list.`)
                }))
                return cancel()
            }

            if (subcommand === "enable" && targetChannelId) {
                const entry = manager.getEntry(targetChannelId)
                if (!entry) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Sticky Not Found", "There is no sticky configured for that channel.", [], "Red")
                    }))
                    return cancel()
                }

                entry.enabled = true
                manager.saveEntry(entry)
                const resendResult = await manager.resendSticky(targetChannelId)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: resendResult.success
                        ? buildReply("Sticky Enabled", "The sticky is enabled again and has been resent.")
                        : buildReply("Sticky Enabled With Warning", `The sticky was enabled, but it could not be resent immediately.\n\n${resendResult.reason ?? "Unknown error."}`, [], "Yellow")
                }))
                return cancel()
            }

            if (subcommand === "disable" && targetChannelId) {
                const entry = manager.getEntry(targetChannelId)
                if (!entry) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Sticky Not Found", "There is no sticky configured for that channel.", [], "Red")
                    }))
                    return cancel()
                }

                entry.enabled = false
                manager.saveEntry(entry)
                manager.clearChannelTimer(targetChannelId)
                if (manager.config.data.deleteStickyMessageWhenDisabled) await manager.deleteStickyMessage(entry, true)

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Sticky Disabled", manager.config.data.deleteStickyMessageWhenDisabled
                        ? "The sticky is disabled and the current sticky message has been removed."
                        : "The sticky is disabled. The current sticky message was left in place.")
                }))
                return cancel()
            }

            if (subcommand === "resend" && targetChannelId) {
                const resendResult = await manager.resendSticky(targetChannelId)
                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: resendResult.success
                        ? buildReply("Sticky Resent", "The sticky message was deleted and sent again successfully.")
                        : buildReply("Resend Failed", resendResult.reason ?? "The sticky could not be resent.", [], "Red")
                }))
                return cancel()
            }

            if (subcommand === "show" && targetChannelId) {
                const entry = manager.getEntry(targetChannelId)
                if (!entry) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Sticky Not Found", "There is no sticky configured for that channel.", [], "Red")
                    }))
                    return cancel()
                }

                const channelLabel = await formatStickyChannel(targetChannelId)
                const ignoredRoles = entry.ignoredRoleIds.length > 0 ? truncateText(entry.ignoredRoleIds.map((roleId) => `<@&${roleId}>`).join(", "), 1024) : "None"
                const fields: discord.EmbedField[] = [
                    { name: "Channel", value: channelLabel, inline: false },
                    { name: "Enabled", value: entry.enabled ? "Yes" : "No", inline: true },
                    { name: "Type", value: formatStickyType(entry.type), inline: true },
                    { name: "Mode", value: formatStickyMode(entry), inline: true },
                    { name: "Ignored Roles", value: ignoredRoles, inline: false },
                    { name: "Current Sticky Message", value: entry.lastStickyMessageId ? `\`${entry.lastStickyMessageId}\`` : "None", inline: false }
                ]

                if (entry.messageContent.length > 0) fields.push({ name: "Message Content", value: truncateText(entry.messageContent, 1024), inline: false })
                if (entry.embedData) fields.push({ name: "Embed Preview", value: truncateText(`Title: ${entry.embedData.title || "/"}\nDescription: ${entry.embedData.description || "/"}`, 1024), inline: false })
                if (entry.attachmentData) fields.push({ name: "Attachment", value: `\`${entry.attachmentData.originalName}\``, inline: false })

                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Sticky Details", `Saved sticky settings for ${channelLabel}.`, fields)
                }))
                return cancel()
            }

            if (subcommand === "remove" && targetChannelId) {
                const removed = await manager.removeEntry(targetChannelId, true)
                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: removed
                        ? buildReply("Sticky Removed", "The sticky configuration and the current sticky message were removed.")
                        : buildReply("Sticky Not Found", "There is no sticky configured for that channel.", [], "Red")
                }))
                return cancel()
            }

            if (subcommand === "list") {
                const entries = manager.getAllEntries()
                if (entries.length === 0) {
                    instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                        data: buildReply("Sticky List", "No sticky messages are configured yet.")
                    }))
                    return cancel()
                }

                const fields: discord.EmbedField[] = []
                for (const entry of entries.slice(0, 25)) {
                    fields.push({
                        name: `${entry.enabled ? "Enabled" : "Disabled"} • ${formatStickyType(entry.type)}`,
                        value: `${await formatStickyChannel(entry.channelId)}\nMode: ${formatStickyMode(entry)}`,
                        inline: false
                    })
                }

                const extraText = entries.length > 25 ? `\n\nShowing the first 25 of ${entries.length} sticky channels.` : ""
                instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                    data: buildReply("Sticky List", `Configured sticky channels: **${entries.length}**.${extraText}`, fields)
                }))
                return cancel()
            }

            instance.reply(await opendiscord.builders.messages.getSafe("ot-sticky-messages:reply-message").build(source, {
                data: buildReply("Unknown Subcommand", `The sticky subcommand \`${subcommand}\` is not supported by this plugin.`, [], "Red")
            }))
            return cancel()
        }),
        new api.ODWorker("ot-sticky-messages:logs", -1, (instance, params, source) => {
            const subcommand = instance.options.getSubCommand() ?? "unknown"
            opendiscord.log(instance.user.displayName + " used the 'sticky " + subcommand + "' command!", "plugin", [
                { key: "user", value: instance.user.username },
                { key: "userid", value: instance.user.id, hidden: true },
                { key: "channelid", value: instance.channel.id, hidden: true },
                { key: "method", value: source }
            ])
        })
    ])
})

// RUNTIME LISTENERS
opendiscord.events.get("onCodeLoad").listen(() => {
    const manager = getStickyManager()
    const client = opendiscord.client.client

    client.on("messageCreate", async (message) => {
        await manager.handleMessage(message)
    })

    client.on("channelDelete", async (channel) => {
        if (!channel.isTextBased()) return
        if (!manager.getEntry(channel.id)) return
        await manager.removeEntry(channel.id, false)
    })
})

opendiscord.events.get("onReadyForUsage").listen(() => {
    getStickyManager().boot()
})
