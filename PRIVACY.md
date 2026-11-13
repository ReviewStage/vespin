# Privacy

Effective date: November 5, 2026

## 1\. Introduction

Stage Inc., a Delaware corporation ("we," "us," or "our"), operates the
vespin.dev website, the Vespin Mac app, the Vespin web app, and the hosted
service behind them (collectively, the "Service"). Vespin is an inbox for all
your coding agents. This Privacy Policy explains how we collect, use,
disclose, and safeguard your information when you use the Service.

By using the Service, you agree to the collection and use of information in
accordance with this policy.

## 2\. Information we collect

### Account information

When you sign in with Google or GitHub, we collect your name, email address,
profile picture address, and which provider you used. We also store the
records that keep you signed in, each with the IP address and browser or app
it came from, and a daily count of your dictation use. Signing in with GitHub,
or linking GitHub later, authorizes the Vespin GitHub App; we store its
OAuth tokens encrypted on the Service and never send them to your Mac or
browser.

### Voice calls

When you talk to an agent by voice, your audio goes from the app to OpenAI, on
your own OpenAI API key, and nowhere else; the key never leaves the Service.
What you say reaches the agent as its messages, as a typed line does, and is
kept in its conversation like one. We keep nothing else of a call but its
length, which counts toward your day and in our usage counts.

### Workspaces, tasks, and descriptions

Every account gets a first workspace, and you can create or join others.
Members of a workspace see each other's names, email addresses, and roles.
Owners and admins can invite people by email, upload a workspace photo, and
connect a GitHub App installation. Within a workspace we store each task's
name, its description (a Markdown document written by members and agents) with its
full revision history, comments on the description, inbox items and their answers,
pages that agents make, pictures and short videos added to any of these, and,
if the Memory experiment is on, short facts agents save about how your team
works. Every member of the workspace can see all of this. Agents record their
videos as WebM, which iPhones cannot play, so for each video an agent records
in a cloud sandbox, we also keep an MP4 copy, made in that agent's sandbox.
The copy is shown to the same people as its video, is deleted with it, and is
the version the iPhone app plays.

### Agent conversations

For each turn an agent runs, we store your message, any files you attach, the
agent's reply and reasoning summaries, each tool call with its input and
output, and the model, token counts, and timing. Tool output can include files
from your repository, command output, web pages, screenshots of the agent's
browser, windows of apps on your Mac you let agents use, and answers from your
integrations. We also store the agent harness's
own record of its session, Claude Code's transcript or Codex's thread, its
thinking text included, so the agent can resume it and an agent continued or
forked from it goes on from it. Transcripts and descriptions are stored
as written, not end-to-end encrypted, and our operators can read them.

### Link previews

When you rest the pointer on a plain web link in a conversation, a thread, or
a description, Vespin shows a card of the page it opens: its title,
description, site name, icon, and picture. To draw it, the Service fetches
that page, and the icon and picture it names, from our servers over HTTPS
only, so the site
sees a request from Vespin and never from your Mac or browser, with no cookie
or credential of yours. The Service refuses addresses inside a network and
keeps what a page answered for a few minutes, keyed by the address alone and
under no one's name; it does not record which links you hovered.

### Repository and GitHub data

Through your workspace's GitHub App installation, we access repository
contents, pull requests, code diffs, review comments, checks, and issues for
repositories where the App is installed. A cloud agent works on a checkout of
the repository in its own Vercel Sandbox: on a drive of its own where it was
forked from its workspace's drive or from the drive of the agent it was
continued from, and in the sandbox otherwise; an agent on your own machine
keeps its work there. A workspace repository's default branch may also remain
on a drive of its own made before workspace drives, which nothing reads or
writes any more. Each workspace keeps one drive holding the default branch
of every repository it connects, which each new cloud agent forks, so an
agent's sandbox holds those repositories beside its own checkout: those its
installation grants and those a member added on their own token alike, the
latter cloned with that member's token.
Sections 6 and 7 say how long those checkouts, drives, and snapshots are kept.
Apart from them, we generally do not keep copies of repository content beyond
what lands in an agent's transcript, except a pull request's number, title,
state, and checks, and any chapters you generate for it.

### Credentials you save

