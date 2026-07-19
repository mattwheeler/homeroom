import { z } from "zod";

export const studentExternalLinkPolicySchema = z.enum(["guardian_approval", "blocked"]);

export type StudentExternalLinkPolicy = z.infer<typeof studentExternalLinkPolicySchema>;

export interface StudentOutboundResource {
  available: boolean;
  policy: StudentExternalLinkPolicy;
}

export function studentOutboundResource(
  available: boolean,
  policy: StudentExternalLinkPolicy
): StudentOutboundResource {
  return { available, policy: studentExternalLinkPolicySchema.parse(policy) };
}
