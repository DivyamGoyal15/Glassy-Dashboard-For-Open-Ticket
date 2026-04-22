import { api, opendiscord, utilities } from "#opendiscord"
import * as discord from "discord.js"

if (utilities.project != "openticket") throw new api.ODPluginError("This plugin only works in Open Ticket!")

// 1. TYPE DEFINITIONS
export interface ESEWelcomerConfig {
    welcomeChannelId: string;
    testTitle: string; 
    messageContent: string;
    embed: {
        color: string;
        title: string;
        description: string;
        footer: string;
        thumbnail: string;
        image: string;
        timestamp: boolean;
        author: { name: string; icon: string; url: string; }
    };
    leaveChannelId: string;
    leaveTestTitle: string;
    leaveMessageContent: string;
    leaveEmbed: {
        color: string;
        title: string;
        description: string;
        footer: string;
        thumbnail: string;
        image: string;
        timestamp: boolean;
        author: { name: string; icon: string; url: string; }
    }
}

export class ESEWelcomerJsonConfig extends api.ODJsonConfig {
    declare data: ESEWelcomerConfig
}

// 2. DECLARATIONS
declare module "#opendiscord-types" {
    export interface ODPluginManagerIds_Default { "ese-welcomer": api.ODPlugin }
    export interface ODConfigManagerIds_Default { "ese-welcomer:config": ESEWelcomerJsonConfig }
    export interface ODCheckerManagerIds_Default { "ese-welcomer:config": api.ODChecker }
    export interface ODSlashCommandManagerIds_Default {
        "ese-welcomer:welcome-command": api.ODSlashCommand
        "ese-welcomer:leave-command": api.ODSlashCommand
    }
    export interface ODMessageManagerIds_Default {
        "ese-welcomer:welcome-msg": { source: "slash" | "other", params: { configData: ESEWelcomerConfig, member: discord.GuildMember }, workers: "ese-welcomer:welcome-msg" }
        "ese-welcomer:leave-msg": { source: "slash" | "other", params: { configData: ESEWelcomerConfig, member: discord.GuildMember }, workers: "ese-welcomer:leave-msg" }
        "ese-welcomer:reload-message": { source: "slash", params: { success: boolean, type: string }, workers: "ese-welcomer:reload-message" }
    }
    export interface ODEmbedManagerIds_Default {
        "ese-welcomer:welcome-embed": { source: "slash" | "other", params: { configData: ESEWelcomerConfig, member: discord.GuildMember }, workers: "ese-welcomer:welcome-embed" }
        "ese-welcomer:leave-embed": { source: "slash" | "other", params: { configData: ESEWelcomerConfig, member: discord.GuildMember }, workers: "ese-welcomer:leave-embed" }
    }
}

// 3. REGISTER CONFIG
opendiscord.events.get("onConfigLoad").listen((configs) => {
    configs.add(new ESEWelcomerJsonConfig("ese-welcomer:config", "config.json", "./plugins/ese-welcomer/"))
})

