import React, { useState, useEffect, useCallback } from 'react';
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
  Loader2,
  ShieldCheck,
  RefreshCw,
  KeyRound,
  AlertCircle
} from 'lucide-react';

interface TeamRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TournamentConfig;
  existingTeams: TeamRegistration[];
  onSuccess: () => void;
}

type OtpStatus = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified';

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

  // WhatsApp OTP Verification State
  const [otpStatus, setOtpStatus] = useState<OtpStatus>('idle');
  const [otpCode, setOtpCode] = useState<string>('');
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState<string | null>(null);
  const [twilioConfigured, setTwilioConfigured] = useState<boolean | null>(null);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setPlayerTags(prev => {
      if (prev.length === reqTags) return prev;
      return Array.from({ length: reqTags }, (_, i) => prev[i] || '');
    });
  }, [reqTags]);

  // Check Twilio configuration status on modal open
  useEffect(() => {
    if (!isOpen) return;

    fetch('/api/whatsapp-otp/status')
      .then(res => res.json())
      .then(data => {
        setTwilioConfigured(Boolean(data.configured));
      })
      .catch(() => {
        setTwilioConfigured(null);
      });
  }, [isOpen]);

  // Cooldown countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Reset/Invalidate verification if phone or region changes
  const invalidateVerification = useCallback(() => {
    if (verificationToken || otpStatus !== 'idle') {
      setVerificationToken(null);
      setVerifiedPhone(null);
      setOtpStatus('idle');
      setOtpCode('');
      setOtpError(null);
      setOtpSuccess(null);
    }
  }, [verificationToken, otpStatus]);

  if (!isOpen) return null;

  const handleRegionChange = (nextRegion: TournamentRegion) => {
    setRegion(nextRegion);
    invalidateVerification();
    const nextCode = getRegionCountryCode(nextRegion);
    setWhatsappNumber1(prev => {
      const stripped = prev
        .trim()
        .replace(/^\+(?:91|880|92)\s*/, '')
        .trim();
      return stripped ? `${nextCode} ${stripped}` : `${nextCode} `;
    });
  };

  const handlePhoneChange = (val: string) => {
    setWhatsappNumber1(val);
    invalidateVerification();
  };

  const handlePlayerChange = (index: number, value: string) => {
    setPlayerTags(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Request WhatsApp OTP from Twilio Verify
  const handleSendOtp = async () => {
    setOtpError(null);
    setOtpSuccess(null);

    const cleanWa1 = whatsappNumber1.trim();
    const expectedCode = getRegionCountryCode(region);

    if (!cleanWa1 || cleanWa1 === expectedCode) {
      setOtpError(`Please enter your WhatsApp Number (starting with ${expectedCode}).`);
      return;
    }

    if (!isValidWhatsAppNumber(cleanWa1, region)) {
      setOtpError(`Invalid WhatsApp Number! Please enter a valid number with ${expectedCode} country code for ${region} (e.g., ${expectedCode}9876543210).`);
      return;
    }

    setOtpStatus('sending');

    try {
      const res = await fetch('/api/whatsapp-otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanWa1,
          region
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setOtpStatus('sent');
        setResendCooldown(data.cooldownSeconds || 60);
        setOtpSuccess(data.message || 'Verification code sent to your WhatsApp!');
      } else {
        setOtpError(data.error || 'Failed to send WhatsApp verification code.');
        if (data.cooldownSeconds && data.cooldownSeconds > 0) {
          setResendCooldown(data.cooldownSeconds);
          setOtpStatus('sent');
        } else {
          setOtpStatus('idle');
        }
      }
    } catch (err: any) {
      setOtpError(err.message || 'Network error communicating with WhatsApp verification service.');
      setOtpStatus('idle');
    }
  };

  // Verify WhatsApp OTP with Twilio Verify
  const handleVerifyOtp = async () => {
    setOtpError(null);
    setOtpSuccess(null);

    const cleanCode = otpCode.trim();
    if (!cleanCode) {
      setOtpError('Please enter the verification code received on WhatsApp.');
      return;
    }

    if (!/^\d{4,8}$/.test(cleanCode)) {
      setOtpError('Please enter a valid numeric verification code.');
      return;
    }

    setOtpStatus('verifying');

    try {
      const res = await fetch('/api/whatsapp-otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: whatsappNumber1.trim(),
          code: cleanCode,
          region
        })
      });

      const data = await res.json();

      if (res.ok && data.success && data.verificationToken) {
        setOtpStatus('verified');
        setVerificationToken(data.verificationToken);
        setVerifiedPhone(data.verifiedPhone || whatsappNumber1.trim());
        setOtpSuccess(data.message || 'WhatsApp number successfully verified!');
        setValidationError(null);
      } else {
        setOtpError(data.error || 'Incorrect or expired code. Please try again.');
        setOtpStatus('sent');
      }
    } catch (err: any) {
      setOtpError(err.message || 'Network error while verifying OTP code.');
      setOtpStatus('sent');
    }
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

    // Enforce OTP verification before final registration
    if (!verificationToken || otpStatus !== 'verified') {
      setValidationError('WhatsApp number verification is mandatory! Please click "Verify on WhatsApp" to receive and confirm your OTP before finalizing registration.');
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
          verificationToken,
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
        if (data.code === 'INVALID_VERIFICATION_TOKEN' || data.code === 'VERIFICATION_TOKEN_EXPIRED') {
          invalidateVerification();
        }
      }
    } catch (err: any) {
      setValidationError(err.message || 'Network error while connecting to tournament server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCode = getRegionCountryCode(region);
  const isVerified = otpStatus === 'verified' && Boolean(verificationToken);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-xl overflow-y-auto">
      <div className="rounded-[28px] bg-[#080A0F]/95 border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.85)] w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-auto">
        <div className="px-6 sm:px-8 py-5 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#0EA5E9]/10 border border-[#38BDF8]/25 flex items-center justify-center text-[#38BDF8]">
              <Users className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="eyebrow-label mb-0.5">
                Direct Squad Entry
              </div>
              <h2 className="font-display text-base sm:text-lg font-bold text-white">
                Register Your Team
              </h2>
              <p className="text-[11px] text-white/50">
                {config.title || 'Tournament'} · {reqTags} Required Players ({config.format})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5 text-xs">
          {twilioConfigured === false && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 text-xs leading-relaxed">
                <span className="font-semibold">Twilio Verify Notice:</span> Server administrator must configure <code className="px-1 py-0.5 rounded bg-black/40 text-amber-200 font-mono text-[10px]">TWILIO_ACCOUNT_SID</code>, <code className="px-1 py-0.5 rounded bg-black/40 text-amber-200 font-mono text-[10px]">TWILIO_AUTH_TOKEN</code>, and <code className="px-1 py-0.5 rounded bg-black/40 text-amber-200 font-mono text-[10px]">TWILIO_VERIFY_SERVICE_SID</code> in the environment to dispatch live WhatsApp OTP codes.
              </div>
            </div>
          )}

          {validationError && (
            <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/25 text-[#F87171] flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 text-xs font-medium leading-relaxed">
                {validationError}
              </div>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/25 text-[#10B981] flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <div className="flex-1 text-xs font-medium">
                {successMessage}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-white/75 mb-2">
              Team Name <span className="text-[#F87171]">*</span>
            </label>
            <input
              type="text"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              placeholder="e.g. Glacier Esports"
              disabled={isSubmitting}
              className="w-full h-11 px-3.5 rounded-xl esports-input placeholder-white/35"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/75 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Globe2 className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Region</span>
                <span className="text-[#F87171]">*</span>
              </span>
              <span className="text-[11px] text-white/45 font-mono">
                Auto-sets {currentCode} country code
              </span>
            </label>
            <select
              value={region}
              onChange={e => handleRegionChange(e.target.value as TournamentRegion)}
              disabled={isSubmitting || otpStatus === 'verifying'}
              className="w-full h-11 px-3.5 rounded-xl esports-input text-xs font-medium cursor-pointer"
              required
            >
              {VALID_TOURNAMENT_REGIONS.map(reg => (
                <option key={reg} value={reg} className="bg-[#090C12] text-white">
                  {reg === 'India' ? '🇮🇳 India (+91)' : reg === 'Bangladesh' ? '🇧🇩 Bangladesh (+880)' : '🇵🇰 Pakistan (+92)'}
                </option>
              ))}
            </select>
          </div>

          {/* WhatsApp Number & OTP Verification Section */}
          <div className="space-y-2.5 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-white/80 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-[#10B981]" />
                <span>Captain WhatsApp Number</span>
                <span className="text-[#F87171]">*</span>
              </label>

              {isVerified ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verified via WhatsApp</span>
                </span>
              ) : (
                <span className="text-[11px] text-amber-400/90 font-mono flex items-center gap-1">
                  <span>Verification Required</span>
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="tel"
                  value={whatsappNumber1}
                  onChange={e => handlePhoneChange(e.target.value)}
                  placeholder={`${currentCode} XXXXXXXXXX`}
                  disabled={isSubmitting || isVerified}
                  className={`w-full h-11 px-3.5 rounded-xl esports-input font-mono text-xs placeholder-white/35 ${
                    isVerified ? 'border-[#10B981]/40 bg-[#10B981]/5 text-emerald-300' : ''
                  }`}
                  required
                />
              </div>

              {!isVerified ? (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={isSubmitting || otpStatus === 'sending' || resendCooldown > 0}
                  className="h-11 px-4 rounded-xl text-xs font-semibold bg-[#10B981] hover:bg-[#059669] text-white transition-all flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {otpStatus === 'sending' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : resendCooldown > 0 ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Resend ({resendCooldown}s)</span>
                    </>
                  ) : otpStatus === 'sent' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Resend OTP</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Verify WhatsApp</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={invalidateVerification}
                  disabled={isSubmitting}
                  className="h-11 px-3.5 rounded-xl text-[11px] font-medium bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white border border-white/10 transition-all shrink-0 cursor-pointer"
                  title="Change phone number and re-verify"
                >
                  Change
                </button>
              )}
            </div>

            {/* OTP Entry Row when code is dispatched */}
            {!isVerified && (otpStatus === 'sent' || otpStatus === 'verifying') && (
              <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/25 space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center justify-between text-[11px] text-cyan-300">
                  <span className="flex items-center gap-1 font-medium">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Enter OTP code sent to your WhatsApp</span>
                  </span>
                  {resendCooldown > 0 && (
                    <span className="text-white/45 font-mono">
                      Resend in {resendCooldown}s
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 6-digit WhatsApp code"
                    disabled={isSubmitting || otpStatus === 'verifying'}
                    className="flex-1 h-10 px-3.5 rounded-lg esports-input font-mono text-center tracking-widest text-sm placeholder-white/30"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    disabled={isSubmitting || otpStatus === 'verifying' || !otpCode.trim()}
                    className="h-10 px-4 rounded-lg text-xs font-bold bg-[#38BDF8] hover:bg-[#0EA5E9] text-black transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {otpStatus === 'verifying' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Checking...</span>
                      </>
                    ) : (
                      <span>Confirm OTP</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* In-flight feedback messages */}
            {otpError && (
              <div className="text-[11px] text-[#F87171] flex items-center gap-1.5 pt-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{otpError}</span>
              </div>
            )}

            {otpSuccess && (
              <div className="text-[11px] text-[#10B981] flex items-center gap-1.5 pt-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{otpSuccess}</span>
              </div>
            )}

            <p className="text-[11px] text-white/45 font-mono">
              {isVerified
                ? `Phone verified (${verifiedPhone || whatsappNumber1.trim()}) for this registration.`
                : `Country code (${currentCode}) required. A verification code will be sent to your WhatsApp.`}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center gap-3 text-xs text-white/55">
            <Info className="w-4 h-4 text-[#38BDF8] shrink-0" />
            <span>Contact number is verified via WhatsApp to confirm captain authenticity. Upon submit, all {reqTags} tagged players receive the Team Voice Channel Role to join VC.</span>
          </div>

          <div className="space-y-3 pt-3 border-t border-white/[0.07]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Player Tags ({reqTags} Players Required)
              </span>
              <span className="text-[11px] font-mono text-[#38BDF8]">
                Exact {reqTags} tags
              </span>
            </div>

            <div className="space-y-2.5">
              {playerTags.slice(0, reqTags).map((tag, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <span className="w-24 text-[11px] font-mono text-white/50 shrink-0">
                    {idx === 0 ? 'Player 1 (IGL):' : `Player ${idx + 1}:`}
                  </span>
                  <input
                    type="text"
                    value={tag}
                    onChange={e => handlePlayerChange(idx, e.target.value)}
                    placeholder={`@Player${idx + 1} or Discord ID`}
                    disabled={isSubmitting}
                    className="flex-1 h-10 px-3.5 rounded-xl esports-input text-xs placeholder-white/35"
                    required
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="pt-5 border-t border-white/[0.07] flex items-center justify-between gap-3">
            <div className="text-[11px]">
              {!isVerified ? (
                <span className="text-amber-400/80 flex items-center gap-1 font-mono">
                  <span>* Verify WhatsApp to unlock registration</span>
                </span>
              ) : (
                <span className="text-[#10B981] flex items-center gap-1 font-mono font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>WhatsApp verified</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="btn-glacier-secondary h-10 px-5 rounded-xl text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !isVerified}
                className="btn-glacier-primary h-10 px-6 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title={!isVerified ? 'Please verify your WhatsApp number first' : 'Register your squad'}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Registering Team...</span>
                  </>
                ) : (
                  <span>Register Team</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
