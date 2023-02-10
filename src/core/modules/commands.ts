import {
    Interaction,
    BaseCommandInteraction,
    Message,
    CommandInteraction,
    Client,
    ContextMenuInteraction,
    UserContextMenuInteraction,
    InteractionDeferReplyOptions,
    InteractionReplyOptions,
    MessagePayload,
    WebhookEditMessageOptions,
} from "discord.js";
import fs from "fs";
import path from "path";
import {
    ECommandOptionType,
    ECommandType,
    ICommandOption,
    IDiscordApiCommand,
} from "@core/types";
import { BotModule, ELoadableState, Loadable } from "@core/base";
import { log } from "@core/utils";
import axios, { Axios } from "axios";
import util from 'util'
import { BotPlugin } from "./plugins";
import { FrameworkConstants } from "@core/framework";
import { FSWatcher, watch } from 'chokidar'
export class CommandContext {
    ctx: BaseCommandInteraction
    constructor(ctx: BaseCommandInteraction) {
        this.ctx = ctx;
    }

    get type() {
        if (this.ctx.isCommand()) {
            return ECommandType.SLASH
        } else if (this.ctx.isUserContextMenu()) {
            return ECommandType.USER_CONTEXT_MENU;
        }

        return ECommandType.CHAT_CONTEXT_MENU;
    }

    get asSlashContext() {
        return this.ctx as CommandInteraction;
    }

    get asChatContext() {
        return this.ctx as ContextMenuInteraction;
    }

    get asUserContext() {
        return this.ctx as UserContextMenuInteraction;
    }

    get deferred() {
        return this.ctx.deferred;
    }

    async deferReply(opts?: InteractionDeferReplyOptions) {
        return await this.ctx.deferReply(opts);
    }

    async reply(opts: InteractionReplyOptions) {
        return await this.ctx.reply(opts);
    }

    async editReply(opts: string | MessagePayload | WebhookEditMessageOptions) {
        if (!this.ctx.deferred && this.ctx.channel) {
            return await this.ctx.channel.send(opts);
        }

        return await this.ctx.editReply(opts);
    }
}

abstract class CommandBase<P extends BotPlugin = BotPlugin> extends Loadable {
    name: string;
    type: ECommandType;
    description: string;
    dependencies: string[];
    plugin: P | null = null;

    constructor(name: string, desc: string, deps: string[]) {
        super();
        this.name = name;
        this.description = desc;
        this.dependencies = deps;
    }

    setPlugin(plugin: P) {
        this.plugin = plugin;
    }

    async execute(ctx: CommandContext, ...args: any[]) {
        throw new Error("Execute not implemented")
    };

    override async load() {
        log("Loading Command", this.name)
        await super.load();
        log("Loaded Command", this.name)
    };

    toJson() {
        return {
            name: this.name,
            type: this.type,
            description: this.description
        }
    }

    get uniqueId() {
        return `${this.type}${this.name}`
    }

}

abstract class CommandWithOptions<P extends BotPlugin = BotPlugin> extends CommandBase<P> {
    options: ICommandOption[]
    constructor(name: CommandBase['name'], desc: CommandBase['description'], options: ICommandOption[], deps: CommandBase['dependencies']) {
        super(name, desc, deps)
        this.options = options;
    }
}


export abstract class SlashCommand<P extends BotPlugin = BotPlugin> extends CommandWithOptions<P> {
    group: string
    constructor(name: CommandWithOptions['name'], desc: CommandWithOptions['description'], group: string = "", options: CommandWithOptions['options'] = [], deps: CommandWithOptions['dependencies'] = []) {
        super(name, desc, options, deps)
        this.group = group
        this.type = ECommandType.SLASH;
    }

    toJson() {
        return { ...CommandBase.prototype.toJson(), options: this.options }
    }

}

export abstract class UserContextMenuCommand<P extends BotPlugin = BotPlugin> extends CommandWithOptions<P> {
    constructor(name: CommandWithOptions['name'], desc: CommandWithOptions['description'], options: CommandWithOptions['options'], deps: CommandWithOptions['dependencies']) {
        super(name, desc, options, deps)
        this.type = ECommandType.USER_CONTEXT_MENU;
    }
}

