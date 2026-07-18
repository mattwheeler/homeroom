import { HomeroomDemo } from "./components/homeroom-demo";
import { bandCampV1, courseFixtures, emilyFixture } from "../lib/domain/fixtures";

export default function HomePage() {
  return <HomeroomDemo student={emilyFixture} courses={courseFixtures} bandCamp={bandCampV1} />;
}
