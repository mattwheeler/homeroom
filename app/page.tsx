import type { Metadata } from "next";

import { AccountEntry } from "./components/account-entry";

export const metadata: Metadata = {
  title: "Choose your Homeroom space",
  description: "Open the student or guardian Homeroom workspace."
};

export default function HomePage() {
  return <AccountEntry />;
}
