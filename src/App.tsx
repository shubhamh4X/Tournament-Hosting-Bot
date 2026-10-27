import React, { useState, useEffect } from 'react';
import {
  TournamentConfig,
  TeamRegistration,
  RoomCredentials,
  GatewayOperationalState
} from './types/tournament';
import { TourneyConfigPanel } from './components/TourneyConfigPanel';
import { SlotRosterTable } from './components/SlotRosterTable';
import { RoomIdpModal } from './components/RoomIdpModal';
import { LiveBotRunner } from './components/LiveBotRunner';
import { CommandsPage } from './components/CommandsPage';
import {
  KeyRound,
  ShieldCheck,
  Trophy,
  Users,
  UserPlus,
  Terminal,
  BookOpen,
  ArrowRight,
  Activity,
  Layers,
  Sparkles,
  ExternalLink,
  SlidersHorizontal
} from 'lucide-react';

export type AppPage = 'home' | 'rules' | 'commands' | 'slots' | 'gateway';

export default function App() {
  const getPageFromHash = (): AppPage => {
    if (typeof window === 'undefined') return 'home';
    const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    if (hash === 'rules') return 'rules';
    if (hash === 'commands') return 'commands';
    if (hash === 'slots' || hash === 'roster') return 'slots';
    if (hash === 'gateway' || hash === 'bot') return 'gateway';
    return 'home';
  };

  const [currentPage, setCurrentPage] = useState<AppPage>(() => getPageFromHash());
  const [isIdpModalOpen, setIsIdpModalOpen] = useState<boolean>(false);
  const [isBotOnline, setIsBotOnline] = useState<boolean>(false);
  const [botClientId, setBotClientId] = useState<string>('1564392085094666353');
  const [gatewayState, setGatewayState] = useState<GatewayOperationalState>('disconnected');

  const [config, setConfig] = useState<TournamentConfig>({
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
    verifiedRoleName: 'Verified Team',
    managerRoleName: 'FFA Bot Manager',
    easyTagEnabled: true,
    prohibitDuplicateTags: true,
    prohibitSelfDuplication: true,
    disallowBots: true,
    autoDeleteInvalid: true,
    autoDeleteSeconds: 5,
    autoCreateTeamVoice: true,
    status: 'open',
    regChannel: 'registration',
    slotListChannel: 'slot-list',
    idpChannel: 'id-pass',
    rulesMessage: 'Format:\nTeam Name: <Your Team>\nPlayer 1: @Tag1\nPlayer 2: @Tag2\nPlayer 3: @Tag3\nPlayer 4: @Tag4',
    roleName: 'Confirmed Slot'
  });

  const [registeredTeams, setRegisteredTeams] = useState<TeamRegistration[]>([]);
  const [roomDispatch, setRoomDispatch] = useState<RoomCredentials | null>(null);

  const navigateTo = (page: AppPage) => {
    setCurrentPage(page);
    if (typeof window !== 'undefined') {
      window.location.hash = page === 'home' ? '' : page;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPage(getPageFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.totalSlots === 'number') {
          setConfig(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});

    fetch('/api/teams')
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.confirmed)) {
          setRegisteredTeams([...data.confirmed, ...(data.waitlist || [])]);
        }
      })
      .catch(() => {});
  }, []);

  const refreshTeams = () => {
    fetch('/api/teams')
      .then(res => res.json())
      .then(data => {
        if (data && data.confirmed) {
          setRegisteredTeams([...data.confirmed, ...(data.waitlist || [])]);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    const syncState = () => {
      fetch('/api/bot/status')
        .then(r => r.json())
        .then(s => {
          setIsBotOnline(s?.isOnline || false);
          if (s?.botUser?.id) {
            setBotClientId(s.botUser.id);
          } else if (s?.clientId) {
            setBotClientId(s.clientId);
          }
          if (s?.gatewayState) {
            setGatewayState(s.gatewayState);
          } else {
            setGatewayState(s?.isOnline ? 'connected' : s?.isConnecting ? 'reconnecting' : 'disconnected');
          }
        })
        .catch(() => {});

      fetch('/api/config')
        .then(res => res.json())
        .then(data => {
          if (data && typeof data.totalSlots === 'number') {
            setConfig(prev => ({ ...prev, ...data }));
          }
        })
        .catch(() => {});

      fetch('/api/teams')
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.confirmed)) {
            setRegisteredTeams([...data.confirmed, ...(data.waitlist || [])]);
          }
        })
        .catch(() => {});
    };
    syncState();
    const interval = setInterval(syncState, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdateConfig = (newConfig: Partial<TournamentConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    }).catch(() => {});
  };

  const handleKickTeam = (teamId: string) => {
    fetch('/api/teams/kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId })
    })
      .then(r => r.json())
      .then(data => {
        if (data?.teams) {
          setRegisteredTeams(data.teams);
        } else {
          refreshTeams();
        }
      })
      .catch(() => {});
  };

  const handleResetTeams = () => {
    setRegisteredTeams([]);
    setConfig(prev => ({ ...prev, status: 'open' }));
    fetch('/api/teams/reset', { method: 'POST' }).catch(() => {});
  };

  const handleRoomDispatch = (creds: RoomCredentials) => {
    setRoomDispatch(creds);
    fetch('/api/idp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds)
    }).catch(() => {});
  };

  const confirmedTeams = registeredTeams.filter(t => !t.isWaitlist);
  const waitlistTeams = registeredTeams.filter(t => t.isWaitlist);
  const dotColor =
    gatewayState === 'connected'
      ? 'bg-[#10B981]'
      : gatewayState === 'partially_operational'
      ? 'bg-[#F59E0B]'
      : gatewayState === 'reconnecting'
      ? 'bg-[#38BDF8] animate-pulse'
      : 'bg-[#64748B]';

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans selection:bg-[#38BDF8]/30 overflow-x-hidden">
      {/* Sticky Header with Navigation */}
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-2xl border-b border-white/[0.05] shrink-0">
        <div className="w-full max-w-7xl mx-auto h-20 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          {/* Brand Logo & Title */}
          <button
            type="button"
            onClick={() => navigateTo('home')}
            className="flex items-center gap-3 whitespace-nowrap shrink-0 cursor-pointer group text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#38BDF8] rounded-xl"
          >
            <div className="relative">
              <div className="pointer-events-none absolute -inset-1 rounded-xl bg-gradient-to-tr from-[#38BDF8]/30 to-[#0EA5E9]/20 opacity-0 group-hover:opacity-100 blur-xs transition-opacity" />
              <img
                src="/assets/glacier-cup-logo.png"
                alt="FFA | Glacier Cup Manager™"
                className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-cover border border-white/15 bg-[#080B11] group-hover:border-[#38BDF8]/45 transition-colors"
                referrerPolicy="no-referrer"
              />
            </div>
            <span className="font-display text-sm sm:text-[17px] font-bold tracking-tight text-white group-hover:text-[#E0F2FE] transition-colors">
              FFA | Glacier Cup Manager™
            </span>
          </button>

          {/* Desktop Navigation Dock (Matches Exact User Screenshot) */}
          <nav className="hidden md:flex items-center px-2.5 h-11 rounded-full nav-glass-dock gap-1 text-[13.5px]">
            <button
              type="button"
              onClick={() => navigateTo('home')}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                currentPage === 'home'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1] shadow-xs'
                  : 'text-white/60 hover:text-white font-medium border border-transparent hover:bg-white/[0.03]'
              }`}
            >
              Home
            </button>

            <button
              type="button"
              onClick={() => navigateTo('rules')}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                currentPage === 'rules'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1] shadow-xs'
                  : 'text-white/60 hover:text-white font-medium border border-transparent hover:bg-white/[0.03]'
              }`}
            >
              Rules
            </button>

            <button
              type="button"
              onClick={() => navigateTo('commands')}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                currentPage === 'commands'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1] shadow-xs'
                  : 'text-white/60 hover:text-white font-medium border border-transparent hover:bg-white/[0.03]'
              }`}
            >
              Commands
            </button>

            <button
              type="button"
              onClick={() => navigateTo('slots')}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                currentPage === 'slots'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1] shadow-xs'
                  : 'text-white/60 hover:text-white font-medium border border-transparent hover:bg-white/[0.03]'
              }`}
            >
              <span>Slots</span>
              <span className="text-[11px] font-mono tabular-nums text-[#7DD3FC]">
                ({confirmedTeams.length}/{config.totalSlots})
              </span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('gateway')}
              className={`h-8 px-4 rounded-full transition-all whitespace-nowrap cursor-pointer flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-[#38BDF8] ${
                currentPage === 'gateway'
                  ? 'bg-white/[0.08] text-white font-semibold border border-white/[0.1] shadow-xs'
                  : 'text-white/60 hover:text-white font-medium border border-transparent hover:bg-white/[0.03]'
              }`}
            >
              <span>Gateway</span>
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            </button>
          </nav>

          {/* Quick Actions (Invite & Publish IDP) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <a
              href={`https://discord.com/api/oauth2/authorize?client_id=${botClientId || '1564392085094666353'}&permissions=8&scope=bot%20applications.commands`}
              target="_blank"
              rel="noreferrer"
              className="h-10 px-4 sm:px-5 rounded-full bg-[#0C0F15] hover:bg-[#141923] border border-white/[0.11] hover:border-[#38BDF8]/35 text-[13px] font-semibold text-white whitespace-nowrap shrink-0 flex items-center gap-2 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#7DD3FC]" />
              <span>Invite</span>
            </a>

            <button
              type="button"
              onClick={() => setIsIdpModalOpen(true)}
              className="h-10 px-4 sm:px-5 rounded-full bg-[#0C0F15] hover:bg-[#141923] border border-white/[0.11] hover:border-[#38BDF8]/35 text-[13px] font-semibold text-white whitespace-nowrap shrink-0 flex items-center gap-2 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-[#38BDF8]"
            >
              <KeyRound className="w-3.5 h-3.5 text-[#7DD3FC]" />
              <span>Publish IDP</span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="flex md:hidden items-center justify-center gap-3 bg-[#0B0D12]/95 border-t border-white/[0.06] px-4 py-2 text-xs overflow-x-auto">
          {(
            [
              { key: 'home', label: 'Home' },
              { key: 'rules', label: 'Rules' },
              { key: 'commands', label: 'Commands' },
              { key: 'slots', label: `Slots (${confirmedTeams.length}/${config.totalSlots})` },
              { key: 'gateway', label: 'Gateway' }
            ] as const
          ).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => navigateTo(tab.key)}
              className={`px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-colors ${
                currentPage === tab.key
                  ? 'bg-white/[0.12] text-white font-bold'
                  : 'text-white/60 hover:text-white font-medium'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Page Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-8 sm:py-10 pb-24">
        {/* ============================================================ */}
        {/* 1. HOME PAGE */}
        {/* ============================================================ */}
        {currentPage === 'home' && (
          <div className="space-y-12 animate-fadeIn">
            {/* Hero Section with Ambient Glow */}
            <section className="relative pt-6 pb-8 sm:pt-12 sm:pb-10 text-center">
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 w-[880px] max-w-full h-[360px] rounded-full bg-gradient-to-b from-[#38BDF8]/15 via-[#0EA5E9]/8 to-transparent blur-[120px] -z-10" />
              <div className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 w-[480px] max-w-full h-[180px] rounded-full bg-[#BAE6FD]/8 blur-[80px] -z-10" />

              <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#0EA5E9]/[0.07] border border-[#38BDF8]/25 mb-6 shadow-[0_0_24px_rgba(56,189,248,0.1)]">
                <Trophy className="w-3.5 h-3.5 text-[#7DD3FC]" />
                <span className="eyebrow-label">
                  Automated Discord Tournament &amp; Scrims Engine
                </span>
              </div>

              <h1 className="font-display text-4xl sm:text-6xl lg:text-[4.5rem] font-black tracking-[-0.035em] leading-[1.08] pb-1.5 max-w-4xl mx-auto text-balance hero-gradient-text">
                {config.title || 'Glacier Cup Manager'}
              </h1>

              <p className="mt-5 text-[15px] sm:text-base lg:text-[17px] text-white/65 max-w-2xl mx-auto leading-[1.7] font-normal">
                Precision tag-basis squad verification, cross-team anti-duplicate protection, automated multi-group slot allocation, private team voice channels, and instant Room ID &amp; Password dispatch.
              </p>

              {/* 4 Tournament Metrics */}
              <div className="mt-12 py-7 border-y border-white/[0.07] w-full grid grid-cols-2 sm:grid-cols-4 gap-y-6 sm:gap-y-0 sm:divide-x sm:divide-white/[0.07] text-center">
                <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                    Active Format
                  </div>
                  <div className="font-display text-2xl sm:text-3xl font-extrabold text-white mt-2 flex items-baseline justify-center gap-2 tracking-tight">
                    <span>{config.format}</span>
                    <span className="text-xs font-mono text-[#7DD3FC] font-medium">
                      ({config.requiredTags} Tags)
                    </span>
                  </div>
                </div>

                <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                    Confirmed Slots
                  </div>
                  <div className="font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-[#7DD3FC] mt-2 tracking-tight">
                    {confirmedTeams.length}
                    <span className="text-white/30 font-normal text-xl sm:text-2xl"> / {config.totalSlots}</span>
                  </div>
                </div>

                <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                    Waitlist Queue
                  </div>
                  <div className="font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-white mt-2 tracking-tight">
                    {waitlistTeams.length}
                    <span className="text-white/30 font-normal text-xl sm:text-2xl"> / {config.waitlistSlots}</span>
                  </div>
                </div>

                <div className="px-3 sm:px-6 flex flex-col items-center justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                    Registration Status
                  </div>
                  <div className="font-mono text-base sm:text-lg font-bold uppercase mt-2.5 flex items-center justify-center gap-2.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        config.status === 'open'
                          ? 'bg-[#10B981] shadow-[0_0_10px_#10B981]'
                          : config.status === 'paused'
                          ? 'bg-[#F59E0B]'
                          : 'bg-[#EF4444]'
                      }`}
                    />
                    <span
                      className={
                        config.status === 'open'
                          ? 'text-[#10B981]'
                          : config.status === 'paused'
                          ? 'text-[#F59E0B]'
                          : 'text-[#EF4444]'
                      }
                    >
                      {config.status}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Marquee Ticker */}
            <div className="border-y border-white/[0.07] bg-gradient-to-r from-transparent via-white/[0.018] to-transparent py-4 overflow-hidden glacier-marquee-mask select-none">
              <div className="glacier-marquee-track">
                {[0, 1].map(loopIdx => (
                  <div key={loopIdx} className="flex items-center gap-10 sm:gap-14 pr-10 sm:pr-14 whitespace-nowrap">
                    <span className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                      Powering Competitive Esports &amp; Scrims
                    </span>
                    <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                    <span className="font-display text-[11px] sm:text-xs font-extrabold uppercase tracking-[0.24em] bg-gradient-to-r from-white via-[#E0F2FE] to-[#38BDF8] bg-clip-text text-transparent">
                      Glacier Cup Manager
                    </span>
                    <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                    <span className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                      Automated Tag-Basis Squad Verification
                    </span>
                    <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                    <span className="font-display text-[11px] sm:text-xs font-extrabold uppercase tracking-[0.24em] bg-gradient-to-r from-white via-[#E0F2FE] to-[#38BDF8] bg-clip-text text-transparent">
                      FFA Esports Engine
                    </span>
                    <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                    <span className="font-display text-[11px] sm:text-xs font-semibold uppercase tracking-[0.24em] text-white/55">
                      Instant Room ID &amp; Password Dispatch
                    </span>
                    <span className="text-[#38BDF8]/40 text-xs" aria-hidden="true">·</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Feature Page Navigation Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div
                onClick={() => navigateTo('rules')}
                className="p-6 rounded-2xl esports-card hover:border-[#38BDF8]/40 transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/20 flex items-center justify-center text-[#7DD3FC]">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-white text-lg group-hover:text-[#7DD3FC] transition-colors">
                    Tournament Rules
                  </h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    Set custom format rules, required player tags, EasyTag tagcheck policies, and role permissions.
                  </p>
                </div>
                <div className="pt-4 flex items-center gap-1.5 text-xs text-[#38BDF8] font-semibold">
                  <span>Open Rules Page</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              <div
                onClick={() => navigateTo('commands')}
                className="p-6 rounded-2xl esports-card hover:border-[#38BDF8]/40 transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 border border-[#10B981]/20 flex items-center justify-center text-[#10B981]">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-white text-lg group-hover:text-[#10B981] transition-colors">
                    Bot Commands
                  </h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    Explore all 18 Discord slash (/) and prefix (!) commands with 1-click copyable syntax and examples.
                  </p>
                </div>
                <div className="pt-4 flex items-center gap-1.5 text-xs text-[#10B981] font-semibold">
                  <span>Open Commands Page</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              <div
                onClick={() => navigateTo('slots')}
                className="p-6 rounded-2xl esports-card hover:border-[#38BDF8]/40 transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/20 flex items-center justify-center text-[#F59E0B]">
                    <Users className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-white text-lg group-hover:text-[#F59E0B] transition-colors">
                    Slots &amp; Rosters
                  </h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    View live confirmed squads ({confirmedTeams.length}/{config.totalSlots}), waitlist queue, and export rosters to CSV.
                  </p>
                </div>
                <div className="pt-4 flex items-center gap-1.5 text-xs text-[#F59E0B] font-semibold">
                  <span>Open Slots Page</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              <div
                onClick={() => navigateTo('gateway')}
                className="p-6 rounded-2xl esports-card hover:border-[#38BDF8]/40 transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-[#38BDF8]/10 border border-[#38BDF8]/20 flex items-center justify-center text-[#7DD3FC]">
                    <Activity className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-white text-lg group-hover:text-[#7DD3FC] transition-colors">
                    Gateway &amp; Bot
                  </h3>
                  <p className="text-xs text-white/55 leading-relaxed">
                    Monitor Discord Gateway status, ping latency, connected servers, and live audit event stream.
                  </p>
                </div>
                <div className="pt-4 flex items-center gap-1.5 text-xs text-[#38BDF8] font-semibold">
                  <span>Open Gateway Console</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>

            {/* Tournament Setup Wizard & Invites */}
            <LiveBotRunner
              config={config}
              onRefreshTeams={refreshTeams}
              onUpdateConfig={handleUpdateConfig}
              viewMode="wizard-only"
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* 2. RULES PAGE */}
        {/* ============================================================ */}
        {currentPage === 'rules' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="p-6 sm:p-8 rounded-[24px] esports-card flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative overflow-hidden">
              <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[#38BDF8]/10 blur-[90px]" />
              <div className="space-y-2 relative">
                <div className="eyebrow-label">
                  Rulebook &amp; Verification Parameters
                </div>
                <h2 className="font-display text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
                  Tournament Rules &amp; Configuration
                </h2>
                <p className="text-xs sm:text-sm text-white/55 max-w-2xl leading-relaxed">
                  Set custom tournament rules for <code className="text-[#38BDF8] font-mono">#📋┃rules-format</code>, configure required squad tags, format presets, and anti-duplicate registration policies.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => navigateTo('slots')}
                  className="btn-glacier-secondary h-11 px-5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <Users className="w-4 h-4 text-[#F59E0B]" />
                  <span>View Slot Roster</span>
                </button>
              </div>
            </div>

            <TourneyConfigPanel
              config={config}
              onSaveConfig={handleUpdateConfig}
              registeredTeams={registeredTeams}
              onResetTeams={handleResetTeams}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* 3. COMMANDS PAGE */}
        {/* ============================================================ */}
        {currentPage === 'commands' && (
          <CommandsPage />
        )}

        {/* ============================================================ */}
        {/* 4. SLOTS PAGE */}
        {/* ============================================================ */}
        {currentPage === 'slots' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="p-6 sm:p-8 rounded-[24px] esports-card flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative overflow-hidden">
              <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[#38BDF8]/10 blur-[90px]" />
              <div className="space-y-2 relative">
                <div className="eyebrow-label">
                  Slot Allocation &amp; Group Partitions
                </div>
                <h2 className="font-display text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
                  Confirmed Slots &amp; Waiting List
                </h2>
                <p className="text-xs sm:text-sm text-white/55 max-w-2xl leading-relaxed">
                  Real-time registered squads table with group partitions (Group A, Group B, etc.), captain contact info, player tags, and instant waitlist auto-promotion.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsIdpModalOpen(true)}
                  className="btn-glacier-primary h-11 px-5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Publish Room IDP</span>
                </button>
              </div>
            </div>

            <SlotRosterTable
              teams={registeredTeams}
              config={config}
              onKickTeam={handleKickTeam}
              onClearAll={handleResetTeams}
              onRefreshTeams={refreshTeams}
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* 5. GATEWAY PAGE */}
        {/* ============================================================ */}
        {currentPage === 'gateway' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="p-6 sm:p-8 rounded-[24px] esports-card flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative overflow-hidden">
              <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[#38BDF8]/10 blur-[90px]" />
              <div className="space-y-2 relative">
                <div className="eyebrow-label">
                  Discord Operational Console
                </div>
                <h2 className="font-display text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
                  Discord Gateway &amp; Operational Console
                </h2>
                <p className="text-xs sm:text-sm text-white/55 max-w-2xl leading-relaxed">
                  Real-time WebSocket heartbeat, shard monitoring, server authorization, registration channel selectors, and live event audit stream.
                </p>
              </div>

              <a
                href={`https://discord.com/api/oauth2/authorize?client_id=${botClientId || '1564392085094666353'}&permissions=8&scope=bot%20applications.commands`}
                target="_blank"
                rel="noreferrer"
                className="btn-glacier-primary h-11 px-5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shrink-0"
              >
                <UserPlus className="w-4 h-4" />
                <span>Authorize Bot in Server</span>
              </a>
            </div>

            <LiveBotRunner
              config={config}
              onRefreshTeams={refreshTeams}
              onUpdateConfig={handleUpdateConfig}
              viewMode="gateway-only"
            />
          </div>
        )}
      </main>

      {/* Global Room IDP Dispatch Modal */}
      <RoomIdpModal
        isOpen={isIdpModalOpen}
        onClose={() => setIsIdpModalOpen(false)}
        config={config}
        confirmedTeams={confirmedTeams}
        onDispatch={handleRoomDispatch}
        lastDispatch={roomDispatch}
      />

      {/* Footer */}
      <footer className="mt-auto border-t border-white/[0.06] bg-black/80 backdrop-blur-md py-7 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/45">
          <div className="flex items-center gap-3">
            <img
              src="/assets/glacier-cup-logo.png"
              alt=""
              className="w-6 h-6 rounded-lg object-cover border border-white/10"
              referrerPolicy="no-referrer"
            />
            <span className="font-display font-bold text-white/85 tracking-tight">
              FFA | Glacier Cup Manager™
            </span>
          </div>
          <div className="flex items-center gap-2 text-white/50">
            <ShieldCheck className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>Tag-Basis Discord Tournament Registration Bot &amp; Scrims Manager</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