If you save an Anthropic or OpenAI API key, a GitHub personal access token, or
your Claude plan's setup token, or sign in with your ChatGPT plan, we store it
encrypted with AES-256-GCM under a per-credential key that is itself encrypted
with a server-only secret held outside the database. We keep a short hint
(such as `sk-ant-…abcd`), the email of the ChatGPT account a plan signed in
as, the name you give a plan, and whether the provider accepts it. We never
log a saved credential or include it in analytics, error reports, or screen
recordings. We never send one to your devices, except to run an agent on your
own machine (see Agents on your own machines below).

A workspace's owners and admins can save environment variables for the
workspace, which we store sealed the same way. Each of the workspace's cloud
agents is handed them as environment variables in its sandbox as it starts a
turn, so the agent can read them, and a value it reads or prints may reach its
model and its transcript. Agents on your Mac are never handed them.

### Integrations and connected apps

If you connect an integration (such as Linear, Notion, Sentry, Slack, Gmail,
Google Calendar, Google Drive, Granola, Mercury, Neon, PostHog, Resend, Stripe,
Supabase, Vercel, Y Combinator, or Executor), Vercel Connect stores its token
for your account, encrypted, and we keep the connection's state and a display
name. While connected, your agents can read and change whatever your grant at
that service allows, without asking you first, and everything the service
answers, which can include other people's messages or credentials it hands
out, goes to the agent's model and into its transcript. If your workspace
connects Vespin's Slack bot, we store your Slack user id, and messages you send
the bot, with the earlier messages of that Slack thread, are handed to an
agent. If you allow an app such as Claude Code or Cursor to connect to our MCP
server, we store a record of the app, your consent, and hashed tokens.

### Commands on your Mac

If you allow it in Settings › This Mac, agents can run shell commands on your
Mac as your macOS user, with access to everything you can reach. The command,
its exit code, and up to 20,000 characters each of its output and errors are
returned to the agent, stored in its transcript, and sent to the agent's model
provider. **This output is not redacted**: if a command prints a password,
token, key, or file contents, that goes too.

### Apps on your Mac

If your workspace turns on Computer use and you allow it in Settings › This
Mac, agents can see and use apps on your Mac: Vespin asks you the first time an
agent wants each app, and you can answer Allow once, Always allow, or Deny.
For an app you allow, the agent reads its window's controls and their text and
a screenshot of the window, and clicks and types in it. The screenshot is sent
to the agent's model provider, and a full-size copy and the app's icon are
stored with the agent's transcript and deleted with it. Vespin never offers
agents terminals, password managers, System Settings, or Vespin itself, but
**anything an allowed app's window shows goes too**, a message or a password
on screen included. You can take an app off the always-allowed list, or turn
computer use off, in Settings › This Mac.

### Agents on your own machines

Agents can run directly on This Mac, once you turn on its toggle in Machines,
or on another machine you add, with full access to everything that machine's account
can reach. Their work stays on that machine, though their transcripts are
stored like any other, and, on a machine running host 0.11.0 or later, so is
their harness's own session, its thinking text included, as a cloud agent's
is. A teammate who can see such an agent may continue or fork it, unless it
works on your own GitHub token: the new agent is handed that session where we
keep it, or a replay of its transcript where we don't, and the branch the
agent pushed. Nothing is read from your machine, and a continue only stops the
agent there. To tell your machines apart, each sends us a keyed hash of its
hardware or machine id, never the id itself, and a Mac sends its model name.

When such an agent starts, it runs on the Claude Code or Codex login already
set up on that machine, never on a credential you saved in Vespin: we send that
machine none of your Anthropic or OpenAI credentials, and its work counts
against that login's plan or key. If the machine has no such login, the agent's
turn fails and says to sign in on that machine. The agent and every command it
runs have full access to that machine's account, that login included.

An agent on your machine also uses the GitHub sign-in already set up on that
machine for its account: your `gh` login, your Git credential helper and
settings, and your SSH keys and SSH agent. We never send that machine a GitHub
token. **Such an agent acts as whoever is signed in on that machine, with every
repository and permission that sign-in has, not just the task's repository.**
Before it starts, it checks that the sign-in reaches the repository. If it
doesn't, the agent doesn't start, and its transcript says to sign in with
`gh auth login` or set up SSH.

### Usage data and screen recordings

The Mac app and the web app send counts of which features you use, from a
fixed list of event names and values, under your account's name and email.
They never include anything you type or say, titles, branches, file paths,
prompts, or error text. The Service counts work done through it (such as
tasks created and agents started) the same way. Counts are grouped by
workspace, with each workspace's name and creation date.

