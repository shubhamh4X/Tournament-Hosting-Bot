import React, { useState, useEffect } from 'react';
import { TournamentConfig, TeamRegistration, TournamentRegion } from '../types/tournament';
import {
  isValidWhatsAppNumber,
  sanitizeWhatsAppNumber,
  getRegionCountryCode,
  isValidTournamentRegion,
  VALID_TOURNAMENT_REGIONS
} from '../utils/tagParser';
import {
  X,
  Users,
  ShieldAlert,
  CheckCircle2,
  Phone,
  Globe2,
  Info,
  Loader2
} from 'lucide-react';

interface TeamRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TournamentConfig;
  existingTeams: TeamRegistration[];
  onSuccess: () => void;
}

export const TeamRegistrationModal: React.FC<TeamRegistrationModalProps> = ({
  isOpen,
  onClose,
  config,
  existingTeams,
  onSuccess
}) => {
  const reqTags = Math.max(1, config.requiredTags || 4);

  const [teamName, setTeamName] = useState<string>('');
  const [region, setRegion] = useState<TournamentRegion>('India');
  const [whatsappNumber1, setWhatsappNumber1] = useState<string>('+91 ');
  const [playerTags, setPlayerTags] = useState<string[]>(
    Array.from({ length: reqTags }, () => '')
  );

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setPlayerTags(prev => {
      if (prev.length === reqTags) return prev;
      return Array.from({ length: reqTags }, (_, i) => prev[i] || '');
    });
  }, [reqTags]);

  if (!isOpen) return null;

  const handleRegionChange = (nextRegion: TournamentRegion) => {
    setRegion(nextRegion);
    const nextCode = getRegionCountryCode(nextRegion);
    setWhatsappNumber1(prev => {
      const stripped = prev
        .trim()
        .replace(/^\+(?:91|880|92)\s*/, '')
        .trim();
      return stripped ? `${nextCode} ${stripped}` : `${nextCode} `;
    });
  };

  const handlePlayerChange = (index: number, value: string) => {
    setPlayerTags(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const validateForm = (): boolean => {
    setValidationError(null);

    const cleanTeam = teamName.trim();
    if (!cleanTeam) {
      setValidationError('Team Name is required.');
      return false;
    }
    if (cleanTeam.length < 2) {
      setValidationError('Team Name must be at least 2 characters long.');
      return false;
    }
    const lower = cleanTeam.toLowerCase();
    if (lower === 'team name' || lower === 'your team' || lower === 'your team name') {
      setValidationError('Please provide your actual squad name (e.g. "Team Glacier").');
      return false;
    }

    const isDuplicateName = existingTeams.some(
      t => t.teamName.trim().toLowerCase() === lower
    );
    if (isDuplicateName) {
      setValidationError(`A team named "${cleanTeam}" is already registered. Please use a unique team name.`);
      return false;
    }

    if (!region || !isValidTournamentRegion(region)) {
      setValidationError('Please select a valid Region (India, Bangladesh, or Pakistan).');
      return false;
    }

    const cleanWa1 = whatsappNumber1.trim();
    const expectedCode = getRegionCountryCode(region);
    if (!cleanWa1 || cleanWa1 === expectedCode) {
      setValidationError(`WhatsApp Number is required (starting with ${expectedCode}).`);
      return false;
    }
    if (!isValidWhatsAppNumber(cleanWa1, region)) {
      setValidationError(`Invalid WhatsApp Number! Please enter a valid number with ${expectedCode} country code (e.g., ${expectedCode}9876543210).`);
      return false;
    }

    const filledPlayers = playerTags.map(p => p.trim()).filter(Boolean);
    if (filledPlayers.length !== reqTags) {
      setValidationError(`Exactly ${reqTags} players are required as configured in tournament setup (no extra or missing players).`);
      return false;
    }

    const lowerPlayers = filledPlayers.map(p => p.toLowerCase().replace(/^@/, ''));
    const uniquePlayers = new Set(lowerPlayers);
    if (uniquePlayers.size !== lowerPlayers.length) {
      setValidationError('Duplicate player tags detected within the same team. Every player tag must be unique.');
      return false;
    }

    if (config.prohibitDuplicateTags) {
      for (const p of filledPlayers) {
        const pLower = p.toLowerCase().replace(/^@/, '');
        for (const team of existingTeams) {
          const playerMatch = team.players.some(
            pl => pl.displayName.toLowerCase().replace(/^@/, '') === pLower || pl.username.toLowerCase() === pLower
          );
          if (playerMatch) {
            setValidationError(`Player "${p}" is already registered in team "${team.teamName}". Multi-team registration is prohibited!`);
            return false;
          }
        }
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    const cleanTeam = teamName.trim();
    const sanitizedWa1 = sanitizeWhatsAppNumber(whatsappNumber1, region);
    const filledPlayers = playerTags.slice(0, reqTags).map(p => p.trim()).filter(Boolean);

    const playersList = filledPlayers.map((p, idx) => ({
      id: `ply-${Date.now()}-${idx + 1}`,
      username: p.toLowerCase().replace(/[^a-z0-9_]/g, '') || `player${idx + 1}`,
      displayName: p.replace(/^@/, ''),
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${p}`
    }));

    const captainUser = playersList[0];

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName: cleanTeam,
          whatsappNumber1: sanitizedWa1,
          region,
          captain: captainUser,
          players: playersList,
          messageId: `web-${Date.now()}`,
          channelId: config.regChannel || 'registration'
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage(`Team "${cleanTeam}" registered in ${data.isWaitlist ? `Waitlist #${data.slotNumber}` : `Slot #${data.slotNumber}`}! Tagged players granted Voice Channel Role.`);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1200);
      } else {
        setValidationError(data.error || 'Registration failed. Please check the fields and try again.');
      }
    } catch (err: any) {
      setValidationError(err.message || 'Network error while connecting to tournament server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCode = getRegionCountryCode(region);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[#14171D] border border-[#292F3A] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 my-auto">
        <div className="px-5 sm:px-6 py-4 border-b border-[#292F3A] flex items-center justify-between bg-[#101217]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#191D25] border border-[#292F3A] flex items-center justify-center text-[#6685FF]">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm sm:text-base font-bold text-[#F3F5F9]">
                Register Your Team
              </h2>
              <p className="text-[11px] text-[#929BAA]">
                {config.title || 'Tournament'} · {reqTags} Required Players ({config.format})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-[#929BAA] hover:text-[#F3F5F9] hover:bg-[#191D25] transition-colors cursor-pointer disabled:opacity-50"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4 text-xs">
          {validationError && (
            <div className="p-3 rounded-lg bg-[#FF626C]/10 border border-[#FF626C]/30 text-[#FF626C] flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 text-[11px] font-medium leading-relaxed">
                {validationError}
              </div>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-[#31D69A]/10 border border-[#31D69A]/30 text-[#31D69A] flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <div className="flex-1 text-[11px] font-medium">
                {successMessage}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#F3F5F9] mb-1.5">
              Team Name: <span className="text-[#FF626C]">*</span>
            </label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="e.g. Glacier Esports"
              disabled={isSubmitting}
              className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF] transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#F3F5F9] mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-[#6685FF]" />
                <span>Region:</span>
                <span className="text-[#FF626C]">*</span>
              </span>
              <span className="text-[10px] text-[#707A89] font-mono">
                Auto-sets {currentCode} country code
              </span>
            </label>
            <select
              value={region}
              onChange={e => handleRegionChange(e.target.value as TournamentRegion)}
              disabled={isSubmitting}
              className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs font-medium focus:outline-hidden focus:border-[#6685FF] cursor-pointer"
              required
            >
              {VALID_TOURNAMENT_REGIONS.map(reg => (
                <option key={reg} value={reg} className="bg-[#14171D] text-[#F3F5F9]">
                  {reg === 'India' ? '🇮🇳 India (+91)' : reg === 'Bangladesh' ? '🇧🇩 Bangladesh (+880)' : '🇵🇰 Pakistan (+92)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#F3F5F9] mb-1.5 flex items-center gap-1">
              <Phone className="w-3 h-3 text-[#31D69A]" />
              <span>WhatsApp no :</span>
              <span className="text-[#FF626C]">*</span>
            </label>
            <input
              type="tel"
              value={whatsappNumber1}
              onChange={e => setWhatsappNumber1(e.target.value)}
              placeholder={`${currentCode} XXXXXXXXXX`}
              disabled={isSubmitting}
              className="w-full h-9 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] font-mono text-[11px] placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF] transition-colors"
              required
            />
            <p className="text-[10px] text-[#707A89] mt-1 font-mono">
              Country code ({currentCode}) automatically added for {region}
            </p>
          </div>

          <div className="p-2.5 rounded-md bg-[#191D25] border border-[#292F3A] flex items-center gap-2 text-[11px] text-[#929BAA]">
            <Info className="w-3.5 h-3.5 text-[#6685FF] shrink-0" />
            <span>Contact number remains confidential to tournament staff. Upon submit, all {reqTags} tagged players receive the Team Voice Channel Role to join VC.</span>
          </div>

          <div className="space-y-2.5 pt-2 border-t border-[#292F3A]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#F3F5F9]">
                Players Tags : ({reqTags} Players Required)
              </span>
              <span className="text-[11px] font-mono text-[#A7C7FF]">
                Exact {reqTags} tags (no extra players)
              </span>
            </div>

            <div className="space-y-1.5">
              {playerTags.slice(0, reqTags).map((tag, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-24 text-[11px] font-mono text-[#707A89] shrink-0">
                    {idx === 0 ? 'Player 1 (IGL):' : `Player ${idx + 1}:`}
                  </span>
                  <input
                    type="text"
                    value={tag}
                    onChange={e => handlePlayerChange(idx, e.target.value)}
                    placeholder={`@Player${idx + 1} or Discord ID`}
                    disabled={isSubmitting}
                    className="flex-1 h-8 px-3 rounded-md bg-[#101319] border border-[#292F3A] text-[#F3F5F9] text-xs placeholder-[#707A89] focus:outline-hidden focus:border-[#6685FF]"
                    required
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-[#292F3A] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-9 px-4 rounded-md bg-[#191D25] hover:bg-[#222731] text-[#929BAA] hover:text-[#F3F5F9] text-xs font-semibold border border-[#292F3A] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="h-9 px-5 rounded-md bg-[#6685FF] hover:bg-[#5473EE] text-[#F3F5F9] text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Registering Team...</span>
                </>
              ) : (
                <span>Register Team</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
