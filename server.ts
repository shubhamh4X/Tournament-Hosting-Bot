import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { discordBot } from './src/server/discordBot.ts';
import { twilioVerifyService } from './src/server/twilioVerifyService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = process.env.STATE_FILE_PATH
  ? path.resolve(process.env.STATE_FILE_PATH)
  : path.resolve(__dirname, '.tournament-state.json');

interface PlayerTag {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export type TournamentRegion = 'India' | 'Pakistan' | 'Bangladesh';

interface TeamRegistration {
  id: string;
  slotNumber: number;
  teamName: string;
  captain: PlayerTag;
  players: PlayerTag[];
  registeredAt: string;
  messageId: string;
  channelId: string;
  isWaitlist: boolean;
  group?: string;
  teamRoleId?: string;
  teamRoleName?: string;
  teamCategoryId?: string;
  teamCategoryName?: string;
  teamVoiceChannelId?: string;
  teamVoiceChannelName?: string;
  whatsappNumber1?: string;
  whatsappNumber2?: string;
  region?: TournamentRegion;
  whatsappVerified?: boolean;
  whatsappVerifiedAt?: string;
}

interface TournamentConfig {
  id: string;
  title: string;
  game: string;
  format: 'Squad' | 'Trio' | 'Duo' | 'Solo' | 'Custom';
  requiredTags: number;
  maxTags: number;
  totalSlots: number;
  waitlistSlots: number;
  groupsCount?: number;
  teamsPerGroup?: number;
  categoryName?: string;
  verifiedRoleName?: string;
  managerRoleName?: string;
  rulesChannel?: string;
  customRules?: string;
  easyTagEnabled: boolean;
  prohibitDuplicateTags: boolean;
  prohibitSelfDuplication: boolean;
  disallowBots: boolean;
  autoDeleteInvalid: boolean;
  autoDeleteSeconds: number;
  autoCreateTeamVoice?: boolean;
  status: 'open' | 'closed' | 'paused';
  regChannel: string;
  slotListChannel: string;
  idpChannel: string;
  regDetailsChannel?: string;
  rulesMessage: string;
  roleName: string;
}

interface RoomCredentials {
  roomId: string;
  roomPass: string;
  mapName: string;
  matchTime: string;
  serverType: string;
  sentAt?: string;
}

let config: TournamentConfig & { explicitlyStoppedOrPaused?: boolean } = {
  id: '',
  title: 'Glacier Cup',
  game: '',
  format: 'Squad',
  requiredTags: 4,
  maxTags: 4,
  totalSlots: 20,
  waitlistSlots: 5,
  groupsCount: 1,
  categoryName: '',
  easyTagEnabled: true,
  prohibitDuplicateTags: true,
  prohibitSelfDuplication: true,
  disallowBots: true,
  autoDeleteInvalid: true,
  autoDeleteSeconds: 5,
  autoCreateTeamVoice: true,
  status: 'open',
  explicitlyStoppedOrPaused: false,
  regChannel: 'registration',
  slotListChannel: 'slot-list',
  idpChannel: 'id-pass',
  regDetailsChannel: '🔒┃registration-details',
  rulesMessage: 'Format:\nTeam Name: Glacier Titans\nRegion: India\nWhatsApp: +919876543210\nPlayer 1: @Captain\nPlayer 2: @Player2\nPlayer 3: @Player3\nPlayer 4: @Player4',
  roleName: 'Confirmed Slot',
  verifiedRoleName: 'Verified Team',
  managerRoleName: 'FFA Bot Manager'
};

let registeredTeams: TeamRegistration[] = [];
let lastRoomDispatch: RoomCredentials | null = null;

function saveTournamentState() {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serialized = JSON.stringify({ config, registeredTeams, lastRoomDispatch }, null, 2);
    const tempFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tempFile, serialized, 'utf8');
    fs.renameSync(tempFile, STATE_FILE);
  } catch (err) {
    console.error('[Server] Failed to save tournament state to disk:', err);
  }
}

function loadTournamentState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.config) {
        config = { ...config, ...parsed.config };
        if (!config.totalSlots || config.totalSlots <= 0) {
          config.totalSlots = 20;
        }
        if (!config.explicitlyStoppedOrPaused) {
          config.status = 'open';
        }
      }
      if (parsed && Array.isArray(parsed.registeredTeams)) {
        registeredTeams = parsed.registeredTeams;
      }
      if (parsed && parsed.lastRoomDispatch) {
        lastRoomDispatch = parsed.lastRoomDispatch;
      }
    }
  } catch (err) {
    console.error('[Server] Failed to load tournament state from disk:', err);
  }
}