The Vespin iOS app sends the same kind of counts while you are signed in:
when it opens, each day you use it, sign-ins and sign-outs, and the kind of
screen you open (the Inbox, a thread, a task, an agent, a page, a pull
request, or Settings) and whether the window showed one column or two, never
which thread, task, or agent it was. They go through the Service, as the Mac
app's do, and the app holds no PostHog key of its own.

While you are signed in, the Mac app and the web app record how you use
Vespin's window, such as the screens you visit and where you click, never your
screen or other apps. Text you type and other content that may be sensitive is
masked before a recording leaves your device. Recordings are linked to your
account. While a maintainer is signed in as your account with your support
access (section 4), their use of the web app is counted and recorded the same
way, under your account. The iOS app records nothing.

### Error and performance data

The Mac app, the web app, and the Service send Sentry error reports, crash
reports, reports of the errors Vespin shows you, and performance traces for a
sample of launches and page loads. They use Sentry's default data collection,
so reports may include error messages, stack traces, request addresses and
headers, device details, and your IP address. Sentry replaces values whose
names look like credentials, and Vespin removes query parameter values and
token-shaped parts of addresses. Reports name your account by its id only. The
Service does not send Sentry what was sent to or returned by a model, though an
error's own words can quote what an agent was working on. The Mac app also sends
Sentry diagnostic data about its resource use, such as processor usage. The
Service and the Mac app's windows send processor profiles of the traces Sentry
keeps: which of their own functions ran and for how long, never the values
they handled.

An agent running in Vespin's cloud also sends Sentry, from its sandbox, the
timings of its own start: performance traces of its startup steps, in the same
trace as the Service's, and the time from its taking your message to the first
word of the model's answer. These carry only ids, the kind of agent, how
it was started, and durations, never your messages, the agent's work, or its
environment; it sends no error reports. An agent running on your own machine
sends Sentry nothing.

A machine you run Vespin's host on, This Mac or one you installed it on,
sends Sentry the host's own lines about its setup and running: that it
connected, fetched the tools its agents run on, became ready, or could not,
in Vespin's own words, with the host's version and operating system. A line
saying something failed is sent as an error report. These never carry your
agents' messages, their work, what a tool or a terminal printed, or a
credential. The Mac app sends the same of setting up This Mac's host. The
host on This Mac also keeps these lines in `~/Library/Logs/Vespin Host/` on
your Mac.

The Vespin iOS app sends Sentry error reports, crash reports (a crash is sent
the next time you open the app, a crash as the app starts, before its first
screen, among them), and reports of a screen that could not be drawn. It uses Sentry's default data collection, so reports may include error
messages, stack traces, the addresses of the app's own requests, device and
iOS details, the app's version and build, and your IP address. A report
naming a sign-in token in an address is dropped, and reports name your
account by its id only, or not at all for a crash before you are signed in
again at launch. The app sends no performance traces, screenshots, or
recordings of the screen.

### Feedback

If you send feedback, we receive your words, any screenshots you attach, and,
unless you untick it, your name and email.

### Notifications

If you turn on Show a notification in Settings › Preferences › Notifications, the Mac
app, or the web app where your browser allows it, asks your system to show a
notification while Vespin is in the background when an agent you started
finishes, or when an Inbox item asks you something, including one on a task
assigned to you whose agent someone else started. **The notification shows the
agent's or the task's name, and the title of the question asked**, and your
system (macOS's Notification Center, or your browser and the system it runs
on) shows it and may keep it in its notification history under its own
settings, outside Vespin. Showing one sends nothing to us or anyone else. It is off until you
turn it on. The notification that a command waits on your Mac, which the Mac
app shows whatever this setting, names no command.

If you add your own sounds in Settings › Preferences › Notifications, to play when an
agent finishes or something needs you, we keep **each sound's audio and the
name you give it** with your account: its bytes, its audio type, a
fingerprint of them (SHA-256) that tells your other signed-in apps when it
changed, so they fetch it again, and which sound each of yours plays. We
never keep the file's own name, which the app only offers as the name to
start from, and a sound is sent only to apps signed in to your account.
You can rename or remove each one in the same place, and all of them are
deleted with your account.

