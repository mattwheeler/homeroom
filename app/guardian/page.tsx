import type { Metadata } from "next";

import { GuardianSetupWorkspace } from "../components/guardian-setup";

export const metadata: Metadata = {
  title: "Guardian setup — Homeroom",
  description: "Parent-owned learning, safety, privacy, and school-source controls for Homeroom."
};

export default function GuardianPage() {
  return <GuardianSetupWorkspace />;
}
