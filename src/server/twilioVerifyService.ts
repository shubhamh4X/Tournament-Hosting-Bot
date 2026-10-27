import crypto from 'crypto';
import twilio from 'twilio';
import { TournamentRegion } from '../types/tournament';

export interface VerifiedSession {
  token: string;
  phoneNumber: string; // E.164 format
  region: TournamentRegion;
  verifiedAt: number;
  expiresAt: number;
  consumed: boolean;
  consumedAt?: number;
}

interface RateLimitRecord {
  requests: number[];
  lastRequestTime: number;
  attempts: number;
}

class TwilioVerifyService {
  private client: twilio.Twilio | null = null;
  private accountSid: string = '';
  private authToken: string = '';
  private verifyServiceSid: string = '';

  // In-memory verification sessions: token -> VerifiedSession
  private verificationSessions = new Map<string, VerifiedSession>();

  // In-memory rate limiting and cooldowns
  private phoneRateLimits = new Map<string, RateLimitRecord>();
  private ipRateLimits = new Map<string, number[]>();

  // Cleanup interval for expired records (15 minutes TTL)
  private cleanupInterval: NodeJS.Timeout | null = null;

  private readonly SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
  private readonly MAX_PHONE_REQUESTS_PER_HOUR = 5;
  private readonly MAX_IP_REQUESTS_PER_HOUR = 15;
  private readonly MAX_VERIFY_ATTEMPTS = 5;

  constructor() {
    this.refreshCredentials();

    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);

    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  public refreshCredentials(): boolean {
    this.accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    this.authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    this.verifyServiceSid = (process.env.TWILIO_VERIFY_SERVICE_SID || '').trim();

    if (this.accountSid && this.authToken && this.verifyServiceSid) {
      try {
        this.client = twilio(this.accountSid, this.authToken);
        return true;
      } catch (err: any) {
        console.error('[TwilioVerify] Failed to initialize Twilio client:', err?.message || err);
        this.client = null;
        return false;
      }
    } else {
      this.client = null;
      return false;
    }
  }

  public isConfigured(): boolean {
    return Boolean(this.client && this.verifyServiceSid);
  }

  public getConfigStatus(): {
    configured: boolean;
    hasAccountSid: boolean;
    hasAuthToken: boolean;
    hasVerifyServiceSid: boolean;
  } {
    return {
      configured: this.isConfigured(),
      hasAccountSid: Boolean(this.accountSid),
      hasAuthToken: Boolean(this.authToken),
      hasVerifyServiceSid: Boolean(this.verifyServiceSid)
    };
  }

  /**
   * Cleans up expired verification sessions and old rate limit timestamps.
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();

    for (const [token, session] of this.verificationSessions.entries()) {
      if (now > session.expiresAt) {
        this.verificationSessions.delete(token);
      }
    }

    const oneHourAgo = now - 60 * 60 * 1000;
    for (const [phone, record] of this.phoneRateLimits.entries()) {
      record.requests = record.requests.filter(ts => ts > oneHourAgo);
      if (record.requests.length === 0 && now - record.lastRequestTime > 60 * 60 * 1000) {
        this.phoneRateLimits.delete(phone);
      }
    }

    for (const [ip, timestamps] of this.ipRateLimits.entries()) {
      const valid = timestamps.filter(ts => ts > oneHourAgo);
      if (valid.length === 0) {
        this.ipRateLimits.delete(ip);
      } else {
        this.ipRateLimits.set(ip, valid);
      }
    }
  }

  /**
   * Check rate limits and resend cooldown before dispatching an OTP.
   */
  private checkRateLimits(phone: string, ip: string): { allowed: boolean; error?: string; cooldownSeconds?: number } {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // IP rate limit
    const ipRequests = (this.ipRateLimits.get(ip) || []).filter(ts => ts > oneHourAgo);
    if (ipRequests.length >= this.MAX_IP_REQUESTS_PER_HOUR) {
      return {
        allowed: false,
        error: 'Too many OTP requests from this network. Please wait before trying again.'
      };
    }

    // Phone rate limit and cooldown
    const phoneRecord = this.phoneRateLimits.get(phone) || { requests: [], lastRequestTime: 0, attempts: 0 };
    phoneRecord.requests = phoneRecord.requests.filter(ts => ts > oneHourAgo);

    const timeSinceLast = now - phoneRecord.lastRequestTime;
    if (phoneRecord.lastRequestTime > 0 && timeSinceLast < this.RESEND_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((this.RESEND_COOLDOWN_MS - timeSinceLast) / 1000);
      return {
        allowed: false,
        cooldownSeconds: remainingSeconds,
        error: `Please wait ${remainingSeconds}s before requesting a new WhatsApp OTP code.`
      };
    }

    if (phoneRecord.requests.length >= this.MAX_PHONE_REQUESTS_PER_HOUR) {
      return {
        allowed: false,
        error: 'Maximum hourly OTP requests reached for this phone number. Please try again later.'
      };
    }

    return { allowed: true };
  }

