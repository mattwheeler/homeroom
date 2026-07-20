# Homeroom Google Classroom sandbox seeder

This one-time Google Apps Script creates seven fictional Grade 9 classes, publishes fifteen assignments, and invites one personal Google account as the demo student. It uses Google's official Classroom API with interactive teacher authorization.

The seeder is intentionally separate from Homeroom's read-only OAuth application. Its teacher write permissions never become part of the student product, its source contains no client secret or token, and rerunning it reuses tagged classes and existing assignment titles.

## Setup

1. Sign in to [Google Apps Script](https://script.google.com/) using the personal Google account that will act as the sandbox teacher.
2. Create a new standalone project named `Homeroom Sandbox Seeder`.
3. In **Project Settings**, enable **Show "appsscript.json" manifest file in editor**.
4. Replace the editor's `Code.gs` and `appsscript.json` contents with the matching files from this directory.
5. In **Project Settings → Script Properties**, add:
   - Property: `HOMEROOM_DEMO_STUDENT_EMAIL`
   - Value: the separate personal Google account that will act as the fictional demo student.
6. Run `previewHomeroomSandbox` first. It performs no writes and lists the seven planned classes.
7. Run `seedHomeroomSandbox`. Review and approve the three teacher scopes when Google asks. For a personal Gmail teacher, this first pass creates all seven provisioned classes and logs the required acceptance step.
8. Open [Google Classroom](https://classroom.google.com/) as the sandbox teacher and click **Accept** on all seven provisioned class cards.
9. Run `seedHomeroomSandbox` again. This pass publishes all fifteen assignments and sends the student invitations.
10. Open Google Classroom as the demo student and accept every pending class invitation.
11. Add the demo student's personal account to the Homeroom Google Cloud project's OAuth test users.
12. Connect Google Classroom in Homeroom using the demo student account, then run **Sync now**.

## What it creates

- Seven active Grade 9 classes whose names map deterministically to Homeroom's seven Learning tracks.
- At least two published readiness assignments per class with bounded fictional descriptions and upcoming due dates, including one explicit source-backed guardian action for reminder testing.
- A paired `dueDate` and 23:59 UTC `dueTime` on every assignment, as required by the Classroom API.
- One student invitation per class.

The script does not delete or archive anything. A partial failure can be corrected and the function safely rerun; tagged courses and matching assignment titles are reused.

For personal `@gmail.com` teacher accounts, the script follows Google's required two-pass lifecycle: it creates each course as `PROVISIONED`, pauses for the teacher to accept the class cards in Classroom, then publishes coursework and sends student invitations on the next run.
