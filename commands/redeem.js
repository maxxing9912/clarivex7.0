// commands/redeem.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { redeemKey } = require('../utils/keyManager');
const xpDb = require('../xpManager'); // our QuickDB wrapper

module.exports = {
    data: new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('❖ Redeem a Premium Serial Key (activates Premium for this server owner)')
        .addStringOption(option =>
            option
                .setName('key')
                .setDescription('Your Premium Serial Code')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const guildOwnerId = interaction.guild.ownerId;

        // 1) Check if already Premium in this guild
        if (await xpDb.isPremiumInGuild(guildId, guildOwnerId)) {
            return interaction.reply({
                content: '❗ Your server owner already has Premium in this server.',
                ephemeral: true
            });
        }

        // 2) Redeem the key
        const key = interaction.options.getString('key');
        let result;
        try {
            result = redeemKey(guildOwnerId, key);
        } catch (err) {
            console.error('redeemKey error:', err);
            return interaction.reply({ content: '❌ Error redeeming key.', ephemeral: true });
        }
        if (!result.success) {
            return interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
        }

        // 3) Mark Premium for this guild + owner
        await xpDb.setGuildPremium(guildId, guildOwnerId, true);

        // 4) Confirm
        const embed = new EmbedBuilder()
            .setTitle('🎉 Premium Activated!')
            .setDescription(`Premium is now active for <@${guildOwnerId}> in this server.`)
            .setColor(0x57F287)
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};