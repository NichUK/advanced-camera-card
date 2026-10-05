import { z } from 'zod';

export const archiveIdentitySchema = z.object({
  shinobi_recordings_entry: z.string().regex(/^[A-Za-z0-9_-]+$/),
  shinobi_recordings_monitor: z.string().regex(/^[A-Za-z0-9_-]+$/),
  shinobi_recordings_timezone: z.string().optional(),
});
export type ArchiveIdentity = z.infer<typeof archiveIdentitySchema>;

export const clipIdentifierSchema = z
  .tuple([
    z.literal('media-source://shinobi_recordings/clip'),
    z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    z.string().regex(/^v1-[0-9a-f]{64}$/),
    z
      .string()
      .regex(/^-?\d+(?:\.\d{1,6})?$/)
      .transform(Number),
    z
      .string()
      .regex(/^-?\d+(?:\.\d{1,6})?$/)
      .transform(Number),
  ])
  .refine(
    (parts) =>
      parts[4] < parts[5] &&
      Math.abs(parts[4]) < 8.64e12 &&
      Math.abs(parts[5]) < 8.64e12,
  );
