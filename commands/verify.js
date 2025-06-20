// commands/verify.js
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags
} = require('discord.js');
const { randomBytes } = require('crypto');
const xpDb = require('../xpManager');
const setupManager = require('../utils/setupManager');
const noblox = require('noblox.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('🔗 Link your Roblox account (one time only)')
        .setDMPermission(true)
        .addStringOption(opt =>
            opt
                .setName('roblox')
                .setDescription('Your exact Roblox username')
                .setRequired(true)
        ),

    async execute(interaction) {
        const discordId = interaction.user.id;
        const robloxName = interaction.options.getString('roblox');

        // 1) Se già verificato, esci subito
        const already = await xpDb.getLinked(discordId);
        if (already) {
            return interaction.reply({
                content: `✅ You are already linked to **${already}**.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // 2) Genera codice e salva temporaneamente
        const code = randomBytes(3).toString('hex');
        await xpDb.setCode(discordId, code);
        await xpDb.setTempUser(discordId, robloxName);

        // 3) Embed istruzioni + bottone
        const embed = new EmbedBuilder()
            .setTitle('🔗 Roblox Verification')
            .setDescription([
                `**User:** <@${discordId}>`,
                `**Roblox:** ${robloxName}`,
                '',
                '1. Copy the code below:',
                `\`\`\`${code}\`\`\``,
                '2. Paste it into your Roblox profile “About” or “Description”.',
                '3. Click the button below to complete verification within 2 minutes.'
            ].join('\n'))
            .setColor(0x0099FF)
            .setTimestamp();

        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('complete_verification')
                .setLabel('✅ Complete Verification')
                .setStyle(ButtonStyle.Primary)
        );

        // 4) Invia embed + bottone
        await interaction.reply({
            embeds: [embed],
            components: [buttonRow],
            flags: MessageFlags.Ephemeral
        });

        // 5) Prendi il messaggio per il collector
        let replyMsg;
        try {
            replyMsg = await interaction.fetchReply();
        } catch {
            return;
        }

        // 6) Collector per 2 minuti
        const collector = replyMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120_000
        });

        collector.on('collect', async btn => {
            if (btn.user.id !== discordId) {
                return btn.reply({
                    content: '❌ These buttons are not for you.',
                    flags: MessageFlags.Ephemeral
                });
            }
            // Acknowledge the button interaction
            await btn.deferUpdate();

            // Disabilita il bottone
            const disabledRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(btn.component).setDisabled(true)
            );
            try {
                await replyMsg.edit({ components: [disabledRow] });
            } catch (err) {
                if (err.code !== 10008) console.error('Failed to disable button:', err);
            }

            // 7) Carica i dati temporanei
            const storedCode = await xpDb.getCode(discordId);
            const storedName = await xpDb.getTempUser(discordId);
            if (!storedCode || !storedName) {
                return btn.followUp({
                    content: '❌ Verification data not found. Please run `/verify` again.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // 8) Controlla il blurb su Roblox
            try {
                await noblox.setCookie(process.env.ROBLOX_COOKIE);
                const userId = await noblox.getIdFromUsername(storedName);
                const blurb = (await noblox.getPlayerInfo(userId)).blurb || '';
                if (!blurb.includes(storedCode)) {
                    return btn.followUp({
                        content: '❌ Code not found in your Roblox “About”/“Description”. Paste it correctly.',
                        flags: MessageFlags.Ephemeral
                    });
                }
            } catch (err) {
                console.error('Roblox check error:', err);
                return btn.followUp({
                    content: '❌ Error checking Roblox. Please try again later.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // 9) Salva link permanente
            await xpDb.linkRoblox(discordId, storedName);
            await xpDb.setCode(discordId, '');
            await xpDb.setTempUser(discordId, '');

            // 10) Se eseguito in guild, assegna eventuale ruolo di verifica
            if (interaction.inGuild()) {
                const cfg = await setupManager.getConfig(interaction.guildId);
                if (cfg.verificationRoleId) {
                    try {
                        const member = await interaction.guild.members.fetch(discordId);
                        await member.roles.add(cfg.verificationRoleId, 'Assigned after /verify');
                    } catch (err) {
                        console.error('Role assign error:', err);
                    }
                }
            }

            // 11) Embed di successo
            const success = new EmbedBuilder()
                .setTitle('✅ Verification Complete!')
                .setDescription(`You are now linked to **${storedName}** on Roblox.`)
                .setColor(0x57F287)
                .setTimestamp();

            return btn.followUp({
                embeds: [success],
                flags: MessageFlags.Ephemeral
            });
        });

        collector.on('end', async () => {
            // Disabilita il bottone quando scade il collector
            if (!replyMsg) return;
            const row = replyMsg.components?.[0];
            if (!row) return;
            const disabledRow = new ActionRowBuilder().addComponents(
                row.components.map(c => ButtonBuilder.from(c).setDisabled(true))
            );
            try {
                await replyMsg.edit({ components: [disabledRow] });
            } catch (err) {
                if (err.code !== 10008) console.error('Failed to disable on end:', err);
            }
        });
    }
};