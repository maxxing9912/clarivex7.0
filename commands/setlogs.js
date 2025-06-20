// commands/setlogs.js
const { SlashCommandBuilder, ChannelType, EmbedBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const permManager = require('../utils/permManager');

const db = new QuickDB({ filePath: './data.sqlite' });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setlogs')
        .setDescription('Configure log channels for various event types')
        // category: member / message / moderation
        .addStringOption(opt =>
            opt
                .setName('category')
                .setDescription('Select the log category')
                .setRequired(true)
                .addChoices(
                    { name: 'Member join/leave', value: 'member' },
                    { name: 'Message send/delete/edit', value: 'message' },
                    { name: 'Moderation (ban/unban/timeout/kick)', value: 'moderation' }
                )
        )
        // action: enable / disable
        .addStringOption(opt =>
            opt
                .setName('action')
                .setDescription('Enable or disable this log')
                .setRequired(true)
                .addChoices(
                    { name: 'Enable', value: 'enable' },
                    { name: 'Disable', value: 'disable' }
                )
        )
        // channel: required if action=enable
        .addChannelOption(opt =>
            opt
                .setName('channel')
                .setDescription('Channel to send logs into (required if action=enable)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const trueOwnerId = interaction.guild.ownerId;
        const ownerId = await permManager.getOwner(guildId, trueOwnerId);
        if (userId !== ownerId) {
            return interaction.reply({ content: '❌ Only the server owner can use this command.', ephemeral: true });
        }

        const category = interaction.options.getString('category'); // 'member'|'message'|'moderation'
        const action = interaction.options.getString('action');     // 'enable'|'disable'
        const channel = interaction.options.getChannel('channel');  // TextChannel or null

        let key, title, desc;
        if (category === 'member') {
            key = `memberLogChannel_${guildId}`;
            if (action === 'enable') {
                if (!channel) {
                    return interaction.reply({ content: '❌ You must provide the channel when enabling member logs.', ephemeral: true });
                }
                await db.set(key, channel.id);
                title = '✅ Member Logs Enabled';
                desc = `I will log member joins/leaves in <#${channel.id}>.`;
            } else { // disable
                await db.delete(key);
                title = '❌ Member Logs Disabled';
                desc = 'Member join/leave logging disabled.';
            }
        }
        else if (category === 'message') {
            key = `messageLogChannel_${guildId}`;
            if (action === 'enable') {
                if (!channel) {
                    return interaction.reply({ content: '❌ You must provide the channel when enabling message logs.', ephemeral: true });
                }
                await db.set(key, channel.id);
                title = '✅ Message Logs Enabled';
                desc = `I will log message sends/deletions/edits in <#${channel.id}>.`;
            } else {
                await db.delete(key);
                title = '❌ Message Logs Disabled';
                desc = 'Message send/delete/edit logging disabled.';
            }
        }
        else if (category === 'moderation') {
            key = `modLogChannel_${guildId}`;
            if (action === 'enable') {
                if (!channel) {
                    return interaction.reply({ content: '❌ You must provide the channel when enabling moderation logs.', ephemeral: true });
                }
                await db.set(key, channel.id);
                title = '✅ Moderation Logs Enabled';
                desc = `I will log moderation actions (ban/unban/timeout/kick) in <#${channel.id}>.`;
            } else {
                await db.delete(key);
                title = '❌ Moderation Logs Disabled';
                desc = 'Moderation logging disabled.';
            }
        }
        else {
            return interaction.reply({ content: '❌ Unknown category.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc)
            .setColor(action === 'enable' ? 'Green' : 'Red')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};