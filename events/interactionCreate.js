// events/interactionCreate.js

const { Events, EmbedBuilder } = require('discord.js');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

module.exports = {
    name: Events.InteractionCreate,
    /**
     * Gestisce i button interactions con customId che iniziano con "confirm_join_"
     * per setup e transfer.
     * @param {import('discord.js').Interaction} interaction 
     */
    async execute(interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('confirm_join_')) return;

        // Defer come ephemeral (invisibile agli altri)
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (err) {
            console.warn('[ConfirmJoin] Impossibile fare deferReply:', err);
            // Continuiamo comunque; potremmo già aver risposto
        }

        // Estrazione guildId dal customId: formato atteso "confirm_join_<guildId>"
        const parts = interaction.customId.split('_');
        // Se customId è "confirm_join_123456789", parts = ['confirm','join','123456789']
        const guildId = parts.slice(2).join('_');
        console.log(`[ConfirmJoin] Pulsante cliccato: customId="${interaction.customId}", estratto guildId="${guildId}", interaction.guildId="${interaction.guildId}"`);

        // ─── 1) Pending Setup ───
        let pendingSetup;
        try {
            pendingSetup = await setupManager.getPendingSetup(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] Errore getPendingSetup:', err);
            return interaction.editReply({ content: '❌ Errore interno: impossibile recuperare il setup pendente. Riprova più tardi.' });
        }
        console.log('[ConfirmJoin] pendingSetup:', pendingSetup);

        if (pendingSetup) {
            // ATTENZIONE: adatta il nome della proprietà per il canale originale!
            // Se nel setPendingSetup avete salvato ad esempio `requestingChannelId`, usate quello.
            const { groupId, premiumKey, requestingChannelId /*oppure invokingChannelId*/ } = pendingSetup;

            // Controllo se esiste già configurazione definitiva
            let existingCfg;
            try {
                existingCfg = await setupManager.getConfig(guildId);
            } catch (err) {
                console.error('[ConfirmJoin] Errore getConfig:', err);
                return interaction.editReply({ content: '❌ Errore interno: impossibile verificare configurazione esistente.' });
            }
            if (existingCfg && existingCfg.groupId) {
                return interaction.editReply({
                    content: '🚫 Questo server è già configurato con un gruppo Roblox.'
                });
            }

            try {
                // Imposto cookie Roblox
                if (!process.env.ROBLOX_COOKIE) {
                    console.error('[ConfirmJoin] ROBLOX_COOKIE non impostata');
                    return interaction.editReply({ content: '❌ Errore di configurazione: manca la ROBLOX_COOKIE.' });
                }
                await noblox.setCookie(process.env.ROBLOX_COOKIE);

                // Ottengo info sull’account bot
                const botUser = await noblox.getAuthenticatedUser();
                console.log('[ConfirmJoin] getAuthenticatedUser restituisce:', botUser);
                // A seconda della versione noblox, la proprietà id potrebbe essere botUser.id o botUser.UserID
                const botUserId = botUser.id ?? botUser.UserID;
                if (!botUserId) {
                    console.error('[ConfirmJoin] Impossibile determinare botUserId da getAuthenticatedUser():', botUser);
                    throw new Error('Could not determine bot user ID from getAuthenticatedUser()');
                }

                // Verifico che groupId sia un numero valido
                const numericGroupId = Number(groupId);
                if (isNaN(numericGroupId)) {
                    console.warn('[ConfirmJoin] groupId memorizzato non valido:', groupId);
                    return interaction.editReply({
                        content: '❌ L’ID del gruppo memorizzato non è valido.'
                    });
                }

                // Controllo rank del bot nel gruppo
                let botRank;
                try {
                    botRank = await noblox.getRankInGroup(numericGroupId, botUserId);
                } catch (err) {
                    console.warn('[ConfirmJoin] getRankInGroup ha fallito:', err);
                    botRank = 0;
                }
                console.log(`[ConfirmJoin] botRank in gruppo ${numericGroupId}:`, botRank);
                if (!botRank || botRank === 0) {
                    return interaction.editReply({
                        content: '❌ Il bot non risulta ancora membro del gruppo Roblox. Aggiungilo e poi clicca nuovamente il pulsante.'
                    });
                }

                // Bot è nel gruppo: salvo la configurazione definitiva
                // setConfig internamente cancella il pendingSetup, ma potete chiamare anche clearPendingSetup prima.
                try {
                    // Prima cancelliamo esplicitamente pending (opzionale, setConfig lo fa comunque)
                    await setupManager.clearPendingSetup(guildId);
                } catch (err) {
                    console.warn('[ConfirmJoin] clearPendingSetup ha fallito (ma procedo comunque):', err);
                }
                const configData = {
                    groupId: String(groupId),
                    premiumKey: premiumKey ?? null,
                    // Altri campi iniziali se necessari:
                    roleBindings: [],
                    // ... verificationRoleId: null, unverifiedRoleId: null, ecc.
                };
                try {
                    await setupManager.setConfig(guildId, configData);
                } catch (err) {
                    console.error('[ConfirmJoin] setConfig ha fallito:', err);
                    return interaction.editReply({ content: '❌ Errore interno: impossibile salvare la configurazione definitiva.' });
                }

                // Embed di successo per chi ha cliccato
                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Bot Configurato Correttamente')
                    .setDescription([
                        `**Group ID:** \`${groupId}\``,
                        'Il bot è stato trovato nel gruppo e la configurazione è completata.'
                    ].join('\n'))
                    .setColor(0x57f287)
                    .setTimestamp();
                await interaction.editReply({ embeds: [successEmbed] });

                // Notifica nel canale originario (/setup), se salvato
                if (requestingChannelId) {
                    try {
                        const originalChannel = await interaction.client.channels.fetch(requestingChannelId);
                        if (originalChannel && originalChannel.isTextBased()) {
                            await originalChannel.send({
                                content: `✅ Il bot è stato aggiunto correttamente al gruppo Roblox **${groupId}** e la configurazione è ora attiva!`
                            });
                        } else {
                            console.warn('[ConfirmJoin] originalChannel non trovato o non text-based:', requestingChannelId);
                        }
                    } catch (err) {
                        console.error('[ConfirmJoin] Fallita notifica canale originario:', err);
                    }
                } else {
                    console.warn('[ConfirmJoin] requestingChannelId non definito nel pendingSetup');
                }

                return;
            } catch (err) {
                console.error('❌ Errore durante il flusso di conferma setup:', err);
                return interaction.editReply({
                    content:
                        '❌ Qualcosa è andato storto durante la verifica dell’appartenenza del bot al gruppo Roblox. Riprova più tardi.'
                });
            }
        }

        // ─── 2) Pending Transfer ───
        let pendingTransfer;
        try {
            pendingTransfer = await setupManager.getPendingTransfer(guildId);
        } catch (err) {
            console.error('[ConfirmJoin] Errore getPendingTransfer:', err);
            // Non blocchiamo qui, passiamo al messaggio di nessun pending
            pendingTransfer = null;
        }
        console.log('[ConfirmJoin] pendingTransfer:', pendingTransfer);

        if (pendingTransfer) {
            const { oldGroupId, newGroupId, requestingChannelId /*oppure invokingChannelId*/ } = pendingTransfer;

            // Verifica configurazione esistente
            let existingCfg;
            try {
                existingCfg = await setupManager.getConfig(guildId);
            } catch (err) {
                console.error('[ConfirmJoin] Errore getConfig in transfer:', err);
                return interaction.editReply({ content: '❌ Errore interno: impossibile recuperare la configurazione esistente.' });
            }
            if (!existingCfg || !existingCfg.groupId) {
                return interaction.editReply({
                    content: '❌ Non esiste una configurazione esistente in questo server da trasferire.'
                });
            }
            if (existingCfg.groupId === String(newGroupId)) {
                return interaction.editReply({
                    content: '❌ Non puoi trasferire allo stesso gruppo già configurato.'
                });
            }

            try {
                if (!process.env.ROBLOX_COOKIE) {
                    console.error('[ConfirmJoin-Transfer] ROBLOX_COOKIE non impostata');
                    return interaction.editReply({ content: '❌ Errore di configurazione: manca la ROBLOX_COOKIE.' });
                }
                await noblox.setCookie(process.env.ROBLOX_COOKIE);

                const botUser = await noblox.getAuthenticatedUser();
                console.log('[ConfirmJoin-Transfer] getAuthenticatedUser:', botUser);
                const botUserId = botUser.id ?? botUser.UserID;
                if (!botUserId) {
                    console.error('[ConfirmJoin-Transfer] Impossibile determinare botUserId');
                    throw new Error('Could not determine bot user ID');
                }

                const numericNewGroupId = Number(newGroupId);
                if (isNaN(numericNewGroupId)) {
                    return interaction.editReply({
                        content: '❌ L’ID del nuovo gruppo non è valido.'
                    });
                }

                let botRank;
                try {
                    botRank = await noblox.getRankInGroup(numericNewGroupId, botUserId);
                } catch (err) {
                    console.warn('[ConfirmJoin-Transfer] getRankInGroup fallito:', err);
                    botRank = 0;
                }
                console.log(`[ConfirmJoin-Transfer] botRank in nuovo gruppo ${numericNewGroupId}:`, botRank);
                if (!botRank || botRank === 0) {
                    return interaction.editReply({
                        content: '❌ Il bot non risulta ancora membro del nuovo gruppo Roblox. Aggiungilo e riprova.'
                    });
                }

                // Bot è nel nuovo gruppo: salvo nuova config
                try {
                    await setupManager.clearPendingTransfer(guildId);
                } catch (err) {
                    console.warn('[ConfirmJoin-Transfer] clearPendingTransfer fallito:', err);
                }
                const updatedCfg = {
                    ...existingCfg,
                    groupId: String(newGroupId)
                };
                try {
                    await setupManager.setConfig(guildId, updatedCfg);
                } catch (err) {
                    console.error('[ConfirmJoin-Transfer] setConfig fallito:', err);
                    return interaction.editReply({ content: '❌ Errore interno: impossibile salvare la configurazione aggiornata.' });
                }

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Setup Trasferito')
                    .setDescription([
                        `• **Old Group ID:** \`${oldGroupId}\``,
                        `• **New Group ID:** \`${newGroupId}\``,
                        'Il bot è stato trovato nel nuovo gruppo e il trasferimento è completato.'
                    ].join('\n'))
                    .setColor(0x57f287)
                    .setTimestamp();
                await interaction.editReply({ embeds: [successEmbed] });

                // Notifica canale originario (/transfer-group)
                if (requestingChannelId) {
                    try {
                        const originalChannel = await interaction.client.channels.fetch(requestingChannelId);
                        if (originalChannel && originalChannel.isTextBased()) {
                            await originalChannel.send({
                                content: `✅ Il bot è stato spostato correttamente dal gruppo **${oldGroupId}** a **${newGroupId}**!`
                            });
                        } else {
                            console.warn('[ConfirmJoin-Transfer] originalChannel non trovato o non text-based:', requestingChannelId);
                        }
                    } catch (err) {
                        console.error('[ConfirmJoin-Transfer] Fallita notifica canale originario:', err);
                    }
                } else {
                    console.warn('[ConfirmJoin-Transfer] requestingChannelId non definito nel pendingTransfer');
                }

                return;
            } catch (err) {
                console.error('❌ Errore durante il flusso di transfer:', err);
                return interaction.editReply({
                    content:
                        '❌ Qualcosa è andato storto durante la verifica dell’appartenenza del bot al nuovo gruppo Roblox. Riprova più tardi.'
                });
            }
        }

        // ─── 3) Nessun pending trovata ───
        return interaction.editReply({
            content: '❌ Nessuna configurazione pendente o trasferimento trovato per questo server.'
        });
    }
};
