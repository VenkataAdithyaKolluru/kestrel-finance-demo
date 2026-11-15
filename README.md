# Kestrel Finance demo

A Next.js App Router prototype for demonstrating loan operations, governance, and cost observability. All applicants, financial values, uploaded statements, and ledger entries are for demo purposes.

## Run locally

Requirements: Node.js 20.9 or newer.

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm run typecheck` checks TypeScript, `npm run build` creates the production build, and `npm start` serves it.

## Replay the walkthrough

1. Choose **User** at sign-in. The Relationship Manager lands in **My work**, with only new submissions and document follow-up assigned to that role. Use **All applications** for shared status visibility across the full synthetic pipeline.
2. Select **Review & accept** on a new submission to accept it and begin **Document intake**. Request bank, GSTR-1, and GSTR-3B statements, upload PDFs, or choose **Use demo sample packet** for synthetic 12-month coverage. The sample packet does not hand the file off automatically: RM must click **Verify & hand off complete documents** after complete coverage is available. Incomplete files stay in RM follow-up. Choose a reason to draft an editable email. Run the Critic again after edits, then use **Send demo email** to record a simulated send to a `@demo.kestrelfinance.test` address; no provider is contacted.
3. Switch the **Workspace** dropdown to **Analyst** after RM document verification. Only RM-verified files appear in the Analyst queue and studio. Review document coverage, run the demo spreading, inspect the agent/Critic indicators, check the promoter bureau score, request a Critic-checked cash-flow summary, save notes, and explicitly approve **Verify & move to Credit Manager**. The handoff is blocked unless complete 12-month coverage is verified by RM, spreading has run and passed Critic verification, the promoter bureau check is completed, a Critic-verified cash-flow summary is generated, and Analyst confirmation is checked.
4. Switch the dropdown to **Credit Manager**. Only files with full Analyst approval appear in the pending decision queue and dossier selector. Inspect the pending-decision count, dossier, spreading analysis, bureau score, cash-flow summary, and document coverage; draft a Critic-checked customer email if needed, then enter the manager name, choose **Approve** or **Decline**, enter any non-empty demo password, and submit the decision. The decision form closes after recording, and a decided application is locked. An approved application shows a separate final Credit Officer disbursement confirmation. Demo passwords are not authenticated or stored and do not authorize a real transaction.
5. Sign out and choose **Owner** to inspect the separate Owner console: demo SLA metrics, per-application and per-action costs, the searchable audit ledger, and model/policy settings.
6. Select **Reset demo** at any time to restore seeded applications/settings and clear FinOps and document state; the audit ledger records the reset event.

Workspaces have persona-specific URLs: `/rm/work`, `/rm/applications`, `/rm/intake`, `/analyst/work`, `/analyst/applications`, `/analyst/studio`, `/approver/work`, `/approver/applications`, `/approver/dossier`, and `/owner/console`. Each user defaults to **My work**, which contains only that role's actionable queue. Selecting an assigned application opens its role work page directly and preserves the application in the URL. **All applications** shows shared pipeline status across every stage; handoffs and completed files remain visible but are not presented as open tasks for the current role. RM sees new submissions and document follow-up; Analyst sees only applications after RM uploads and confirms complete 12-month coverage; Credit Manager sees only applications after Analyst completes and approves all review checks, Critic verification, and explicit Analyst handoff. After handoff, the completed file is removed from the previous role's work queue. The Owner console shows the whole portfolio, search/filter controls, and a selectable application detail view in addition to governance and FinOps data. The **User** sign-in starts in the RM workspace; the role dropdown switches between RM, Analyst, and Credit Manager. Each role handoff requires an explicit action. Owner remains a separate sign-in and can draft governance, audit, and cost updates. Sign-in is not real authentication. Sensitive API operations check the demo cookie against a per-route access policy. Most API handlers simulate processing latency.

## What the prototype demonstrates

- Process-local TypeScript storage for applications, uploaded-document metadata/text, mock spreading results, configuration, FinOps, and audit events.
- PDF upload with a 12 MiB/60-page limit, local searchable-text extraction and bundled English OCR for image-only pages, rolling 12-month coverage checks for bank/GSTR-1/GSTR-3B, PII tokenization, and prompt-injection pattern blocking. OCR does not call an external service or send documents outside the local server.
- PDF.js page rendering with text-item coordinates and Tesseract word-level OCR boxes. A spreading row is highlighted only when its exact synthetic amount is found on an uploaded statement; OCR-based highlights display the recognition confidence.
- Role-gated API workflows for intake, analyst extraction/summary/notes, credit-manager decisions, and Owner observability/configuration.
- Synthetic extraction and critic arithmetic checks, configurable manual-review fallback, model/prompt/policy settings, per-action cost estimates, audit categories, and executive demo metrics.
- Analyst and Credit Manager views include arithmetic cash-flow indicators (monthly average credits, cash retained, debit-to-credit ratio, and GST/bank variance), coverage and Critic review flags, and a reminder that those checks are not a credit recommendation.
- Analyst review shows the applicant business/contact, requested amount, demo email/address, and promoter/guarantor. The **Check CIBIL score · demo** search action creates a synthetic promoter score and marks the check with a timestamp; it does not call CIBIL or another bureau.
- Critic checks are recorded for intake completeness, synthetic extraction, summary, and editable email drafts. The Analyst explicitly confirms human review before handoff; the Credit Manager submits a name, decision, and non-empty demo password to record the final decision. Confidence percentages are illustrative deterministic demo scores, not calibrated model probabilities.
- Role-specific email reasons include missing statements, intake confirmation, statement clarification, review status, decision outcome, next steps, and owner governance/FinOps summaries. A changed draft must be Critic-checked again. Demo sends are restricted to `.test` addresses and written to the audit ledger only.

## Prototype boundaries

- This is not a production deployment or real credit system. User/Owner selection is a demo cookie, not authentication; the non-empty decision/disbursement password fields are demo-only prompts and do not authenticate or authorize a user. Password values are not stored. There is no identity provider, tenant boundary, or production authorization.
- No LLM is called. Extraction and summary values are synthetic/deterministic, the fallback is configuration-driven rather than triggered by a real provider timeout/rate limit, and token counts/costs are estimates rather than vendor usage telemetry.
- Customer contact details and bureau scores shown in the workspace are synthetic fixtures. A production commercial-loan review needs an authorized commercial bureau integration and appropriate consented promoter/guarantor checks; the demo score is not a real bureau result or credit decision.
- Email drafts and demo send records are role-specific and Critic-checked but are not connected to an email provider. "Send demo email" only records a simulated send in the in-memory audit ledger; it never transmits a message.
- Coverage is inferred from searchable/OCR text and month labels, not document classification or semantic validation. OCR is English-only and can misread scans; page/word coordinates are derived from PDF.js or OCR, but the prototype's financial values are still synthetic and are not extracted from the uploaded statements.
- A highlight is produced only when the exact synthetic amount can be matched to the uploaded PDF's text/OCR. If there is no exact match, no citation is shown. OCR confidence is indicative, not a financial-data accuracy guarantee.
- Raw PDF bytes are not retained after the request, but tokenized extracted text, text positions, and the in-memory PII token mapping remain until reset or server restart. Use synthetic files only.
- The store is in-memory, resets on server restart, and is not shared across instances. The audit ledger is not durable, cryptographically immutable, or tamper-proof; the demo reset endpoint clears it.
- The PDF upload flow does not provide production malware scanning, document classification, Azure hosting, or durable encrypted storage. Decision names are user-supplied demo signatures, not authenticated or legally binding.

Use synthetic files and data only. Do not upload real customer documents or personal information.
