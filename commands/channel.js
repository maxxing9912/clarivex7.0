// commands/channel.js
const { SlashCommandBuilder } = require('discord.js');
const { QuickDB } = require('quick.db');
const permManager = require('../utils/permManager');
const db = new QuickDB({ filePath: './data.sqlite' });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Enable or disable all bot commands in this channel')
        .addSubcommand(sub =>
            sub
                .setName('disable')
                .setDescription('Disable all bot commands in this channel')
        )
        .addSubcommand(sub =>
            sub
                .setName('enable')
                .setDescription('Enable bot commands in this channel again')
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const authorId = interaction.user.id;

        // Recupera l’ID owner con await e fallback a interaction.guild.ownerId
        const trueOwnerId = interaction.guild.ownerId;
        const ownerId = await permManager.getOwner(guildId, trueOwnerId);
        if (authorId !== ownerId) {
            return interaction.reply({ content: '❌ Only the server Owner can use this.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand(); // 'disable' o 'enable'
        const channelId = interaction.channelId;
        const key = `disabledChannels_${guildId}`;
        let disabled = await db.get(key) || [];

        if (sub === 'disable') {
            if (!disabled.includes(channelId)) {
                disabled.push(channelId);
                await db.set(key, disabled);
                return interaction.reply({ content: `🚫 Commands have been **disabled** in <#${channelId}>.`, ephemeral: true });
            } else {
                return interaction.reply({ content: '⚠️ Commands are already disabled here.', ephemeral: true });
            }
        } else { // 'enable'
            if (disabled.includes(channelId)) {
                disabled = disabled.filter(id => id !== channelId);
                await db.set(key, disabled);
                return interaction.reply({ content: `✅ Commands have been **enabled** again in <#${channelId}>.`, ephemeral: true });
            } else {
                return interaction.reply({ content: '⚠️ Commands are already enabled here.', ephemeral: true });
            }
        }
    },
};