const { Events, EmbedBuilder } = require('discord.js');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton() || !interaction.customId.startsWith('confirm_join_')) return;
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.customId.split('_')[2];
        console.log(`[ConfirmJoin] clicked for guild ${guildId}`);

        // 1) Cancella subito pending
        await setupManager.clearPendingSetup(guildId);

        // 2) Se già configurato, esci
        const cfg = await setupManager.getConfig(guildId);
        if (cfg.groupId) {
            return interaction.editReply(`✅ Already configured with Group ID \`${cfg.groupId}\`.`);
        }

        // 3) Riprendi dati pendenti
        const pending = await setupManager.getPendingSetup(guildId);
        if (!pending) {
            return interaction.editReply('❌ No pending setup found.');
        }

        // 4) Verifica bot nel gruppo Roblox
        try {
            if (!process.env.ROBLOX_COOKIE) throw new Error('Missing ROBLOX_COOKIE');
            await noblox.setCookie(process.env.ROBLOX_COOKIE);
            const botUser = await noblox.getAuthenticatedUser();
            const botId = botUser.id ?? botUser.UserID;
            const rank = await noblox.getRankInGroup(Number(pending.groupId), botId).catch(() => 0);
            if (!rank) {
                return interaction.editReply('❌ Bot not yet in the Roblox group.');
            }

            // 5) Salva config definitiva
            await setupManager.setConfig(guildId, {
                groupId: pending.groupId,
                premiumKey: pending.premiumKey,
                roleBindings: [],
                verificationRoleId: null,
                unverifiedRoleId: null,
                bypassRoleId: null
            });

            await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Bot Configured')
                        .setDescription(`Group ID **${pending.groupId}** configured successfully.`)
                        .setColor(0x57f287)
                ]
            });
        } catch (err) {
            console.error('[ConfirmJoin] error:', err);
            return interaction.editReply(`❌ Error: ${err.message}`);
        }
    }
};
