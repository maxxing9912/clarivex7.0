// commands/antiraid.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const permManager = require('../utils/permManager');

const db = new QuickDB({ filePath: './data.sqlite' });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('antiraid')
        .setDescription('Configure anti-raid system')
        .addSubcommand(sub =>
            sub.setName('enable').setDescription('Enable anti-raid')
        )
        .addSubcommand(sub =>
            sub.setName('disable').setDescription('Disable anti-raid')
        )
        .addSubcommand(sub =>
            sub
                .setName('threshold')
                .setDescription('Set join threshold')
                .addIntegerOption(opt =>
                    opt.setName('count').setDescription('Number of joins').setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('interval').setDescription('Time window in seconds').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('action')
                .setDescription('Set action on raid detection')
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('kick, timeout, or quarantine')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Kick', value: 'kick' },
                            { name: 'Timeout', value: 'timeout' },
                            { name: 'Quarantine role', value: 'quarantine' }
                        )
                )
                .addIntegerOption(opt =>
                    opt.setName('duration').setDescription('Timeout duration in seconds (if timeout)').setRequired(false)
                )
                .addRoleOption(opt =>
                    opt.setName('quarantine_role').setDescription('Role to assign (if quarantine)').setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('logchannel')
                .setDescription('Set channel for anti-raid logs')
                .addChannelOption(opt =>
                    opt.setName('channel').setDescription('Text channel').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('whitelist')
                .setDescription('Manage whitelist roles (esentare da azioni anti-raid join)')
                .addStringOption(opt =>
                    opt.setName('action').setDescription('add or remove').setRequired(true)
                        .addChoices(
                            { name: 'Add', value: 'add' },
                            { name: 'Remove', value: 'remove' }
                        )
                )
                .addRoleOption(opt =>
                    opt.setName('role').setDescription('Role to whitelist/unwhitelist for join').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('banwhitelist')
                .setDescription('Manage roles allowed to eseguire ban (protezione mass ban)')
                .addStringOption(opt =>
                    opt.setName('action').setDescription('add or remove').setRequired(true)
                        .addChoices(
                            { name: 'Add', value: 'add' },
                            { name: 'Remove', value: 'remove' }
                        )
                )
                .addRoleOption(opt =>
                    opt.setName('role').setDescription('Role to allow/disallow ban').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status').setDescription('Show current anti-raid settings')
        )
        .addSubcommand(sub =>
            sub.setName('reset').setDescription('Reset lockdown state and clear recent joins')
        ),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const authorId = interaction.user.id;
        const realOwnerId = interaction.guild.ownerId;
        const ownerId = await permManager.getOwner(guildId, realOwnerId);
        if (authorId !== ownerId) {
            return interaction.reply({ content: '❌ Only the server owner can use this.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        // helper per leggere config anti-raid
        async function getCfg() {
            const enabled = await db.get(`antiRaid_${guildId}.enabled`);
            const threshold = await db.get(`antiRaid_${guildId}.threshold`);
            const interval = await db.get(`antiRaid_${guildId}.interval`);
            const action = await db.get(`antiRaid_${guildId}.action`);
            const duration = await db.get(`antiRaid_${guildId}.timeoutDuration`);
            const quarantineRoleId = await db.get(`antiRaid_${guildId}.quarantineRoleId`);
            const logChannelId = await db.get(`antiRaid_${guildId}.logChannelId`);
            const whitelistRoles = await db.get(`antiRaid_${guildId}.whitelistRoles`) || [];
            const banAllowedRoles = await db.get(`antiRaid_${guildId}.banAllowedRoles`) || [];
            const lockdown = await db.get(`antiRaid_${guildId}.lockdown`) || false;
            const revokeInvitesOnLockdown = await db.get(`antiRaid_${guildId}.revokeInvitesOnLockdown`) || false;
            return { enabled, threshold, interval, action, duration, quarantineRoleId, logChannelId, whitelistRoles, banAllowedRoles, lockdown, revokeInvitesOnLockdown };
        }

        switch (sub) {
            case 'enable':
                await db.set(`antiRaid_${guildId}.enabled`, true);
                await interaction.reply({ content: '✅ Anti-raid enabled.', ephemeral: true });
                break;

            case 'disable':
                await db.set(`antiRaid_${guildId}.enabled`, false);
                await db.set(`antiRaid_${guildId}.lockdown`, false);
                await db.delete(`antiRaid_${guildId}.lastJoins`);
                await interaction.reply({ content: '❌ Anti-raid disabled and state reset.', ephemeral: true });
                break;

            case 'threshold': {
                const count = interaction.options.getInteger('count');
                const interval = interaction.options.getInteger('interval');
                await db.set(`antiRaid_${guildId}.threshold`, count);
                await db.set(`antiRaid_${guildId}.interval`, interval);
                await interaction.reply({ content: `✅ Threshold set: ${count} joins in ${interval}s.`, ephemeral: true });
                break;
            }

            case 'action': {
                const type = interaction.options.getString('type');
                if (type === 'timeout') {
                    const dur = interaction.options.getInteger('duration');
                    if (!dur) {
                        return interaction.reply({ content: '❌ You must specify duration (seconds) for timeout.', ephemeral: true });
                    }
                    await db.set(`antiRaid_${guildId}.action`, 'timeout');
                    await db.set(`antiRaid_${guildId}.timeoutDuration`, dur);
                    await db.delete(`antiRaid_${guildId}.quarantineRoleId`);
                    await interaction.reply({ content: `✅ Action set: timeout ${dur}s.`, ephemeral: true });
                } else if (type === 'quarantine') {
                    const role = interaction.options.getRole('quarantine_role');
                    if (!role) {
                        return interaction.reply({ content: '❌ You must specify a role when action is quarantine.', ephemeral: true });
                    }
                    await db.set(`antiRaid_${guildId}.action`, 'quarantine');
                    await db.set(`antiRaid_${guildId}.quarantineRoleId`, role.id);
                    await db.delete(`antiRaid_${guildId}.timeoutDuration`);
                    await interaction.reply({ content: `✅ Action set: assign quarantine role <@&${role.id}>.`, ephemeral: true });
                } else if (type === 'kick') {
                    await db.set(`antiRaid_${guildId}.action`, 'kick');
                    await db.delete(`antiRaid_${guildId}.timeoutDuration`);
                    await db.delete(`antiRaid_${guildId}.quarantineRoleId`);
                    await interaction.reply({ content: '✅ Action set: kick.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ Invalid action type.', ephemeral: true });
                }
                break;
            }

            case 'logchannel': {
                const channel = interaction.options.getChannel('channel');
                await db.set(`antiRaid_${guildId}.logChannelId`, channel.id);
                await interaction.reply({ content: `✅ Log channel set to <#${channel.id}>.`, ephemeral: true });
                break;
            }

            case 'whitelist': {
                const act = interaction.options.getString('action'); // 'add' o 'remove'
                const role = interaction.options.getRole('role');
                let list = await db.get(`antiRaid_${guildId}.whitelistRoles`) || [];
                if (act === 'add') {
                    if (!list.includes(role.id)) {
                        list.push(role.id);
                        await db.set(`antiRaid_${guildId}.whitelistRoles`, list);
                        await interaction.reply({ content: `✅ Role <@&${role.id}> whitelisted for join.`, ephemeral: true });
                    } else {
                        await interaction.reply({ content: '⚠️ Role already whitelisted for join.', ephemeral: true });
                    }
                } else {
                    if (list.includes(role.id)) {
                        list = list.filter(r => r !== role.id);
                        await db.set(`antiRaid_${guildId}.whitelistRoles`, list);
                        await interaction.reply({ content: `✅ Role <@&${role.id}> removed from join-whitelist.`, ephemeral: true });
                    } else {
                        await interaction.reply({ content: '⚠️ Role was not whitelisted for join.', ephemeral: true });
                    }
                }
                break;
            }

            case 'banwhitelist': {
                const act = interaction.options.getString('action'); // 'add' o 'remove'
                const role = interaction.options.getRole('role');
                let list = await db.get(`antiRaid_${guildId}.banAllowedRoles`) || [];
                if (act === 'add') {
                    if (!list.includes(role.id)) {
                        list.push(role.id);
                        await db.set(`antiRaid_${guildId}.banAllowedRoles`, list);
                        await interaction.reply({ content: `✅ Role <@&${role.id}> allowed to ban members.`, ephemeral: true });
                    } else {
                        await interaction.reply({ content: '⚠️ Role already allowed to ban.', ephemeral: true });
                    }
                } else {
                    if (list.includes(role.id)) {
                        list = list.filter(r => r !== role.id);
                        await db.set(`antiRaid_${guildId}.banAllowedRoles`, list);
                        await interaction.reply({ content: `✅ Role <@&${role.id}> removed from ban-allowed list.`, ephemeral: true });
                    } else {
                        await interaction.reply({ content: '⚠️ Role was not in ban-allowed list.', ephemeral: true });
                    }
                }
                break;
            }

            case 'status': {
                const cfg = await getCfg();
                const embed = new EmbedBuilder()
                    .setTitle('Anti-Raid Status')
                    .addFields(
                        { name: 'Enabled', value: cfg.enabled ? '✅' : '❌', inline: true },
                        { name: 'Lockdown', value: cfg.lockdown ? '⚠️ Active' : 'None', inline: true },
                        { name: 'Threshold', value: cfg.threshold ? `${cfg.threshold} joins` : 'Not set', inline: true },
                        { name: 'Interval', value: cfg.interval ? `${cfg.interval}s` : 'Not set', inline: true },
                        { name: 'Action', value: cfg.action || 'Not set', inline: true },
                        { name: 'Timeout Dur.', value: cfg.duration ? `${cfg.duration}s` : '-', inline: true },
                        { name: 'Quarantine Role', value: cfg.quarantineRoleId ? `<@&${cfg.quarantineRoleId}>` : '-', inline: true },
                        { name: 'Log Channel', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : '-', inline: true },
                        { name: 'Whitelist Roles (join)', value: (cfg.whitelistRoles.length ? cfg.whitelistRoles.map(r => `<@&${r}>`).join(', ') : 'None'), inline: false },
                        { name: 'Ban Allowed Roles', value: (cfg.banAllowedRoles.length ? cfg.banAllowedRoles.map(r => `<@&${r}>`).join(', ') : 'None'), inline: false },
                        { name: 'Revoke Invites on Lockdown', value: cfg.revokeInvitesOnLockdown ? '✅' : '❌', inline: true }
                    )
                    .setColor(cfg.lockdown ? 'Red' : 'Green')
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;
            }

            case 'reset': {
                await db.set(`antiRaid_${guildId}.lockdown`, false);
                await db.delete(`antiRaid_${guildId}.lastJoins`);
                await interaction.reply({ content: '✅ Lockdown reset; monitoring resumes normally.', ephemeral: true });
                break;
            }

            default:
                await interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
        }
    }
};