  /**
   * Initiates real WhatsApp OTP delivery via Twilio Verify API.
   */
  public async sendWhatsAppOtp(
    toPhoneE164: string,
    ipAddress: string
  ): Promise<{
    success: boolean;
    status?: string;
    cooldownSeconds?: number;
    error?: string;
    code?: string;
  }> {
    if (!this.isConfigured()) {
      this.refreshCredentials();
    }

    if (!this.isConfigured() || !this.client) {
      return {
        success: false,
        code: 'TWILIO_NOT_CONFIGURED',
        error: 'WhatsApp verification service is not configured on the server. Please ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID are set in environment variables.'
      };
    }

    const rateCheck = this.checkRateLimits(toPhoneE164, ipAddress);
    if (!rateCheck.allowed) {
      return {
        success: false,
        code: 'RATE_LIMITED',
        cooldownSeconds: rateCheck.cooldownSeconds,
        error: rateCheck.error
      };
    }

    try {
      // Record rate limit attempt
      const now = Date.now();
      const phoneRecord = this.phoneRateLimits.get(toPhoneE164) || { requests: [], lastRequestTime: 0, attempts: 0 };
      phoneRecord.requests.push(now);
      phoneRecord.lastRequestTime = now;
      phoneRecord.attempts = 0; // reset verify attempts for new OTP cycle
      this.phoneRateLimits.set(toPhoneE164, phoneRecord);

      const ipList = this.ipRateLimits.get(ipAddress) || [];
      ipList.push(now);
      this.ipRateLimits.set(ipAddress, ipList);

      // Call Twilio Verify v2 API with channel 'whatsapp'
      const verification = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({
          to: toPhoneE164,
          channel: 'whatsapp'
        });

      console.log(`[TwilioVerify] WhatsApp OTP initiated for ${toPhoneE164.slice(0, 5)}*** Status: ${verification.status}`);

      return {
        success: true,
        status: verification.status,
        cooldownSeconds: 60
      };
    } catch (err: any) {
      console.error(`[TwilioVerify] Error sending WhatsApp OTP to ${toPhoneE164.slice(0, 5)}***:`, err?.message || err);

      let userErrorMessage = 'Failed to deliver WhatsApp verification code. Please verify your phone number and try again.';
      let errorCode = 'PROVIDER_ERROR';

      if (err?.code === 60200 || err?.code === 21211) {
        userErrorMessage = 'Invalid phone number format for WhatsApp delivery. Please check country code and number.';
        errorCode = 'INVALID_PHONE_NUMBER';
      } else if (err?.code === 60203) {
        userErrorMessage = 'Max send attempts reached for this number. Please wait before retrying.';
        errorCode = 'MAX_ATTEMPTS_EXCEEDED';
      } else if (err?.code === 60223) {
        userErrorMessage = 'WhatsApp delivery is not enabled for this Twilio Verify Service. Please enable the WhatsApp channel in your Twilio Console.';
        errorCode = 'WHATSAPP_CHANNEL_DISABLED';
      } else if (err?.code === 20429) {
        userErrorMessage = 'Twilio API rate limit exceeded. Please try again shortly.';
        errorCode = 'PROVIDER_RATE_LIMIT';
      } else if (err?.code === 20003) {
        userErrorMessage = 'Twilio authentication failed. Please check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.';
        errorCode = 'AUTHENTICATION_FAILED';
      } else if (err?.message) {
        userErrorMessage = err.message;
      }

      return {
        success: false,
        code: errorCode,
        error: userErrorMessage
      };
    }
  }