loadTournamentState();

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Handled async rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Handled runtime exception:', err.message);
});

async function startServer() {
  const app = express();
  const parsedPort = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000', 10);
  const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      botOnline: discordBot.getStatus().isOnline
    });
  });

  discordBot.getTournamentConfig = () => config;
  discordBot.getRegisteredTeams = () => registeredTeams;
  discordBot.onConfigUpdated = () => {
    saveTournamentState();
  };
  discordBot.onTeamRegistered = (team) => {
    registeredTeams.push(team);
    saveTournamentState();
    console.log(`[Tournament] Registered new team via Discord bot: ${team.teamName} (Slot #${team.slotNumber})`);
  };
  discordBot.onTeamDeleted = (slotNumber) => {
    saveTournamentState();
    console.log(`[Tournament] Slot #${slotNumber} deleted via Discord command`);
  };
  discordBot.onTournamentDeleted = () => {
    registeredTeams = [];
    lastRoomDispatch = null;
    config.title = '';
    config.totalSlots = 0;
    config.categoryName = '';
    config.status = 'closed';
    config.explicitlyStoppedOrPaused = true;
    saveTournamentState();
    console.log(`[Tournament] Active tournament deleted & roster reset via Discord command`);
  };

  const getConfiguredToken = (): string => {
    return (process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '').trim();
  };

  const initialToken = getConfiguredToken();
  if (initialToken) {
    discordBot.start(initialToken).then(res => {
      if (res.success) {
        console.log('FFA-Manager connected to Discord Gateway on startup.');
      } else {
        console.error('FFA-Manager startup notice:', res.error);
      }
    }).catch((err) => {
      console.error('FFA-Manager unexpected startup error:', err);
    });
  } else {
    console.warn(
      '[Server] Notice: DISCORD_TOKEN environment variable is not set. ' +
      'Configure DISCORD_TOKEN in your .env file or hosting environment to auto-connect on startup, ' +
      'or connect manually via the web dashboard.'
    );
  }

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json(config);
  });

  app.post('/api/config', (req: Request, res: Response) => {
    const incoming = { ...req.body };
    const isExplicitStatusChange = Boolean(incoming.explicitStatusCommand);
    delete incoming.explicitStatusCommand;

    if (!isExplicitStatusChange) {
      delete incoming.status;
    } else if (incoming.status === 'paused' || incoming.status === 'closed') {
      config.explicitlyStoppedOrPaused = true;
    } else if (incoming.status === 'open') {
      config.explicitlyStoppedOrPaused = false;
    }

    config = { ...config, ...incoming };
    if (typeof config.requiredTags === 'number' && config.requiredTags > 0) {
      config.maxTags = config.requiredTags;
    }
    if (!config.explicitlyStoppedOrPaused) {
      config.status = 'open';
    }
    saveTournamentState();
    res.json({ success: true, config });
  });

  app.get('/api/teams', (_req: Request, res: Response) => {
    res.json({
      confirmed: registeredTeams.filter(t => !t.isWaitlist),
      waitlist: registeredTeams.filter(t => t.isWaitlist),
      totalSlots: config.totalSlots,
      waitlistSlots: config.waitlistSlots,
      remainingSlots: Math.max(0, config.totalSlots - registeredTeams.filter(t => !t.isWaitlist).length),
      isFull: registeredTeams.filter(t => !t.isWaitlist).length >= config.totalSlots
    });
  });

  app.post('/api/parse-eztag', (req: Request, res: Response) => {
    const { text, userDirectory } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing text content' });
    }

    const tokenRegex = /(?:<@!?)?(\d{6,25})>?/g;
    let convertedText = text;
    const detectedTags: any[] = [];
    const unresolvedIds: string[] = [];
    const malformedIds: string[] = [];

    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
      const foundId = match[1];
      if (!/^\d{17,20}$/.test(foundId)) {
        malformedIds.push(foundId);
        continue;
      }
      const foundUser = (userDirectory || []).find((u: any) => u.id === foundId);
      if (foundUser) {
        convertedText = convertedText.replace(match[0], `@${foundUser.displayName}`);
        detectedTags.push(foundUser);
      } else {
        unresolvedIds.push(foundId);
      }
    }

    res.json({
      originalText: text,
      convertedText,
      detectedTags,
      unresolvedIds,
      malformedIds,
      valid: malformedIds.length === 0 && unresolvedIds.length === 0
    });
  });

  app.get('/api/whatsapp-otp/status', (_req: Request, res: Response) => {
    res.json(twilioVerifyService.getConfigStatus());
  });

  app.post('/api/whatsapp-otp/send', async (req: Request, res: Response) => {
    const { phone, region } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PHONE_NUMBER',
        error: 'Phone number is required.'
      });
    }

    const validRegions = ['India', 'Pakistan', 'Bangladesh'] as const;
    const targetRegion = (region && validRegions.includes(region as any)) ? (region as TournamentRegion) : 'India';

    const waNorm = discordBot.normalizeWhatsAppWithRegion(phone, targetRegion);
    if (!waNorm.valid) {
      const expectedCode = discordBot.getRegionCountryCode(targetRegion);
      return res.status(400).json({
        success: false,
        code: 'INVALID_PHONE_NUMBER',
        error: `Invalid WhatsApp Number! Please enter a valid number with ${expectedCode} country code for ${targetRegion} (e.g., ${expectedCode}9876543210).`
      });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';

    const result = await twilioVerifyService.sendWhatsAppOtp(waNorm.formatted, clientIp);

    if (!result.success) {
      const statusCode = result.code === 'RATE_LIMITED' ? 429 : result.code === 'TWILIO_NOT_CONFIGURED' ? 503 : 400;
      return res.status(statusCode).json(result);
    }

    return res.json({
      success: true,
      message: `Verification code sent to your WhatsApp (${waNorm.formatted}).`,
      cooldownSeconds: result.cooldownSeconds || 60,
      normalizedPhone: waNorm.formatted
    });
  });

  app.post('/api/whatsapp-otp/verify', async (req: Request, res: Response) => {
    const { phone, code, region } = req.body;
    if (!phone || typeof phone !== 'string' || !code || typeof code !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        error: 'Phone number and verification code are required.'
      });
    }

    const validRegions = ['India', 'Pakistan', 'Bangladesh'] as const;
    const targetRegion = (region && validRegions.includes(region as any)) ? (region as TournamentRegion) : 'India';

    const waNorm = discordBot.normalizeWhatsAppWithRegion(phone, targetRegion);
    if (!waNorm.valid) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PHONE_NUMBER',
        error: 'Invalid phone number format.'
      });
    }

    const result = await twilioVerifyService.verifyWhatsAppOtp(waNorm.formatted, code, targetRegion);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({
      success: true,
      verificationToken: result.verificationToken,
      message: `WhatsApp number ${waNorm.formatted} verified successfully!`,
      verifiedPhone: waNorm.formatted
    });
  });

  app.post('/api/register', async (req: Request, res: Response) => {
    const {
      teamName,
      captain,
      players,
      messageId,
      channelId,
      whatsappNumber1,
      region,
      verificationToken
    } = req.body;

    const result = await discordBot.withOperationLock(async () => {
      if (!config.explicitlyStoppedOrPaused && config.status !== 'open') {
        config.status = 'open';
      }
      if (config.status !== 'open') {
        return {
          status: 400,
          body: {
            success: false,
            code: 'REGISTRATION_CLOSED',
            error: `Registrations are currently ${config.status.toUpperCase()}! Please wait for staff to open.`
          }
        };
      }

      const cleanedName = (teamName || '').replace(/^<\s*|\s*>$/g, '').trim();
      const lowerName = cleanedName.toLowerCase();
      if (!cleanedName || cleanedName.length < 2 || lowerName === 'team name' || lowerName === 'your team' || lowerName === 'your team name') {
        return {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_TEAM_NAME',
            error: 'Please specify a valid Team Name (e.g. `Team Name: Team Glacier`).'
          }
        };
      }

      const validRegions = ['India', 'Pakistan', 'Bangladesh'] as const;
      if (!region || !validRegions.includes(region as any)) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_REGION',
            error: 'Region is required and must be selected from: India, Bangladesh, or Pakistan.'
          }
        };
      }

      const rawWa1 = typeof whatsappNumber1 === 'string' ? whatsappNumber1.trim() : '';
      const waNorm = discordBot.normalizeWhatsAppWithRegion(rawWa1, region as TournamentRegion);
      if (!waNorm.valid) {
        const expectedCode = discordBot.getRegionCountryCode(region as TournamentRegion);
        return {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_WHATSAPP_NUMBER',
            error: `WhatsApp Number is required with ${expectedCode} country code for ${region} (e.g., ${expectedCode}9876543210).`
          }
        };
      }
      const cleanWa1 = waNorm.formatted;

      // Enforce real WhatsApp OTP verification
      if (twilioVerifyService.isConfigured()) {
        if (!verificationToken) {
          return {
            status: 400,
            body: {
              success: false,
              code: 'WHATSAPP_VERIFICATION_REQUIRED',
              error: 'WhatsApp phone number verification is mandatory. Please click "Verify on WhatsApp" to receive and confirm your OTP before registering.'
            }
          };
        }

        const tokenCheck = twilioVerifyService.consumeVerificationToken(verificationToken, cleanWa1);
        if (!tokenCheck.valid) {
          return {
            status: 400,
            body: {
              success: false,
              code: tokenCheck.code || 'INVALID_VERIFICATION_TOKEN',
              error: tokenCheck.error || 'WhatsApp verification failed or has expired. Please verify your number again.'
            }
          };
        }
      } else {
        return {
          status: 503,
          body: {
            success: false,
            code: 'TWILIO_NOT_CONFIGURED',
            error: 'Twilio WhatsApp verification is not configured on this server. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in server environment to enable verified tournament registrations.'
          }
        };
      }

      const confirmedCount = registeredTeams.filter(t => !t.isWaitlist).length;
      const waitlistCount = registeredTeams.filter(t => t.isWaitlist).length;

      if (!players || players.length < config.requiredTags) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'INSUFFICIENT_TAGS',
            error: `Tagcheck Failed! Exactly ${config.requiredTags} players are required for ${config.format} (as set during setup). You provided ${players ? players.length : 0}.`
          }
        };
      }

      if (players.length > config.requiredTags) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'EXCESSIVE_TAGS',
            error: `Tagcheck Failed! Only ${config.requiredTags} players are allowed per team as set during setup (no extra players or tags). You provided ${players.length}.`
          }
        };
      }

      if (config.prohibitSelfDuplication) {
        const playerIds = players.map((p: any) => p.id);
        const uniqueIds = new Set(playerIds);
        if (uniqueIds.size !== playerIds.length) {
          return {
            status: 400,
            body: {
              success: false,
              code: 'DUPLICATE_PLAYERS_IN_TEAM',
              error: 'Tagcheck Failed! Duplicate players detected in the same team roster. Every player tag must be unique.'
            }
          };
        }
      }

      const blacklist = discordBot.getBlacklist();
      for (const player of players) {
        const banned = blacklist.find(b => b.userId === player.id || b.username.toLowerCase() === (player.username || '').toLowerCase() || b.username.toLowerCase() === (player.displayName || '').toLowerCase());
        if (banned) {
          return {
            status: 400,
            body: {
              success: false,
              code: 'PLAYER_BLACKLISTED',
              error: `Tagcheck Failed! Player @${player.displayName || player.username} is BLACKLISTED from this tournament (Reason: ${banned.reason}).`
            }
          };
        }
      }

      const captainId = captain?.id || players[0]?.id;
      const captainExistingTeam = registeredTeams.find(t => t.captain?.id === captainId);

      const duplicateTeamName = registeredTeams.find(
        t => (!captainExistingTeam || t.id !== captainExistingTeam.id) && t.teamName.toLowerCase() === lowerName
      );
      if (duplicateTeamName) {
        return {
          status: 400,
          body: {
            success: false,
            code: 'DUPLICATE_TEAM_NAME',
            error: `Tagcheck Failed! A team named "${duplicateTeamName.teamName}" is already registered in Slot #${duplicateTeamName.slotNumber}.`
          }
        };
      }

      if (config.prohibitDuplicateTags) {
        for (const player of players) {
          for (const existingTeam of registeredTeams) {
            if (captainExistingTeam && existingTeam.id === captainExistingTeam.id) continue;
            const isRegistered = existingTeam.players.some((p: any) => p.id === player.id);
            if (isRegistered) {
              return {
                status: 400,
                body: {
                  success: false,
                  code: 'PLAYER_ALREADY_REGISTERED',
                  error: `Tagcheck Failed! Player @${player.displayName} is already registered in team "${existingTeam.teamName}" (Slot #${existingTeam.slotNumber}). Cross-team duplicate tagging is prohibited!`
                }
              };
            }
          }
        }
      }

      if (captainExistingTeam) {
        const client = (discordBot as any).client;
        const guild = client?.guilds?.cache?.first();
        if (guild) {
          await discordBot.cleanupTeamWorkspace(guild, captainExistingTeam).catch(() => {});
        }
        const idx = registeredTeams.findIndex(t => t.id === captainExistingTeam.id);
        if (idx !== -1) {
          registeredTeams.splice(idx, 1);
        }
      }

      const isWaitlist = captainExistingTeam ? captainExistingTeam.isWaitlist : confirmedCount >= config.totalSlots;
      const slotNumber = captainExistingTeam ? captainExistingTeam.slotNumber : (isWaitlist ? waitlistCount + 1 : confirmedCount + 1);

      const assignedGroup = isWaitlist ? undefined : discordBot.calculateGroupForSlot(slotNumber, config);

      const newTeam: TeamRegistration = {
        id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        slotNumber,
        teamName: cleanedName,
        captain: captain || players[0],
        players,
        registeredAt: new Date().toISOString(),
        messageId: messageId || `msg-${Date.now()}`,
        channelId: channelId || config.regChannel,
        isWaitlist,
        group: isWaitlist ? undefined : assignedGroup,
        teamRoleName: cleanedName,
        teamCategoryName: cleanedName,
        teamVoiceChannelName: cleanedName,
        whatsappNumber1: cleanWa1,
        region: region as TournamentRegion,
        whatsappVerified: true,
        whatsappVerifiedAt: new Date().toISOString()
      };

      if (config.autoCreateTeamVoice !== false) {
        const client = (discordBot as any).client;
        const guild = client?.guilds?.cache?.first();
        if (guild) {
          await discordBot.provisionTeamWorkspace(
            guild,
            newTeam,
            players.map((p: any) => p.id)
          ).catch(() => {});
        }
      }

      registeredTeams.push(newTeam);
      registeredTeams.sort((a, b) => (a.isWaitlist === b.isWaitlist ? a.slotNumber - b.slotNumber : a.isWaitlist ? 1 : -1));
      saveTournamentState();

      const client = (discordBot as any).client;
      const guild = client?.guilds?.cache?.first();
      if (guild) {
        await discordBot.updateSlotListChannel(guild, config).catch(() => {});
      }

      const newConfirmedCount = registeredTeams.filter(t => !t.isWaitlist).length;

      return {
        status: 200,
        body: {
          success: true,
          team: newTeam,
          isWaitlist,
          slotNumber,
          autoClosed: false,
          remainingSlots: Math.max(0, config.totalSlots - newConfirmedCount)
        }
      };
    });

    return res.status(result.status).json(result.body);
  });

  app.post('/api/teams/kick', async (req: Request, res: Response) => {
    const { teamId, guildId } = req.body;
    const targetTeam = registeredTeams.find(t => t.id === teamId);
    if (!targetTeam) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();

    const result = await discordBot.deleteSlot(targetTeam.slotNumber, guild);
    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to remove team slot' });
    }

    res.json({
      success: true,
      kickedTeam: result.deletedTeam,
      promotedTeam: result.promotedTeam,
      syncWarnings: result.syncWarnings || [],
      teams: registeredTeams
    });
  });

  app.post('/api/teams/reset', async (_req: Request, res: Response) => {
    await discordBot.withOperationLock(async () => {
      const client = (discordBot as any).client;
      const guild = client?.guilds?.cache?.first();
      if (guild) {
        for (const t of registeredTeams) {
          await discordBot.cleanupTeamWorkspace(guild, t).catch(() => {});
        }
      }
      registeredTeams.splice(0, registeredTeams.length);
      config.status = 'open';
      saveTournamentState();
      if (guild) {
        await discordBot.updateSlotListChannel(guild, config).catch(() => {});
      }
    });
    res.json({ success: true, message: 'All registrations and slots reset successfully.' });
  });

  app.post('/api/idp', async (req: Request, res: Response) => {
    const { roomId, roomPass, mapName, matchTime, serverType } = req.body;
    if (!roomId || !roomPass) {
      return res.status(400).json({ error: 'Room ID and Password are required' });
    }

    lastRoomDispatch = {
      roomId: String(roomId).trim(),
      roomPass: String(roomPass).trim(),
      mapName: mapName || 'Main Lobby',
      matchTime: matchTime || 'TBD',
      serverType: serverType || 'Custom Room #1',
      sentAt: new Date().toISOString()
    };

    const pubResult = await discordBot.dispatchIdp(lastRoomDispatch, config);

    res.json({
      success: pubResult.success,
      dispatch: lastRoomDispatch,
      recipientCount: registeredTeams.filter(t => !t.isWaitlist).length,
      publishedCount: pubResult.sentCount,
      targetChannels: pubResult.targetChannels,
      publicationFailures: pubResult.failedGuilds
    });
  });

  app.get('/api/idp', (_req: Request, res: Response) => {
    res.json({ dispatch: lastRoomDispatch });
  });

  app.get('/api/bot/status', (_req: Request, res: Response) => {
    res.json(discordBot.getStatus());
  });

  app.post('/api/bot/start', async (req: Request, res: Response) => {
    const tokenToUse = (req.body?.token && String(req.body.token).trim()) || getConfiguredToken();
    if (!tokenToUse) {
      return res.status(400).json({
        success: false,
        error: 'Bot token is required. Set DISCORD_TOKEN in your .env/environment or enter a token in the dashboard.'
      });
    }
    const result = await discordBot.start(tokenToUse);
    res.json(result);
  });

  app.post('/api/bot/connect', async (req: Request, res: Response) => {
    const tokenToUse = (req.body?.token && String(req.body.token).trim()) || getConfiguredToken();
    if (!tokenToUse) {
      return res.status(400).json({
        success: false,
        error: 'Bot token is required. Set DISCORD_TOKEN in your .env/environment or enter a token in the dashboard.'
      });
    }
    const result = await discordBot.start(tokenToUse);
    res.json(result);
  });

  app.post('/api/bot/stop', async (_req: Request, res: Response) => {
    await discordBot.stop();
    res.json({ success: true, status: discordBot.getStatus() });
  });

  app.post('/api/bot/auto-setup', async (req: Request, res: Response) => {
    const { guildId } = req.body;
    if (!guildId) {
      return res.status(400).json({ success: false, error: 'guildId is required' });
    }
    const result = await discordBot.setupGuild(guildId);
    res.json(result);
  });

  app.post('/api/bot/tournament-setup', async (req: Request, res: Response) => {
    const { guildId, title, slots, tags, groups, teamsPerGroup, verifiedRoleName } = req.body;
    if (!guildId) {
      return res.status(400).json({ success: false, error: 'guildId is required' });
    }

    const client = (discordBot as any).client;
    const guild = client?.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ success: false, error: 'Discord server not found or bot lacks access' });
    }

    const parsedSlots = Math.max(2, Math.min(500, parseInt(slots, 10) || config.totalSlots || 20));
    const parsedTeamsPerGroup = parseInt(teamsPerGroup || groups, 10) || config.teamsPerGroup || parsedSlots;

    const result = await discordBot.createTournament(guild, {
      title,
      slots: parsedSlots,
      tags: parseInt(tags, 10) || config.requiredTags,
      teamsPerGroup: parsedTeamsPerGroup,
      verifiedRoleName: verifiedRoleName || 'Verified Team',
      createdBy: 'Web Dashboard'
    });

    res.json({
      ...result,
      config
    });
  });

  app.post('/api/bot/start-registration', async (req: Request, res: Response) => {
    const { guildId } = req.body || {};
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : undefined;
    const result = await discordBot.startRegistration(guild, 'Web Dashboard');
    saveTournamentState();
    res.json({
      ...result,
      config
    });
  });

  app.post('/api/bot/pause-registration', async (req: Request, res: Response) => {
    const { guildId, reason } = req.body || {};
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : undefined;
    const result = await discordBot.pauseRegistration(guild, reason, 'Web Dashboard');
    saveTournamentState();
    res.json({
      ...result,
      config
    });
  });

  app.post('/api/bot/stop-registration', async (req: Request, res: Response) => {
    const { guildId, reason } = req.body || {};
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : undefined;
    const result = await discordBot.stopRegistration(guild, reason, 'Web Dashboard');
    saveTournamentState();
    res.json({
      ...result,
      config
    });
  });

  app.post('/api/bot/sync-commands', async (_req: Request, res: Response) => {
    const result = await discordBot.registerSlashCommands();
    res.json(result);
  });

  app.post('/api/bot/delete-slot', async (req: Request, res: Response) => {
    const { slot, guildId } = req.body;
    const slotNum = parseInt(slot, 10);
    if (isNaN(slotNum)) {
      return res.status(400).json({ success: false, error: 'Valid slot number is required' });
    }

    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();
    const result = await discordBot.deleteSlot(slotNum, guild);

    res.json({
      ...result,
      teams: registeredTeams
    });
  });

  app.post('/api/bot/delete-tournament', async (req: Request, res: Response) => {
    const { guildId, deleteChannels, preview } = req.body;
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();

    if (preview) {
      const previewData = discordBot.previewDeleteTournament(guild, deleteChannels !== false);
      return res.json({
        success: true,
        preview: previewData
      });
    }

    const result = await discordBot.deleteTournament(guild, deleteChannels !== false);

    res.json({
      ...result,
      config,
      teams: registeredTeams
    });
  });

  app.post('/api/teams/swap', async (req: Request, res: Response) => {
    const { slot1, slot2, guildId } = req.body;
    const s1 = parseInt(slot1, 10);
    const s2 = parseInt(slot2, 10);
    if (isNaN(s1) || isNaN(s2)) {
      return res.status(400).json({ success: false, error: 'Valid slot1 and slot2 numbers are required' });
    }
    const client = (discordBot as any).client;
    const guild = guildId ? client?.guilds.cache.get(guildId) : client?.guilds.cache.first();
    const result = await discordBot.swapSlots(s1, s2, guild);
    res.json({
      ...result,
      teams: registeredTeams
    });
  });

  app.get('/api/blacklist', (_req: Request, res: Response) => {
    res.json({ blacklist: discordBot.getBlacklist() });
  });

  app.post('/api/blacklist/add', (req: Request, res: Response) => {
    const { userId, username, reason, addedBy } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }
    const entry = discordBot.addToBlacklist(userId, username || userId, reason || 'Rule violation', addedBy || 'Admin');
    res.json({ success: true, entry, blacklist: discordBot.getBlacklist() });
  });

  app.post('/api/blacklist/remove', (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }
    const removed = discordBot.removeFromBlacklist(userId);
    res.json({ success: removed, blacklist: discordBot.getBlacklist() });
  });

  app.get('/api/export/csv', (_req: Request, res: Response) => {
    const csv = discordBot.generateRosterExport('csv');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="scrim_rosters.csv"');
    res.send(csv);
  });

  const distPath = path.resolve(__dirname, 'dist');
  const distIndexHtml = path.resolve(distPath, 'index.html');
  const isDevMode = process.env.NODE_ENV === 'development';
  const hasDist = fs.existsSync(distIndexHtml);
  const useStaticBuild = hasDist && !isDevMode;

  if (!useStaticBuild) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.warn('[Server] Vite middleware unavailable, falling back to static asset serving:', viteErr);
      app.use(express.static(distPath));
    }
  } else {
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      res.sendFile(distIndexHtml);
    });
  }

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`FFA | Glacier Cup Manager™ server running on http://${HOST}:${PORT}`);
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      console.warn(`[Server] Port ${PORT} is unavailable (${err.code}). Retrying on an available port so Discord bot stays online...`);
      httpServer.listen(0, HOST, () => {
        const addr = httpServer.address();
        const fallbackPort = typeof addr === 'object' && addr ? addr.port : 'random';
        console.log(`FFA | Glacier Cup Manager™ server running on fallback http://${HOST}:${fallbackPort}`);
      });
      return;
    }
    console.error(`[Server] HTTP server error on ${HOST}:${PORT}:`, err.message);
  });

  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Server] Received ${signal}. Saving tournament state and shutting down gracefully...`);
    try {
      saveTournamentState();
      await discordBot.stop();
    } catch (err) {
      console.error('[Server] Error during shutdown cleanup:', err);
    }
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 5000).unref();
  };

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
