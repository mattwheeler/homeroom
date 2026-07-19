import type { Metadata } from "next";

import { StudentHome } from "../components/student-home";
import { emilyFixture } from "../../lib/domain/fixtures";

export const metadata: Metadata = {
  title: "Emily's Homeroom",
  description: "A calm, connected school workspace for Emily."
};

export default function StudentPage() {
  return <StudentHome student={emilyFixture} />;
}
