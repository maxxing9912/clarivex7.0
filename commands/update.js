// commands/update.js
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const noblox = require("noblox.js");
const setupManager = require("../utils/setupManager");
const xpDb = require("../xpManager");
const fs = require("fs").promises;
const path = require("path");

const premiumUsersFile = path.resolve(process.cwd(), "premiumUsers.json");

// Role IDs from env
const ROLE_IDS = {
    monthly: process.env.DISCORD_PREMIUM_ROLE_ID,                           // e.g. "123456789012345678"
    annual: process.env.DISCORD_PREMIUM_ROLE_ID,                           // reuse same or separate if you want
    lifetime: [
        process.env.DISCORD_LIFETIME_ROLE_ID,       // e.g. "234567890123456789"
        process.env.DISCORD_EARLY_ACCESS_ROLE_ID    // e.g. "345678901234567890"
    ].filter(Boolean)
};

async function loadSubscriptions() {
    try {
        const data = await fs.readFile(premiumUsersFile, "utf8");
        return JSON.parse(data).subscriptions || {};
    } catch {
        return {};
    }
}

async function saveSubscriptions(subscriptions) {
    await fs.writeFile(premiumUsersFile, JSON.stringify({ subscriptions }, null, 2), "utf8");
}

async function isPremium(discordId) {
    const subs = await loadSubscriptions();
    return subs[discordId] || null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("update")
        .setDescription("Sync Discord roles based on premium & Roblox rank/verification")
        .addStringOption(opt =>
            opt
                .setName("roblox")
                .setDescription("Roblox username to update (default = your linked account)")
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true }).catch(() => { });
        if (!interaction.guild || !interaction.member) {
            return interaction.editReply({ content: "❌ Use this command in a server.", ephemeral: true });
        }

        const member = interaction.member;
        const discordId = interaction.user.id;

        // 1) Load subscription
        const subscriptions = await loadSubscriptions();
        const record = subscriptions[discordId];

        // 2) Expiration logic for monthly/annual
        if (record && record.plan !== "lifetime") {
            if (!record.expires || Date.now() > record.expires) {
                // expired → remove record & roles
                delete subscriptions[discordId];
                await saveSubscriptions(subscriptions).catch(() => { });
                const expiredRoles = Object.values(ROLE_IDS).flat();
                await member.roles.remove(expiredRoles, "Subscription expired").catch(() => { });
                return interaction.editReply({ content: "❌ Your subscription has expired.", ephemeral: true });
            }
        }

        // 3) Clear any existing premium roles
        const allPremiumRoles = Object.values(ROLE_IDS).flat();
        await member.roles.remove(allPremiumRoles, "Sync subscription roles").catch(() => { });

        // 4) Re‑assign based on current record
        if (record) {
            let toAdd = [];
            if (record.plan === "lifetime") {
                toAdd = ROLE_IDS.lifetime;
            } else if (["monthly", "annual"].includes(record.plan)) {
                toAdd = [ROLE_IDS.monthly];
            }
            if (toAdd.length) {
                await member.roles.add(toAdd, "Assign subscription roles").catch(console.error);
            }
        }

        // 5) Now perform your existing Roblox/verification sync
        try {
            // Load guild config
            const cfg = await setupManager.getConfig(interaction.guildId);
            if (!cfg || !cfg.groupId) {
                return interaction.editReply("❌ This server is not configured. Run `/setup` first.");
            }
            const {
                groupId,
                roleBindings = [],
                verificationRoleId = null,
                unverifiedRoleId = null,
                bypassRoleId = null
            } = cfg;

            // Determine Roblox username & target Discord ID
            let robloxName = interaction.options.getString("roblox");
            let targetId = discordId;
            if (robloxName) {
                const linked = await xpDb.getDiscordUserIdFromRobloxName(robloxName);
                if (linked) targetId = linked;
                else {
                    const allLinked = await xpDb.getAllLinked();
                    const found = allLinked.find(l => l.robloxName.toLowerCase() === robloxName.toLowerCase());
                    if (found) targetId = found.discordId;
                    else {
                        return interaction.editReply(
                            `❌ No Discord user linked to Roblox username \`${robloxName}\`. They must run \`/verify\`.`
                        );
                    }
                }
            } else {
                robloxName = await xpDb.getLinked(targetId);
                if (!robloxName) {
                    return interaction.editReply("❌ You have not linked your Roblox account. Run `/verify` first.");
                }
            }

            // Fetch Roblox data
            await noblox.setCookie(process.env.ROBLOX_COOKIE).catch(() => { });
            const robloxUserId = await noblox.getIdFromUsername(robloxName).catch(() => {
                throw new Error(`Could not find Roblox user \`${robloxName}\`.`);
            });
            const rank = await noblox.getRankInGroup(groupId, robloxUserId).catch(err => {
                throw new Error(`Error fetching Roblox rank: ${err.message}`);
            });
            const roles = await noblox.getRoles(groupId).catch(err => {
                throw new Error(`Error fetching group roles: ${err.message}`);
            });
            const matched = roles.find(r => r.rank === rank) || null;
            const matchedName = matched?.name || "None";

            // Build sets
            const toAddSet = new Set();
            const toRemoveSet = new Set();

            // a) groupRole binding
            const bind = roleBindings.find(b => b.groupRoleId === matched?.id);
            if (bind) toAddSet.add(bind.discordRoleId);

            // b) verification
            const linkedCheck = await xpDb.getLinked(targetId);
            if (verificationRoleId && linkedCheck) toAddSet.add(verificationRoleId);

            // c) premium role already handled above

            // Fetch member to update roles
            const guildMember = await interaction.guild.members.fetch(targetId);

            // Remove old binding/unverified
            for (const { discordRoleId } of roleBindings) {
                if (!toAddSet.has(discordRoleId) && guildMember.roles.cache.has(discordRoleId)) {
                    toRemoveSet.add(discordRoleId);
                }
            }
            if (unverifiedRoleId && guildMember.roles.cache.has(unverifiedRoleId)) {
                toRemoveSet.add(unverifiedRoleId);
            }

            // Apply group & verification roles
            if (toAddSet.size) {
                await guildMember.roles.add([...toAddSet], "Sync group & verify roles");
            }
            if (toRemoveSet.size) {
                await guildMember.roles.remove([...toRemoveSet], "Remove outdated group/unverified");
            }

            // Sync nickname
            if (guildMember.nickname !== robloxName) {
                await guildMember.setNickname(robloxName, "Sync nickname to Roblox username").catch(() => { });
            }

            // Confirmation embed
            const embed = new EmbedBuilder()
                .setTitle("🔄 Update Completed")
                .addFields(
                    { name: "Roblox User", value: `\`${robloxName}\``, inline: false },
                    { name: "Discord Member", value: `<@${targetId}>`, inline: false },
                    { name: "Group Role", value: matchedName, inline: false },
                    { name: "Roles Added", value: "Premium & binding roles", inline: false },
                    { name: "Roles Removed", value: "Outdated roles", inline: false }
                )
                .setColor(0x5865f2)
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Error in /update flow:", err);
            return interaction.editReply({ content: `❌ ${err.message}`, ephemeral: true });
        }
    },
};