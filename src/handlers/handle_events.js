const ps = require(`${process.cwd()}/passthrough.js`);
const { sync, bot, modulesLastReloadTime, perGuildSettings, commands } = require(`${process.cwd()}/passthrough.js`);

const parser = sync.require('./handle_commands');
const guildDataModule = sync.require('./handle_guild_data');

const utils = sync.require(`${process.cwd()}/utils`);

const fs = require('fs');


async function onMessageCreate(message) {
    if (message.author.id === bot.user.id) return;
    if (message.author.bot) return;

    if (message.mentions.users.has(bot.user.id)) {
        const argument = message.content.split('>')[1].trim().toLowerCase();
        if (argument === '' || argument === 'help') {
            message.args = ['']
            return commands.get('help').execute(message);
        }
    }

    const commandToExecute = await parser.parseMessage(message).catch((error) => utils.log(`\x1b[31mError parsing message\x1b[0m\n`, error));

    if (commandToExecute !== undefined) {
        commandToExecute.execute(message).catch((error) => {
            utils.log(`\x1b[31mError Executing Message Command\x1b[0m\n`, error)
        });
    }
}

async function onInteractionCreate(interaction) {
    if (!interaction.isCommand() && !interaction.isContextMenu()) {
        return;
    }

    const commandToExecute = await parser.parseInteractionCommand(interaction).catch((error) => utils.log(`\x1b[31mError parsing interaction\x1b[0m\n`, error));

    if (commandToExecute == undefined) {
        interaction.reply("Command not yet implemented");
    }
    else {
        commandToExecute.execute(interaction).catch((error) => {
            utils.log(`\x1b[31mError Executing Interaction Command\x1b[0m\n`, error)
        });

    }
}

async function onGuildMemberUpdate(oldMember, newMember) {
    if (newMember.id == bot.user.id) {

        if (newMember.displayName.toLowerCase() != 'Umeko') {
            newMember.setNickname('Umeko');
        }

    }
}

async function onGuildCreate(guild) {
    guildDataModule.joinedNewGuild(guild);
}


// presence update for twitch activity
async function onPresenceUpdate(oldPresence, newPresence) {

    const options = perGuildSettings.get(newPresence.guild.id).twitch_options;

    if (!options.get('enabled') || options.get('enabled') !== 'true') return;

    if (newPresence.activities.length === 0) return;

    const relevantActivities = newPresence.activities.filter((activity) => activity.name === 'Twitch');

    if (relevantActivities.length === 0) return;

    const targetActivity = relevantActivities[0];

    // we only check the first one because afaik a user can't have more than 1 twitch activity
    if (oldPresence.activities.filter((activity) => activity.id === targetActivity.id).length !== 0) return;

    // Twitch online message here
    let twitchOnlineNotification = perGuildSettings.get(guildId).leveling_message;

    twitchOnlineNotification = twitchOnlineNotification.replace(/{user}/gi, `<@${userId}>`);
    twitchOnlineNotification = twitchOnlineNotification.replace(/{username}/gi, `${username}`);


    if (options.get('channel') && options.get('channel') !== '') {
        if (options.get('channel') === "dm") {
            message.author.send(twitchOnlineNotification).catch((error) => { utils.log('Error sending twitch message', error) })
        }
        else {
            const channel = await message.guild.channels.fetch(options.get('channel'));

            if (channel) {
                channel.send(twitchOnlineNotification);
            }
            else {
                message.forceChannelReply = true;
               utils.reply(message, twitchOnlineNotification);
            }
        }
    }
    else {
        message.forceChannelReply = true;
       utils.reply(message, twitchOnlineNotification);
    }
}


const botEvents = [
    { id: 'messageCreate', event: onMessageCreate },
    { id: 'interactionCreate', event: onInteractionCreate },
    { id: 'guildMemberUpdate', event: onGuildMemberUpdate },
    { id: 'guildCreate', event: onGuildCreate },
    { id: 'presenceUpdate', event: onPresenceUpdate }
]

if (bot !== undefined) {
    if (ps.botEvents !== undefined) {
        const previousEvents = ps.botEvents;

        previousEvents.forEach(function (botEvent, index) {
            try {
                bot.removeListener(botEvent.id, botEvent.event);
            } catch (error) {
                utils.log(`\x1b[31mError unbinding event ${botEvent.id} from bot\x1b[0m\n`, error);
            }
        });

    }

    botEvents.forEach(function (botEvent, index) {
        try {
            bot.on(botEvent.id, botEvent.event);
        } catch (error) {
            utils.log(`\x1b[31mError binding event ${botEvent.id} to bot\x1b[0m\n`, error);
        }
    });

    ps.botEvents = botEvents;
}



if (modulesLastReloadTime.events !== undefined) {
    utils.log('\x1b[32mEvents Module Reloaded\x1b[0m');
}
else {
    utils.log('\x1b[32mEvents Module Loaded\x1b[0m');
}

if (bot) {
    modulesLastReloadTime.events = bot.uptime;
}
