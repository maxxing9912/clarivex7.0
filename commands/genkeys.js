// commands/genkeys.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config.json'); // Deve contenere botOwnerId
const keyManager = require('../utils/keyManager');
const generateKeys = require('../utils/generateKeys');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('genkeys')
        .setDescription('🔑 Generate Premium codes (owner only)')
        .setDefaultMemberPermissions(0) // nessuno di default
        .addIntegerOption(opt =>
            opt
                .setName('amount')
                .setDescription('Number of codes to generate')
                .setRequired(true)
        ),

    async execute(interaction) {
        const allowedChannelId = process.env.GENKEYS_CHANNEL_ID;
        // 1) controllo canale
        if (interaction.channel.id !== allowedChannelId) {
            return interaction.reply({
                content: `❌ You are not authorized to use this command here.`,
                ephemeral: true
            });
        }

        // 2) defer (pubblico)
        await interaction.deferReply();

        // 3) controllo permessi
        if (interaction.user.id !== config.botOwnerId) {
            return interaction.editReply({
                content: '❌ You are not authorized to use this command.'
            });
        }

        try {
            // 4) generazione chiavi
            const amount = interaction.options.getInteger('amount');
            const keys = generateKeys(amount);
            keyManager.addGeneratedKeys(keys);

            // 5) embed di risposta (pubblico)
            const embed = new EmbedBuilder()
                .setTitle('🔐 Premium Keys Generated')
                .setDescription(keys.map(k => `\`${k}\``).join('\n'))
                .setColor(0xFFD700)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in /genkeys command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while executing the command.'
            });
        }
    }
};