  /**
   * Verifies the OTP code submitted by the user through Twilio Verify API.
   * If approved, generates a secure, short-lived verification token bound to this phone number.
   */
  public async verifyWhatsAppOtp(
    toPhoneE164: string,
    code: string,
    region: TournamentRegion
  ): Promise<{
    success: boolean;
    verificationToken?: string;
    error?: string;
    code?: string;
  }> {
    if (!this.isConfigured()) {
      this.refreshCredentials();
    }

    if (!this.isConfigured() || !this.client) {
      return {
        success: false,
        code: 'TWILIO_NOT_CONFIGURED',
        error: 'WhatsApp verification service is not configured on the server.'
      };
    }

    const cleanCode = (code || '').trim();
    if (!cleanCode || !/^\d{4,8}$/.test(cleanCode)) {
      return {
        success: false,
        code: 'INVALID_CODE_FORMAT',
        error: 'Please enter a valid verification code (numbers only).'
      };
    }

    const phoneRecord = this.phoneRateLimits.get(toPhoneE164);
    if (phoneRecord) {
      phoneRecord.attempts = (phoneRecord.attempts || 0) + 1;
      if (phoneRecord.attempts > this.MAX_VERIFY_ATTEMPTS) {
        return {
          success: false,
          code: 'TOO_MANY_FAILED_ATTEMPTS',
          error: 'Too many incorrect attempts. Please request a new verification code.'
        };
      }
    }

    try {
      const check = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({
          to: toPhoneE164,
          code: cleanCode
        });

      if (check.status === 'approved') {
        // Generate a cryptographically secure token
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();

        const session: VerifiedSession = {
          token,
          phoneNumber: toPhoneE164,
          region,
          verifiedAt: now,
          expiresAt: now + this.SESSION_TTL_MS,
          consumed: false
        };

        this.verificationSessions.set(token, session);

        // Reset failed attempt count
        if (phoneRecord) {
          phoneRecord.attempts = 0;
        }

        console.log(`[TwilioVerify] Verified WhatsApp number ${toPhoneE164.slice(0, 5)}*** successfully. Token issued.`);

        return {
          success: true,
          verificationToken: token
        };
      } else {
        return {
          success: false,
          code: 'INVALID_OR_EXPIRED_CODE',
          error: 'Incorrect or expired verification code. Please check your WhatsApp and try again.'
        };
      }
    } catch (err: any) {
      console.error(`[TwilioVerify] Error verifying code for ${toPhoneE164.slice(0, 5)}***:`, err?.message || err);

      let userMsg = 'Failed to verify WhatsApp code. Please check the code and try again.';
      let errCode = 'VERIFICATION_FAILED';

      if (err?.code === 60200 || err?.code === 20404) {
        userMsg = 'No active verification found or the code has expired. Please request a new code.';
        errCode = 'VERIFICATION_EXPIRED';
      } else if (err?.code === 60202) {
        userMsg = 'Max verification check attempts reached. Please request a new code.';
        errCode = 'MAX_CHECK_ATTEMPTS';
      }

      return {
        success: false,
        code: errCode,
        error: userMsg
      };
    }
  }

  /**
   * Atomically validates and consumes the verification token during final registration.
   * Ensures the token is strictly bound to the exact normalized phone number and has not been reused.
   */
  public consumeVerificationToken(
    token: string,
    expectedPhoneE164: string
  ): { valid: boolean; error?: string; code?: string; session?: VerifiedSession } {
    if (!token || typeof token !== 'string') {
      return {
        valid: false,
        code: 'MISSING_VERIFICATION_TOKEN',
        error: 'WhatsApp number verification is required before finalizing registration.'
      };
    }

    const session = this.verificationSessions.get(token);
    if (!session) {
      return {
        valid: false,
        code: 'INVALID_VERIFICATION_TOKEN',
        error: 'Verification session not found or expired. Please verify your WhatsApp number again.'
      };
    }

    if (session.consumed) {
      return {
        valid: false,
        code: 'VERIFICATION_TOKEN_REUSED',
        error: 'This WhatsApp verification token has already been used for a registration attempt. Please re-verify.'
      };
    }

    if (Date.now() > session.expiresAt) {
      this.verificationSessions.delete(token);
      return {
        valid: false,
        code: 'VERIFICATION_TOKEN_EXPIRED',
        error: 'WhatsApp verification session has expired. Please request a new verification code.'
      };
    }

    // Strict number matching (E.164 normalization check)
    const cleanExpected = expectedPhoneE164.trim().replace(/[\s\-()]/g, '');
    const cleanSession = session.phoneNumber.trim().replace(/[\s\-()]/g, '');

    if (cleanSession !== cleanExpected) {
      return {
        valid: false,
        code: 'PHONE_NUMBER_MISMATCH',
        error: `Verified phone number does not match submitted registration phone number. Verified: ${session.phoneNumber}, Submitted: ${expectedPhoneE164}`
      };
    }

    // Atomically consume token
    session.consumed = true;
    session.consumedAt = Date.now();

    return {
      valid: true,
      session
    };
  }

  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.verificationSessions.clear();
  }
}

export const twilioVerifyService = new TwilioVerifyService();
