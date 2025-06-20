// index.js

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');

const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AuditLogEvent,
    Events
} = require('discord.js');

const noblox = require('noblox.js');

// Suppress Noblox deprecation warnings globally
noblox.setOptions({ show_deprecation_warnings: false });

const xpManager = require('./xpManager');           // Your XP/Roblox link manager
const permManager = require('./utils/permManager'); // Permissions/rank checks
const configManager = require('./configManager');   // Your config store (e.g., getSetting, setSetting)
const AntiRaidManager = require('./utils/antiRaidManager');
const backupManager = require('./utils/backupManager');
const setupManager = require('./utils/setupManager');
const initDatabase = require('./utils/initDatabase');

const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// -------------------- Anti-Raid Manager --------------------
const antiRaid = new AntiRaidManager(client);
// -------------------- End Anti-Raid Manager --------------------

// ID of channel where to notify bot added to new guild (optional)
const notifyChannelId = process.env.NOTIFY_CHANNEL_ID;

// -------------------- Roblox login --------------------
async function loginRoblox() {
    try {
        if (!process.env.ROBLOX_COOKIE) {
            console.warn('ROBLOX_COOKIE not set');
            return;
        }
        // Set cookie for Noblox
        await noblox.setCookie(process.env.ROBLOX_COOKIE);
        console.log('Roblox login successful');

        // Get authenticated user info
        const botUser = await noblox.getAuthenticatedUser();
        console.log('Roblox getAuthenticatedUser returned:', botUser);
        const botUserId = botUser.id ?? botUser.UserID;
        if (botUserId) {
            client.robloxUserId = botUserId;
            console.log(`Bot Roblox user ID: ${botUserId}`);
        } else {
            console.warn('Could not determine Roblox bot user ID from getAuthenticatedUser():', botUser);
        }
    } catch (err) {
        console.error('Roblox login failed:', err);
    }
}

// -------------------- Helpers for log channels --------------------
async function getLogChannel(guild, settingKey) {
    if (!guild) return null;
    try {
        const channelId = await configManager.getSetting(guild.id, settingKey);
        if (!channelId) return null;
        let channel = guild.channels.cache.get(channelId)
            || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return null;
        const botMember = guild.members.me || await guild.members.fetchMe();
        const perms = channel.permissionsFor(botMember);
        if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            console.warn(`[getLogChannel] Missing perms in channel ${channelId} for guild ${guild.id}`);
            return null;
        }
        return channel;
    } catch (err) {
        console.error(`Error fetching log channel ${settingKey}:`, err);
        return null;
    }
}

async function getMemberLogChannel(guild) {
    return getLogChannel(guild, 'memberLogChannel');
}
async function getMessageLogChannel(guild) {
    return getLogChannel(guild, 'messageLogChannel');
}
async function getModLogChannel(guild) {
    return getLogChannel(guild, 'modLogChannel');
}
async function getRankingLogChannel(guild) {
    return getLogChannel(guild, 'rankingLogChannelId');
}
async function getDemotionLogChannel(guild) {
    return getLogChannel(guild, 'demotionLogChannelId');
}

// -------------------- Methods to log promotion/demotion --------------------
client.logPromotion = async function (guild, user, oldRankName, newRankName, extraInfo = '') {
    try {
        const channel = await getRankingLogChannel(guild);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle('📈 Promotion')
            .setColor('Blue')
            .setDescription(`<@${user.id}> (${user.tag}) was promoted.`)
            .addFields(
                { name: 'Previous Rank', value: oldRankName || 'N/A', inline: true },
                { name: 'New Rank', value: newRankName || 'N/A', inline: true }
            )
            .setTimestamp();
        if (extraInfo) {
            embed.addFields({ name: 'Info', value: extraInfo.slice(0, 1024) });
        }
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in logPromotion:', err);
    }
};

client.logDemotion = async function (guild, user, oldRankName, newRankName, extraInfo = '') {
    try {
        const channel = await getDemotionLogChannel(guild);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle('📉 Demotion')
            .setColor('Orange')
            .setDescription(`<@${user.id}> (${user.tag}) was demoted.`)
            .addFields(
                { name: 'Previous Rank', value: oldRankName || 'N/A', inline: true },
                { name: 'New Rank', value: newRankName || 'N/A', inline: true }
            )
            .setTimestamp();
        if (extraInfo) {
            embed.addFields({ name: 'Info', value: extraInfo.slice(0, 1024) });
        }
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in logDemotion:', err);
    }
};

// -------------------- Premium check --------------------
async function checkPremium(member) {
    try {
        if (typeof xpManager.isPremiumUser === 'function') {
            return await xpManager.isPremiumUser(member.user.id);
        }
        if (typeof xpManager.isPremiumInGuild === 'function') {
            return await xpManager.isPremiumInGuild(member.guild.id, member.user.id);
        }
    } catch (e) {
        console.warn('Error checking premium status:', e);
    }
    return false;
}

