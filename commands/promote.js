// commands/promote.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const noblox = require('noblox.js');
const xpDb = require('../xpManager');
const cfg = require('../configManager');
const permManager = require('../utils/permManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a user one rank up in the Roblox group')
        .addUserOption(o =>
            o
                .setName('user')
                .setDescription('Target Discord user')
                .setRequired(true)
        )
        .addStringOption(o =>
            o
                .setName('reason')
                .setDescription('Reason for promotion')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const executorId = interaction.user.id;
        const targetDc = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');

        // 1️⃣ Verify executor has linked Roblox account
        const linkedExecutor = await xpDb.getLinked(executorId);
        if (!linkedExecutor) {
            return interaction.reply({
                content: '❗ You must verify your Roblox account with `/verify` first.',
                ephemeral: true
            });
        }

        // 2️⃣ Check internal rank (HICOM or higher)
        const executorRank = permManager.getRank(executorId);
        if (executorRank < permManager.RANKS.HICOM) {
            return interaction.reply({
                content: '❌ You need HICOM or higher to use this command.',
                ephemeral: true
            });
        }

        // 3️⃣ Verify target has linked Roblox account
        const targetLink = await xpDb.getLinked(targetDc.id);
        if (!targetLink) {
            return interaction.reply({
                content: '❗ That user has not linked their Roblox account.',
                ephemeral: true
            });
        }

        // 4️⃣ Load Roblox group ID from config
        const groupId = await cfg.get(guildId, 'groupId');
        if (!groupId) {
            return interaction.reply({
                content: '❌ This server is not configured with a Roblox group. Use `/setup` first.',
                ephemeral: true
            });
        }

        try {
            // 5️⃣ Initialize noblox
            await noblox.setCookie(process.env.ROBLOX_COOKIE);

            // 6️⃣ Fetch executor’s Roblox rank in group
            const executorRbId = await noblox.getIdFromUsername(linkedExecutor);
            const executorRbRank = await noblox.getRankInGroup(groupId, executorRbId);

            // 7️⃣ Fetch target’s Roblox rank in group
            const targetRbId = await noblox.getIdFromUsername(targetLink);
            const targetRbRank = await noblox.getRankInGroup(groupId, targetRbId);

            // Prevent promoting someone with equal or higher Roblox rank (unless executor is group Owner 255)
            if (executorRbRank !== 255 && executorRbRank <= targetRbRank) {
                return interaction.reply({
                    content: '❌ You cannot promote someone at equal or higher Roblox rank.',
                    ephemeral: true
                });
            }

            // 8️⃣ Fetch & sort roles in ascending order
            const roles = await noblox.getRoles(groupId);
            roles.sort((a, b) => a.rank - b.rank);

            // 9️⃣ Determine new rank for target
            const idx = roles.findIndex(r => r.rank === targetRbRank);
            if (idx < 0 || idx === roles.length - 1) {
                return interaction.reply({
                    content: '❗ Cannot promote further.',
                    ephemeral: true
                });
            }

            const newRole = roles[idx + 1];
            await noblox.setRank(groupId, targetRbId, newRole.rank);

            // 🔟 Confirmation embed
            const okEmbed = new EmbedBuilder()
                .setTitle('✅ Promotion Successful')
                .setDescription(
                    `${targetDc} promoted from **${roles[idx].name}** → **${newRole.name}**`
                )
                .setColor(0x00FF00)
                .setTimestamp();
            await interaction.reply({ embeds: [okEmbed] });

            // 1️⃣1️⃣ Public log if configured
            const rankingLogChannelId = await cfg.get(guildId, 'rankingLogChannelId');
            if (rankingLogChannelId) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('📈 Promotion Log')
                    .addFields(
                        { name: 'User', value: `${targetDc}`, inline: true },
                        { name: 'Previous Rank', value: roles[idx].name, inline: true },
                        { name: 'New Rank', value: newRole.name, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'By', value: `${interaction.user}`, inline: true }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp();
                const logChan = await interaction.client.channels.fetch(rankingLogChannelId);
                if (logChan?.isTextBased()) {
                    await logChan.send({ embeds: [logEmbed] });
                }
            }
        } catch (err) {
            console.error(err);
            return interaction.reply({
                content: `❌ Promotion failed: ${err.message}`,
                ephemeral: true
            });
        }
    }
};