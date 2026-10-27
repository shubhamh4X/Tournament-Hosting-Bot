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
    <div className="space-y-16 w-full">
      <section className="p-6 sm:p-8 rounded-[24px] gateway-hero-panel space-y-6 relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[640px] max-w-full h-[240px] rounded-full bg-[#38BDF8]/10 blur-[100px]" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-5">
            <div className="relative shrink-0">
              <div className="pointer-events-none absolute -inset-1.5 rounded-2xl bg-gradient-to-tr from-[#38BDF8]/35 to-[#0EA5E9]/20 opacity-80 blur-sm" />
              <img
                src={botStatus.botUser?.avatar || '/assets/glacier-cup-logo.png'}
                alt="FFA-Manager"
                className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border border-white/15 bg-black object-cover shrink-0 shadow-lg"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="min-w-0">
              <div className="eyebrow-label mb-1.5">
                Discord Gateway Connection
              </div>
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {botStatus.isOnline
                    ? botStatus.botUser?.tag || 'FFA-Manager'
                    : 'FFA-Manager Gateway'}
                </h2>

                <span
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono font-semibold border ${
                    gatewayState === 'connected'
                      ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/25'
                      : gatewayState === 'partially_operational'
                      ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25'
                      : gatewayState === 'reconnecting'
                      ? 'bg-[#38BDF8]/12 text-[#7DD3FC] border-[#38BDF8]/30'
                      : 'bg-white/[0.03] text-white/50 border-white/10'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      gatewayState === 'connected'
                        ? 'bg-[#10B981] shadow-[0_0_8px_#10B981]'
                        : gatewayState === 'partially_operational'
                        ? 'bg-[#F59E0B]'
                        : gatewayState === 'reconnecting'
                        ? 'bg-[#38BDF8] animate-pulse'
                        : 'bg-white/40'
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
                  <span className="text-xs font-mono tabular-nums text-[#7DD3FC] flex items-center gap-1.5">
                    <span className="text-white/25" aria-hidden="true">·</span>
                    <span>{botStatus.wsPing}ms</span>
                  </span>
                )}

                {botStatus.isOnline && typeof botStatus.uptimeSeconds === 'number' && botStatus.uptimeSeconds > 0 && (
                  <span className="text-xs font-mono tabular-nums text-white/60 flex items-center gap-1.5">
                    <span className="text-white/25" aria-hidden="true">·</span>
                    <span>Uptime {formatUptime(botStatus.uptimeSeconds)}</span>
                  </span>
                )}
              </div>

              <p className="text-xs sm:text-sm text-white/60 mt-2.5 leading-relaxed max-w-4xl">
                {botStatus.isOnline
                  ? `Active in ${botStatus.guilds?.length || 0} Discord server(s) · Listening for tag-basis registrations in #${config.regChannel} · EasyTag: ${config.easyTagEnabled ? 'Active' : 'Disabled'}`
                  : 'Connect your bot instance to listen to tournament registrations from your Discord community server in real-time.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {!botStatus.isOnline ? (
              <button
                onClick={handleConnectBot}
                disabled={isLoading || botStatus.isConnecting}
                className="btn-glacier-primary h-11 px-6 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Power className="w-4 h-4" />
                <span>{isLoading || botStatus.isConnecting ? 'Connecting to Bot...' : 'Connect to Bot'}</span>
              </button>
            ) : (
              <>
                <button
                  onClick={handleConnectBot}
                  disabled={isLoading}
                  className="btn-glacier-secondary h-10 px-4 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title="Reconnect or refresh Discord Bot Gateway session"
                >
                  <Power className="w-3.5 h-3.5 text-[#10B981]" />
                  <span>{isLoading ? 'Connecting...' : 'Refresh Session'}</span>
                </button>
                <button
                  onClick={handleStopBot}
                  disabled={isLoading}
                  className="h-10 px-4 rounded-xl bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#F87171] border border-[#EF4444]/25 text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>Disconnect Bot</span>
                </button>
              </>
            )}
          </div>
        </div>

        {!botStatus.isOnline && (
          <div className="relative pt-6 border-t border-white/[0.07] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Optional: Paste custom Discord Bot Token (leave blank to use default configured bot)"
              className="flex-1 h-11 px-4 rounded-xl esports-input text-xs placeholder-white/35 font-mono"
            />
            <button
              onClick={handleConnectBot}
              disabled={isLoading || botStatus.isConnecting}
              className="btn-glacier-primary h-11 px-6 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Power className="w-3.5 h-3.5" />
              <span>{isLoading || botStatus.isConnecting ? 'Connecting...' : 'Launch Gateway'}</span>
            </button>
          </div>
        )}

        {gatewayState === 'partially_operational' && botStatus.degradedReasons && botStatus.degradedReasons.length > 0 && (
          <div className="p-4 rounded-2xl bg-[#F59E0B]/[0.07] border border-[#F59E0B]/25 text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-[#F59E0B]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Gateway Partially Operational — Diagnostics</span>
            </div>
            <ul className="list-disc list-inside text-[11px] text-white/80 space-y-0.5 font-mono">
              {botStatus.degradedReasons.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {feedback && (
        <div
          className={`px-5 py-4 rounded-2xl border flex items-center gap-3 text-xs font-medium backdrop-blur-md ${
            feedback.type === 'success'
              ? 'bg-[#10B981]/[0.08] border-[#10B981]/30 text-[#10B981]'
              : feedback.type === 'error'
              ? 'bg-[#EF4444]/[0.08] border-[#EF4444]/30 text-[#F87171]'
              : 'bg-[#38BDF8]/[0.08] border-[#38BDF8]/30 text-[#7DD3FC]'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#10B981]" />
          ) : feedback.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-[#F87171]" />
          ) : (
            <Info className="w-4 h-4 shrink-0 text-[#38BDF8]" />
          )}
          <span className="text-white/90">{feedback.message}</span>
        </div>
      )}

      {botStatus.isOnline && (
        <section className="relative pt-4 space-y-8">
          <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[680px] max-w-full h-[260px] rounded-full bg-gradient-to-b from-[#38BDF8]/10 via-[#0EA5E9]/5 to-transparent blur-[110px] -z-10" />

          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="eyebrow-label">
              Automated Server Provisioning
            </div>
            <h3 className="font-display text-2xl sm:text-4xl font-extrabold text-white tracking-tight text-balance">
              Tournament Setup Wizard
            </h3>
            <p className="text-xs sm:text-sm text-white/60 leading-relaxed max-w-xl mx-auto">
              Configure slots, player tags, and group structure, or run <code className="text-[#7DD3FC] font-mono bg-white/[0.04] px-2 py-0.5 rounded-md border border-white/[0.08]">!setup</code> in Discord to automatically provision categories, channels, and verified roles.
            </p>
          </div>

          <div className="p-6 sm:p-8 rounded-[24px] esports-card space-y-7">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/25 flex items-center justify-center text-[#7DD3FC] shrink-0">
                  <Trophy className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-display text-base sm:text-lg font-bold text-white block">
                    Instant Tournament Presets &amp; Parameters
                  </span>
                  <span className="text-xs text-white/45">
                    Select a competitive template or customize slot and group counts below
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowWizard(!showWizard)}
                className="btn-glacier-secondary h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {showWizard ? 'Minimize' : 'Expand Wizard'}
              </button>
            </div>

            {showWizard && (
              <form onSubmit={handleRunSetupWizard} className="space-y-7">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50 mb-3.5">
                    Select Format Preset
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <button
                      type="button"
                      onClick={() => applyPreset(20, 4, 20, 'Glacier Cup Squads')}
                      className={`p-4 rounded-2xl text-left cursor-pointer group transition-all border ${
                        wizardSlots === 20 && wizardGroups === 20
                          ? 'bg-[#0EA5E9]/[0.09] border-[#38BDF8]/40 shadow-[inset_0_1px_0_rgba(186,230,253,0.12)]'
                          : 'esports-card-sub'
                      }`}
                    >
                      <div className="font-display text-sm font-bold text-white group-hover:text-[#7DD3FC] transition-colors">
                        Squad Scrims
                      </div>
                      <div className="text-xs font-mono tabular-nums text-white/50 mt-1">
                        20 Slots · 4 Tags · 20/Grp
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyPreset(48, 4, 12, 'Championship Series — 4 Groups')}
                      className={`p-4 rounded-2xl text-left cursor-pointer group transition-all border ${
                        wizardSlots === 48 && wizardGroups === 12
                          ? 'bg-[#0EA5E9]/[0.09] border-[#38BDF8]/40 shadow-[inset_0_1px_0_rgba(186,230,253,0.12)]'
                          : 'esports-card-sub'
                      }`}
                    >
                      <div className="font-display text-sm font-bold text-white group-hover:text-[#7DD3FC] transition-colors">
                        48-Slot Major
                      </div>
                      <div className="text-xs font-mono tabular-nums text-white/50 mt-1">
                        48 Slots · 4 Tags · 12/Grp
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyPreset(100, 4, 20, '100-Team Qualifier')}
                      className={`p-4 rounded-2xl text-left cursor-pointer group transition-all border ${
                        wizardSlots === 100 && wizardGroups === 20
                          ? 'bg-[#0EA5E9]/[0.09] border-[#38BDF8]/40 shadow-[inset_0_1px_0_rgba(186,230,253,0.12)]'
                          : 'esports-card-sub'
                      }`}
                    >
                      <div className="font-display text-sm font-bold text-white group-hover:text-[#7DD3FC] transition-colors">
                        100-Slot Qualifier
                      </div>
                      <div className="text-xs font-mono tabular-nums text-white/50 mt-1">
                        100 Slots · 4 Tags · 20/Grp
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyPreset(500, 4, 25, '500-Slot Open Cup')}
                      className={`p-4 rounded-2xl text-left cursor-pointer group transition-all border ${
                        wizardSlots === 500 && wizardGroups === 25
                          ? 'bg-[#0EA5E9]/[0.09] border-[#38BDF8]/40 shadow-[inset_0_1px_0_rgba(186,230,253,0.12)]'
                          : 'esports-card-sub'
                      }`}
                    >
                      <div className="font-display text-sm font-bold text-white group-hover:text-[#7DD3FC] transition-colors">
                        500-Slot Open Cup
                      </div>
                      <div className="text-xs font-mono tabular-nums text-white/50 mt-1">
                        500 Slots · 4 Tags · 25/Grp
                      </div>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-2">
                      Target Discord Server
                    </label>
                    <select
                      value={wizardGuildId || (botStatus.guilds[0]?.id ?? '')}
                      onChange={e => setWizardGuildId(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-medium cursor-pointer"
                    >
                      {botStatus.guilds.map(g => (
                        <option key={g.id} value={g.id} className="bg-[#090C12] text-white">
                          {g.name} ({g.memberCount} members)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-white/75 mb-2">
                      Tournament / Scrim Title
                    </label>
                    <input
                      type="text"
                      value={wizardTitle}
                      onChange={e => setWizardTitle(e.target.value)}
                      placeholder="e.g. Glacier Cup Season 1"
                      className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-2">
                      Total Slots (2–500)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="2"
                        max="500"
                        value={wizardSlots}
                        onChange={e => setWizardSlots(Math.max(2, Math.min(500, parseInt(e.target.value, 10) || 20)))}
                        className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-mono tabular-nums"
                        required
                      />
                      <div className="flex gap-1 shrink-0">
                        {[20, 48, 100, 500].map(sl => (
                          <button
                            key={sl}
                            type="button"
                            onClick={() => setWizardSlots(sl)}
                            className={`h-11 px-2.5 rounded-xl border text-[11px] font-mono tabular-nums transition-all cursor-pointer ${
                              wizardSlots === sl
                                ? 'bg-[#0EA5E9]/20 border-[#38BDF8]/50 text-[#7DD3FC] font-semibold'
                                : 'bg-white/[0.02] border-white/[0.08] text-white/50 hover:text-white hover:border-white/20'
                            }`}
                          >
                            {sl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-2">
                      Required Tags / Team
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="6"
                        value={wizardTags}
                        onChange={e => setWizardTags(parseInt(e.target.value, 10) || 4)}
                        className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-mono tabular-nums"
                        required
                      />
                      <div className="flex gap-1 shrink-0">
                        {[2, 3, 4].map(tg => (
                          <button
                            key={tg}
                            type="button"
                            onClick={() => setWizardTags(tg)}
                            className={`h-11 px-3 rounded-xl border text-[11px] font-mono tabular-nums transition-all cursor-pointer ${
                              wizardTags === tg
                                ? 'bg-[#0EA5E9]/20 border-[#38BDF8]/50 text-[#7DD3FC] font-semibold'
                                : 'bg-white/[0.02] border-white/[0.08] text-white/50 hover:text-white hover:border-white/20'
                            }`}
                          >
                            {tg}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/75 mb-2">
                      Teams per Group ({Math.max(1, Math.ceil(wizardSlots / Math.max(1, wizardGroups)))} Group(s))
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="500"
                        value={wizardGroups}
                        onChange={e => setWizardGroups(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 12)))}
                        className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-mono tabular-nums"
                        required
                      />
                      <div className="flex gap-1 shrink-0">
                        {[12, 16, 20, 25].map(tpg => (
                          <button
                            key={tpg}
                            type="button"
                            onClick={() => setWizardGroups(tpg)}
                            className={`h-11 px-2.5 rounded-xl border text-[11px] font-mono tabular-nums transition-all cursor-pointer ${
                              wizardGroups === tpg
                                ? 'bg-[#0EA5E9]/20 border-[#38BDF8]/50 text-[#7DD3FC] font-semibold'
                                : 'bg-white/[0.02] border-white/[0.08] text-white/50 hover:text-white hover:border-white/20'
                            }`}
                          >
                            {tpg}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-xs font-medium text-white/75 mb-2">
                      Role for Verified Teams (Unlocks #id-pass)
                    </label>
                    <input
                      type="text"
                      value={wizardRoleName}
                      onChange={e => setWizardRoleName(e.target.value)}
                      placeholder="Verified Team"
                      className="w-full h-11 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-6 border-t border-white/[0.07]">
                  <div className="text-xs text-white/55 flex flex-wrap items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-[#7DD3FC] shrink-0" />
                    <span>Discord Command Alternative:</span>
                    <code className="text-[#7DD3FC] font-mono bg-white/[0.03] px-3 py-1 rounded-lg border border-white/[0.08]">
                      !setup {wizardSlots} {wizardTags} {wizardGroups} {wizardTitle.split(' ')[0]}
                    </code>
                  </div>

                  <button
                    type="submit"
                    disabled={isSettingUpTourney}
                    className="btn-glacier-primary h-11 px-6 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    <Wand2 className="w-4 h-4" />
                    <span>{isSettingUpTourney ? 'Generating Channels & Roles...' : 'Auto-Create Category, Channels & Roles'}</span>
                  </button>
                </div>

                {wizardResult && (
                  <div
                    className={`p-5 rounded-2xl border ${
                      wizardResult.success
                        ? 'bg-[#10B981]/[0.07] border-[#10B981]/30 text-white'
                        : 'bg-[#EF4444]/[0.07] border-[#EF4444]/30 text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs mb-2">
                      {wizardResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-[#F87171]" />
                      )}
                      <span>
                        {wizardResult.success
                          ? 'Tournament Channels & Role Created Successfully'
                          : 'Setup Encountered An Error'}
                      </span>
                    </div>
                    {wizardResult.success ? (
                      <div className="space-y-2 text-xs text-white/60">
                        <p className="font-medium text-[#10B981]">Items provisioned in Discord:</p>
                        <ul className="list-disc list-inside space-y-1">
                          {wizardResult.created.map((item, idx) => (
                            <li key={idx} className="font-mono text-[11px] text-white/90">{item}</li>
                          ))}
                        </ul>
                        {wizardResult.warnings && wizardResult.warnings.length > 0 && (
                          <div className="mt-2 p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] space-y-1">
                            <p className="font-semibold text-[11px]">Partial Setup Notices:</p>
                            <ul className="list-disc list-inside text-[11px] text-white/90 space-y-0.5">
                              {wizardResult.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="text-[11px] text-white/50 pt-1">
                          Teams who tag {wizardTags} players in #registration will automatically receive the @{wizardRoleName} role and gain access to #id-pass.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 text-xs">
                        <p className="text-[#F87171]">{wizardResult.error}</p>
                        {wizardResult.rolledBack && wizardResult.rolledBack.length > 0 && (
                          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 text-white/60">
                            <p className="font-semibold text-[#F59E0B] mb-1">Automatic Rollback Executed:</p>
                            <ul className="list-disc list-inside font-mono text-[11px] text-white/90 space-y-0.5">
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
          </div>
        </section>
      )}

      {botStatus.isOnline && (
        <section className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <div className="eyebrow-label mb-1.5">
                Active Guild Bindings
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Connected Discord Communities ({botStatus.guilds.length})
              </h3>
            </div>

            <a
              href={adminInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#38BDF8] hover:text-white flex items-center gap-1.5 font-semibold transition-colors"
              title="Re-authorize bot with Administrator permissions to resolve all permission limits"
            >
              <span>Re-Authorize with Admin Role</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {botStatus.guilds.length === 0 ? (
            <div className="p-10 text-center rounded-[28px] esports-card">
              <p className="font-display text-base font-bold text-white">
                Bot is online, but hasn't been added to a server yet
              </p>
              <p className="text-xs sm:text-sm text-white/55 mt-1.5">
                Use the invite links below to add FFA-Manager to your Discord community.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {botStatus.guilds.map((guild: BotGuildInfo) => {
                const hasReg = guild.channels.some(c => c.name === config.regChannel);
                const canManageChannels = guild.permissions?.hasManageChannels || guild.permissions?.isAdmin;
                const canManageRoles = guild.permissions?.hasManageRoles || guild.permissions?.isAdmin;

                return (
                  <div
                    key={guild.id}
                    className="p-5 sm:p-6 rounded-[24px] esports-card space-y-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-2xl bg-[#0EA5E9]/10 text-[#38BDF8] font-display font-bold text-base flex items-center justify-center border border-[#38BDF8]/25 shrink-0">
                          {guild.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-display font-bold text-white text-base sm:text-lg">
                            {guild.name}
                          </h4>
                          <div className="text-xs text-white/45 font-mono tabular-nums mt-0.5">
                            {guild.memberCount} members · Guild ID: {guild.id}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                        <span
                          className={`px-3 py-1 rounded-full border ${
                            canManageChannels
                              ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/25'
                              : 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25'
                          }`}
                        >
                          Manage Channels: {canManageChannels ? 'Granted' : 'Missing'}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full border ${
                            canManageRoles
                              ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/25'
                              : 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25'
                          }`}
                        >
                          Manage Roles: {canManageRoles ? 'Granted' : 'Missing'}
                        </span>
                      </div>
                    </div>

                    {!canManageChannels && (
                      <div className="p-4 rounded-2xl bg-[#F59E0B]/[0.07] border border-[#F59E0B]/25 text-xs space-y-2.5">
                        <div className="flex items-center gap-2 font-semibold text-[#F59E0B]">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Missing "Manage Channels" Permission in "{guild.name}"</span>
                        </div>
                        <p className="text-white/70 text-xs leading-relaxed">
                          The bot cannot automatically create new channels in this server because its Discord role lacks <strong className="text-white">Manage Channels</strong> permission.
                        </p>
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          <a
                            href={adminInviteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-glacier-primary h-9 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>1-Click Fix: Re-Authorize with Admin Role</span>
                          </a>
                          <span className="text-white/45 text-xs">or select an existing channel below:</span>
                        </div>
                      </div>
                    )}

                    <div className="pt-5 border-t border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold text-white flex items-center gap-2">
                          <Hash className="w-3.5 h-3.5 text-[#38BDF8]" />
                          <span>Active Registration Channel:</span>
                          <code className="text-[#10B981] font-mono">#{config.regChannel}</code>
                        </div>
                        <p className="text-xs text-white/45 mt-1">
                          The bot listens for tournament tag registrations in this channel.
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <select
                          value={guild.channels.some(c => c.name === config.regChannel) ? config.regChannel : ''}
                          onChange={e => handleSelectRegChannel(e.target.value)}
                          className="h-10 px-3.5 rounded-xl esports-input text-xs font-mono cursor-pointer"
                        >
                          <option value="" disabled className="bg-[#090C12]">
                            Select server channel...
                          </option>
                          {guild.channels.map(ch => (
                            <option key={ch.id} value={ch.name} className="bg-[#090C12]">
                              #{ch.name}
                            </option>
                          ))}
                        </select>

                        {canManageChannels && !hasReg && (
                          <button
                            onClick={() => handleAutoSetupGuild(guild.id)}
                            disabled={settingUpGuildId === guild.id}
                            className="btn-glacier-primary h-10 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
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

      <section id="bot-commands-section" className="space-y-8 scroll-mt-24">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="eyebrow-label mb-1.5">
              Command Architecture
            </div>
            <h3 className="font-display text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
              Discord Slash Commands
            </h3>
            <p className="text-xs sm:text-sm text-white/55 mt-1.5">
              Type <code className="text-[#38BDF8] font-mono">/</code> in any Discord server channel where the bot is present.
            </p>
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
            className="btn-glacier-secondary h-11 px-5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer self-start md:self-auto whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4 text-[#38BDF8]" />
            <span>Sync Slash Commands to Discord</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#38BDF8] bg-[#38BDF8]/10 px-2.5 py-1 rounded-lg border border-[#38BDF8]/20">/setup</span>
              <span className="text-[11px] text-white/40 font-mono">slots, tags, groups, title</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Auto-creates category (<code className="text-white/85 font-mono">🏆 ┃ TOURNAMENTS</code>), channels (<code className="text-white/85 font-mono">#rules-format</code>, <code className="text-white/85 font-mono">#registration</code>, <code className="text-white/85 font-mono">#slot-list</code>, <code className="text-white/85 font-mono">#id-pass</code>) &amp; <code className="text-white/85 font-mono">@Verified Team</code> role.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-lg border border-[#10B981]/20">/create tournament</span>
              <span className="text-[11px] text-white/40 font-mono">slots, tags, groups, title</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Provisions a tournament with custom slot counts, multi-group breakdowns (Group A, B, C, D), and role permissions.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#F59E0B] bg-[#F59E0B]/10 px-2.5 py-1 rounded-lg border border-[#F59E0B]/20">/idpass</span>
              <span className="text-[11px] text-white/40 font-mono">room_id, password, map, time</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Dispatches private custom lobby Room ID &amp; Password to <code className="text-white/85 font-mono">#🔑┃id-pass</code> with <code className="text-white/85 font-mono">@here</code> ping for verified teams.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-lg border border-[#10B981]/20">/lock &amp; /unlock</span>
              <span className="text-[11px] text-white/40 font-mono">reason (optional)</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Instantly locks or unlocks tournament registrations in <code className="text-white/85 font-mono">#registration</code> and posts an official status banner.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#38BDF8] bg-[#38BDF8]/10 px-2.5 py-1 rounded-lg border border-[#38BDF8]/20">/tagcheck</span>
              <span className="text-[11px] text-white/40 font-mono">user (@mention)</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Inspects any Discord member to check if they are already registered on a squad, blacklisted, or eligible to register.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#38BDF8] bg-[#38BDF8]/10 px-2.5 py-1 rounded-lg border border-[#38BDF8]/20">/team-info</span>
              <span className="text-[11px] text-white/40 font-mono">query (slot # or name)</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Displays full team dossier including Slot #, Group, Captain, all verified player tags, and registration timestamp.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#F87171] bg-[#EF4444]/10 px-2.5 py-1 rounded-lg border border-[#EF4444]/20">/blacklist</span>
              <span className="text-[11px] text-white/40 font-mono">add | remove | list</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Bans rule-violators from registering or being tagged in any squad. Auto-rejects teams tagging blacklisted players.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#F59E0B] bg-[#F59E0B]/10 px-2.5 py-1 rounded-lg border border-[#F59E0B]/20">/standings</span>
              <span className="text-[11px] text-white/40 font-mono">group (optional)</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Posts the live tournament leaderboard, wins count, finish points, and official placement scoring matrix.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-lg border border-[#10B981]/20">/swap-slots</span>
              <span className="text-[11px] text-white/40 font-mono">slot1, slot2</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Swaps the slot numbers and group assignments of two registered teams and updates <code className="text-white/85 font-mono">#slot-list</code> live.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#F87171] bg-[#EF4444]/10 px-2.5 py-1 rounded-lg border border-[#EF4444]/20">/delete slot</span>
              <span className="text-[11px] text-white/40 font-mono">slot (int)</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Removes the team from the specified slot, auto-promotes the first waitlist team to confirmed, and refreshes <code className="text-white/85 font-mono">#slot-list</code>.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#F87171] bg-[#EF4444]/10 px-2.5 py-1 rounded-lg border border-[#EF4444]/20">/delete tournament</span>
              <span className="text-[11px] text-white/40 font-mono">delete_channels (bool)</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Deletes tournament channels and category, cleans up permissions, and resets all registered rosters.
            </p>
          </div>

          <div className="p-6 rounded-2xl esports-card-sub space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-[#38BDF8] bg-[#38BDF8]/10 px-2.5 py-1 rounded-lg border border-[#38BDF8]/20">/rules · /announce · /export</span>
              <span className="text-[11px] text-white/40 font-mono">+ /slots, /help</span>
            </div>
            <p className="text-xs text-white/55 leading-relaxed">
              Publish the official rulebook, broadcast announcements with <code className="text-white/85 font-mono">@here</code>, or export clean rosters in Markdown/CSV.
            </p>
          </div>
        </div>
      </section>

      <section className="p-5 sm:p-6 rounded-[24px] esports-card space-y-5">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-[#38BDF8]" />
            <h3 className="font-display text-lg sm:text-xl font-bold text-white">
              Real-Time Gateway Event Stream
            </h3>
          </div>
          <span className="text-[11px] font-mono text-white/40">
            Live Stream
          </span>
        </div>

        <div className="rounded-2xl bg-black/60 border border-white/[0.07] p-5 max-h-64 overflow-y-auto divide-y divide-white/[0.06] font-mono text-xs">
          {(!botStatus.events || botStatus.events.length === 0) ? (
            <div className="text-white/40 text-center py-8">
              Waiting for Discord events...
            </div>
          ) : (
            botStatus.events.map((evt: BotLogEvent) => (
              <div
                key={evt.id}
                className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-3 text-[11px] leading-relaxed"
              >
                <span className="text-white/40 tabular-nums shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span
                  className={`w-14 text-center py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 border ${
                    evt.type === 'success'
                      ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/25'
                      : evt.type === 'warn'
                      ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25'
                      : evt.type === 'error'
                      ? 'bg-[#EF4444]/10 text-[#F87171] border-[#EF4444]/25'
                      : 'bg-white/[0.04] text-white/50 border-white/10'
                  }`}
                >
                  {evt.type}
                </span>
                {evt.guildName && (
                  <span className="text-[#38BDF8] shrink-0">
                    [{evt.guildName}]
                  </span>
                )}
                <span className="text-white/85 select-text break-words">
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

