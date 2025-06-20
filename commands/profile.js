// commands/profile.js
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} = require('discord.js');
const noblox = require('noblox.js');
const xpManager = require('../xpManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View a Roblox profile with server-specific badges & warnings')
        .addStringOption(o =>
            o.setName('username')
                .setDescription('Roblox username (omit for your linked account)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();
        await noblox.setCookie(process.env.ROBLOX_COOKIE);

        const guildId = interaction.guild.id;
        const guildOwnerId = interaction.guild.ownerId;

        // Premium checks as before
        const hasGuildPremium = await xpManager.isPremiumInGuild(guildId, guildOwnerId);
        const mainGuildId = process.env.MAIN_GUILD_ID;
        const premiumRoleId = process.env.PREMIUM_ROLE_ID;
        let hasRolePremium = false;
        if (mainGuildId && premiumRoleId) {
            const mainGuild = interaction.client.guilds.cache.get(mainGuildId);
            if (mainGuild) {
                try {
                    const mainMember = await mainGuild.members.fetch(guildOwnerId);
                    hasRolePremium = mainMember.roles.cache.has(premiumRoleId);
                } catch { }
            }
        }
        const isPremiumSession = hasGuildPremium || hasRolePremium;

        const inputUsername = interaction.options.getString('username');
        const linkedName = await xpManager.getLinked(interaction.user.id);
        const robloxName = inputUsername || linkedName;
        if (!robloxName) return interaction.editReply('❗ You have no linked Roblox account. Use /verify first.');

        let userId, userInfo, thumb;
        try {
            userId = await noblox.getIdFromUsername(robloxName);
            userInfo = await noblox.getUserInfo(userId);
            thumb = await noblox.getPlayerThumbnail(userId, 150, 'png', false, 'Headshot');
        } catch {
            return interaction.editReply(`❌ Failed to fetch data for **${robloxName}**.`);
        }
        const avatarUrl = Array.isArray(thumb) ? thumb[0]?.imageUrl : thumb?.imageUrl;

        // Fetch server-specific badges and warnings
        const botBadges = await xpManager.getBadges(userId, guildId);
        const warns = await xpManager.getWarnings(userId, guildId) || [];

        const embed = new EmbedBuilder()
            .setTitle(`${isPremiumSession ? '🌟 Premium' : 'Profile'} – ${userInfo.name}`)
            .setThumbnail(avatarUrl)
            .setColor(isPremiumSession ? 0xFFD700 : 0x5865f2)
            .setTimestamp()
            .addFields(
                { name: 'User ID', value: userId.toString(), inline: true },
                { name: 'Account Age', value: `${userInfo.age} days`, inline: true },
                { name: 'Created At', value: new Date(userInfo.created).toLocaleDateString(), inline: true }
            )
            .setDescription(isPremiumSession
                ? '🏅 **Premium Member**\nAll features unlocked.'
                : '🔹 **Free Profile**\nYou can view and manage badges & warnings specific to this server!');

        // Add bot-managed badge & warning counts
        embed.addFields(
            { name: 'Server Badges', value: `${botBadges.length}`, inline: true },
            { name: 'Server Warnings', value: `${warns.length}`, inline: true }
        );

        // Action buttons always clickable
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`iden_${userId}`).setLabel('Identification').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`grps_${userId}`).setLabel('Groups').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`meds_${userId}`).setLabel('Badges').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`qual_${userId}`).setLabel('User Info').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`warn_${userId}`).setLabel('Warnings').setStyle(ButtonStyle.Danger)
        );

        const reply = await interaction.editReply({ embeds: [embed], components: [row], fetchReply: true });

        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120000
        });

        collector.on('collect', async btn => {
            if (btn.user.id !== interaction.user.id) return btn.reply({ content: '❌ These buttons are not for you.', ephemeral: true });

            const [type, uidStr] = btn.customId.split('_');
            const uid = parseInt(uidStr, 10);
            let detailEmbed;

            try {
                switch (type) {
                    case 'iden': {
                        const fresh = await noblox.getUserInfo(uid);
                        detailEmbed = new EmbedBuilder()
                            .setTitle(`${fresh.name} – Identification`)
                            .addFields(
                                { name: 'Name', value: fresh.name, inline: true },
                                { name: 'ID', value: uid.toString(), inline: true },
                                { name: 'Age', value: `${fresh.age} days`, inline: true },
                                { name: 'Created At', value: new Date(fresh.created).toLocaleDateString(), inline: true }
                            )
                            .setColor(0x5865f2)
                            .setTimestamp();
                        break;
                    }
                    case 'grps': {
                        const grps = await noblox.getGroups(uid);
                        detailEmbed = new EmbedBuilder()
                            .setTitle('🛡️ Groups')
                            .setDescription(grps.length ? grps.map(g => `**${g.Name}** — ${g.Role}`).join('\n') : 'No groups.')
                            .setColor(0x2ecc71)
                            .setTimestamp();
                        break;
                    }
                    case 'meds': {
                        // Bot-managed badges per server
                        const serverBadges = await xpManager.getBadges(uid, guildId);
                        detailEmbed = new EmbedBuilder()
                            .setTitle('🎖️ Server Badges')
                            .setDescription(serverBadges.length ? serverBadges.map(b => b.name).join('\n') : 'No badges in this server.')
                            .setColor(0xf1c40f)
                            .setTimestamp();
                        break;
                    }
                    case 'qual': {
                        const fresh = await noblox.getUserInfo(uid);
                        const discordId = await xpManager.getDiscordUserIdFromRobloxName(fresh.name);
                        let mention = 'N/A', roleMention = 'N/A';
                        if (discordId) {
                            const m = await interaction.guild.members.fetch(discordId).catch(() => null);
                            if (m) {
                                mention = `<@${m.id}>`;
                                roleMention = m.roles.highest?.id ? `<@&${m.roles.highest.id}>` : 'N/A';
                            }
                        }
                        detailEmbed = new EmbedBuilder()
                            .setTitle('🏆 User Info')
                            .addFields(
                                { name: 'Display Name', value: fresh.displayName || 'N/A', inline: true },
                                { name: 'Discord User', value: mention, inline: true },
                                { name: 'Highest Role', value: roleMention, inline: true }
                            )
                            .setColor(0x9b59b6)
                            .setTimestamp();
                        break;
                    }
                    case 'warn': {
                        // Server-specific warnings
                        const serverWarns = await xpManager.getWarnings(uid, guildId) || [];
                        detailEmbed = new EmbedBuilder()
                            .setTitle('👮 Warnings')
                            .setDescription(serverWarns.length ? serverWarns.map((w, i) => `${i + 1}. ${w}`).join('\n') : 'No warnings in this server.')
                            .setColor(0xe74c3c)
                            .setTimestamp();
                        break;
                    }
                }

                if (detailEmbed) await btn.update({ embeds: [detailEmbed], components: [row] });
            } catch (err) {
                console.error('[profile collector]', err);
                await btn.update({ content: '❌ An error occurred.', embeds: [], components: [] });
            }
        });

        collector.on('end', async () => {
            const disabled = new ActionRowBuilder().addComponents(
                row.components.map(b => ButtonBuilder.from(b).setDisabled(true))
            );
            await reply.edit({ components: [disabled] });
        });
    }
};