export abstract class ChatContextMenuCommand<P extends BotPlugin = BotPlugin> extends CommandBase<P> {
    constructor(name: CommandWithOptions['name'], desc: CommandWithOptions['description'], deps: CommandWithOptions['dependencies']) {
        super(name, desc, deps)
        this.type = ECommandType.CHAT_CONTEXT_MENU;
    }
}

export class CommandsModule extends BotModule {
    static FILE_UPDATE_TIMEOUT = 1000 * 10;
    commands: Map<string, CommandBase> = new Map()
    pathsToCommands: Map<string, CommandBase> = new Map()
    slashCommands: Map<string, SlashCommand> = new Map();
    pendingFileUpdate: Map<string, ReturnType<typeof setTimeout>> = new Map()
    userContextMenuCommands: Map<string, UserContextMenuCommand> = new Map();
    chatContextMenuCommands: Map<string, ChatContextMenuCommand> = new Map();
    watcher: FSWatcher;
    interactionCreateCallback: (interaction: Interaction) => Promise<void> = this.onInteractionCreate.bind(this);

    get coreCommandsPath() {
        return path.join(process.cwd(), 'commands');
    }

    constructor(bot: Client) {
        super(bot)
        this.watcher = watch([], {

        })
        const onCommandFileAddedCallback = this.onCommandFileAdded.bind(this)
        const onCommandFileChangedCallback = this.onCommandFileChanged.bind(this)
        const onCommandFileDeletedCallback = this.onCommandFileDeleted.bind(this)
        this.watcher.on('add', onCommandFileAddedCallback)
        this.watcher.on('change', onCommandFileChangedCallback)
        this.watcher.on('unlink', onCommandFileDeletedCallback)
        this.addBoundEvents([
            {
                target: this.watcher,
                event: 'add',
                callback: onCommandFileAddedCallback
            },
            {
                target: this.watcher,
                event: 'change',
                callback: onCommandFileChangedCallback
            },
            {
                target: this.watcher,
                event: 'unlink',
                callback: onCommandFileDeletedCallback
            }
        ])
    }

    async onCommandFileAdded(path: string, stats: fs.Stats) {
        if (this.pathsToCommands.has(path)) return
        log("Command Path Added", path)
    }

    async onCommandFileChanged(path: string, stats?: fs.Stats | undefined) {
        if (this.pendingFileUpdate.has(path)) {
            log("Refreshing pending File update")
            this.pendingFileUpdate.get(path)!.refresh();
            return;
        }

        log("Adding Pending File update")

        // to account for multiple file updates at the same time so we wait till the latest version
        await new Promise((r => this.pendingFileUpdate.set(path, setTimeout(r, CommandsModule.FILE_UPDATE_TIMEOUT))));

        if (this.pathsToCommands.has(path)) {
            const command = this.pathsToCommands.get(path)!
            if (command.state === ELoadableState.DESTROYING) {
                return
            }
            await command.destroy()
            await this.importCommand(path, command.plugin, false)

            this.pendingFileUpdate.delete(path)
        }
    }

    async onCommandFileDeleted(path: string) {

    }

    async onLoad(): Promise<void> {
        log("Preparing Commands")
        this.bot.on('interactionCreate', this.interactionCreateCallback);
        const commandsToImport = await fs.promises.readdir(this.coreCommandsPath)
        for (let i = 0; i < commandsToImport.length; i++) {
            await this.importCommand(path.join(this.coreCommandsPath, commandsToImport[i]))
        }

        log("Commands Ready")
    }

    async onMessageCreate(message: Message) {
        if (!(this.bot.user === message.author) || message.author.bot) return;

        try {

            if (
                message.mentions.users.has(this.bot.user.id) &&
                message.content &&
                message.content.split(">")[1]
            ) {
                const argument = message.content.split(">")[1].trim().toLowerCase();
                if (argument === "" || argument === "help") {
                }
            }

        } catch (error) {
            log(error);
        }
    }

    static COMMAND_GROUPS = Object.values(FrameworkConstants.COMMAND_GROUPS)

    async onInteractionCreate(interaction: Interaction) {
        try {
            if (!interaction.isCommand() && !interaction.isContextMenu()) {
                return;
            }

            let command: CommandBase | undefined = undefined;
            log("New interaction", interaction.commandName)
            if (interaction.isCommand()) {
                if (interaction.options.getSubcommand(false)) {
                    command = this.slashCommands.get(interaction.options.getSubcommand());
                }
                else {
                    command = this.slashCommands.get(interaction.commandName);
                }

            } else if (interaction.isUserContextMenu()) {
                command = this.userContextMenuCommands.get(interaction.commandName);
            } else if (interaction.isContextMenu()) {
                command = this.chatContextMenuCommands.get(interaction.commandName);
            }

            if (command) {
                await command.execute(new CommandContext(interaction));
            }

        } catch (error) {
            log(error);
        }
    }