// 4. UTILITY FUNCTIONS
const getThumbnailUrl = (member: discord.GuildMember | discord.PartialGuildMember, configThumb: string): string | undefined => {
    if (configThumb.toLowerCase() === "user-icon") return member.user?.displayAvatarURL({ size: 512 });
    return configThumb.startsWith("http") ? configThumb : undefined;
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// 5. REGISTER SLASH COMMANDS
opendiscord.events.get("onSlashCommandLoad").listen((slash) => {
    const options = [
        { type: discord.ApplicationCommandOptionType.Subcommand, name: "test", description: "Test the message output" },
        { type: discord.ApplicationCommandOptionType.Subcommand, name: "reload", description: "Reload the plugin configuration" }
    ] as any;

    slash.add(new api.ODSlashCommand("ese-welcomer:welcome-command", {
        name: "welcome", description: "Manage welcome messages", type: 1, contexts: [0], integrationTypes: [0], options: options
    }));
    slash.add(new api.ODSlashCommand("ese-welcomer:leave-command", {
        name: "leave", description: "Manage leave messages", type: 1, contexts: [0], integrationTypes: [0], options: options
    }));
})

// 5.5 REGISTER HELP MENU (Fix: Alle 4 commands apart met slash in het Engels)
opendiscord.events.get("onHelpMenuComponentLoad").listen((menu) => {
    const extraCategory = menu.get("opendiscord:extra");
    
    extraCategory.add(new api.ODHelpMenuCommandComponent("ese-welcomer:welcome-test", 0, {
        slashName: "/welcome test",
        slashDescription: "Test the welcome message output in this channel."
    }));

    extraCategory.add(new api.ODHelpMenuCommandComponent("ese-welcomer:welcome-reload", 1, {
        slashName: "/welcome reload",
        slashDescription: "Reload the welcome message configuration."
    }));

    extraCategory.add(new api.ODHelpMenuCommandComponent("ese-welcomer:leave-test", 2, {
        slashName: "/leave test",
        slashDescription: "Test the leave message output in this channel."
    }));

    extraCategory.add(new api.ODHelpMenuCommandComponent("ese-welcomer:leave-reload", 3, {
        slashName: "/leave reload",
        slashDescription: "Reload the leave message configuration."
    }));
})

// 6. BUILDERS
opendiscord.events.get("onEmbedBuilderLoad").listen((embeds) => {
    // Welcome Embed
    embeds.add(new api.ODEmbed("ese-welcomer:welcome-embed"))
    embeds.get("ese-welcomer:welcome-embed").workers.add(new api.ODWorker("ese-welcomer:welcome-embed", 0, (instance, params) => {
        const { configData, member } = params;
        const data = configData.embed;
        if (data.author && data.author.name) {
            instance.setAuthor(
                data.author.name.replace("{user}", member.displayName).replace("{server}", member.guild.name), 
                data.author.icon.startsWith("http") ? data.author.icon : undefined,
                data.author.url.startsWith("http") ? data.author.url : undefined
            );
        }
        instance.setTitle((data.title || "Welcome").replace("{server}", member.guild.name));
        instance.setDescription((data.description || "").replace("{user}", member.toString()).replace("{server}", member.guild.name));
        instance.setColor((data.color as any) || "#ff8c00");
        if (data.footer) instance.setFooter(data.footer.replace("{server}", member.guild.name));
        const thumb = getThumbnailUrl(member, data.thumbnail);
        if (thumb) instance.setThumbnail(thumb);
        if (data.timestamp) instance.setTimestamp(new Date());
    }));

    // Leave Embed
    embeds.add(new api.ODEmbed("ese-welcomer:leave-embed"))
    embeds.get("ese-welcomer:leave-embed").workers.add(new api.ODWorker("ese-welcomer:leave-embed", 0, (instance, params) => {
        const { configData, member } = params;
        const data = configData.leaveEmbed;
        if (data.author && data.author.name) {
            instance.setAuthor(
                data.author.name.replace("{user}", member.displayName).replace("{server}", member.guild.name), 
                data.author.icon.startsWith("http") ? data.author.icon : undefined,
                data.author.url.startsWith("http") ? data.author.url : undefined
            );
        }
        instance.setTitle((data.title || "Goodbye").replace("{user}", member.displayName).replace("{server}", member.guild.name));
        instance.setDescription((data.description || "").replace("{user}", member.toString()).replace("{server}", member.guild.name));
        instance.setColor((data.color as any) || "#ff0000");
        if (data.footer) instance.setFooter(data.footer.replace("{server}", member.guild.name));
        const thumb = getThumbnailUrl(member, data.thumbnail);
        if (thumb) instance.setThumbnail(thumb);
        if (data.timestamp) instance.setTimestamp(new Date());
    }));
})

opendiscord.events.get("onMessageBuilderLoad").listen((messages) => {
    messages.add(new api.ODMessage("ese-welcomer:welcome-msg"));
    messages.get("ese-welcomer:welcome-msg").workers.add(new api.ODWorker("ese-welcomer:welcome-msg", 0, async (instance, params, source) => {
        instance.addEmbed(await opendiscord.builders.embeds.getSafe("ese-welcomer:welcome-embed").build(source, params));
        instance.setContent((params.configData.testTitle + params.configData.messageContent).replace("{user}", params.member.toString()).replace("{server}", params.member.guild.name));
        if (source === "slash") instance.setEphemeral(true);
    }));

    messages.add(new api.ODMessage("ese-welcomer:leave-msg"));
    messages.get("ese-welcomer:leave-msg").workers.add(new api.ODWorker("ese-welcomer:leave-msg", 0, async (instance, params, source) => {
        instance.addEmbed(await opendiscord.builders.embeds.getSafe("ese-welcomer:leave-embed").build(source, params));
        instance.setContent((params.configData.leaveTestTitle + params.configData.leaveMessageContent).replace("{user}", params.member.toString()).replace("{server}", params.member.guild.name));
        if (source === "slash") instance.setEphemeral(true);
    }));

    messages.add(new api.ODMessage("ese-welcomer:reload-message"));
    messages.get("ese-welcomer:reload-message").workers.add(new api.ODWorker("ese-welcomer:reload-message", 0, async (instance, params, source) => {
        instance.setContent(params.success ? `✅ **ESE-Welcomer ${params.type} configuration successfully reloaded!**` : "❌ **An error occurred during reload.**");
        if (source === "slash") instance.setEphemeral(true);
    }));
})

// 7. COMMAND RESPONDERS
opendiscord.events.get("onCommandResponderLoad").listen((commands) => {
    const general = opendiscord.configs.get("opendiscord:general");
    const purplePlugin = "\x1b[35m[PLUGIN]\x1b[0m";
    const grey = "\x1b[90m";
    const reset = "\x1b[0m";

    const welcomeRes = new api.ODCommandResponder("ese-welcomer:welcome-responder", general.data.prefix, "welcome");
    commands.add(welcomeRes);
    welcomeRes.workers.add(new api.ODWorker("ese-welcomer:welcome-worker", 0, async (instance, params, source, cancel) => {
        if (source !== "slash") return;
        const scope = instance.options.getSubCommand();
        const config = opendiscord.configs.get("ese-welcomer:config");
        if (!config || !config.data) return cancel();
        const formattedUser = capitalize(instance.user.username);
        if (scope === "test") {
            console.log(`${purplePlugin} ${formattedUser} used welcome-test! ${grey}(user: ${instance.user.username}, method: slash)${reset}`);
            instance.reply(await opendiscord.builders.messages.getSafe("ese-welcomer:welcome-msg").build(source, { configData: config.data, member: instance.member as discord.GuildMember }));
            return cancel();
        }
        if (scope === "reload") {
            await config.init();
            console.log(`${purplePlugin} ${formattedUser} reloaded welcome config! ${grey}(user: ${instance.user.username}, method: slash)${reset}`);
            instance.reply(await opendiscord.builders.messages.getSafe("ese-welcomer:reload-message").build(source, { success: true, type: "Welcome" }));
            return cancel();
        }
    }));

    const leaveRes = new api.ODCommandResponder("ese-welcomer:leave-responder", general.data.prefix, "leave");
    commands.add(leaveRes);
    leaveRes.workers.add(new api.ODWorker("ese-welcomer:leave-worker", 0, async (instance, params, source, cancel) => {
        if (source !== "slash") return;
        const scope = instance.options.getSubCommand();
        const config = opendiscord.configs.get("ese-welcomer:config");
        if (!config || !config.data) return cancel();
        const formattedUser = capitalize(instance.user.username);
        if (scope === "test") {
            console.log(`${purplePlugin} ${formattedUser} used leave-test! ${grey}(user: ${instance.user.username}, method: slash)${reset}`);
            instance.reply(await opendiscord.builders.messages.getSafe("ese-welcomer:leave-msg").build(source, { configData: config.data, member: instance.member as discord.GuildMember }));
            return cancel();
        }
        if (scope === "reload") {
            await config.init();
            console.log(`${purplePlugin} ${formattedUser} reloaded leave config! ${grey}(user: ${instance.user.username}, method: slash)${reset}`);
            instance.reply(await opendiscord.builders.messages.getSafe("ese-welcomer:reload-message").build(source, { success: true, type: "Leave" }));
            return cancel();
        }
    }));
})

// 8. AUTOMATIC EVENTS
opendiscord.events.get("onCodeLoad").listen(() => {
    const client = (opendiscord.client as any).client as discord.Client;
    if (!client) return;

    client.on("guildMemberAdd", async (member) => {
        const config = opendiscord.configs.get("ese-welcomer:config");
        if (!config || !config.data) return;
        const data = config.data;
        const channel = client.channels.cache.get(data.welcomeChannelId) as discord.TextChannel;
        if (!channel || !channel.isTextBased()) return;
        
        const embed = new discord.EmbedBuilder()
            .setTitle((data.embed.title || "Welcome").replace("{server}", member.guild.name))
            .setDescription((data.embed.description || "").replace("{user}", member.toString()).replace("{server}", member.guild.name))
            .setColor((data.embed.color as any) || "#ff8c00");
        
        if (data.embed.author && data.embed.author.name) {
            embed.setAuthor({ 
                name: data.embed.author.name.replace("{user}", member.displayName), 
                iconURL: data.embed.author.icon.startsWith("http") ? data.embed.author.icon : undefined,
                url: data.embed.author.url.startsWith("http") ? data.embed.author.url : undefined
            });
        }
        if (data.embed.footer) embed.setFooter({ text: data.embed.footer.replace("{server}", member.guild.name) });
        const thumb = getThumbnailUrl(member, data.embed.thumbnail);
        if (thumb) embed.setThumbnail(thumb);
        if (data.embed.timestamp) embed.setTimestamp();
        
        channel.send({ content: data.messageContent.replace("{user}", member.toString()).replace("{server}", member.guild.name), embeds: [embed] }).catch(() => {});
    });

    client.on("guildMemberRemove", async (member) => {
        const config = opendiscord.configs.get("ese-welcomer:config");
        if (!config || !config.data) return;
        const data = config.data;
        const channel = client.channels.cache.get(data.leaveChannelId) as discord.TextChannel;
        if (!channel || !channel.isTextBased()) return;
        
        const embed = new discord.EmbedBuilder()
            .setTitle((data.leaveEmbed.title || "Goodbye").replace("{user}", member.displayName).replace("{server}", member.guild.name))
            .setDescription((data.leaveEmbed.description || "").replace("{user}", member.toString()).replace("{server}", member.guild.name))
            .setColor((data.leaveEmbed.color as any) || "#ff0000");

        if (data.leaveEmbed.author && data.leaveEmbed.author.name) {
            embed.setAuthor({ 
                name: data.leaveEmbed.author.name.replace("{user}", member.displayName), 
                iconURL: data.leaveEmbed.author.icon.startsWith("http") ? data.leaveEmbed.author.icon : undefined,
                url: data.leaveEmbed.author.url.startsWith("http") ? data.leaveEmbed.author.url : undefined
            });
        }
        if (data.leaveEmbed.footer) embed.setFooter({ text: data.leaveEmbed.footer.replace("{server}", member.guild.name) });
        const thumb = getThumbnailUrl(member as any, data.leaveEmbed.thumbnail);
        if (thumb) embed.setThumbnail(thumb);
        if (data.leaveEmbed.timestamp) embed.setTimestamp();
        
        channel.send({ content: data.leaveMessageContent.replace("{user}", member.toString()).replace("{server}", member.guild.name), embeds: [embed] }).catch(() => {});
    });
});
