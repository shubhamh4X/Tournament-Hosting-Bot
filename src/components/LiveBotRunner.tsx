import React, { useState, useEffect } from 'react';
import {
  BotStatus,
  TournamentConfig,
  BotGuildInfo,
  BotLogEvent
} from '../types/tournament';
import {
  Power,
  ShieldCheck,
  Server,
  Hash,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Info,
  Wand2,
  Terminal,
  Activity,
  AlertTriangle,
  Trophy,
  Zap
} from 'lucide-react';

interface LiveBotRunnerProps {
  config: TournamentConfig;
  onRefreshTeams: () => void;
  onUpdateConfig?: (newConfig: Partial<TournamentConfig>) => void;
}

export const LiveBotRunner: React.FC<LiveBotRunnerProps> = ({ config, onRefreshTeams, onUpdateConfig }) => {
  const [botStatus, setBotStatus] = useState<BotStatus>({
    isOnline: false,
    isConnecting: false,
    gatewayState: 'disconnected',
    wsPing: -1,
    wsStatus: -1,
    uptimeSeconds: 0,
    degradedReasons: [],
    botUser: null,
    guilds: [],
    lastError: null,
    startedAt: null,
    events: []
  });

  const [tokenInput, setTokenInput] = useState<string>('');
  const [clientIdInput, setClientIdInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [settingUpGuildId, setSettingUpGuildId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [showWizard, setShowWizard] = useState<boolean>(true);
  const [wizardGuildId, setWizardGuildId] = useState<string>('');
  const [wizardTitle, setWizardTitle] = useState<string>(config.title || '');
  const [wizardSlots, setWizardSlots] = useState<number>(config.totalSlots > 0 ? config.totalSlots : 20);
  const [wizardTags, setWizardTags] = useState<number>(config.requiredTags || 4);
  const [wizardGroups, setWizardGroups] = useState<number>(config.teamsPerGroup || (config.totalSlots > 0 ? config.totalSlots : 20));
  const [wizardRoleName, setWizardRoleName] = useState<string>(config.verifiedRoleName || 'Verified Team');
  const [isSettingUpTourney, setIsSettingUpTourney] = useState<boolean>(false);
  const [wizardResult, setWizardResult] = useState<{
    success: boolean;
    created: string[];
    warnings?: string[];
    rolledBack?: string[];
    error?: string;
  } | null>(null);

  const applyPreset = (slots: number, tags: number, teamsPerGroup: number, title: string) => {
    setWizardSlots(slots);
    setWizardTags(tags);
    setWizardGroups(teamsPerGroup);
    setWizardTitle(title);
  };

  const handleRunSetupWizard = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetGuildId = wizardGuildId || (botStatus.guilds[0]?.id ?? '');
    if (!targetGuildId) {
      setFeedback({ type: 'error', message: 'Please select a Discord server to setup' });
      return;
    }

    setIsSettingUpTourney(true);
    setWizardResult(null);

    try {
      const res = await fetch('/api/bot/tournament-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildId: targetGuildId,
          title: wizardTitle,
          slots: wizardSlots,
          tags: wizardTags,
          teamsPerGroup: wizardGroups,
          verifiedRoleName: wizardRoleName
        })
      });

      const data = await res.json();
      if (data.success) {
        setWizardResult({
          success: true,
          created: data.created || [],
          warnings: data.warnings || []
        });
        setFeedback({
          type: data.warnings?.length ? 'info' : 'success',
          message: data.warnings?.length
            ? `Tournament "${wizardTitle}" created with ${data.warnings.length} permission notice(s).`
            : `Tournament "${wizardTitle}" auto-created! Channels & @${wizardRoleName} role are ready.`
        });
        if (onUpdateConfig && data.config) {
          onUpdateConfig(data.config);
        }
        fetchStatus();
      } else {
        setWizardResult({
          success: false,
          created: data.created || [],
          rolledBack: data.rolledBack || [],
          error: data.error || 'Failed to setup tournament'
        });
        setFeedback({
          type: 'error',
          message: data.error || 'Setup failed'
        });
      }
    } catch (err: any) {
      setWizardResult({
        success: false,
        created: [],
        error: err.message || 'Setup request failed'
      });
    } finally {
      setIsSettingUpTourney(false);
    }
  };

  const fetchStatus = () => {
    fetch('/api/bot/status')
      .then(r => r.json())
      .then((data: BotStatus) => {
        setBotStatus(data);
        if (data.isOnline) {
          onRefreshTeams();
          if (data.botUser?.id && !clientIdInput) {
            setClientIdInput(data.botUser.id);
          }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectBot = async () => {
    setIsLoading(true);
    setFeedback({ type: 'info', message: 'Connecting to Discord Gateway...' });
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() || undefined })
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', message: 'Discord bot connected and online!' });
        fetchStatus();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to connect to Discord bot.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to connect to Discord bot.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopBot = async () => {
    setIsLoading(true);
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      setFeedback({ type: 'success', message: 'Discord bot disconnected.' });
      fetchStatus();
    } catch {
      setFeedback({ type: 'error', message: 'Failed to stop bot.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoSetupGuild = async (guildId: string) => {
    setSettingUpGuildId(guildId);
    setFeedback(null);
    try {
      const res = await fetch('/api/bot/auto-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId })
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({
          type: 'success',
          message: `Server setup complete! Channels #${config.regChannel}, #${config.slotListChannel}, #${config.idpChannel} and role @${config.roleName} are ready.`
        });
        fetchStatus();
      } else {
        const rbMsg = data.rolledBack?.length ? ` (Rolled back ${data.rolledBack.length} partial item(s))` : '';
        setFeedback({
          type: 'error',
          message: (data.error || 'Failed to auto-setup. The bot needs "Manage Channels" permission in your server.') + rbMsg
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Auto-setup failed' });
    } finally {
      setSettingUpGuildId(null);
    }
  };

  const handleSelectRegChannel = (channelName: string) => {
    if (onUpdateConfig) {
      onUpdateConfig({ regChannel: channelName });
    } else {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regChannel: channelName })
      }).catch(() => {});
    }

    setFeedback({
      type: 'success',
      message: `Registration channel set to #${channelName}. The bot is now listening in #${channelName}!`
    });
  };

  const activeClientId = botStatus.botUser?.id || clientIdInput.trim() || '1564392085094666353';
  const standardInviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${activeClientId}&permissions=268519488&scope=bot%20applications.commands`;
  const adminInviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${activeClientId}&permissions=8&scope=bot%20applications.commands`;

  const gatewayState = botStatus.gatewayState || (botStatus.isOnline ? 'connected' : botStatus.isConnecting ? 'reconnecting' : 'disconnected');
  const formatUptime = (secs?: number) => {
    if (!secs || secs <= 0) return '0s';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m < 60) return m > 0 ? `${m}m ${s}s` : `${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  return (
    <div className="space-y-5 w-full">
      <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-start sm:items-center gap-4">
            <img
              src={botStatus.botUser?.avatar || '/assets/glacier-cup-logo.png'}
              alt="FFA-Manager"
              className="w-12 h-12 rounded-lg border border-[#292F3A] bg-[#191D25] object-cover shrink-0"
              referrerPolicy="no-referrer"
            />

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-display text-base sm:text-lg font-bold text-[#F3F5F9] tracking-tight">
                  {botStatus.isOnline
                    ? botStatus.botUser?.tag || 'FFA-Manager'
                    : 'FFA-Manager Gateway'}
                </h2>

                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium border ${
                    gatewayState === 'connected'
                      ? 'bg-[#31D69A]/10 text-[#31D69A] border-[#31D69A]/30'
                      : gatewayState === 'partially_operational'
                      ? 'bg-[#F0B75A]/10 text-[#F0B75A] border-[#F0B75A]/30'
                      : gatewayState === 'reconnecting'
                      ? 'bg-[#6685FF]/15 text-[#A7C7FF] border-[#6685FF]/30'
                      : 'bg-[#191D25] text-[#929BAA] border-[#292F3A]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      gatewayState === 'connected'
                        ? 'bg-[#31D69A]'
                        : gatewayState === 'partially_operational'
                        ? 'bg-[#F0B75A]'
                        : gatewayState === 'reconnecting'
                        ? 'bg-[#6685FF] animate-pulse'
                        : 'bg-[#707A89]'
                    }`}
                  />
                  {gatewayState === 'connected'
                    ? 'Connected (Operational)'
                    : gatewayState === 'partially_operational'
                    ? 'Partially Operational'
                    : gatewayState === 'reconnecting'
                    ? 'Reconnecting Gateway...'
                    : 'Disconnected'}
                </span>

                {botStatus.isOnline && typeof botStatus.wsPing === 'number' && botStatus.wsPing >= 0 && (
                  <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded bg-[#101319] text-[#A7C7FF] border border-[#292F3A]">
                    Ping: {botStatus.wsPing}ms
                  </span>
                )}

                {botStatus.isOnline && typeof botStatus.uptimeSeconds === 'number' && botStatus.uptimeSeconds > 0 && (
                  <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded bg-[#101319] text-[#929BAA] border border-[#292F3A]">
                    Uptime: {formatUptime(botStatus.uptimeSeconds)}
                  </span>
                )}
              </div>

              <p className="text-xs text-[#929BAA] mt-1.5 leading-relaxed">
                {botStatus.isOnline
                  ? `Active in ${botStatus.guilds?.length || 0} Discord server(s) · Listening for tag-basis registrations in #${config.regChannel} · EasyTag: ${config.easyTagEnabled ? 'Active' : 'Disabled'}`
                  : 'Connect your bot to listen to registrations from your Discord community server in real-time.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!botStatus.isOnline ? (
              <button
                onClick={handleConnectBot}
                disabled={isLoading || botStatus.isConnecting}
                className="h-9 px-4 rounded-md bg-[#31D69A] hover:bg-[#28BD86] text-[#0A0B0E] text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Power className="w-3.5 h-3.5" />
                <span>{isLoading || botStatus.isConnecting ? 'Connecting to Bot...' : 'Connect to Bot'}</span>
              </button>
            ) : (
              <>
                <button
                  onClick={handleConnectBot}
                  disabled={isLoading}
                  className="h-9 px-3.5 rounded-md bg-[#31D69A]/15 hover:bg-[#31D69A]/25 text-[#31D69A] border border-[#31D69A]/30 text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title="Reconnect or refresh Discord Bot Gateway session"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{isLoading ? 'Connecting...' : 'Connect to Bot'}</span>
                </button>
                <button
                  onClick={handleStopBot}
                  disabled={isLoading}
                  className="h-9 px-3.5 rounded-md bg-[#FF626C]/10 hover:bg-[#FF626C]/20 text-[#FF626C] border border-[#FF626C]/30 text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>Disconnect Bot</span>
                </button>
              </>
            )}
          </div>
        </div>

        {!botStatus.isOnline && (
          <div className="pt-3 border-t border-[#292F3A] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Optional: Paste custom Discord Bot Token (leave blank to use default configured bot)"
              className="flex-1 h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF] font-mono"
            />
            <button
              onClick={handleConnectBot}
              disabled={isLoading || botStatus.isConnecting}
              className="h-9 px-4 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Power className="w-3.5 h-3.5" />
              <span>{isLoading || botStatus.isConnecting ? 'Connecting...' : 'Connect to Bot'}</span>
            </button>
          </div>
        )}

        {gatewayState === 'partially_operational' && botStatus.degradedReasons && botStatus.degradedReasons.length > 0 && (
          <div className="p-3.5 rounded-lg bg-[#F0B75A]/10 border border-[#F0B75A]/30 text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-[#F0B75A]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Gateway Partially Operational — Telemetry Diagnostics</span>
            </div>
            <ul className="list-disc list-inside text-[11px] text-[#F3F5F9] space-y-0.5 font-mono">
              {botStatus.degradedReasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {feedback && (
        <div
          className={`px-4 py-3 rounded-lg border flex items-center gap-3 text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-[#31D69A]/10 border-[#31D69A]/30 text-[#31D69A]'
              : feedback.type === 'error'
              ? 'bg-[#FF626C]/10 border-[#FF626C]/30 text-[#FF626C]'
              : 'bg-[#6685FF]/10 border-[#6685FF]/30 text-[#A7C7FF]'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#31D69A]" />
          ) : feedback.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-[#FF626C]" />
          ) : (
            <Info className="w-4 h-4 shrink-0 text-[#6685FF]" />
          )}
          <span className="text-[#F3F5F9]">{feedback.message}</span>
        </div>
      )}

      {botStatus.isOnline && (
        <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#292F3A] pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-[#191D25] border border-[#292F3A] flex items-center justify-center text-[#6685FF] shrink-0">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-base font-bold text-[#F3F5F9]">
                    Tournament Setup Wizard
                  </h3>
                  <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#191D25] text-[#A7C7FF] border border-[#292F3A]">
                    !setup
                  </code>
                </div>
                <p className="text-xs text-[#929BAA] mt-0.5">
                  Configures slots, tags, and groups, then automatically provisions Discord category, channels (#rules, #registration, #slot-list, #id-pass), and verified team roles.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowWizard(!showWizard)}
              className="h-8 px-3 rounded-md bg-[#191D25] hover:bg-[#222731] text-[#929BAA] hover:text-[#F3F5F9] text-xs font-medium border border-[#292F3A] transition-colors cursor-pointer self-start sm:self-auto whitespace-nowrap"
            >
              {showWizard ? 'Hide Wizard' : 'Show Wizard'}
            </button>
          </div>

          {showWizard && (
            <form onSubmit={handleRunSetupWizard} className="space-y-5">
              <div>
                <div className="text-xs font-medium text-[#929BAA] mb-2">
                  Quick Tournament Presets
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => applyPreset(20, 4, 20, 'Glacier Cup Squads')}
                    className="p-3 rounded-md bg-[#191D25] hover:bg-[#1E232D] border border-[#292F3A] hover:border-[#6685FF]/60 text-left transition-colors cursor-pointer group"
                  >
                    <div className="text-xs font-semibold text-[#F3F5F9] group-hover:text-[#A7C7FF]">
                      Squad Scrims
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#707A89] mt-1">
                      20 Slots · 4 Tags · 20/Grp
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset(48, 4, 12, 'Championship Series — 4 Groups')}
                    className="p-3 rounded-md bg-[#191D25] hover:bg-[#1E232D] border border-[#292F3A] hover:border-[#6685FF]/60 text-left transition-colors cursor-pointer group"
                  >
                    <div className="text-xs font-semibold text-[#F3F5F9] group-hover:text-[#A7C7FF]">
                      48-Slot Major
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#707A89] mt-1">
                      48 Slots · 4 Tags · 12/Grp
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset(100, 4, 20, '100-Team Qualifier')}
                    className="p-3 rounded-md bg-[#191D25] hover:bg-[#1E232D] border border-[#292F3A] hover:border-[#6685FF]/60 text-left transition-colors cursor-pointer group"
                  >
                    <div className="text-xs font-semibold text-[#F3F5F9] group-hover:text-[#A7C7FF]">
                      100-Slot Qualifier
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#707A89] mt-1">
                      100 Slots · 4 Tags · 20/Grp
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset(500, 4, 25, '500-Slot Open Cup')}
                    className="p-3 rounded-md bg-[#191D25] hover:bg-[#1E232D] border border-[#292F3A] hover:border-[#6685FF]/60 text-left transition-colors cursor-pointer group"
                  >
                    <div className="text-xs font-semibold text-[#F3F5F9] group-hover:text-[#A7C7FF]">
                      500-Slot Open Cup
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#707A89] mt-1">
                      500 Slots · 4 Tags · 25/Grp
                    </div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                    Target Discord Server
                  </label>
                  <select
                    value={wizardGuildId || (botStatus.guilds[0]?.id ?? '')}
                    onChange={e => setWizardGuildId(e.target.value)}
                    className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-medium focus:outline-hidden focus:border-[#6685FF] cursor-pointer"
                  >
                    {botStatus.guilds.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.memberCount} members)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                    Tournament / Scrim Title
                  </label>
                  <input
                    type="text"
                    value={wizardTitle}
                    onChange={e => setWizardTitle(e.target.value)}
                    placeholder="e.g. Glacier Cup Season 1"
                    className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                    Total Slots (2–500)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="2"
                      max="500"
                      value={wizardSlots}
                      onChange={e => setWizardSlots(Math.max(2, Math.min(500, parseInt(e.target.value, 10) || 20)))}
                      className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono tabular-nums focus:outline-hidden focus:border-[#6685FF]"
                      required
                    />
                    <div className="flex gap-1 shrink-0">
                      {[20, 48, 100, 500].map(sl => (
                        <button
                          key={sl}
                          type="button"
                          onClick={() => setWizardSlots(sl)}
                          className={`h-9 px-2 rounded-md border text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                            wizardSlots === sl
                              ? 'bg-[#6685FF]/20 border-[#6685FF] text-[#A7C7FF]'
                              : 'bg-[#191D25] border-[#292F3A] text-[#929BAA] hover:text-[#F3F5F9]'
                          }`}
                        >
                          {sl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                    Required Tags / Team
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1"
                      max="6"
                      value={wizardTags}
                      onChange={e => setWizardTags(parseInt(e.target.value, 10) || 4)}
                      className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono tabular-nums focus:outline-hidden focus:border-[#6685FF]"
                      required
                    />
                    <div className="flex gap-1 shrink-0">
                      {[2, 3, 4].map(tg => (
                        <button
                          key={tg}
                          type="button"
                          onClick={() => setWizardTags(tg)}
                          className={`h-9 px-2.5 rounded-md border text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                            wizardTags === tg
                              ? 'bg-[#6685FF]/20 border-[#6685FF] text-[#A7C7FF]'
                              : 'bg-[#191D25] border-[#292F3A] text-[#929BAA] hover:text-[#F3F5F9]'
                          }`}
                        >
                          {tg}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                    Teams in Each Group ({Math.max(1, Math.ceil(wizardSlots / Math.max(1, wizardGroups)))} Group(s))
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={wizardGroups}
                      onChange={e => setWizardGroups(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 12)))}
                      className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono tabular-nums focus:outline-hidden focus:border-[#6685FF]"
                      required
                    />
                    <div className="flex gap-1 shrink-0">
                      {[12, 16, 20, 25].map(tpg => (
                        <button
                          key={tpg}
                          type="button"
                          onClick={() => setWizardGroups(tpg)}
                          className={`h-9 px-2 rounded-md border text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                            wizardGroups === tpg
                              ? 'bg-[#6685FF]/20 border-[#6685FF] text-[#A7C7FF]'
                              : 'bg-[#191D25] border-[#292F3A] text-[#929BAA] hover:text-[#F3F5F9]'
                          }`}
                        >
                          {tpg}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-medium text-[#929BAA] mb-1.5">
                    Role for Verified Teams (Unlocks #id-pass)
                  </label>
                  <input
                    type="text"
                    value={wizardRoleName}
                    onChange={e => setWizardRoleName(e.target.value)}
                    placeholder="Verified Team"
                    className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-[#292F3A]">
                <div className="text-xs text-[#929BAA] flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-[#6685FF] shrink-0" />
                  <span>Discord Command Alternative:</span>
                  <code className="text-[#A7C7FF] font-mono bg-[#101319] px-2 py-0.5 rounded border border-[#292F3A]">
                    !setup {wizardSlots} {wizardTags} {wizardGroups} {wizardTitle.split(' ')[0]}
                  </code>
                </div>

                <button
                  type="submit"
                  disabled={isSettingUpTourney}
                  className="h-9 px-4 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>{isSettingUpTourney ? 'Generating Channels & Roles...' : 'Auto-Create Category, Channels & Roles'}</span>
                </button>
              </div>

              {wizardResult && (
                <div
                  className={`p-4 rounded-lg border ${
                    wizardResult.success
                      ? 'bg-[#31D69A]/10 border-[#31D69A]/30 text-[#F3F5F9]'
                      : 'bg-[#FF626C]/10 border-[#FF626C]/30 text-[#F3F5F9]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-xs mb-2">
                    {wizardResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-[#31D69A]" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-[#FF626C]" />
                    )}
                    <span>
                      {wizardResult.success
                        ? 'Tournament Channels & Role Created Successfully'
                        : 'Setup Encountered An Error'}
                    </span>
                  </div>
                  {wizardResult.success ? (
                    <div className="space-y-1.5 text-xs text-[#929BAA]">
                      <p className="font-medium text-[#31D69A]">Items provisioned in Discord:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {wizardResult.created.map((item, idx) => (
                          <li key={idx} className="font-mono text-[11px] text-[#F3F5F9]">{item}</li>
                        ))}
                      </ul>
                      {wizardResult.warnings && wizardResult.warnings.length > 0 && (
                        <div className="mt-2 p-2.5 rounded bg-[#F0B75A]/10 border border-[#F0B75A]/30 text-[#F0B75A] space-y-1">
                          <p className="font-semibold text-[11px]">Partial Setup Notices:</p>
                          <ul className="list-disc list-inside text-[11px] text-[#F3F5F9] space-y-0.5">
                            {wizardResult.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="text-[11px] text-[#929BAA] pt-1">
                        Teams who tag {wizardTags} players in #registration will automatically receive the @{wizardRoleName} role and gain access to #id-pass.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      <p className="text-[#FF626C]">{wizardResult.error}</p>
                      {wizardResult.rolledBack && wizardResult.rolledBack.length > 0 && (
                        <div className="p-2.5 rounded bg-[#101319] border border-[#292F3A] text-[#929BAA]">
                          <p className="font-semibold text-[#F0B75A] mb-1">Automatic Rollback Executed:</p>
                          <ul className="list-disc list-inside font-mono text-[11px] text-[#F3F5F9] space-y-0.5">
                            {wizardResult.rolledBack.map((rb, idx) => (
                              <li key={idx}>{rb}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </form>
          )}
        </section>
      )}

      {botStatus.isOnline && (
        <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292F3A] pb-3.5">
            <div className="flex items-center gap-2.5">
              <Server className="w-4 h-4 text-[#6685FF]" />
              <h3 className="font-display text-base font-bold text-[#F3F5F9]">
                Connected Discord Communities ({botStatus.guilds.length})
              </h3>
            </div>

            <a
              href={adminInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#A7C7FF] hover:text-[#F3F5F9] flex items-center gap-1 font-medium transition-colors"
              title="Re-authorize bot with Administrator permissions to resolve all permission limits"
            >
              <span>Re-Authorize with Admin Role</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {botStatus.guilds.length === 0 ? (
            <div className="p-8 text-center bg-[#191D25] rounded-lg border border-[#292F3A]">
              <p className="text-sm font-semibold text-[#F3F5F9]">
                Bot is online, but hasn't been added to a server yet
              </p>
              <p className="text-xs text-[#929BAA] mt-1">
                Use the invite links below to add FFA-Manager to your Discord community.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {botStatus.guilds.map((guild: BotGuildInfo) => {
                const hasReg = guild.channels.some(c => c.name === config.regChannel);
                const canManageChannels = guild.permissions?.hasManageChannels || guild.permissions?.isAdmin;
                const canManageRoles = guild.permissions?.hasManageRoles || guild.permissions?.isAdmin;

                return (
                  <div
                    key={guild.id}
                    className="p-4 sm:p-5 rounded-lg bg-[#191D25] border border-[#292F3A] space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md bg-[#14171D] text-[#A7C7FF] font-display font-bold text-sm flex items-center justify-center border border-[#292F3A] shrink-0">
                          {guild.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-display font-bold text-[#F3F5F9] text-sm">
                            {guild.name}
                          </h4>
                          <div className="text-xs text-[#707A89] font-mono tabular-nums mt-0.5">
                            {guild.memberCount} members · Guild ID: {guild.id}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                        <span
                          className={`px-2 py-0.5 rounded border ${
                            canManageChannels
                              ? 'bg-[#31D69A]/10 text-[#31D69A] border-[#31D69A]/30'
                              : 'bg-[#F0B75A]/10 text-[#F0B75A] border-[#F0B75A]/30'
                          }`}
                        >
                          Manage Channels: {canManageChannels ? 'Granted' : 'Missing'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border ${
                            canManageRoles
                              ? 'bg-[#31D69A]/10 text-[#31D69A] border-[#31D69A]/30'
                              : 'bg-[#F0B75A]/10 text-[#F0B75A] border-[#F0B75A]/30'
                          }`}
                        >
                          Manage Roles: {canManageRoles ? 'Granted' : 'Missing'}
                        </span>
                      </div>
                    </div>

                    {!canManageChannels && (
                      <div className="p-3.5 rounded-md bg-[#F0B75A]/10 border border-[#F0B75A]/30 text-xs space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-[#F0B75A]">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Missing "Manage Channels" Permission in "{guild.name}"</span>
                        </div>
                        <p className="text-[#929BAA] text-[11px] leading-relaxed">
                          The bot cannot automatically create new channels in this server because its Discord role lacks <strong className="text-[#F3F5F9]">Manage Channels</strong> permission.
                        </p>
                        <div className="flex flex-wrap items-center gap-2.5 pt-1">
                          <a
                            href={adminInviteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="h-8 px-3 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] text-xs font-semibold flex items-center gap-1.5 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>1-Click Fix: Re-Authorize with Admin Role</span>
                          </a>
                          <span className="text-[#707A89] text-xs">or select an existing channel below:</span>
                        </div>
                      </div>
                    )}

                    <div className="pt-3 border-t border-[#292F3A] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-[#F3F5F9] flex items-center gap-1.5">
                          <Hash className="w-3.5 h-3.5 text-[#6685FF]" />
                          <span>Active Registration Channel:</span>
                          <code className="text-[#31D69A] font-mono">#{config.regChannel}</code>
                        </div>
                        <p className="text-[11px] text-[#707A89] mt-0.5">
                          The bot listens for tournament tag registrations in this channel.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={guild.channels.some(c => c.name === config.regChannel) ? config.regChannel : ''}
                          onChange={e => handleSelectRegChannel(e.target.value)}
                          className="h-8 px-2.5 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-mono focus:outline-hidden focus:border-[#6685FF] cursor-pointer"
                        >
                          <option value="" disabled>
                            Select server channel...
                          </option>
                          {guild.channels.map(ch => (
                            <option key={ch.id} value={ch.name}>
                              #{ch.name}
                            </option>
                          ))}
                        </select>

                        {canManageChannels && !hasReg && (
                          <button
                            onClick={() => handleAutoSetupGuild(guild.id)}
                            disabled={settingUpGuildId === guild.id}
                            className="h-8 px-3 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>{settingUpGuildId === guild.id ? 'Creating...' : 'Create #registration'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292F3A] pb-3.5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#6685FF]" />
            <h3 className="font-display text-base font-bold text-[#F3F5F9]">
              Bot Authorization & Server Invite Link
            </h3>
          </div>

          <a
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[#A7C7FF] hover:text-[#F3F5F9] flex items-center gap-1 font-medium transition-colors"
          >
            <span>Open Developer Portal</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-[#191D25] border border-[#6685FF]/40 flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#F3F5F9] text-xs flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#6685FF]" />
                  <span>Full Admin Invite (Recommended)</span>
                </span>
                <span className="text-[11px] font-mono text-[#A7C7FF]">
                  permissions=8
                </span>
              </div>
              <p className="text-xs text-[#929BAA] leading-relaxed">
                Grants full administrative permissions so the bot can provision <code className="text-[#F3F5F9] font-mono">#registration</code>, <code className="text-[#F3F5F9] font-mono">#slot-list</code>, and assign the <code className="text-[#F3F5F9] font-mono">@Confirmed Slot</code> role without hierarchy errors.
              </p>
            </div>
            <a
              href={adminInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="h-9 w-full px-3 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Authorize Bot as Admin</span>
            </a>
          </div>

          <div className="p-4 rounded-lg bg-[#191D25] border border-[#292F3A] flex flex-col justify-between space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#F3F5F9] text-xs">
                  Standard Scrims Invite
                </span>
                <span className="text-[11px] font-mono text-[#707A89]">
                  permissions=268519488
                </span>
              </div>
              <p className="text-xs text-[#929BAA] leading-relaxed">
                Standard operational permissions: Manage Channels, Manage Roles, Send Messages, and Embed Links.
              </p>
            </div>
            <a
              href={standardInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="h-9 w-full px-3 rounded-md bg-[#14171D] hover:bg-[#222731] text-[#F3F5F9] border border-[#292F3A] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#929BAA]" />
              <span>Standard Invite Link</span>
            </a>
          </div>
        </div>
      </section>

      <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#292F3A] pb-3.5">
          <div className="flex items-center gap-2.5">
            <Zap className="w-4 h-4 text-[#6685FF]" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-bold text-[#F3F5F9]">
                  Discord Slash Commands
                </h3>
                <span className="text-xs text-[#707A89]" aria-hidden="true">·</span>
                <span className="text-xs font-mono text-[#A7C7FF]">
                  Fully Functional
                </span>
              </div>
              <p className="text-xs text-[#929BAA] mt-0.5">
                Type <code className="text-[#A7C7FF] font-mono">/</code> in any Discord server channel where the bot is present.
              </p>
            </div>
          </div>

          <button
            onClick={async () => {
              setFeedback({ type: 'info', message: 'Syncing slash commands with Discord REST API...' });
              try {
                const res = await fetch('/api/bot/sync-commands', { method: 'POST' });
                const d = await res.json();
                if (d.success) {
                  setFeedback({ type: 'success', message: `Registered ${d.count} slash commands across all connected servers!` });
                  fetchStatus();
                } else {
                  setFeedback({ type: 'error', message: d.error || 'Failed to sync slash commands' });
                }
              } catch (err: any) {
                setFeedback({ type: 'error', message: err.message });
              }
            }}
            className="h-8 px-3.5 rounded-md bg-[#191D25] hover:bg-[#222731] text-[#F3F5F9] border border-[#292F3A] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#6685FF]" />
            <span>Sync Slash Commands to Discord</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#A7C7FF]">/setup</span>
              <span className="text-[11px] text-[#707A89] font-mono">slots, tags, groups, title</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Auto-creates category (<code className="text-[#F3F5F9] font-mono">🏆 ┃ TOURNAMENTS</code>), channels (<code className="text-[#F3F5F9] font-mono">#rules-format</code>, <code className="text-[#F3F5F9] font-mono">#registration</code>, <code className="text-[#F3F5F9] font-mono">#slot-list</code>, <code className="text-[#F3F5F9] font-mono">#id-pass</code>) &amp; <code className="text-[#F3F5F9] font-mono">@Verified Team</code> role.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#31D69A]">/create tournament</span>
              <span className="text-[11px] text-[#707A89] font-mono">slots, tags, groups, title</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Provisions a tournament with custom slot counts, multi-group breakdowns (Group A, B, C, D), and role permissions.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#F0B75A]">/idpass</span>
              <span className="text-[11px] text-[#707A89] font-mono">room_id, password, map, time</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Dispatches private custom lobby Room ID &amp; Password to <code className="text-[#F3F5F9] font-mono">#🔑┃id-pass</code> with <code className="text-[#F3F5F9] font-mono">@here</code> ping for verified teams.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#31D69A]">/lock &amp; /unlock</span>
              <span className="text-[11px] text-[#707A89] font-mono">reason (optional)</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Instantly locks or unlocks tournament registrations in <code className="text-[#F3F5F9] font-mono">#registration</code> and posts an official status banner.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#A7C7FF]">/tagcheck</span>
              <span className="text-[11px] text-[#707A89] font-mono">user (@mention)</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Inspects any Discord member to check if they are already registered on a squad, blacklisted, or eligible to register.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#A7C7FF]">/team-info</span>
              <span className="text-[11px] text-[#707A89] font-mono">query (slot # or name)</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Displays full team dossier including Slot #, Group, Captain, all verified player tags, and registration timestamp.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#FF626C]">/blacklist</span>
              <span className="text-[11px] text-[#707A89] font-mono">add | remove | list</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Bans rule-violators from registering or being tagged in any squad. Auto-rejects teams tagging blacklisted players.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#F0B75A]">/standings</span>
              <span className="text-[11px] text-[#707A89] font-mono">group (optional)</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Posts the live tournament leaderboard, wins count, finish points, and official placement scoring matrix.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#31D69A]">/swap-slots</span>
              <span className="text-[11px] text-[#707A89] font-mono">slot1, slot2</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Swaps the slot numbers and group assignments of two registered teams and updates <code className="text-[#F3F5F9] font-mono">#slot-list</code> live.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#FF626C]">/delete slot</span>
              <span className="text-[11px] text-[#707A89] font-mono">slot (int)</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Removes the team from the specified slot, auto-promotes the first waitlist team to confirmed, and refreshes <code className="text-[#F3F5F9] font-mono">#slot-list</code>.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#FF626C]">/delete tournament</span>
              <span className="text-[11px] text-[#707A89] font-mono">delete_channels (bool)</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Deletes tournament channels and category, cleans up permissions, and resets all registered rosters.
            </p>
          </div>

          <div className="p-3.5 rounded-md bg-[#101319] border border-[#292F3A] space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#A7C7FF]">/rules · /announce · /export</span>
              <span className="text-[11px] text-[#707A89] font-mono">+ /slots, /help</span>
            </div>
            <p className="text-xs text-[#929BAA] leading-relaxed">
              Publish the official rulebook, broadcast announcements with <code className="text-[#F3F5F9] font-mono">@here</code>, or export clean rosters in Markdown/CSV.
            </p>
          </div>
        </div>
      </section>

      <section className="p-5 sm:p-6 rounded-xl bg-[#14171D] border border-[#292F3A] space-y-3.5">
        <div className="flex items-center justify-between border-b border-[#292F3A] pb-3">
          <div className="flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-[#6685FF]" />
            <h3 className="font-display text-base font-bold text-[#F3F5F9]">
              Real-Time Gateway Activity Feed
            </h3>
          </div>
          <span className="text-[11px] font-mono text-[#707A89]">
            Auto-refreshes live
          </span>
        </div>

        <div className="rounded-md bg-[#101319] border border-[#292F3A] p-3.5 max-h-64 overflow-y-auto divide-y divide-[#292F3A]/50 font-mono text-xs">
          {(!botStatus.events || botStatus.events.length === 0) ? (
            <div className="text-[#707A89] text-center py-6">
              Waiting for Discord events...
            </div>
          ) : (
            botStatus.events.map((evt: BotLogEvent) => (
              <div
                key={evt.id}
                className="py-1.5 first:pt-0 last:pb-0 flex items-start gap-2.5 text-[11px] leading-relaxed"
              >
                <span className="text-[#707A89] tabular-nums shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span
                  className={`w-14 text-center py-0.2 rounded text-[10px] font-semibold uppercase shrink-0 border ${
                    evt.type === 'success'
                      ? 'bg-[#31D69A]/10 text-[#31D69A] border-[#31D69A]/30'
                      : evt.type === 'warn'
                      ? 'bg-[#F0B75A]/10 text-[#F0B75A] border-[#F0B75A]/30'
                      : evt.type === 'error'
                      ? 'bg-[#FF626C]/10 text-[#FF626C] border-[#FF626C]/30'
                      : 'bg-[#191D25] text-[#929BAA] border-[#292F3A]'
                  }`}
                >
                  {evt.type}
                </span>
                {evt.guildName && (
                  <span className="text-[#A7C7FF] shrink-0">
                    [{evt.guildName}]
                  </span>
                )}
                <span className="text-[#F3F5F9] select-text break-words">
                  {evt.message}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
