import { z } from 'zod';

export const archiveIdentitySchema = z.object({
  shinobi_recordings_entry: z.string().regex(/^[A-Za-z0-9_-]+$/),
  shinobi_recordings_monitor: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

export type ArchiveIdentity = z.infer<typeof archiveIdentitySchema>;
