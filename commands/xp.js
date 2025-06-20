// commands/xp.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const xpManager = require('../xpManager');
const config = require('../configManager');
const permManager = require('../utils/permManager');
const noblox = require('noblox.js');
const { groupId, permissibleGroups, logChannelId: defaultLogChannelId } = require('../config.json');
const premiumRoleId = process.env.PREMIUM_ROLE_ID;

// Helper per permessi HICOM+ su Roblox
function hasPermission(rank) {
    return Object.values(permissibleGroups).some(arr => arr.includes(rank));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp')
        .setDescription('Manage XP for a user or all verified users')
        .setDefaultMemberPermissions(0)
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View a user’s XP status')
                .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('give')
                .setDescription('Give XP to a user')
                .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
                .addIntegerOption(o => o.setName('amount').setDescription('XP amount').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove XP from a user')
                .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
                .addIntegerOption(o => o.setName('amount').setDescription('XP to remove').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('setlog')
                .setDescription('Set the XP log channel (Owner only)')
                .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('giveall')
                .setDescription('Give XP to all verified users (Owner + Premium only)')
                .addIntegerOption(o => o.setName('amount').setDescription('XP amount').setRequired(true))
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const guild = interaction.guild;
        const guildId = guild.id;
        const guildOwner = guild.ownerId;

        // ── giveall ──
        if (sub === 'giveall') {
            const amount = interaction.options.getInteger('amount');

            if (userId !== guildOwner) {
                return interaction.editReply('❌ Only the server owner can run `/xp giveall`.');
            }
            const hasRedeemed = await xpManager.isPremiumInGuild(guildId, guildOwner);
            const ownerMember = await guild.members.fetch(guildOwner);
            const hasRole = premiumRoleId && ownerMember.roles.cache.has(premiumRoleId);
            if (!hasRedeemed && !hasRole) {
                return interaction.editReply(
                    '❌ Your server owner has not activated Premium here. ' +
                    'Use `/redeem <key>` or assign the Discord Premium role.'
                );
            }
            const linkedOwner = await xpManager.getLinked(guildOwner);
            if (!linkedOwner) {
                return interaction.editReply('❌ Server owner must link their Roblox account via `/verify` first.');
            }
            let ownerRank;
            try {
                const rbxId = await noblox.getIdFromUsername(linkedOwner);
                ownerRank = await noblox.getRankInGroup(groupId, rbxId);
            } catch {
                return interaction.editReply('❌ Unable to fetch the server owner’s Roblox rank.');
            }
            if (!hasPermission(ownerRank)) {
                return interaction.editReply('❌ Server owner needs HICOM+ rank in Roblox to use `/xp giveall`.');
            }

            const all = await xpManager.getAllLinked();
            for (const { discordId } of all) {
                await xpManager.addXP(discordId, amount);
            }
            return interaction.editReply(`✅ Gave ${amount} XP to all ${all.length} verified users.`);
        }

        // ── altri subcomandi: view, give, remove, setlog ──

        // A) Verifica link
        const linked = await xpManager.getLinked(userId);
        if (!linked) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('❗ Verification Required')
                    .setDescription('You must verify your Roblox account with `/verify` first.')
                    .setColor(0xFF0000)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // B) Fetch rank per give/remove permissions
        let callerRank;
        try {
            const rbxId = await noblox.getIdFromUsername(linked);
            callerRank = await noblox.getRankInGroup(groupId, rbxId);
        } catch {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Verification Error')
                    .setDescription('Unable to verify your Roblox rank.')
                    .setColor(0xFF0000)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Recupera la mappa ranks dal configManager (server-specific)
        const rankMap = await config.get(guildId, 'ranks') || {};
        // Trasforma in array di soglie ordinate per XP crescente:
        // thresholds = [ { name: rankName, xp: requiredXp }, … ]
        const thresholds = Object.entries(rankMap)
            .map(([rankId, xpReq]) => ({ name: `Rank ${rankId}`, xp: xpReq }))
            .sort((a, b) => a.xp - b.xp);

        if (thresholds.length === 0) {
            return interaction.editReply('❌ Nessun rank configurato: usa `/addrank` per aggiungere delle soglie XP→rank.');
        }

        // ───── view ─────
        if (sub === 'view') {
            const target = interaction.options.getUser('user') ?? interaction.user;
            const xp = await xpManager.getXP(target.id);

            let idx = 0;
            while (idx + 1 < thresholds.length && xp >= thresholds[idx + 1].xp) idx++;
            const curr = thresholds[idx];
            const next = thresholds[idx + 1] || null;

            const into = xp - curr.xp;
            const toNext = next ? next.xp - xp : 0;
            const pct = next ? into / (next.xp - curr.xp) : 1;
            const filled = Math.round(pct * 10);
            const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);

            const embed = new EmbedBuilder()
                .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
                .setDescription(`${bar} ${Math.round(pct * 100)}%`)
                .addFields(
                    { name: 'Current Rank', value: curr.name, inline: true },
                    { name: 'Total XP', value: `${xp}`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: 'XP This Rank', value: `${into}/${next ? next.xp - curr.xp : curr.xp}`, inline: true },
                    { name: 'XP to Next', value: next ? `${toNext}` : 'MAX', inline: true }
                )
                .setColor(0x0099FF)
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ───── setlog ─────
        if (sub === 'setlog') {
            if (!permManager.isOwner(guildId, userId)) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle('❌ Permission Denied')
                        .setDescription('Only the server owner can set the XP log channel.')
                        .setColor(0xFF0000)
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
            const channel = interaction.options.getChannel('channel');
            await xpManager.setLogChannel(guildId, channel.id);

            const embed = new EmbedBuilder()
                .setTitle('🔧 XP Log Channel Updated')
                .setDescription(`All XP changes will now be logged in ${channel}.`)
                .setColor(0x00AAFF)
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ───── give/remove ─────
        if (!hasPermission(callerRank)) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('❌ Permission Denied')
                    .setDescription('You do not have permission to manage XP.')
                    .setColor(0xFF0000)
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        const target = interaction.options.getUser('user');
        const amt = interaction.options.getInteger('amount');
        const beforeXP = await xpManager.getXP(target.id);
        const afterXP = sub === 'give'
            ? await xpManager.addXP(target.id, amt)
            : await xpManager.setXP(target.id, Math.max(0, beforeXP - amt));

        // Ricomputiamo la barra di progresso con le stesse thresholds
        let idx2 = 0;
        while (idx2 + 1 < thresholds.length && afterXP >= thresholds[idx2 + 1].xp) idx2++;
        const c = thresholds[idx2];
        const n = thresholds[idx2 + 1] || null;

        const i2 = afterXP - c.xp;
        const t2 = n ? n.xp - afterXP : 0;
        const p2 = n ? i2 / (n.xp - c.xp) : 1;
        const f2 = Math.round(p2 * 10);
        const b2 = '🟩'.repeat(f2) + '⬜'.repeat(10 - f2);

        const publicEmbed = new EmbedBuilder()
            .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
            .setDescription(`${b2} ${Math.round(p2 * 100)}%`)
            .addFields(
                { name: 'Current Rank', value: c.name, inline: true },
                { name: 'Total XP', value: `${afterXP}`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: 'XP This Rank', value: `${i2}/${n ? n.xp - c.xp : c.xp}`, inline: true },
                { name: 'XP to Next', value: n ? `${t2}` : 'MAX', inline: true }
            )
            .setFooter({ text: `${sub === 'give' ? 'Awarded' : 'Removed'} by ${interaction.user.username}` })
            .setColor(sub === 'give' ? 0x00FF00 : 0xFF0000)
            .setTimestamp();

        await interaction.editReply({ embeds: [publicEmbed] });

        // Log embed
        const logEmbed = new EmbedBuilder()
            .setTitle(sub === 'give' ? 'XP Given' : 'XP Removed')
            .setDescription(`**${target.username}**: ${beforeXP} → ${afterXP}`)
            .addFields(
                n
                    ? { name: 'Next Promotion', value: `${t2} XP until ${n.name}` }
                    : { name: 'Next Promotion', value: 'Max rank reached' }
            )
            .setColor(sub === 'give' ? 0x00FF00 : 0xFF0000)
            .setTimestamp();

        const logId = await xpManager.getLogChannel(guildId) || defaultLogChannelId;
        let logChannel = interaction.client.channels.cache.get(logId);
        if (!logChannel) {
            try { logChannel = await interaction.client.channels.fetch(logId); }
            catch { console.error('Could not fetch xp-logs channel:', logId); }
        }
        if (logChannel?.isTextBased()) {
            await logChannel.send({ embeds: [logEmbed] });
        }
    }
};