export interface DiscordUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  role?: string;
  isBot?: boolean;
  color?: string;
}

export type TournamentRegion = 'India' | 'Pakistan' | 'Bangladesh';

export interface TeamRegistration {
  id: string;
  slotNumber: number;
  teamName: string;
  captain: DiscordUser;
  players: DiscordUser[];
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

export interface TournamentConfig {
  id: string;
  title: string;
  game: string;
  format: 'Squad' | 'Trio' | 'Duo' | 'Solo' | 'Custom';
  requiredTags: number;
  maxTags: number;
  totalSlots: number;
  waitlistSlots: number;
  groupsCount: number;
  teamsPerGroup?: number;
  categoryName: string;
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
  verifiedRoleName?: string;
  managerRoleName?: string;
  customRules?: string;
  rulesChannel?: string;
  blacklist?: BlacklistEntry[];
}

export interface BlacklistEntry {
  id: string;
  username: string;
  reason: string;
  addedAt: string;
  addedBy?: string;
}

export interface PointsEntry {
  rank?: number;
  slotNumber: number;
  teamName: string;
  group?: string;
  matches: number;
  wwcd: number;
  placePoints: number;
  killPoints: number;
  totalPoints: number;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: string;
  author?: {
    name: string;
    icon_url?: string;
  };
  fields?: DiscordEmbedField[];
  footer?: {
    text: string;
    icon_url?: string;
  };
  timestamp?: string;
  voiceConnectTeamId?: string;
  voiceConnectChannelName?: string;
}

export interface DiscordMessage {
  id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  channelId: string;
  embed?: DiscordEmbed;
  reactions?: { emoji: string; count: number; users: string[] }[];
  isBotResponse?: boolean;
  referencedMessageId?: string;
  isDeleted?: boolean;
  deleteCountdown?: number;
}

export interface RoomCredentials {
  roomId: string;
  roomPass: string;
  mapName: string;
  matchTime: string;
  serverType: string;
  sentAt?: string;
}

export interface BotGuildInfo {
  id: string;
  name: string;
  memberCount: number;
  channels: { id: string; name: string; type: number }[];
  permissions?: {
    hasManageChannels: boolean;
    hasManageRoles: boolean;
    hasSendMessages: boolean;
    hasManageMessages?: boolean;
    hasEmbedLinks?: boolean;
    isAdmin: boolean;
  };
}

export interface BotLogEvent {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
  guildName?: string;
}

export type GatewayOperationalState =
  | 'connected'
  | 'partially_operational'
  | 'reconnecting'
  | 'disconnected';

export interface BotStatus {
  isOnline: boolean;
  isConnecting: boolean;
  gatewayState?: GatewayOperationalState;
  wsPing?: number | null;
  wsStatus?: number | null;
  uptimeSeconds?: number | null;
  degradedReasons?: string[];
  botUser: {
    id: string;
    tag: string;
    avatar: string;
  } | null;
  guilds: BotGuildInfo[];
  lastError: string | null;
  startedAt: string | null;
  events: BotLogEvent[];
}
