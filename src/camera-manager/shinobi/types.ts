import { z } from 'zod';

const componentIDSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const archiveIdentitySchema = z.object({
  shinobi_recordings_entry: componentIDSchema,
  shinobi_recordings_monitor: componentIDSchema,
  shinobi_recordings_timezone: z.string().min(1).optional(),
});
export type ArchiveIdentity = z.infer<typeof archiveIdentitySchema>;

export const clipIdentifierSchema = z
  .tuple([
    z.literal('media-source://shinobi_recordings/clip'),
    componentIDSchema,
    componentIDSchema,
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
