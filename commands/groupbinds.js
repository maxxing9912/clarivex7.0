// commands/groupbinds.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const noblox = require('noblox.js');
const setupManager = require('../utils/setupManager');
const xpDb = require('../xpManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('groupbinds')
        .setDescription('Manage bindings between Roblox group roles and Discord roles (Owner only)')
        // Subcommand: add
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Bind a Roblox group role ID to a Discord role')
                .addIntegerOption(opt =>
                    opt
                        .setName('id')
                        .setDescription('Roblox group role ID')
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role')
                        .setDescription('Discord role to bind')
                        .setRequired(true)
                )
        )
        // Subcommand: remove
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove an existing binding by Roblox role ID')
                .addIntegerOption(opt =>
                    opt
                        .setName('id')
                        .setDescription('Roblox group role ID to unbind')
                        .setRequired(true)
                )
        )
        // Subcommand: list
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List all current bindings between Roblox roles and Discord roles')
        ),

    async execute(interaction) {
        // Rimuoviamo l’ephemeral, in modo che la risposta sia visibile a tutti
        await interaction.deferReply();

        const guildId = interaction.guild.id;
        const discordUserId = interaction.user.id;
        const subcommand = interaction.options.getSubcommand();
        const currentCfg = await setupManager.getConfig(guildId);

        // 1) Ensure /setup was run
        if (!currentCfg || !currentCfg.groupId) {
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
        const robloxName = await xpDb.getLinked(discordUserId);
        if (!robloxName) {
            return interaction.editReply('❌ You have not linked your Roblox username yet.');
        }

        let robloxUserId;
        try {
            robloxUserId = await noblox.getIdFromUsername(robloxName);
        } catch {
            return interaction.editReply('❌ Failed to resolve your linked Roblox username.');
        }

        let rank;
        try {
            rank = await noblox.getRankInGroup(currentCfg.groupId, robloxUserId);
        } catch (err) {
            return interaction.editReply(`❌ Error fetching group rank: ${err.message}`);
        }

        if (rank !== 255) {
            return interaction.editReply('❌ Only the Roblox Group Owner can use this command.');
        }

        // Prepare bindings array
        const groupId = currentCfg.groupId;
        if (!Array.isArray(currentCfg.roleBindings)) {
            currentCfg.roleBindings = [];
        }

        // -----------------------------
        // SUBCOMMAND: add
        if (subcommand === 'add') {
            const groupRoleId = interaction.options.getInteger('id');
            const discordRole = interaction.options.getRole('role');

            // Verify the Roblox role exists
            let roleInfo;
            try {
                roleInfo = await noblox.getRole(groupId, groupRoleId);
            } catch (err) {
                return interaction.editReply(`❌ Could not fetch Roblox role with ID \`${groupRoleId}\`: ${err.message}`);
            }

            // Copy existing bindings
            const updatedCfg = {
                ...currentCfg,
                roleBindings: [...currentCfg.roleBindings]
            };

            // Check if this groupRoleId already has a binding
            const existingIndex = updatedCfg.roleBindings.findIndex(rb => rb.groupRoleId === groupRoleId);
            if (existingIndex !== -1) {
                // Overwrite Discord role ID for this binding
                updatedCfg.roleBindings[existingIndex].discordRoleId = discordRole.id;
            } else {
                updatedCfg.roleBindings.push({
                    groupRoleId,
                    discordRoleId: discordRole.id
                });
            }

            await setupManager.setConfig(guildId, updatedCfg);

            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🔗 Role Binding Created')
                        .setDescription([
                            `**Roblox Role ID:** \`${groupRoleId}\``,
                            `**Roblox Role Name:** \`${roleInfo.name}\``,
                            `**Discord Role:** ${discordRole.toString()} (ID: \`${discordRole.id}\`)`,
                            '',
                            'Users with this Roblox role will now be able to receive the corresponding Discord role via your binding logic.'
                        ].join('\n'))
                        .setColor(0x00AE86)
                        .setTimestamp()
                ]
            });
        }

        // -----------------------------
        // SUBCOMMAND: remove
        if (subcommand === 'remove') {
            const groupRoleId = interaction.options.getInteger('id');
            const bindings = [...currentCfg.roleBindings];
            const index = bindings.findIndex(rb => rb.groupRoleId === groupRoleId);

            if (index === -1) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('❌ Binding Not Found')
                            .setDescription(`No binding found for Roblox Role ID \`${groupRoleId}\`.`)
                            .setColor(0xED4245)
                            .setTimestamp()
                    ]
                });
            }

            bindings.splice(index, 1);
            const updatedCfg = { ...currentCfg, roleBindings: bindings };
            await setupManager.setConfig(guildId, updatedCfg);

            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🗑️ Binding Removed')
                        .setDescription(`Successfully removed binding for Roblox Role ID \`${groupRoleId}\`.`)
                        .setColor(0xF04747)
                        .setTimestamp()
                ]
            });
        }

        // -----------------------------
        // SUBCOMMAND: list
        if (subcommand === 'list') {
            const bindings = currentCfg.roleBindings;

            if (!bindings.length) {
                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📄 No Bindings Found')
                            .setDescription('There are currently no role bindings set for this server.')
                            .setColor(0xF1C40F)
                            .setTimestamp()
                    ]
                });
            }

            // Fetch Roblox role names for each binding
            const fetches = bindings.map(rb =>
                noblox.getRole(groupId, rb.groupRoleId)
                    .then(info => ({ ...rb, roleName: info.name }))
                    .catch(() => ({ ...rb, roleName: null }))
            );

            let resolved;
            try {
                resolved = await Promise.all(fetches);
            } catch {
                resolved = bindings.map(rb => ({ ...rb, roleName: null }));
            }

            const lines = resolved.map(rb => {
                const discordMention = `<@&${rb.discordRoleId}>`;
                const robloxName = rb.roleName ? `\`${rb.roleName}\`` : `ID \`${rb.groupRoleId}\``;
                return `• Roblox ${robloxName} ↔ Discord ${discordMention} (ID: \`${rb.discordRoleId}\`)`;
            });

            // Paginate in chunks of 10
            const chunkSize = 10;
            const pages = [];
            for (let i = 0; i < lines.length; i += chunkSize) {
                pages.push(lines.slice(i, i + chunkSize).join('\n'));
            }

            const embeds = pages.map((text, idx) => {
                return new EmbedBuilder()
                    .setTitle(`📑 Role Bindings (Page ${idx + 1}/${pages.length})`)
                    .setDescription(text)
                    .setColor(0x5865F2)
                    .setTimestamp();
            });

            return interaction.editReply({ embeds });
        }

        // Should never reach here
        return interaction.editReply('❌ Invalid subcommand.');
    }
};