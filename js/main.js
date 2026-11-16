/* ============================================================
   SQL Server Replication site — shared behaviour
   - sidebar nav (single source of truth)
   - breadcrumbs + prev/next
   - theme toggle
   - risk marker registry + popovers
   - T-SQL syntax highlighting + copy buttons
   - filterable tables (command matrix)
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- navigation model ---------------- */
  var NAV = [
    { head: null, items: [
      { page: "index", title: "Home", file: "index.html", icon: "🏠" }
    ]},
    { head: "Architecture", items: [
      { page: "architecture/overview",    title: "Component Overview", file: "architecture/overview.html" },
      { page: "architecture/publisher",   title: "Publisher",          file: "architecture/publisher.html" },
      { page: "architecture/distributor", title: "Distributor",        file: "architecture/distributor.html" },
      { page: "architecture/subscriber",  title: "Subscriber",         file: "architecture/subscriber.html" },
      { page: "architecture/agents",      title: "Replication Agents", file: "architecture/agents.html" }
    ]},
    { head: "Replication Types", items: [
      { page: "types/snapshot",      title: "Snapshot",      file: "types/snapshot.html" },
      { page: "types/transactional", title: "Transactional", file: "types/transactional.html" },
      { page: "types/merge",         title: "Merge",         file: "types/merge.html" },
      { page: "types/peer-to-peer",  title: "Peer-to-Peer",  file: "types/peer-to-peer.html" }
    ]},
    { head: "Setup & Install", items: [
      { page: "setup/prerequisites",         title: "Prerequisites",          file: "setup/prerequisites.html" },
      { page: "setup/configure-distributor", title: "1. Configure Distributor", file: "setup/configure-distributor.html" },
      { page: "setup/create-publication",    title: "2. Create Publication",    file: "setup/create-publication.html" },
      { page: "setup/create-subscription",   title: "3. Create Subscription",   file: "setup/create-subscription.html" },
      { page: "setup/scripting",             title: "Full T-SQL Script",      file: "setup/scripting.html" }
    ]},
    { head: "Monitoring", items: [
      { page: "monitoring/replication-monitor", title: "Replication Monitor", file: "monitoring/replication-monitor.html" },
      { page: "monitoring/tracer-tokens",       title: "Tracer Tokens",       file: "monitoring/tracer-tokens.html" },
      { page: "monitoring/dmvs-and-tables",     title: "DMVs, Procs & Tables",file: "monitoring/dmvs-and-tables.html" },
      { page: "monitoring/alerts",              title: "Alerts & Thresholds", file: "monitoring/alerts.html" },
      { page: "monitoring/performance",         title: "Performance & Latency", file: "monitoring/performance.html" }
    ]},
    { head: "Command Reference", items: [
      { page: "commands/index",                title: "Command Matrix",       file: "commands/index.html" },
      { page: "commands/publisher-commands",   title: "Publisher Commands",   file: "commands/publisher-commands.html" },
      { page: "commands/distributor-commands", title: "Distributor Commands", file: "commands/distributor-commands.html" },
      { page: "commands/subscriber-commands",  title: "Subscriber Commands",  file: "commands/subscriber-commands.html" },
      { page: "commands/agent-commands",       title: "Agent Jobs & Executables", file: "commands/agent-commands.html" }
    ]},
    { head: "Troubleshooting", items: [
      { page: "troubleshooting/discovery",       title: "1. Topology Discovery",   file: "troubleshooting/discovery.html" },
      { page: "troubleshooting/triage-workflow", title: "2. Incident Triage",      file: "troubleshooting/triage-workflow.html" },
      { page: "troubleshooting/is-it-moving",    title: "3. Is It Moving?",        file: "troubleshooting/is-it-moving.html" },
      { page: "troubleshooting/lsn-deep-dive",   title: "4. LSN Deep Dive",        file: "troubleshooting/lsn-deep-dive.html" },
      { page: "troubleshooting/common-errors",   title: "5. Common Errors",        file: "troubleshooting/common-errors.html" },
      { page: "troubleshooting/risk-areas",      title: "6. ⚠ Risk Checklist",     file: "troubleshooting/risk-areas.html" }
    ]}
  ];

  /* ---------------- risk registry ----------------
     Referenced from SVG markers via data-risk="id".
     Aggregated on troubleshooting/risk-areas.html.      */
  var RISKS = {
    "log-reader-latency": {
      title: "Log Reader latency blocks log truncation",
      sev: "high", comp: "pub",
      what: "The transaction log of a published database cannot be truncated past the oldest record the Log Reader Agent has not yet processed. If the Log Reader stops or falls behind, the log grows until the disk fills — even with frequent log backups.",
      symptom: "Publication database log file growing; log backups don't shrink used space; log_reuse_wait_desc = REPLICATION.",
      detect: "SELECT name, log_reuse_wait_desc FROM sys.databases WHERE name = 'YourPubDB';\nEXEC sp_replcounters;  -- replicated transactions + latency per published DB",
      action: "Check the Log Reader Agent job (history + msdb..sysjobs). If it is failing, fix the cause (permissions, broken log chain, huge transaction). Never truncate the log manually with sp_repldone unless Microsoft support guidance says so — it breaks the subscription chain."
    },
    "large-transactions": {
      title: "Single large transaction floods the pipeline",
      sev: "med", comp: "pub",
      what: "One UPDATE touching 10M rows becomes 10M individual replicated commands. The Log Reader must harvest them all, the distribution database swells, and the Distribution Agent replays them row by row at the Subscriber.",
      symptom: "Sudden latency spike; distribution DB growth; Distribution Agent 'delivering replicated transactions' for hours.",
      detect: "SELECT TOP 5 xact_seqno, count_commands = COUNT(*)\nFROM distribution.dbo.MSrepl_commands\nGROUP BY xact_seqno ORDER BY COUNT(*) DESC;",
      action: "Batch large maintenance DML at the Publisher (loop in chunks). For planned bulk loads, consider dropping/re-adding the article or reinitializing, or use MaxCmdsInTran on the Log Reader to split huge transactions into smaller batches."
    },
    "schema-changes": {
      title: "Schema changes / DDL on published articles",
      sev: "med", comp: "pub",
      what: "Most ALTER TABLE statements replicate automatically (with @replicate_ddl=1), but some operations (rebuilds that change identity, ALTER of filtered columns, dropping replicated columns used by filters) fail or invalidate subscriptions.",
      symptom: "Distribution Agent errors right after a deployment; 'Invalid column name' at Subscriber; snapshot invalidated.",
      detect: "-- recent DDL at the publisher\nSELECT TOP 20 * FROM msdb.dbo.sysjobhistory h\nJOIN msdb.dbo.sysjobs j ON j.job_id = h.job_id\nWHERE j.name LIKE '%LogReader%' ORDER BY h.instance_id DESC;",
      action: "Coordinate deployments with the replication team. Test DDL against a replicated copy first. After article-breaking changes, expect to run a new snapshot for affected articles."
    },
    "pub-db-log-chain": {
      title: "Restoring / detaching a published database",
      sev: "high", comp: "pub",
      what: "Restoring a published database from backup, or rebuilding the log, desynchronizes the LSN chain the Log Reader depends on. Replication metadata points at LSNs that no longer exist.",
      symptom: "Log Reader error 18768/18773 'The process could not execute sp_replcmds'; 'The specified LSN ... is invalid'.",
      detect: "DBCC OPENTRAN; -- oldest replicated transaction\nEXEC sp_repltrans; -- pending transactions not yet harvested",
      action: "If the log chain is broken, replication for that database usually must be dropped (sp_removedbreplication) and rebuilt with a new snapshot. Plan restores of published databases with the replication owner."
    },
    "dist-db-growth": {
      title: "Distribution database growth",
      sev: "high", comp: "dist",
      what: "MSrepl_commands and MSrepl_transactions keep every command until (a) all subscribers received it AND (b) retention allows cleanup. A down subscriber or a failing cleanup job makes the distribution DB grow without limit.",
      symptom: "distribution.mdf growing steadily; cleanup job long-running or failing; disk pressure on the Distributor.",
      detect: "EXEC distribution.dbo.sp_MSdistribution_counters;\nSELECT COUNT(*) FROM distribution.dbo.MSrepl_commands WITH (NOLOCK);",
      action: "Find the subscription holding retention back (Replication Monitor → undistributed commands). Fix or drop dead subscriptions. Verify the 'Distribution clean up: distribution' job runs and completes."
    },
    "cleanup-blocking": {
      title: "Distribution cleanup job blocking agents",
      sev: "med", comp: "dist",
      what: "The 'Distribution clean up' job deletes in batches from MSrepl_commands. On a bloated distribution DB the deletes escalate locks and block Log Reader/Distribution Agents, causing latency exactly when the system is already behind.",
      symptom: "Agents blocked (waiting on LCK_M_*); latency spikes every 10 minutes (default cleanup schedule).",
      detect: "SELECT r.session_id, r.blocking_session_id, r.wait_type, t.text\nFROM sys.dm_exec_requests r\nCROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\nWHERE r.blocking_session_id <> 0;",
      action: "Let cleanup catch up out of hours; consider shorter retention (@max_distretention) once backlog is resolved. Do not just disable the cleanup job — that trades blocking for unbounded growth."
    },
    "retention-expired": {
      title: "Subscription expiration (retention exceeded)",
      sev: "high", comp: "dist",
      what: "If a subscriber is unreachable longer than the publication retention period (default 336 h), the subscription is deactivated or expired, and cleanup removes commands it still needed. The only recovery is full reinitialization.",
      symptom: "Error 21074 'The subscription(s) have been marked inactive and must be reinitialized'; agent refuses to sync after an outage.",
      detect: "SELECT status, subscriber_id, * FROM distribution.dbo.MSsubscriptions; -- status 0=inactive,1=subscribed,2=active",
      action: "Monitor subscriber outages against retention. If expired: sp_reinitsubscription (or Reinitialize in SSMS) and run the Snapshot Agent — plan for snapshot delivery time and locks."
    },
    "distributor-spof": {
      title: "Distributor is a single point of failure",
      sev: "med", comp: "dist",
      what: "Every publication on every publisher that uses this Distributor stops flowing if the distribution server or distribution database is down. A remote distributor concentrates risk for many publishers.",
      symptom: "All publications latent at once; Log Readers cannot connect; msdb jobs failing on connection.",
      detect: "SELECT @@SERVERNAME, name, state_desc FROM sys.databases WHERE name = 'distribution';",
      action: "Back up the distribution database regularly (it is required for sync with backup topologies). Document which publishers depend on this distributor. Consider failover clustering / AG for the distributor in SQL 2017+."
    },
    "snapshot-share-perms": {
      title: "Snapshot folder permissions",
      sev: "high", comp: "agent",
      what: "The Snapshot Agent writes to the snapshot folder; Distribution/Merge Agents read from it. With pull subscriptions a local path (C:\\...) on the distributor is unreachable for the subscriber — it must be a UNC share with read access for agent accounts.",
      symptom: "Error 'The process could not read file ... .pre due to OS error 5 (access denied)' or '(The system cannot find the path specified)'.",
      detect: "EXEC sp_helpdistributor; -- shows the working directory\n-- test from subscriber: dir \\\\DIST\\ReplSnapshots",
      action: "Use a UNC path (\\\\server\\share). Grant the Snapshot Agent account WRITE and the Distribution/Merge agent accounts READ on both share and NTFS ACLs."
    },
    "snapshot-disk-space": {
      title: "Snapshot folder disk space & generation cost",
      sev: "med", comp: "agent",
      what: "A snapshot is a full BCP export of all published articles. Large publications produce many GB of .bcp files and hold locks (shared locks during generation for snapshot/transactional) at the Publisher.",
      symptom: "Snapshot Agent fails midway with disk full; publisher blocking during business-hours snapshot runs.",
      detect: "-- size of current snapshot files\n-- (filesystem) dir /s \\\\DIST\\ReplSnapshots\\unc\\",
      action: "Generate snapshots off-hours; ensure free space ≥ published data size; consider @sync_method = 'database snapshot' (Enterprise) to reduce blocking, or initialize from backup for very large databases."
    },
    "agent-login-failure": {
      title: "Agent security / login failures",
      sev: "high", comp: "agent",
      what: "Each agent connects to two or three servers (publisher, distributor, subscriber) under configurable accounts. Password rotations, dropped logins, or missing db_owner rights silently stop an agent.",
      symptom: "Error 18456 'Login failed for user'; agent history shows 'Unable to start execution of step 2'; replication stops after an AD password rotation.",
      detect: "SELECT TOP 20 j.name, h.run_date, h.run_time, h.message\nFROM msdb.dbo.sysjobhistory h JOIN msdb.dbo.sysjobs j ON j.job_id = h.job_id\nWHERE j.category_id IN (SELECT category_id FROM msdb.dbo.syscategories WHERE name LIKE 'REPL-%')\nORDER BY h.instance_id DESC;",
      action: "Document every agent's process account and connection accounts. After rotations, update credentials in agent job properties / sp_changesubscription. Follow least privilege: agents need db_owner in their target DBs, not sysadmin."
    },
    "agent-job-stopped": {
      title: "Agent job disabled, stopped, or schedule broken",
      sev: "med", comp: "agent",
      what: "Continuous agents (Log Reader, Distribution in continuous mode) should run 24/7. A failed SQL Agent restart, a disabled job, or someone stopping a job 'temporarily' halts the pipeline without raising obvious errors.",
      symptom: "Latency grows linearly; no errors anywhere; Replication Monitor shows agent 'Not running'.",
      detect: "SELECT j.name, j.enabled, a.start_execution_date, a.stop_execution_date\nFROM msdb.dbo.sysjobs j\nLEFT JOIN msdb.dbo.sysjobactivity a ON a.job_id = j.job_id\nWHERE j.category_id IN (SELECT category_id FROM msdb.dbo.syscategories WHERE name LIKE 'REPL-%');",
      action: "Alert on agent state, not only on failures (a stopped job never 'fails'). Make sure SQL Server Agent is set to auto-start and jobs restart after reboot."
    },
    "query-timeout": {
      title: "Agent query timeouts",
      sev: "med", comp: "agent",
      what: "Agents apply commands with a default QueryTimeout of 1800 s. Long-running applies at the subscriber (missing indexes, blocking) kill the batch; the agent retries the same batch and can loop forever.",
      symptom: "'Query timeout expired' in agent history; agent retries the same transaction repeatedly; latency flat-lining.",
      detect: "-- what is the distribution agent waiting on at the subscriber?\nSELECT r.session_id, r.wait_type, r.wait_time, r.blocking_session_id\nFROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id\nWHERE s.program_name LIKE '%distrib%';",
      action: "Find and fix the slow statement at the subscriber (blocking, missing index on PK used by repl procs). Raising -QueryTimeout in the agent profile is a mitigation, not a fix."
    },
    "row-not-found": {
      title: "Subscriber data drift (error 20598)",
      sev: "high", comp: "sub",
      what: "Someone modified or deleted rows directly at the subscriber. The next replicated UPDATE/DELETE finds no matching row and the Distribution Agent stops — replication assumes subscriber data is exactly what the publisher sent.",
      symptom: "Error 20598 'The row was not found at the Subscriber when applying the replicated command'; agent stopped on one transaction.",
      detect: "-- identify the failing command\nEXEC distribution.dbo.sp_browsereplcmds @xact_seqno_start = '0x...', @xact_seqno_end = '0x...';",
      action: "Find who/what writes to subscriber tables (should be nobody for one-way topologies — consider making subscriber tables read-only to apps). Repair the row manually, or validate with tablediff/sp_publication_validation and reinitialize if drift is widespread. Skipping errors with -SkipErrors 20598 hides corruption — use only as a stopgap."
    },
    "subscriber-blocking": {
      title: "Subscriber workload blocks the Distribution Agent",
      sev: "med", comp: "sub",
      what: "Reporting queries holding shared locks on subscriber tables block the Distribution Agent's applies. Replication latency is then a symptom of subscriber-side blocking, not of the replication pipeline.",
      symptom: "Latency climbs during reporting hours; agent session waiting on LCK_M_X at the subscriber.",
      detect: "SELECT blocking_session_id, wait_type, wait_time, session_id\nFROM sys.dm_exec_requests WHERE blocking_session_id <> 0;",
      action: "Consider RCSI (READ_COMMITTED_SNAPSHOT) on the subscriber database so readers don't block the agent's writes; tune long reports; schedule heavy reports away from sync windows."
    },
    "identity-ranges": {
      title: "Merge identity range exhaustion",
      sev: "high", comp: "sub",
      what: "With identity range management, each merge subscriber gets a range of identity values. If a subscriber burns its range and cannot reach the publisher to get a new one, inserts fail with constraint violations.",
      symptom: "Error 548 'The insert failed. It conflicted with an identity range check constraint'; INSERTs failing at one subscriber only.",
      detect: "SELECT * FROM MSmerge_identity_range_allocations ORDER BY time_of_allocation DESC;",
      action: "Run the Merge Agent to trigger a new range allocation, or EXEC sp_adjustpublisheridentityrange. Size @identity_range / @pub_identity_range to survive your longest expected offline window."
    },
    "merge-conflicts": {
      title: "Merge conflicts & unexpected winners",
      sev: "med", comp: "sub",
      what: "When the same row changes at two nodes between syncs, the conflict resolver picks a winner (default: publisher wins / first-writer priority). Losing changes are logged, not applied — data 'disappears' from the loser's perspective.",
      symptom: "Users report lost updates; MSmerge_conflicts_info rows accumulating.",
      detect: "SELECT * FROM MSmerge_conflicts_info;\nEXEC sp_helpmergearticleconflicts;",
      action: "Review conflicts in the Conflict Viewer regularly. Design to avoid conflicts (partition data by subscriber with filters). Choose/implement an appropriate resolver per article where business rules demand it."
    },
    "nonconverged-data": {
      title: "Non-convergence (silent data differences)",
      sev: "high", comp: "sub",
      what: "Triggers with missing NOT FOR REPLICATION, skipped errors, manual fixes, and interrupted merges can leave publisher and subscriber permanently different without any agent error.",
      symptom: "Reports disagree between servers; validation row counts differ; no errors in agent history.",
      detect: "EXEC sp_publication_validation @publication = 'YourPub'; -- then check agent history\n-- or: tablediff.exe -sourceserver ... -destinationserver ...",
      action: "Schedule periodic validation (row count + binary checksum) in maintenance windows. Investigate every validation failure; reinitialize affected articles if the cause can't be repaired safely."
    },
    "p2p-conflicts": {
      title: "Peer-to-peer conflict = topology-wide stop",
      sev: "high", comp: "sub",
      what: "P2P assumes partitioned writes (each row owned by one node). With conflict detection enabled, a conflicting change raises error 22815 and stops the distribution agents — by design, because P2P has no resolver.",
      symptom: "Error 22815 'A conflict of type ... was detected'; replication between peers halted.",
      detect: "-- originator metadata in the conflict message names both peers\nSELECT * FROM msdb.dbo.sysreplicationalerts;",
      action: "Decide the winner manually, fix the losing node's row, restart agents. Then fix the application-side write partitioning — P2P conflicts are an application bug, not a replication bug."
    },
    "init-snapshot-locks": {
      title: "Initialization locks & long snapshot delivery",
      sev: "med", comp: "agent",
      what: "Default (concurrent) snapshot generation for transactional publications holds short schema locks, but delivery to the subscriber drops & recreates objects and bulk-inserts data — heavy I/O and schema locks at the subscriber for the whole delivery.",
      symptom: "Subscriber tables unavailable during (re)initialization; applications erroring on dropped objects mid-delivery.",
      detect: "-- snapshot agent history\nEXEC sp_MSenum_replication_agents @type = 1;",
      action: "Communicate reinit windows to app owners. For big databases prefer initialize-from-backup (@sync_type = 'replication support only' / 'initialize with backup') to skip snapshot delivery entirely."
    },
    "monitor-blindness": {
      title: "Monitoring gap: no alerting on latency",
      sev: "med", comp: "dist",
      what: "Out of the box nothing alerts when replication is latent — Replication Monitor is interactive only. Teams routinely discover hours of latency from end users.",
      symptom: "Latency discovered by business users; no SQL Agent alerts configured for REPL-* categories.",
      detect: "SELECT name, enabled FROM msdb.dbo.sysalerts WHERE name LIKE '%Replication%';",
      action: "Enable the canned replication alerts (error 14151, 20574, 20572...), add a tracer-token or sp_replcounters-based latency check job, and alert on agent 'not running' state."
    }
  };

  var COMP_LABEL = { pub: "Publisher", dist: "Distributor", sub: "Subscriber", agent: "Agents" };

  /* expose for pages that render the registry (risk-areas.html) */
  window.REPL_SITE = { NAV: NAV, RISKS: RISKS, COMP_LABEL: COMP_LABEL };

  var root = document.body.getAttribute("data-root") || "";
  var page = document.body.getAttribute("data-page") || "";

  /* ---------------- theme ---------------- */
  function getTheme() {
    try { return localStorage.getItem("repl-theme"); } catch (e) { return null; }
  }
  function applyTheme(t) {
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(getTheme());

  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme");
    if (!cur) cur = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem("repl-theme", next); } catch (e) { /* private mode */ }
  }

  /* ---------------- sidebar ---------------- */
  function buildSidebar() {
    var sb = document.getElementById("sidebar");
    if (!sb) return;
    var html = "";
    html += '<div class="sidebar-top">';
    html += '<a class="site-title" href="' + root + 'index.html">SQL Server Replication<small>Support Engineer Field Guide</small></a>';
    html += '<span><button id="sidebar-toggle" title="Menu">☰</button> <button id="theme-toggle" title="Toggle dark / light">◐</button></span>';
    html += "</div>";
    html += '<div class="nav-groups">';
    NAV.forEach(function (g) {
      html += '<div class="nav-group">';
      if (g.head) html += '<div class="nav-head">' + g.head + "</div>";
      g.items.forEach(function (it) {
        var cls = it.page === page ? ' class="active"' : "";
        html += '<a href="' + root + it.file + '"' + cls + ">" + (it.icon ? it.icon + " " : "") + it.title + "</a>";
      });
      html += "</div>";
    });
    html += "</div>";
    sb.innerHTML = html;
    var tt = document.getElementById("theme-toggle");
    if (tt) tt.addEventListener("click", toggleTheme);
    var st = document.getElementById("sidebar-toggle");
    if (st) st.addEventListener("click", function () { sb.classList.toggle("open"); });
  }

  /* ---------------- prev / next ---------------- */
  function buildPrevNext() {
    var mainEl = document.querySelector("main");
    if (!mainEl || !page) return;
    var flat = [];
    NAV.forEach(function (g) { g.items.forEach(function (it) { flat.push(it); }); });
    var idx = -1;
    flat.forEach(function (it, i) { if (it.page === page) idx = i; });
    if (idx < 0) return;
    var prev = idx > 0 ? flat[idx - 1] : null;
    var next = idx < flat.length - 1 ? flat[idx + 1] : null;
    if (!prev && !next) return;
    var div = document.createElement("div");
    div.className = "prevnext";
    div.innerHTML =
      (prev ? '<a href="' + root + prev.file + '"><span class="dir">← Previous</span>' + prev.title + "</a>" : "<span></span>") +
      (next ? '<a href="' + root + next.file + '" style="text-align:right"><span class="dir">Next →</span>' + next.title + "</a>" : "<span></span>");
    mainEl.appendChild(div);
  }

  /* ---------------- T-SQL highlighter ---------------- */
  var SQL_KW = ("ADD|ALTER|AND|AS|ASC|BACKUP|BEGIN|BETWEEN|BREAK|BY|CASE|CHECK|CHECKPOINT|COLUMN|COMMIT|CONSTRAINT|CREATE|CROSS|DATABASE|DBCC|DECLARE|DEFAULT|DELETE|DESC|DISTINCT|DROP|ELSE|END|EXEC|EXECUTE|EXISTS|FETCH|FOR|FROM|FULL|FUNCTION|GO|GRANT|GROUP|HAVING|IF|IN|INDEX|INNER|INSERT|INTO|IS|JOIN|KEY|LEFT|LIKE|NOCOUNT|NOT|NULL|ON|OPEN|OR|ORDER|OUTER|OVER|PARTITION|PRIMARY|PRINT|PROC|PROCEDURE|RAISERROR|RECONFIGURE|REPLICATION|RESTORE|RETURN|REVOKE|RIGHT|ROLLBACK|SCHEMA|SELECT|SET|TABLE|THEN|TOP|TRAN|TRANSACTION|TRIGGER|TRUNCATE|UNION|UNIQUE|UPDATE|USE|VALUES|VIEW|WAITFOR|WHEN|WHERE|WHILE|WITH").split("|");
  var KW_SET = {};
  SQL_KW.forEach(function (k) { KW_SET[k] = true; });

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightSql(src) {
    var out = "";
    var i = 0, n = src.length;
    while (i < n) {
      var ch = src[i];
      // line comment
      if (ch === "-" && src[i + 1] === "-") {
        var j = src.indexOf("\n", i); if (j < 0) j = n;
        out += '<span class="tok-com">' + escapeHtml(src.slice(i, j)) + "</span>"; i = j; continue;
      }
      // block comment
      if (ch === "/" && src[i + 1] === "*") {
        var j2 = src.indexOf("*/", i + 2); j2 = j2 < 0 ? n : j2 + 2;
        out += '<span class="tok-com">' + escapeHtml(src.slice(i, j2)) + "</span>"; i = j2; continue;
      }
      // string
      if (ch === "'") {
        var j3 = i + 1;
        while (j3 < n) { if (src[j3] === "'" && src[j3 + 1] === "'") { j3 += 2; continue; } if (src[j3] === "'") break; j3++; }
        j3 = Math.min(j3 + 1, n);
        out += '<span class="tok-str">' + escapeHtml(src.slice(i, j3)) + "</span>"; i = j3; continue;
      }
      // word
      if (/[A-Za-z_@#\[]/.test(ch)) {
        var j4 = i;
        while (j4 < n && /[A-Za-z0-9_@#$\[\].]/.test(src[j4])) j4++;
        var w = src.slice(i, j4);
        var up = w.toUpperCase();
        if (KW_SET[up]) out += '<span class="tok-kw">' + escapeHtml(w) + "</span>";
        else if (/^sp_|^xp_|\.sp_|\.dbo\.sp_/i.test(w) || /^(distrib|logread|snapshot|replmerg|qrdrsvc|tablediff|sqlmonitor)(\.exe)?$/i.test(w))
          out += '<span class="tok-proc">' + escapeHtml(w) + "</span>";
        else out += escapeHtml(w);
        i = j4; continue;
      }
      // number
      if (/[0-9]/.test(ch)) {
        var j5 = i;
        while (j5 < n && /[0-9xA-Fa-f.]/.test(src[j5])) j5++;
        out += '<span class="tok-num">' + escapeHtml(src.slice(i, j5)) + "</span>"; i = j5; continue;
      }
      out += escapeHtml(ch); i++;
    }
    return out;
  }

  function enhanceCode() {
    var blocks = document.querySelectorAll("pre code");
    Array.prototype.forEach.call(blocks, function (code) {
      var pre = code.parentElement;
      var raw = code.textContent;
      if (code.classList.contains("sql") || !code.className) {
        code.innerHTML = highlightSql(raw);
      }
      // wrap with header + copy button if not already wrapped
      if (!pre.parentElement.classList.contains("codeblock")) {
        var wrap = document.createElement("div");
        wrap.className = "codeblock";
        var head = document.createElement("div");
        head.className = "code-head";
        var label = pre.getAttribute("data-label") || "T-SQL";
        head.innerHTML = "<span>" + label + "</span>";
        var btn = document.createElement("button");
        btn.className = "copy-btn";
        btn.textContent = "Copy";
        btn.addEventListener("click", function () {
          var done = function () { btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = "Copy"; }, 1600); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(raw).then(done, function () { fallbackCopy(raw); done(); });
          } else { fallbackCopy(raw); done(); }
        });
        head.appendChild(btn);
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(head);
        wrap.appendChild(pre);
      }
    });
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /* ---------------- risk markers & popover ---------------- */
  var popover = null;
  function closePopover() { if (popover) { popover.remove(); popover = null; } }

  function openPopover(riskId, anchorRect) {
    closePopover();
    var r = RISKS[riskId];
    if (!r) return;
    popover = document.createElement("div");
    popover.id = "risk-popover";
    if (r.sev === "high") popover.classList.add("sev-high");
    popover.innerHTML =
      '<button class="close-pop" title="Close">✕</button>' +
      "<h4>⚠ " + escapeHtml(r.title) +
      ' <span class="badge ' + (r.sev === "high" ? "danger" : "warn") + '">' + (r.sev === "high" ? "HIGH" : "MEDIUM") + "</span>" +
      ' <span class="badge ' + r.comp + '">' + COMP_LABEL[r.comp] + "</span></h4>" +
      "<dl>" +
      "<dt>What can go wrong</dt><dd>" + escapeHtml(r.what) + "</dd>" +
      "<dt>Symptom</dt><dd>" + escapeHtml(r.symptom) + "</dd>" +
      "<dt>Detect</dt><dd><code>" + escapeHtml(r.detect).replace(/\n/g, "<br>") + "</code></dd>" +
      "<dt>First response</dt><dd>" + escapeHtml(r.action) + "</dd>" +
      "</dl>";
    document.body.appendChild(popover);
    popover.querySelector(".close-pop").addEventListener("click", closePopover);
    // position near marker, clamped to viewport
    var px = anchorRect.left + window.scrollX + anchorRect.width / 2;
    var py = anchorRect.bottom + window.scrollY + 8;
    var w = popover.offsetWidth;
    var left = Math.max(10, Math.min(px - w / 2, window.scrollX + document.documentElement.clientWidth - w - 10));
    popover.style.left = left + "px";
    popover.style.top = py + "px";
  }

  function wireRiskMarkers() {
    var markers = document.querySelectorAll(".risk-marker[data-risk]");
    Array.prototype.forEach.call(markers, function (m) {
      var id = m.getAttribute("data-risk");
      var r = RISKS[id];
      if (r && r.sev === "high") {
        m.classList.add("sev-high");
        // add expanding halo ring for high severity
        if (m.namespaceURI === "http://www.w3.org/2000/svg" && !m.querySelector(".risk-ring")) {
          var ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          ring.setAttribute("class", "risk-ring");
          ring.setAttribute("r", "11");
          m.insertBefore(ring, m.firstChild);
        }
      }
      if (r) {
        var titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
        titleEl.textContent = "⚠ " + r.title + " — click for details";
        m.appendChild(titleEl);
      }
      m.addEventListener("click", function (ev) {
        ev.stopPropagation();
        openPopover(id, m.getBoundingClientRect());
      });
    });
    document.addEventListener("click", function (ev) {
      if (popover && !popover.contains(ev.target)) closePopover();
    });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closePopover(); });
  }

  /* ---------------- risk list renderer (risk-areas.html) ---------------- */
  function renderRiskList() {
    var host = document.getElementById("risk-list");
    if (!host) return;
    var ids = Object.keys(RISKS);
    ids.sort(function (a, b) {
      var sa = RISKS[a].sev === "high" ? 0 : 1, sb = RISKS[b].sev === "high" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return RISKS[a].comp.localeCompare(RISKS[b].comp);
    });
    var html = "";
    ids.forEach(function (id) {
      var r = RISKS[id];
      html += '<div class="risk-item sev-' + r.sev + '" data-comp="' + r.comp + '" id="risk-' + id + '">' +
        "<h3>⚠ " + escapeHtml(r.title) +
        ' <span class="badge ' + (r.sev === "high" ? "danger" : "warn") + '">' + (r.sev === "high" ? "HIGH" : "MEDIUM") + "</span>" +
        ' <span class="badge ' + r.comp + '">' + COMP_LABEL[r.comp] + "</span></h3>" +
        "<dl>" +
        "<dt>What can go wrong</dt><dd>" + escapeHtml(r.what) + "</dd>" +
        "<dt>Symptom</dt><dd>" + escapeHtml(r.symptom) + "</dd>" +
        '<dt>Detection query</dt><dd><pre data-label="Detect"><code class="sql">' + escapeHtml(r.detect) + "</code></pre></dd>" +
        "<dt>First response</dt><dd>" + escapeHtml(r.action) + "</dd>" +
        "</dl></div>";
    });
    host.innerHTML = html;
  }

  /* ---------------- filterable tables ---------------- */
  function wireFilters() {
    var bar = document.querySelector(".filter-bar[data-target]");
    if (!bar) return;
    var tbl = document.querySelector(bar.getAttribute("data-target"));
    if (!tbl) return;
    var search = bar.querySelector('input[type="search"]');
    var chips = bar.querySelectorAll(".filter-chip");
    var activeComp = "all";

    function apply() {
      var q = search ? search.value.trim().toLowerCase() : "";
      var rows = tbl.querySelectorAll("tbody tr");
      var visible = 0;
      Array.prototype.forEach.call(rows, function (tr) {
        var tags = (tr.getAttribute("data-tags") || "").toLowerCase();
        var text = tr.textContent.toLowerCase();
        var okComp = activeComp === "all" || tags.indexOf(activeComp) >= 0;
        var okText = !q || text.indexOf(q) >= 0;
        tr.style.display = okComp && okText ? "" : "none";
        if (okComp && okText) visible++;
      });
      var count = document.getElementById("filter-count");
      if (count) count.textContent = visible + " command" + (visible === 1 ? "" : "s");
    }
    if (search) search.addEventListener("input", apply);
    Array.prototype.forEach.call(chips, function (c) {
      c.addEventListener("click", function () {
        Array.prototype.forEach.call(chips, function (x) { x.classList.remove("active"); });
        c.classList.add("active");
        activeComp = c.getAttribute("data-filter");
        apply();
      });
    });
    apply();
  }

  /* ---------------- boot ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    buildSidebar();
    renderRiskList();   /* before enhanceCode so generated blocks get highlighted */
    enhanceCode();
    wireRiskMarkers();
    wireFilters();
    buildPrevNext();
  });
})();