If you sign in to the Vespin iOS app and allow notifications, the app
registers your iPhone's Apple push token with the Service, with which of
Apple's gateways the token belongs to and the app it was issued to, and we
keep them with your account. When the Service pushes a notification to your
phone, it sends Apple that token and the notification itself: **its title and
body, which may carry the words of an Inbox thread, and the agent's or the
task's name**, with the ids the app opens on a tap. Apple delivers it under
its own policies, and your phone keeps it in its notification history under
its own settings, outside Vespin. We keep the token while the phone stays
registered: the app unregisters it when you sign out, we delete it when
Apple tells us the phone will no longer take pushes on it, and it is deleted
with your account. Beside the token we keep each phone's "Notify me" choice,
when a push to it last reached Apple, and, while its pushes fail, since when
and Apple's reason, which the phone's Settings shows.

If your iPhone allows the app's Live Activities, the app also registers the
two tokens Apple hands it for the one Live Activity that shows your running
agents: one that lets the Service start the activity, and one for the
activity while it stands on the phone. We keep them with your phone's row,
beside when the Service last pushed the activity and what that push showed,
and the Service sends Apple a token with each push to the activity: **your
running agents' titles** and when each began, how many of them run, and how
many threads wait on you. We forget the activity's token once it ends, or Apple
says it is gone, and both tokens leave with the phone's row or your account.

If you add the app's Inbox widget to your Home Screen or Lock Screen, the
app keeps a small file for it on your iPhone, in storage it shares only with
its own widget and notification extensions: the name of the workspace you
chose, how many threads wait on you there, and **the titles of up to three
of them and their tasks' names**, with the ids a tap opens. It holds no
message's words, no sign-in token, and nothing the widget sends anywhere:
the widget has no network of its own. The app rewrites the file as your
Inbox changes, the notification extension updates it as a notification
arrives, and the app deletes it when you sign out. The widget marks the
titles as private, so iOS hides them on a locked iPhone if your settings
say to.

While you are signed in to the Vespin iOS app, it keeps a small file on your
phone, in a folder only the app and its own extensions can read, for
Vespin's share sheet: **your account's id, your workspaces' ids and names,
and the names of the repositories each reaches**, with the Service's address
and the app's version. The app also keeps **your account's current sign-in
token** (the short-lived access token, never the refresh token that renews
it) in one Keychain item that only the app and its share sheet can read. That
item stays on this iPhone, never syncs to iCloud or moves to another device,
holds the time the token stops being sent, a little under an hour after it
was issued, is rewritten each time the token is renewed, and is deleted when
you sign out. When you share text, a link or up to four pictures to Vespin from another
app and press Start, the share sheet sends **the words you shared and
edited, and the pictures you kept**, made smaller as the app's New task
makes a photo, with the workspace and repository you picked, to the Service under that token, exactly
as the app's New task does, and the task starts there. Where you allow
Vespin's notifications, the share sheet then posts one on the phone itself,
never through Apple's push service, which says "Task started" and nothing
of the task, and carries the ids of the task and its agent for the app to
open when you tap it. Where the task
doesn't start, because the token has expired, the Service refuses it, or the
Service doesn't answer, the share sheet keeps those words, pictures and
picks as a draft in the same folder instead, which the app opens New task on
the next time you open the app, then deletes, the pictures once New task
has read them. Signing out deletes the files and the
Keychain item. Deleting the app deletes the files at once, but iOS keeps an
app's Keychain items after the app is deleted, so the item stays on the
iPhone until the app is installed and opened again, which deletes it; by
then the token in it has expired, within an hour of being issued, and the
share sheet never sends a token past its expiry.

So your phone stays quiet while you're at your desk, the Service notes when
a desktop or web client of yours was last active: while you use one, it
tells the Service so at most every 30 seconds, with nothing of what you typed
or clicked, and we keep only the latest time with your account. While that
time is within the last two minutes, a notification due to a phone set to
"Away" is held, and we keep which thread or agent it was about until it is
sent once you step away, or dropped because it no longer waits on you. The
time and the holds are deleted with your account.

### Setup questions

If you answer the optional questions in setup (how you heard about Vespin,
your role, and what you hope it helps with), we keep your answers, and
anything you write beside "Other", with your account. We also record them in
PostHog under your account's name and email, whether or not you share usage
data, and post them to our team's Slack.

### Information stored on your Mac

