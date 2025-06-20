// commands/announce.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send a maintenance announcement via DM to all guild owners')
        .addStringOption(opt =>
            opt
                .setName('message')
                .setDescription('Testo del tuo annuncio')
                .setRequired(true)
        ),

    async execute(interaction) {
        const triggerChannelId = process.env.ANNOUNCE_TRIGGER_CHANNEL_ID;
        if (interaction.channel.id !== triggerChannelId) {
            return interaction.reply({
                content: '❌ You are not authorized to use this command here.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const text = interaction.options.getString('message');
        const embed = new EmbedBuilder()
            .setTitle('📢 Maintenance Announcement')
            .setDescription(text)
            .setColor(0xFFA500)
            .setTimestamp();

        // Prendi tutti gli owner unici
        const uniqueOwnerIds = new Set();
        for (const [, guild] of interaction.client.guilds.cache) {
            if (guild.ownerId) {
                uniqueOwnerIds.add(guild.ownerId);
            }
        }

        let success = 0;
        let fail = 0;

        // Invia a ciascun owner una sola volta
        for (const ownerId of uniqueOwnerIds) {
            try {
                const user = await interaction.client.users.fetch(ownerId);
                await user.send({ embeds: [embed] });
                success++;
            } catch (err) {
                console.error(`Failed to DM owner ${ownerId}:`, err);
                fail++;
            }
        }

        return interaction.editReply({
            content: `✅ Annuncio inviato a ${success} owner${fail ? `, falliti: ${fail}` : ''}.`,
            flags: MessageFlags.Ephemeral
        });
    }
};