    async addCommand(command: CommandBase) {

        this.commands.set(command.uniqueId, command);

        switch (command.type) {
            case ECommandType.CHAT_CONTEXT_MENU:
                await this.addChatContextMenuCommand(command as ChatContextMenuCommand)
                break;
            case ECommandType.SLASH:
                await this.addSlashCommand(command as SlashCommand)
                break;
            case ECommandType.USER_CONTEXT_MENU:
                await this.addUserContextMenuCommand(command as UserContextMenuCommand)
                break;
            default:
                break;
        }

        await command.load()
    }

    private async addChatContextMenuCommand(command: ChatContextMenuCommand) {
        if (this.chatContextMenuCommands.has(command.name)) {
            await this.chatContextMenuCommands.get(command.name)!.destroy()
        }

        this.chatContextMenuCommands.set(command.name, command)
    }

    private async addSlashCommand(command: SlashCommand) {
        if (this.slashCommands.has(command.name)) {
            await this.slashCommands.get(command.name)!.destroy()
        }

        this.slashCommands.set(command.name, command)
    }

    private async addUserContextMenuCommand(command: UserContextMenuCommand) {
        if (this.userContextMenuCommands.has(command.name)) {
            await this.userContextMenuCommands.get(command.name)!.destroy()
        }

        this.userContextMenuCommands.set(command.name, command)
    }

    async importCommand(importPath: string, plugin: BotPlugin | null = null, bWatch = true) {

        if (!importPath.endsWith(".js")) return;

        if (this.pathsToCommands.has(importPath)) {
            delete require.cache[require.resolve(importPath)];
        }

        try {

            const command: CommandBase = new (require(importPath).default)();

            if (plugin) {
                command.setPlugin(plugin);
            }

            await this.addCommand(command);

            if (bWatch) {
                this.pathsToCommands.set(importPath, command);
                this.watcher.add(importPath);
            }

        } catch (error) {
            log(`Error loading ${importPath}\x1b[0m\n`, error);
        }
    }

    getSlashCommand(id: string) {
        return this.slashCommands.get(id);
    }

    getUserContextMenuCommand(id: string) {
        return this.userContextMenuCommands.get(id);
    }

    getChatContextMenuCommand(id: string) {
        return this.userContextMenuCommands.get(id);
    }

    export() {
        const commandsToExport: IDiscordApiCommand[] = [];
        const groups: { [group: string]: IDiscordApiCommand } = {}

        this.slashCommands.forEach(command => {
            if (command.group.length > 0) {

                if (!groups[command.group]) {
                    groups[command.group] = {
                        name: command.group,
                        description: `${command.group} interface`,
                        options: []
                    }
                }

                (groups[command.group].options as IDiscordApiCommand[]).push({ name: command.name, description: command.description, options: command.options, type: ECommandOptionType.SUB_COMMAND })
            }
            else {
                commandsToExport.push({ name: command.name, description: command.description, options: command.options, type: command.type })
            }
        })


        commandsToExport.push.apply(commandsToExport, Object.values(groups));

        commandsToExport.push.apply(commandsToExport, Array.from(this.userContextMenuCommands.values()).map(com => ({ name: com.name, type: com.type })));

        commandsToExport.push.apply(commandsToExport, Array.from(this.chatContextMenuCommands.values()).map(com => ({ name: com.name, type: com.type })));

        return commandsToExport;
    }

    async uploadCommands(guild?: string) {

        const payload = this.export();

        const config = {
            headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
            }
        }
        try {
            if (guild) {
                await axios.put(`https://discord.com/api/v10/applications/895104527001354313/guilds/${guild}/commands`, payload, config);
            }
            else {
                await axios.put(`https://discord.com/api/v10/applications/895104527001354313/commands`, payload, config);
            }
        } catch (error) {
            if (error.isAxiosError) {
                log("error uploading", util.inspect(error.response.data.errors, true, 1000))
            }
        }

    }

}