The Mac app keeps its window layout and the drafts of messages you have not
sent. While you are signed in, it also keeps a copy of your workspaces' lists
and changes you made offline in one file, `entities.sealed`, encrypted under a
key in the macOS Keychain and deleted when you sign out. Your sign-in
tokens are kept encrypted the same way. Transcripts and pictures you
open are held in memory only.

### Spotlight and Handoff on your iPhone

While you are signed in to the Vespin iOS app, it adds the tasks and Inbox
threads of the workspace you work in to your iPhone's or iPad's Spotlight
index, so a search on your device finds them: each task's name, status, and
workspace, each thread's title and its latest words as the Inbox shows them,
and each one's vespin.dev link. The index stays on your device, where it is
readable only while the device is unlocked, and the app sends none of it to
us. It changes as your lists do, the app takes a workspace's items out when
you choose another, and it empties the index when you sign out.

While you look at a thread, task, agent, or pull request, the app tells iOS
its title and its vespin.dev link, so Handoff can offer it on your other
devices signed in to the same Apple Account. iOS hands them to those devices
directly, and the app does not offer them to Siri suggestions or to search.

## 3\. Legal basis for processing

We process your personal information on the following legal bases, as
applicable under the EU General Data Protection Regulation (GDPR) and similar
laws:

- **Contractual necessity:** processing required to provide the Service,
  manage your account, and run your agents.
- **Legitimate interest:** processing for security, error monitoring, abuse
  prevention, and improving the Service, where these interests are not
  overridden by your rights.
- **Consent:** processing based on your consent, such as connecting an
  integration, letting agents run commands on your Mac, or sharing usage data.
  You may withdraw consent at any time.
- **Legal obligation:** processing necessary to comply with applicable laws
  and regulations.

## 4\. How we use your information

- Provide, operate, and maintain the Service
- Run your agents and the models they use, on your own keys
- Authenticate your identity and manage your account and workspaces
- Send workspace invitations and the Slack messages your workspace asked for
- Monitor and analyze usage to improve the Service
- Detect, prevent, and address technical issues and security threats
- Comply with legal obligations

Our operators can read what the Service stores. Vespin's maintainers also have
an admin page showing each account's name, email, activity counts, workspaces
and members, agents' status and models, and which providers and integrations
are connected. A maintainer may sign in to the web app as your account only
while you have granted support access from Settings. A grant lasts seven days
and you can revoke it at any time, which also ends any such sign-in under way;
each sign-in lasts up to an hour. While signed in as you, a maintainer sees and
can do what you can in the web app.

We do not use your code or conversations to train AI models.

## 5\. Data sharing and disclosure

We do not sell your personal information or use it for advertising. We share
data with:

- **AI providers:** your agents, web search, dictation, voice calls, and pull request
  chapters run on Anthropic or OpenAI, always on the API key or subscription
  you saved, never ours. Titles, of your agents, tasks, and the threads you
  start, are generated on Anthropic under Vespin's own API key, from excerpts
  of an agent's opening message, your latest message, and its latest answer,
  or of a thread's first message.
  Each call carries what the model needs, such as the description, the conversation,
  attached files, and what the agent read. These providers process it under
  their own policies.
- **GitHub:** to check out repositories, push branches, and open pull requests
  through the Vespin GitHub App. Your devices also contact GitHub directly to
  check for updates and load avatars.
- **Apple:** notifications to the Vespin iOS app go through Apple's Push
  Notification service, which receives your phone's push token and each
  notification's title and body, as the Notifications section says.