// -------------------- Command loader --------------------
client.commands = new Map();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if (command.data && command.execute) {
                client.commands.set(command.data.name, command);
                console.log(`Loaded command: ${command.data.name}`);
            } else {
                console.warn(`Skipping ${file}: missing data or execute property`);
            }
        } catch (err) {
            console.error(`Error loading command ${file}:`, err);
        }
    }
}

// -------------------- Bot ready --------------------
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await loginRoblox();

    // Initialize DB tables if needed
    try {
        await initDatabase();
    } catch (err) {
        console.error('Error in initDatabase:', err);
    }

    // Example: sync XP every 15 minutes
    setInterval(async () => {
        console.log('Sync XP (stub)');
        // your xp sync logic here...
    }, 15 * 60 * 1000);
});

// -------------------- Send setup DM to guild owner on join & notify in channel --------------------
client.on('guildCreate', async (guild) => {
    try {
        let inviterInfo = 'Unknown (no audit log)';
        try {
            const logs = await guild.fetchAuditLogs({
                type: AuditLogEvent.BotAdd,
                limit: 1
            });
            const entry = logs.entries.first();
            if (entry && entry.target && entry.target.id === client.user.id) {
                const executor = entry.executor;
                inviterInfo = `${executor.tag} (${executor.id})`;
            }
        } catch (err) {
            console.warn(`Cannot fetch audit log in guild ${guild.id}:`, err);
        }

        const embedNotify = new EmbedBuilder()
            .setTitle('🤖 Bot Added to Server')
            .setColor('Blue')
            .addFields(
                { name: 'Server Name', value: guild.name, inline: false },
                { name: 'Server ID', value: guild.id, inline: false },
                { name: 'Member Count', value: String(guild.memberCount), inline: true },
                { name: 'Invited By', value: inviterInfo, inline: false }
            )
            .setTimestamp();

        if (notifyChannelId) {
            try {
                const ch = await client.channels.fetch(notifyChannelId);
                if (ch && ch.isTextBased()) {
                    await ch.send({ embeds: [embedNotify] });
                } else {
                    console.warn('Notify channel is not text-based or not found:', notifyChannelId);
                }
            } catch (err) {
                console.error('Failed to send notify embed to channel:', err);
            }
        } else {
            console.warn('NOTIFY_CHANNEL_ID not set in .env');
        }
    } catch (err) {
        console.error('Error sending notify in guildCreate:', err);
    }

    // DM setup instructions to guild owner
    try {
        const ownerMember = await guild.fetchOwner();
        const ownerUser = ownerMember.user;
        if (!ownerUser) {
            console.warn(`Could not fetch owner for guild ${guild.id}`);
            return;
        }

        const setupMessage = `
📌 **How to set up the Bot**

1️⃣ If you haven't verified yet, use \`/verify\` to link your Roblox account to your Discord account.

2️⃣ Then use \`/setup\` and enter your **Group ID** (found in your Roblox group link) to connect your Roblox group to your Discord server.

✅ Done! Now you can use features like:
- \`/profile\` → Check account info
- \`/warns add\` → Give warnings
- \`/warns\` → View warnings
- \`/medal create\` → Create medals
- \`/setwelcomelogs enable\` → Enable welcome logs
- Logs for deleted/edited messages, joins/leaves, and more!

🛠️ Start managing your community!
`.trim();

        await ownerUser.send({
            content: `📥 **Bot joined your server**\nServer: **${guild.name}** (ID: ${guild.id})\n\n${setupMessage}`
        });
        console.log(`Sent setup instructions to ${ownerUser.tag} for server ${guild.name}`);
    } catch (err) {
        console.error('Error sending DM to guild owner:', err);
    }
});

