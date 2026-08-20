import { z } from "zod";

/**
 * Auth request-body schemas. Phone gets only shape limits here — full
 * normalization/validation happens in the auth service so responses
 * stay generic. OTP shape is validated strictly (6 digits) to avoid
 * wasting challenge attempts on obviously malformed input.
 */

export const otpRequestSchema = z.object({
  phone: z.string().min(1).max(32),
  return_to: z.string().max(512).optional(),
});

export const otpResendSchema = z.object({
  challenge_id: z.uuid(),
});

export const otpVerifySchema = z.object({
  challenge_id: z.uuid(),
  otp: z.string().regex(/^[0-9]{6}$/, "OTP must be 6 digits"),
  return_to: z.string().max(512).optional(),
});