- **Infrastructure providers:** Vercel (hosting, agent sandboxes, and Vercel
  Connect, which holds integration tokens), Neon (database), PostHog (usage
  data, screen recordings, feedback, and setup answers), Sentry (error and
  performance monitoring), Resend (email: for the onboarding emails a new account is sent,
  Resend is told your email address, your first name, when you signed up, whether
  you accepted a workspace invitation, and on which days you started a task),
  and Slack (feedback, setup answers, and Vespin's Slack bot).
- **Integrations and connected apps:** the services and MCP clients you connect
  receive what your agents send them, or what our tools answer, and keep it
  under their own policies.
- **Workspace members:** data within a workspace is visible to its other
  members.
- **Legal requirements:** we may disclose information if required by law,
  regulation, or legal process.

## 6\. Data storage and security

Your data is stored on servers provided by our infrastructure partners: our
database is hosted by Neon, and agents' checkouts and session files live in
Vercel Sandboxes and on Vercel Drives: each agent's
checkout on a drive of its own, and one drive per workspace holding the default
branch of every repository it connects, member-token ones included, which each
new cloud agent forks. A copy of a workspace repository's default branch, with
its dependencies installed, may also remain on a drive of its own made before
workspace drives, which nothing reads or writes any more. A sandbox's own
disk is discarded when it stops, so only its drive outlives it; a sandbox made
before that changed keeps a snapshot of its disk instead.
We use encryption in transit (TLS), encrypt saved credentials as described
above, and keep the tokens agents use outside their sandboxes, adding them at
the sandbox's network firewall, except a ChatGPT plan's access token, which a
Codex agent holds inside its sandbox to sign in. Transcripts, descriptions, and other content are not
end-to-end encrypted.

While we strive to protect your information, no method of electronic storage
or transmission is 100% secure, and we cannot guarantee absolute security. In
the event of a data breach affecting your personal information, we will notify
affected users and relevant authorities as required by applicable law.

## 7\. Data retention

We retain your data for as long as your account is active and as needed to
provide the Service. Deleting a task deletes it at once with its history,
pages, inbox items, and pictures, and its agents' transcripts. Deleting an
agent deletes its transcript at once. Deleting an agent asks Vercel to delete
its sandbox and the drive holding its checkout; where that fails or does not
finish in time, the delete goes ahead anyway, and the drive may remain.
Archiving an agent deletes neither: its sandbox and drive are deleted once
they have gone seven days unused, as any agent's are. A sandbox keeps no snapshot; the snapshots of one made
before that changed otherwise expire and are removed seven days after they
were last used. The workspace's drive of every
repository it connects is kept for the workspace's agents until the workspace
is deleted. A repository's default-branch drive made before workspace drives
is no longer read; deleting its workspace asks Vercel to delete it where one of
the workspace's agents still names its repository, and where none does, or the
delete fails or does not finish in time, it may remain. A repository snapshot
made before default-branch drives expires thirty days after its last use. When you delete your account:

- **Account data** (profile, sessions, OAuth tokens, saved credentials,
  preferences, your sounds, integration records, your phones' push
  tokens, when you were last active at a client, and the notifications held
  for you) is deleted at once.
- **Your tasks, descriptions, transcripts, and inbox items** are deleted at once,
  but for the tasks in workspaces with other members (below), and we ask
  Vercel to delete your agents' sandboxes and the drives holding their
  checkouts; where that fails or does not finish in time, your account is
  deleted anyway and a drive may remain. The snapshots of a sandbox made
  before sandboxes stopped keeping them otherwise expire and are removed seven
  days after they were last used.
- **Workspaces you own and are the only member of** are deleted at once with
  their tasks, transcripts, and automations, as a deleted task is, and we ask
  Vercel to delete every one of their agents' sandboxes and the drives holding
  their checkouts, the workspace's drive of every repository it connects, and
  the default-branch drive made before it of each repository one of their
  agents still names, and to stop their scheduled automations;
  where that fails or does not finish in time, the workspace is deleted anyway
  and a drive may remain. Their GitHub, Slack, and Sentry
  connections are removed on our side; our apps stay installed at those
  services until you uninstall them there.
- **Workspaces with other members**, and the tasks, memories, comments, and
  description text you left in them, stay with the workspace without your name.
- **Usage data and screen recordings:** we ask PostHog to erase them; if it
  cannot be reached, your account is deleted anyway and PostHog keeps them.
- **Onboarding emails:** we ask Resend to delete the contact it keeps under
  your email address, which stops them; if it cannot be reached, your account
  is deleted anyway and Resend keeps it.
- **Error reports** already sent to Sentry are kept until Sentry's retention
  ends, since Sentry offers no way to erase one account's reports.
- **Integrations:** we ask Vercel Connect to revoke your grants; anything your
  agents already did at those services stays there.
- **Google and GitHub sign-in:** we ask GitHub to revoke your authorization
  of our GitHub App, which ends every token it gave us for you: the access
  token, good for about eight hours, and the refresh token that renews it,
  good for about six months. We ask Google to revoke the token your Google
  sign-in left, an access token good for about an hour; we never ask Google
  for one that renews itself. If either cannot be reached in a few seconds,
  your account is deleted anyway, we keep no copy of its tokens, and they
  stay valid at the provider until they expire.

## 8\. Your rights and choices

Depending on your jurisdiction, you may have the right to:

- Access the personal data we hold about you
- Request correction of inaccurate data
- Request deletion of your data
- Object to or restrict processing of your data
- Request a copy of your data in a portable format
- Withdraw consent at any time

To exercise any of these rights, contact us at founders@vespin.dev. You
can also act directly in the app:

- **Usage data:** turn off Settings › Account › "Share usage data". It is set
  per Mac and per browser, is on by default in the Vespin you download, and
  does not stop the counts the Service makes of work done through it. The
  iOS app has no such switch yet, and counts while you are signed in.
- **Commands on your Mac:** set Settings › This Mac › "Let agents run commands
  on this Mac" to Never.
- **Integrations:** switch one off for a single agent in its message box's MCP
  menu, or disconnect it in Settings › Integrations. Revoke connected apps in
  Settings › MCP › Agents with access.
- **GitHub:** revoke the Vespin GitHub App in GitHub's settings under
  Applications.
- **Delete your account** in Settings › Account.

## 9\. Cookies and tracking

The web app uses a session cookie to keep you signed in. vespin.dev uses
PostHog to count page views, clicks (by what was clicked and where, never the
words on it), and sign-in steps, and to record its pages, except the sign-in
pages; recordings mask what you type into fields. Before anything leaves your
browser, the site removes sign-in codes, tokens, and similar values from every
address. It collects nothing else, regardless of our PostHog project's
settings: no errors, console output, network requests, timings, heatmaps,
surveys, chat widgets, or feature flags. When you finish signing in, the site
links your visits to your account's id, name, and email.

Your browser sends this data to a path on vespin.dev, which passes it on to
PostHog without the site's cookies. PostHog receives your IP address and user
agent; our project is set to discard IP addresses. Vespin in a browser
(vespin.dev/app) records and reports as the Mac app does, and sends Sentry
reports directly from your browser.

## 10\. Third-party services

The Service connects to third-party services you choose, including GitHub,
your model providers, and any integrations you connect. We are not responsible
for the privacy practices of these third parties, and we encourage you to
review their privacy policies.

## 11\. Children's privacy

The Service is not intended for individuals under the age of 18. We do not
knowingly collect personal information from children. If we learn we have
collected data from a child under 18, we will delete it promptly.

## 12\. California privacy rights (CCPA/CPRA)

If you are a California resident, you have additional rights under the
California Consumer Privacy Act (CCPA) and the California Privacy Rights Act
(CPRA):

- **Right to know:** you may request details about the categories and specific
  pieces of personal information we have collected about you.
- **Right to delete:** you may request deletion of your personal information,
  subject to certain exceptions.
- **Right to correct:** you may request correction of inaccurate personal
  information.
- **Right to opt out of sale or sharing:** we do not sell or share your
  personal information as defined under the CCPA/CPRA.
- **Right to non-discrimination:** we will not discriminate against you for
  exercising any of these rights.

To exercise these rights, contact us at founders@vespin.dev. We will
verify your identity before processing your request.

## 13\. International data transfers

Your information may be transferred to and processed in countries other than
your own, including the United States. We rely on Standard Contractual Clauses
(SCCs) and other legally recognized transfer mechanisms to ensure your data is
protected when transferred internationally. Our service providers are
contractually obligated to protect your information in accordance with this
policy.

## 14\. Google user data

Vespin's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use what Google returns when you
sign in with it, your name, email address, and profile picture, only to
identify your account. What Gmail, Google Calendar, and Google Drive answer an
agent, where you connect them, is used only for the work you or your
automations ask that agent to do: it goes to the model that agent runs on and
into the agent's transcript, which is kept as every transcript is. Agents can
read and label mail and write drafts but never send mail. None of it is
transferred or sold, used for advertising, or used to train or improve any AI
or machine-learning model, ours or anyone's, and no person at Vespin reads it
unless you ask us to, for security, or where the law requires it.

## 15\. Changes to this policy

We may update this Privacy Policy from time to time. We will notify you of
material changes by posting the new policy on this page and updating the
effective date. Your continued use of the Service after changes constitutes
acceptance of the updated policy.

## 16\. Governing law

This Privacy Policy is governed by and construed in accordance with the laws
of the State of Delaware, United States, without regard to its conflict of law
provisions.

## 17\. Contact us

If you have questions about this Privacy Policy, please contact us at
founders@vespin.dev.