// -------------------- Welcome message handler --------------------
client.on('guildMemberAdd', async member => {
    try {
        const cfg = await configManager.getSetting(member.guild.id, 'welcome') || {};
        if (!cfg.enabled) return;

        const welcomeChannel = member.guild.channels.cache.get(cfg.channelId)
            || await member.guild.channels.fetch(cfg.channelId).catch(() => null);
        if (!welcomeChannel || !welcomeChannel.isTextBased()) return;

        const messageText = (cfg.message || '').replace('{user}', `<@${member.user.id}>`);

        const createdTimestampSec = Math.floor(member.user.createdTimestamp / 1000);
        const joinTimestampSec = Math.floor(Date.now() / 1000);

        const isPremium = await checkPremium(member);

        const embed = new EmbedBuilder()
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setTimestamp()
            .setFooter({ text: `User ID: ${member.user.id}` });

        if (isPremium) {
            embed
                .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true, size: 64 }) })
                .setTitle('👑 Welcome, Premium Member!')
                .setDescription(messageText || 'Welcome!')
                .setColor('Gold')
                .addFields(
                    {
                        name: 'Account Created',
                        value: `<t:${createdTimestampSec}:D> (<t:${createdTimestampSec}:R>)`,
                        inline: true
                    },
                    {
                        name: 'Member Number',
                        value: `#${member.guild.memberCount}`,
                        inline: true
                    },
                    {
                        name: 'Joined At',
                        value: `<t:${joinTimestampSec}:T> (<t:${joinTimestampSec}:R>)`,
                        inline: true
                    },
                    {
                        name: 'Premium Perks',
                        value: 'Thank you for being a premium user! Enjoy exclusive perks.',
                        inline: false
                    }
                );
            if (cfg.backgroundUrlPremium) {
                embed.setImage(cfg.backgroundUrlPremium);
            } else if (cfg.backgroundUrl) {
                embed.setImage(cfg.backgroundUrl);
            } else if (member.guild.bannerURL) {
                embed.setImage(member.guild.bannerURL({ size: 1024 }));
            }
        } else {
            embed
                .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL({ dynamic: true, size: 64 }) || undefined })
                .setTitle('👋 Welcome!')
                .setDescription(messageText || 'Welcome!')
                .setColor('#00BFFF')
                .addFields(
                    {
                        name: 'Account Created',
                        value: `<t:${createdTimestampSec}:D> (<t:${createdTimestampSec}:R>)`,
                        inline: true
                    },
                    {
                        name: 'Member Number',
                        value: `#${member.guild.memberCount}`,
                        inline: true
                    },
                    {
                        name: 'Joined At',
                        value: `<t:${joinTimestampSec}:T> (<t:${joinTimestampSec}:R>)`,
                        inline: true
                    }
                );
            if (cfg.backgroundUrl) {
                embed.setImage(cfg.backgroundUrl);
            } else if (member.guild.bannerURL) {
                embed.setImage(member.guild.bannerURL({ size: 1024 }));
            }
        }

        const components = [];
        if (cfg.rulesChannelId) {
            const rulesUrl = `https://discord.com/channels/${member.guild.id}/${cfg.rulesChannelId}`;
            components.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('📜 Rules')
                        .setStyle(ButtonStyle.Link)
                        .setURL(rulesUrl)
                )
            );
        }

        await welcomeChannel.send({ embeds: [embed], components });
    } catch (err) {
        console.error('Error in welcome handler:', err);
    }
});

