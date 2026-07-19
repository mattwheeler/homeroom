const HOMEROOM_SANDBOX_MARKER = "[HOMEROOM_SANDBOX_V1]";

const HOMEROOM_SANDBOX_CLASSES = [
  {
    name: "English I - Period 1",
    section: "Period 1",
    subject: "English Language Arts",
    room: "B104",
    assignments: [
      {
        title: "Summer Reading Reflection",
        description: "Write one paragraph identifying a central idea and one supporting detail from your summer reading.",
        dueDate: { year: 2026, month: 8, day: 17 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Evidence and Inference Organizer",
        description: "Complete the visual organizer by pairing three observations with reasonable inferences.",
        dueDate: { year: 2026, month: 8, day: 24 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      }
    ]
  },
  {
    name: "Algebra I - Period 2",
    section: "Period 2",
    subject: "Mathematics",
    room: "A112",
    assignments: [
      {
        title: "Balancing Equations Readiness Check",
        description: "Complete problems 1-5 and explain why the same operation must be applied to both sides.",
        dueDate: { year: 2026, month: 8, day: 18 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Linear Patterns Visual Warm-Up",
        description: "Use the supplied table to sketch a visual pattern and describe how it changes each step.",
        dueDate: { year: 2026, month: 8, day: 21 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      }
    ]
  },
  {
    name: "Biology - Period 3",
    section: "Period 3",
    subject: "Biology",
    room: "C208",
    assignments: [
      {
        title: "Lab Safety Visual Checklist",
        description: "Review the lab diagram and identify five safe choices and two hazards.",
        dueDate: { year: 2026, month: 8, day: 19 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Cells: Structure Preview",
        description: "Label the nucleus, membrane, cytoplasm, and mitochondria on a cell sketch.",
        dueDate: { year: 2026, month: 8, day: 25 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      }
    ]
  },
  {
    name: "World Geography - Period 4",
    section: "Period 4",
    subject: "World Geography",
    room: "D116",
    assignments: [
      {
        title: "Map Skills Warm-Up",
        description: "Use latitude, longitude, scale, and the compass rose to answer the five map questions.",
        dueDate: { year: 2026, month: 8, day: 20 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Regions and Resources Preview",
        description: "Choose one world region and create a two-column organizer for physical features and resources.",
        dueDate: { year: 2026, month: 8, day: 26 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      }
    ]
  },
  {
    name: "Spanish I - Period 5",
    section: "Period 5",
    subject: "Spanish",
    room: "B210",
    assignments: [
      {
        title: "Introductions: Me llamo...",
        description: "Write a four-line introduction using your name, age, one interest, and a greeting.",
        dueDate: { year: 2026, month: 8, day: 21 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Classroom Words Picture Match",
        description: "Match ten classroom vocabulary words to the correct picture.",
        dueDate: { year: 2026, month: 8, day: 27 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      }
    ]
  },
  {
    name: "Concert Band - Period 6",
    section: "Period 6",
    subject: "Band",
    room: "Fine Arts 101",
    assignments: [
      {
        title: "Band Camp Packing Checklist",
        description: "Confirm your instrument, music binder, water bottle, sunscreen, hat, lunch, and athletic shoes are ready.",
        dueDate: { year: 2026, month: 7, day: 31 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Instrument Care Readiness Check",
        description: "Complete the short readiness check for safe setup, cleaning, storage, and transport.",
        dueDate: { year: 2026, month: 8, day: 1 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Band Physical Form",
        description: "A parent or guardian must complete and sign the band physical form before camp. Ask them to review the official form with you.",
        dueDate: { year: 2026, month: 7, day: 24 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      }
    ]
  },
  {
    name: "Art I - Period 7",
    section: "Period 7",
    subject: "Visual Arts",
    room: "E103",
    assignments: [
      {
        title: "Visual Journal: Line and Shape",
        description: "Create one journal page using at least five line types and three geometric or organic shapes.",
        dueDate: { year: 2026, month: 8, day: 22 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      },
      {
        title: "Color Theory Photo Hunt",
        description: "Find and describe one real-world example each of complementary, analogous, and warm colors.",
        dueDate: { year: 2026, month: 8, day: 28 },
        maxPoints: 10,
        workType: "ASSIGNMENT",
        state: "PUBLISHED"
      }
    ]
  }
];

function previewHomeroomSandbox() {
  const preview = HOMEROOM_SANDBOX_CLASSES.map(function (course) {
    return { name: course.name, assignmentCount: course.assignments.length };
  });
  console.log(JSON.stringify({ classCount: preview.length, classes: preview }, null, 2));
  return preview;
}

function seedHomeroomSandbox() {
  const studentEmail = requireDemoStudentEmail_();
  const existingCourses = listOwnedMutableCourses_();
  const readyCourses = [];
  const pendingActivation = [];

  HOMEROOM_SANDBOX_CLASSES.forEach(function (definition) {
    let course = existingCourses.find(function (candidate) {
      return candidate.name === definition.name &&
        String(candidate.description || "").indexOf(HOMEROOM_SANDBOX_MARKER) >= 0;
    });
    let createdCourse = false;
    if (!course) {
      course = Classroom.Courses.create({
        name: definition.name,
        section: definition.section,
        subject: definition.subject,
        room: definition.room,
        ownerId: "me",
        courseState: "PROVISIONED",
        descriptionHeading: "Homeroom Build Week Sandbox",
        description: HOMEROOM_SANDBOX_MARKER + " Fictional Grade 9 data for testing Homeroom's read-only student experience."
      });
      existingCourses.push(course);
      createdCourse = true;
    }

    if (course.courseState === "PROVISIONED") {
      pendingActivation.push({
        className: definition.name,
        classroomUrl: course.alternateLink || "https://classroom.google.com/"
      });
      return;
    }
    if (course.courseState !== "ACTIVE") {
      throw new Error("Sandbox course is in an unsupported state: " + course.courseState);
    }
    readyCourses.push({ definition: definition, course: course, createdCourse: createdCourse });
  });

  if (pendingActivation.length > 0) {
    console.warn(JSON.stringify({
      seeded: false,
      provisionedClassCount: pendingActivation.length,
      actionRequired: "Open Google Classroom as the teacher, accept all provisioned class cards, then rerun seedHomeroomSandbox.",
      classes: pendingActivation
    }, null, 2));
    return pendingActivation;
  }

  const summary = readyCourses.map(function (ready) {
    const definition = ready.definition;
    const course = ready.course;

    const existingWork = listCourseWork_(course.id);
    let createdAssignments = 0;
    definition.assignments.forEach(function (assignment) {
      const exists = existingWork.some(function (item) { return item.title === assignment.title; });
      if (!exists) {
        const assignmentWithDeadline = buildCourseWork_(assignment);
        console.log("Creating coursework payload: " + JSON.stringify(assignmentWithDeadline));
        Classroom.Courses.CourseWork.create(assignmentWithDeadline, course.id);
        createdAssignments += 1;
      }
    });

    const invitation = ensureStudentInvitation_(course.id, studentEmail);
    return {
      className: definition.name,
      createdCourse: ready.createdCourse,
      createdAssignments: createdAssignments,
      studentAccess: invitation,
      classroomUrl: course.alternateLink || null
    };
  });

  console.log(JSON.stringify({
    seeded: true,
    classCount: summary.length,
    invitationReminder: "The demo student must accept all pending Classroom invitations.",
    classes: summary
  }, null, 2));
  return summary;
}

function requireDemoStudentEmail_() {
  const email = String(
    PropertiesService.getScriptProperties().getProperty("HOMEROOM_DEMO_STUDENT_EMAIL") || ""
  ).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Set a valid HOMEROOM_DEMO_STUDENT_EMAIL Script Property before seeding.");
  }
  return email;
}

function listOwnedMutableCourses_() {
  const courses = [];
  let pageToken;
  do {
    const page = Classroom.Courses.list({
      teacherId: "me",
      courseStates: ["ACTIVE", "PROVISIONED"],
      pageSize: 100,
      pageToken: pageToken
    });
    Array.prototype.push.apply(courses, page.courses || []);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return courses;
}

function buildCourseWork_(assignment) {
  return {
    title: assignment.title,
    description: assignment.description,
    dueDate: {
      year: assignment.dueDate.year,
      month: assignment.dueDate.month,
      day: assignment.dueDate.day
    },
    dueTime: {
      hours: 23,
      minutes: 59,
      seconds: 0,
      nanos: 0
    },
    maxPoints: assignment.maxPoints,
    workType: assignment.workType,
    state: assignment.state
  };
}

function listCourseWork_(courseId) {
  const work = [];
  let pageToken;
  do {
    const page = Classroom.Courses.CourseWork.list(courseId, {
      pageSize: 100,
      pageToken: pageToken
    });
    Array.prototype.push.apply(work, page.courseWork || []);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return work;
}

function ensureStudentInvitation_(courseId, studentEmail) {
  try {
    const student = Classroom.Courses.Students.get(courseId, studentEmail);
    if (student && student.userId) return "enrolled";
  } catch (error) {
    // A missing student is expected before the invitation is accepted.
  }

  const pending = Classroom.Invitations.list({ courseId: courseId, userId: studentEmail });
  if ((pending.invitations || []).length > 0) return "invited";
  Classroom.Invitations.create({
    courseId: courseId,
    userId: studentEmail,
    role: "STUDENT"
  });
  return "invited";
}
