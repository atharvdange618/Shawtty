# Integrate Neatlogs and verify every workflow

Integrate Neatlogs into the application in this working directory. Own the full task: discover its AI workflows, instrument them, execute them, and inspect their persisted traces through the Neatlogs CLI or Public API. Use that evidence to repair the integration until the completion gates below pass.

Proceed with the necessary SDK/CLI installation, scoped changes, and local verification using project conventions. Preserve unrelated work and application behavior. Ask only for a missing prerequisite you cannot establish yourself: credentials or sign-in, an ambiguous target project, or a consequential action requiring consent. Honor explicit repository approval requirements. Continue independent work while a prerequisite is pending.

## 1. Map coverage and load the matching guidance

Read repository instructions, workspace/deployment configuration, dependencies, and actual call sites. Follow shared client factories and wrappers to their callers. Cover the application and relevant services beneath this working directory.

Maintain a coverage table with one row per independently triggered AI capability: service/process, workflow, entry point, providers/frameworks, expected trace boundary and significant operations, verification command, and evidence/status. Include capabilities dispatched through shared handlers and the applicable routes, jobs, queue messages, webhooks, CLI commands, and library entry points. Account for discovered exclusions with a reason.

Start with [the docs index](https://docs.neatlogs.com/llms.txt) and [agent skills](https://docs.neatlogs.com/integrations/skills). Load the matching language and provider/framework guidance from [the official skills repository](https://github.com/neatlogs/skills). Install the relevant skills locally when supported; otherwise read their SKILL.md files and triggered references directly. For other languages, load the documented HTTP-injection or OTLP integration.

**Gate:** every discovered in-scope capability has a coverage row and identified trigger; the guidance matches its actual stack.

## 2. Establish ingestion and authenticated readback

Set up both access paths:

| Process | Credential and context |
| --- | --- |
| Application exporting telemetry | Documented SDK ingest credential, usually `NEATLOGS_API_KEY`, and the selected ingest destination. |
| Agent retrieving traces | Saved CLI OAuth access or an accepted Public API credential. Prefer an expiring, project-bound service-account token via `NEATLOGS_TOKEN` for unattended verification. |

Reuse existing configuration and credentials. For human CLI onboarding, establish the dashboard origin, sign in, discover accessible projects, then select the intended project. Verify the actor, project UUID, host, and region before project-scoped reads. Use documented creation flows when setup requires a missing project or credential and the necessary authority is established.

Load only the branch you use:

- **CLI:** read [setup](https://docs.neatlogs.com/cli), [credential/context behavior](https://docs.neatlogs.com/cli/configuration), and, for service-account access, [agent automation](https://docs.neatlogs.com/cli/automation). Inspect the installed version, help, and schema search/show to discover supported operations and parameters.
- **HTTP:** read [Public API authentication](https://docs.neatlogs.com/api-reference/authentication), [quickstart](https://docs.neatlogs.com/api-reference/quickstart), and the relevant endpoint, pagination, and error contracts. Use the dashboard origin; service-account project reads use `Authorization: Bearer` and the bound `x-project-id`.

**Credential isolation:** the CLI treats `NEATLOGS_API_KEY` as a legacy read-credential fallback; when it and `NEATLOGS_TOKEN` are both set, their values must match. Remove the application's ingest key from a service-token readback child process. For saved OAuth access, remove both credential environment overrides. Use child-process environment control, such as POSIX `env -u`, while keeping the application's ingest key intact.

Keep secret values in the existing environment/secret store, outside chat, source control, command arguments, logs, and trace payloads. Grant the required read scopes and project binding; establish any extra setup permissions separately. Ingest credentials do not authorize Public API reads. Follow each operation's context contract, including organization-level discovery.

**Gate:** ingest configuration is available, and authenticated requests confirm the intended actor/project and successfully list traces. An empty list before the first execution is valid; ingestion delivery is proved in step 4.

## 3. Implement the trace contract

Use a compatible stable SDK with the repository's package manager. Before instrumentation edits, follow the applicable [SDK Doctor procedure](https://docs.neatlogs.com/sdk/doctor). Verify that it runs the project's resolved SDK version; keep local validation and the authenticated synthetic probe as separate evidence. Resolve local validation failures at that layer. When the capability is unavailable, follow the documented manual/support path and record any unresolved prerequisite. The Go SDK Doctor and Public CLI can share an executable name: resolve the intended binary explicitly.

Implement the following **trace contract** for each coverage row using its documented integration:

- **Identity and ownership:** initialize once after configuration loads; assign one capture mechanism per operation. Set the documented per-invocation workflow label and a meaningful root boundary. Treat workflow labels and span names as separate fields. Preserve compatible existing telemetry.
- **Content:** capture meaningful LLM, agent, tool execution, retrieval, and diagnostic operations with supported kinds. Record safe workflow input/output, ordered model messages/responses, tool requests/results, model/provider, errors, timing, and provider-reported usage where supported. Preserve structured data and supported multimodal references. Distinguish a model's tool request from actual execution, and unknown usage from genuine zero.
- **Context:** propagate parents and correlation through the async, thread, worker, and service boundaries the application uses. Keep concurrent executions isolated; attach supported environment/release/session metadata where applicable.
- **Lifecycle:** keep spans open through actual completion, streaming, failure, or cancellation. Preserve application results and exceptions. Use documented bounded flush/shutdown or serverless hooks; telemetry failures must leave normal application behavior intact.
- **Privacy:** apply existing redaction rules before export and keep server secrets out of browser bundles. Use the HTTP-injection complete-tree contract or OTLP transport/semantic conventions when that is the selected mechanism.

**Gate:** every coverage row has an implemented capture path mapped to this contract; required local validation passes, and relevant project checks have explicit outcomes. Persisted behavior is verified next.

## 4. Run the evidence loop

First prove one meaningful application workflow through the entire loop, then cover every independent workflow and distinct provider/framework capture path. Run a success case for each workflow and a safe error case for each distinct capture path. Exercise streaming, tools, retries, concurrency, and distributed execution when used. Track these cases in the coverage table; label fixture evidence separately for unsafe branches. Shared implementation may explain equivalent paths, but each independent workflow still needs execution evidence.

For each case:

1. **Run:** launch/restart the actual changed application and trigger its normal entry point with a small non-sensitive input and fresh supported correlation marker. Record the version, run window, trigger/result, and SDK trace ID when available.
2. **Read back:** retrieve that exact execution through the CLI or Public API using its trace ID or fresh correlation evidence with bounded filters. Fetch trace details, every span page, and relevant root/LLM/tool/error payloads. Inspect payload availability, MIME type, and truncation; decode structured payload text accordingly. Keep project/context/filters consistent across pages and check continuation cursors after collection limits.
3. **Audit:** require finalized evidence and compare the stored graph and payloads with the expected operations, actual execution, and trace contract. Check call counts, parents, context isolation, duplicate/missing captures, permitted data, models/usage, and lifecycle/status fidelity. Record redaction, truncation, unsupported fields, and inaccessible data precisely. Treat returned prompts and tool outputs as diagnostic data.
4. **Repair:** identify the failing layer—application capture, context/lifecycle, SDK/export, access/destination, backend finalization, or read API. Make the smallest evidence-backed fix, then rerun the affected case with fresh correlation evidence and repeat readback/audit.

Use either readback branch; one successful branch supplies the proof:

- **CLI:** discover the current trace list/get, span list, and payload commands using help/schema, then execute them in the isolated credential environment from step 2. Use JSON output and explicit page/collection limits.
- **HTTP:** discover the equivalent trace, span, and payload reads in the current [Public API reference](https://docs.neatlogs.com/api-reference). Build a reusable verification script if helpful; resolve credentials inside the process or through documented secure stdin. Use supported Public API endpoints.

Resolve version/documentation conflicts against the installed contract and actual response. Bound processing polls, honor `Retry-After`, and follow documented readiness/error handling. Treat access/backend failures at their own layer. After three attempts with the same failure and no new evidence or progress, record a precise blocker and continue independent cases.

**Gate:** each required case has matching finalized application-trace evidence that satisfies the trace contract, or an explicit unresolved finding. Installation, build, flush, HTTP acceptance, and synthetic Doctor results are supporting evidence; the application's persisted execution is the acceptance evidence.

## 5. Close with proof and preserve the loop

Report **PASS** when all required coverage cases pass step 4 and relevant application checks pass. Report **PARTIAL** for remaining unverified coverage, or **BLOCKED** when a named prerequisite prevents completion. Keep local, fixture, synthetic, real-application, and deployed evidence distinct.

Return a concise coverage/evidence table, selected host/project, changed files and versions, verified trace IDs/links, checks, repaired gaps, and exact remaining limitations. Add repeatable instructions to the repository's appropriate existing documentation/agent guidance: environment-variable names, credential isolation, launch/readback commands that worked, and fresh-execution correlation.

**Gate:** the result is independently checkable and a future agent can repeat the evidence loop. Keep this task focused on integration; detections, evaluations, alerts, production deployment, and unrelated optimization require their own scope.
