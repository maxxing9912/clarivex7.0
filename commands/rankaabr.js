// commands/rankabbr.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const noblox = require('noblox.js');
const setupManager = require('../utils/setupManager');
const xpDb = require('../xpManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rankabbr')
        .setDescription('Manage abbreviations for Roblox group role IDs (Owner only)')
        // Subcommand: add
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Assign an abbreviation to a Roblox group role ID')
                .addIntegerOption(opt =>
                    opt
                        .setName('id')
                        .setDescription('Roblox group role ID')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('abbr')
                        .setDescription('Abbreviation (e.g., GEN)')
                        .setRequired(true)
                )
        )
        // Subcommand: list
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List all current role ID ↔ abbreviation mappings')
        )
        // Subcommand: remove
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove an existing abbreviation mapping by role ID')
                .addIntegerOption(opt =>
                    opt
                        .setName('id')
                        .setDescription('Roblox group role ID to unmap')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const discordUserId = interaction.user.id;
        const sub = interaction.options.getSubcommand();
        const cfg = await setupManager.getConfig(guildId);

        // 1) Ensure /setup was run
        if (!cfg || !cfg.groupId) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Server Not Configured')
                        .setDescription('Use `/setup` first to configure your Roblox Group ID.')
                        .setColor(0xED4245)
                        .setTimestamp()
                ]
            });
        }

        // 2) Ensure the caller is the Roblox Group Owner (rank 255)
        //    a) Get linked Roblox username
        const robloxName = await xpDb.getLinked(discordUserId);
        if (!robloxName) {
            return interaction.editReply('❌ You have not linked your Roblox username yet.');
        }

        //    b) Resolve Roblox userId
        let robloxUserId;
        try {
            robloxUserId = await noblox.getIdFromUsername(robloxName);
        } catch {
            return interaction.editReply('❌ Failed to resolve your linked Roblox username.');
        }

        //    c) Check rank
        let rank;
        try {
            rank = await noblox.getRankInGroup(cfg.groupId, robloxUserId);
        } catch (err) {
            return interaction.editReply(`❌ Error fetching group rank: ${err.message}`);
        }

        if (rank !== 255) {
            return interaction.editReply('❌ Only the Roblox Group Owner can use this command.');
        }

        // Prepare rankAbbreviations array
        const groupId = cfg.groupId;
        const abbrevs = Array.isArray(cfg.rankAbbreviations) ? [...cfg.rankAbbreviations] : [];

        // -----------------------------
        // SUBCOMMAND: add
        if (sub === 'add') {
            const groupRoleId = interaction.options.getInteger('id');
            const abbr = interaction.options.getString('abbr').toUpperCase();

            // Verify the Roblox role exists
            let roleInfo;
            try {
                roleInfo = await noblox.getRole(groupId, groupRoleId);
            } catch (err) {
                return interaction.editReply(`❌ Cannot fetch Roblox role ID \`${groupRoleId}\`: ${err.message}`);
            }

            // Check if already exists
            const idx = abbrevs.findIndex(a => a.groupRoleId === groupRoleId);
            if (idx !== -1) {
                abbrevs[idx].abbreviation = abbr;
            } else {
                abbrevs.push({ groupRoleId, abbreviation: abbr });
            }

            const newCfg = {
                ...cfg,
                rankAbbreviations: abbrevs
            };
            await setupManager.setConfig(guildId, newCfg);

            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Abbreviation Set')
                        .setDescription([
                            `**Roblox Role ID:** \`${groupRoleId}\``,
                            `**Role Name:** \`${roleInfo.name}\``,
                            `**Abbreviation:** \`${abbr}\``
                        ].join('\n'))
                        .setColor(0x00AE86)
                        .setTimestamp()
                ]
            });
        }

        // -----------------------------
        // SUBCOMMAND: remove
        if (sub === 'remove') {
            const groupRoleId = interaction.options.getInteger('id');
            const idx = abbrevs.findIndex(a => a.groupRoleId === groupRoleId);
            if (idx === -1) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('❌ Mapping Not Found')
                            .setDescription(`No abbreviation mapping for Roblox Role ID \`${groupRoleId}\`.`)
                            .setColor(0xED4245)
                            .setTimestamp()
                    ]
                });
            }

            abbrevs.splice(idx, 1);
            const newCfg = {
                ...cfg,
                rankAbbreviations: abbrevs
            };
            await setupManager.setConfig(guildId, newCfg);

            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🗑️ Mapping Removed')
                        .setDescription(`Removed abbreviation for Roblox Role ID \`${groupRoleId}\`.`)
                        .setColor(0xF04747)
                        .setTimestamp()
                ]
            });
        }

        // -----------------------------
        // SUBCOMMAND: list
        if (sub === 'list') {
            if (!abbrevs.length) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📄 No Abbreviations Set')
                            .setDescription('There are currently no rank abbreviations configured.')
                            .setColor(0xF1C40F)
                            .setTimestamp()
                    ]
                });
            }

            // Fetch role names for each mapping
            const fetches = abbrevs.map(entry =>
                noblox.getRole(groupId, entry.groupRoleId)
                    .then(info => ({ ...entry, roleName: info.name }))
                    .catch(() => ({ ...entry, roleName: null }))
            );

            let resolved;
            try {
                resolved = await Promise.all(fetches);
            } catch {
                resolved = abbrevs.map(entry => ({ ...entry, roleName: null }));
            }

            const lines = resolved.map(e => {
                const namePart = e.roleName ? `\`${e.roleName}\`` : `ID \`${e.groupRoleId}\``;
                return `• ${namePart} ↔ \`${e.abbreviation}\``;
            });

            // Paginate in chunks of 10
            const chunkSize = 10;
            const pages = [];
            for (let i = 0; i < lines.length; i += chunkSize) {
                pages.push(lines.slice(i, i + chunkSize).join('\n'));
            }

            const embeds = pages.map((desc, i) =>
                new EmbedBuilder()
                    .setTitle(`📑 Abbreviations (Page ${i + 1}/${pages.length})`)
                    .setDescription(desc)
                    .setColor(0x5865F2)
                    .setTimestamp()
            );

            return interaction.editReply({ embeds });
        }

        // Fallback
        return interaction.editReply('❌ Invalid subcommand.');
    }
};