// -------------------- Member join/leave logs --------------------
client.on('guildMemberAdd', async member => {
    try {
        const logChannel = await getMemberLogChannel(member.guild);
        if (!logChannel) return;
        const embed = new EmbedBuilder()
            .setTitle('👋 Member Joined')
            .setColor('Green')
            .setDescription(`${member.user.tag} (<@${member.user.id}>) has joined.`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .addFields(
                {
                    name: 'Account Created',
                    value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`,
                    inline: true
                }
            )
            .setTimestamp();
        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in member join log handler:', err);
    }
});
client.on('guildMemberRemove', async member => {
    try {
        const logChannel = await getMemberLogChannel(member.guild);
        if (!logChannel) return;
        const embed = new EmbedBuilder()
            .setTitle('👤 Member Left')
            .setColor('Red')
            .setDescription(`${member.user.tag} (<@${member.user.id}>) has left.`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setTimestamp();
        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in member leave log handler:', err);
    }
});

// -------------------- Message delete/edit logs --------------------
client.on('messageDelete', async message => {
    try {
        if (!message.guild) return;
        if (message.partial) {
            try {
                message = await message.fetch();
            } catch {
                return;
            }
        }
        const channel = await getMessageLogChannel(message.guild);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Message Deleted')
            .setColor('Orange')
            .addFields(
                { name: 'Author', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Content', value: message.content?.slice(0, 1024) || '`No text content`' }
            )
            .setTimestamp();
        if (message.attachments.size > 0) {
            const urls = message.attachments.map(att => att.url).join('\n');
            embed.addFields({ name: 'Attachments', value: urls.slice(0, 1024) });
        }
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in messageDelete log:', err);
    }
});
client.on('messageUpdate', async (oldMsg, newMsg) => {
    try {
        if (!oldMsg.guild) return;
        if (oldMsg.partial) {
            try { oldMsg = await oldMsg.fetch(); }
            catch { return; }
        }
        if (newMsg.partial) {
            try { newMsg = await newMsg.fetch(); }
            catch { return; }
        }
        if (oldMsg.content === newMsg.content) return;
        const channel = await getMessageLogChannel(oldMsg.guild);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle('✏️ Message Edited')
            .setColor('Yellow')
            .addFields(
                { name: 'Author', value: `${oldMsg.author.tag} (<@${oldMsg.author.id}>)`, inline: true },
                { name: 'Channel', value: `<#${oldMsg.channel.id}>`, inline: true },
                { name: 'Before', value: oldMsg.content?.slice(0, 1024) || '`No text content`' },
                { name: 'After', value: newMsg.content?.slice(0, 1024) || '`No text content`' }
            )
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in messageUpdate log:', err);
    }
});

// -------------------- Moderation logs --------------------
client.on('guildBanAdd', async (ban) => {
    try {
        const channel = await getModLogChannel(ban.guild);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle('🔨 User Banned')
            .setColor('DarkRed')
            .setDescription(`${ban.user.tag} (<@${ban.user.id}>) was banned.`)
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in guildBanAdd log:', err);
    }
});

client.on('guildBanRemove', async (ban) => {
    try {
        const channel = await getModLogChannel(ban.guild);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle('♻️ User Unbanned')
            .setColor('Green')
            .setDescription(`${ban.user.tag} (<@${ban.user.id}>) was unbanned.`)
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error in guildBanRemove log:', err);
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        const oldUntil = oldMember.communicationDisabledUntilTimestamp;
        const newUntil = newMember.communicationDisabledUntilTimestamp;
        if (!oldUntil && newUntil && newUntil > Date.now()) {
            const channel = await getModLogChannel(newMember.guild);
            if (!channel) return;
            const embed = new EmbedBuilder()
                .setTitle('⏱️ Member Timed Out')
                .setColor('Orange')
                .setDescription(`<@${newMember.user.id}> was put in timeout until <t:${Math.floor(newUntil / 1000)}:F>.`)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        } else if (oldUntil && (!newUntil || newUntil <= Date.now())) {
            const channel = await getModLogChannel(newMember.guild);
            if (!channel) return;
            const embed = new EmbedBuilder()
                .setTitle('✅ Timeout Removed')
                .setColor('Green')
                .setDescription(`<@${newMember.user.id}>'s timeout has been removed.`)
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('Error in guildMemberUpdate log:', err);
    }
});

// -------------------- Interaction Create handler --------------------
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const disabled = await configManager.getSetting(interaction.guildId, 'disabledChannels') || [];
            if (Array.isArray(disabled) && disabled.includes(interaction.channelId)) {
                return interaction.reply({
                    content: '❌ Commands are disabled in this channel.',
                    ephemeral: true
                });
            }

            const cmdName = interaction.commandName;
            const command = client.commands.get(cmdName);
            if (!command) {
                return interaction.reply({
                    content: '❌ Command not found.',
                    ephemeral: true
                });
            }

            if (command.ownerOnly) {
                const ownerId = await permManager.getOwner(interaction.guildId, interaction.guild.ownerId);
                if (interaction.user.id !== ownerId) {
                    return interaction.reply({
                        content: '❌ Only the server owner can use this command.',
                        ephemeral: true
                    });
                }
            }

            if (command.minRank !== undefined) {
                const ok = await permManager.hasRank(interaction.guildId, interaction.user.id, command.minRank);
                if (!ok) {
                    return interaction.reply({
                        content: `❌ You need rank ≥ ${command.minRank} to use this command.`,
                        ephemeral: true
                    });
                }
            }

            try {
                await command.execute(interaction);

                if (cmdName === 'antiraid') {
                    await antiRaid.updateConfigCache(interaction.guildId);
                    const sub = interaction.options.getSubcommand();
                    if (sub === 'reset') {
                        await antiRaid.resetLockdown(interaction.guildId);
                    }
                }
            } catch (err) {
                console.error(`Error executing command ${cmdName}:`, err);
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.reply({ content: '❌ Internal error.', ephemeral: true });
                }
                if (interaction.deferred) {
                    return interaction.editReply({ content: '❌ Internal error.', ephemeral: true });
                }
                return interaction.followUp({ content: '❌ Internal error.', ephemeral: true });
            }
        }
        else if (interaction.isButton()) {
            try {
                const handler = require('./events/interactionCreate');
                if (handler && typeof handler.execute === 'function') {
                    await handler.execute(interaction);
                }
            } catch (err) {
                console.error('Button interaction error:', err);
            }
        }
    } catch (err) {
        console.error('Error in interactionCreate handler:', err);
    }
});

// -------------------- Express App Setup (optional) --------------------
const app = express();
app.use(bodyParser.json());
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(`Express server listening on port ${PORT}`));

// -------------------- Start Bot --------------------
if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN not set');
    process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
