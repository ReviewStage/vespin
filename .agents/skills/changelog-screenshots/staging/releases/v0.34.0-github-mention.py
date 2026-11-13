# v0.34.0-github-mention.py -- builds the GitHub issue mockup for 0.34.0's "Mention Vespin on GitHub": GitHub's dark theme from its own Primer CSS and Octicons, inlined, in a Chrome window.
#
# Throwaway staging, kept to redo the picture. Needs `npm install @primer/css@21 @primer/octicons@19 @primer/primitives@10` under `.context/primer/`;
# writes `.context/mock/github-mention.html`, which the Mac's Chrome renders (README's 0.34.0 row).
import base64, os, re, sys
ROOT = "/workspace/repository"
PRIMER = f"{ROOT}/.context/primer/node_modules/@primer"
OCT = f"{PRIMER}/octicons/build/svg"

def icon(name, size=16, cls="octicon", style=""):
    svg = open(f"{OCT}/{name}-16.svg").read()
    svg = re.sub(r'<svg ', f'<svg class="{cls}" style="{style}" fill="currentColor" ', svg, count=1)
    svg = re.sub(r'width="16" height="16"', f'width="{size}" height="{size}"', svg, count=1)
    return svg

def data(path, mime):
    return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()

CSS_FILES = [
    f"{PRIMER}/primitives/dist/css/base/size/size.css",
    f"{PRIMER}/primitives/dist/css/base/typography/typography.css",
    f"{PRIMER}/primitives/dist/css/functional/size/size.css",
    f"{PRIMER}/primitives/dist/css/functional/size/border.css",
    f"{PRIMER}/primitives/dist/css/functional/typography/typography.css",
    f"{PRIMER}/primitives/dist/css/functional/themes/dark.css",
    f"{PRIMER}/css/dist/primer.css",
]

BOT = data(f"{ROOT}/packages/brand/assets/avatar/avatar-dark-400.png", "image/png")
ACME = data(f"{ROOT}/.agents/skills/changelog-screenshots/assets/acme-mark.svg", "image/svg+xml")
DEAN = data(f"{ROOT}/.agents/skills/changelog-screenshots/assets/dean-stratakos.jpg", "image/jpeg")

def dana(size):
    return (f'<span class="dana" style="width:{size}px;height:{size}px;font-size:{round(size*0.45)}px">D</span>')

def comment(avatar, login, when, body, badge="", reactions="", bot=False):
    botlabel = '<span class="Label Label--secondary ml-1" style="font-size:11px;line-height:16px;padding:0 6px">bot</span>' if bot else ""
    role = f'<span class="Label Label--secondary" style="font-size:12px">{badge}</span>' if badge else ""
    return f'''
<div class="tl-item">
  <div class="tl-avatar">{avatar}</div>
  <div class="cbox">
    <div class="chead"><div><a class="Link--primary text-bold">{login}</a>{botlabel} <span class="fgColor-muted">{when}</span></div>
      <div class="d-flex flex-items-center" style="gap:8px">{role}<span class="fgColor-muted">{icon("kebab-horizontal")}</span></div></div>
    <div class="markdown-body cbody">{body}</div>
    <div class="creact">{reactions}<span class="react-add">{icon("smiley")}</span></div>
  </div>
</div>'''

def page(css):
    tabs = [("code","Code",""),("issue-opened","Issues","12"),("git-pull-request","Pull requests","4"),("play","Actions",""),("table","Projects",""),("shield","Security",""),("graph","Insights",""),("gear","Settings","")]
    nav = "".join(
        f'<a class="rtab{" sel" if label=="Issues" else ""}">{icon(i, cls="octicon fgColor-muted")}<span>{label}</span>{f"<span class=\'Counter\'>{c}</span>" if c else ""}</a>'
        for i,label,c in tabs)
    return f'''<!doctype html><html data-color-mode="dark" data-dark-theme="dark" data-light-theme="dark"><head><meta charset="utf-8">
<style>{css}</style>
<style>
html,body{{background:transparent !important;margin:0}}
body{{width:1712px;height:1112px;position:relative;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;font-size:14px;color:var(--fgColor-default);-webkit-font-smoothing:antialiased}}
.win{{position:absolute;left:56px;top:38px;width:1600px;height:1000px;border-radius:10px;overflow:hidden;background:var(--bgColor-default);box-shadow:0 0 0 .5px rgba(0,0,0,.85),0 22px 60px rgba(0,0,0,.5),0 4px 14px rgba(0,0,0,.35)}}
.strip{{height:42px;background:#1f1f1f;display:flex;align-items:flex-end;padding-left:84px;position:relative}}
.lights{{position:absolute;left:16px;top:15px;display:flex;gap:8px}}.lights i{{width:12px;height:12px;border-radius:50%;display:block}}
.ctab{{height:34px;width:260px;background:#3c3c3c;border-radius:9px 9px 0 0;display:flex;align-items:center;gap:8px;padding:0 12px;color:#e3e3e3;font-size:12.5px;white-space:nowrap;overflow:hidden}}
.ctab svg{{flex:none;color:#e3e3e3}}.ctab .t{{flex:1;overflow:hidden;text-overflow:ellipsis}}
.ctab2{{height:34px;display:flex;align-items:center;padding:0 12px;color:#a8a8a8}}
.toolbar{{height:42px;background:#3c3c3c;display:flex;align-items:center;gap:14px;padding:0 14px;color:#c4c4c4;border-bottom:1px solid #000}}
.omni{{flex:1;height:30px;border-radius:15px;background:#282828;display:flex;align-items:center;gap:10px;padding:0 14px;color:#e3e3e3;font-size:14px}}
.omni .h{{color:#9a9a9a}}
.appheader{{background:var(--bgColor-inset);border-bottom:1px solid var(--borderColor-default)}}
.ah1{{height:56px;display:flex;align-items:center;gap:12px;padding:0 16px}}
.ibtn{{width:32px;height:32px;border:1px solid var(--borderColor-default);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--fgColor-muted)}}
.crumb{{display:flex;align-items:center;gap:6px;font-size:14px}}
.crumb img{{width:20px;height:20px;border-radius:5px}}
.search{{margin-left:auto;width:270px;height:32px;border:1px solid var(--borderColor-default);border-radius:6px;display:flex;align-items:center;gap:8px;padding:0 8px;color:var(--fgColor-muted);font-size:14px}}
.search kbd{{margin-left:auto;font-size:11px;border:1px solid var(--borderColor-default);border-radius:4px;padding:0 4px;color:var(--fgColor-muted);font-family:inherit}}
.rtabs{{display:flex;gap:4px;padding:0 16px;height:48px;align-items:flex-end}}
.rtab{{display:flex;align-items:center;gap:8px;padding:0 8px 10px;color:var(--fgColor-default);font-size:14px;line-height:30px;border-bottom:2px solid transparent}}
.rtab.sel{{border-bottom-color:#f78166;font-weight:600}}
.rtab .Counter{{background:var(--bgColor-neutral-muted);color:var(--fgColor-default)}}
.content{{width:1232px;margin:0 auto;padding-top:22px}}
.ihead{{display:flex;align-items:flex-start;gap:16px}}
.ititle{{font-size:32px;line-height:1.25;font-weight:400;flex:1;margin:0}}
.ititle span{{color:var(--fgColor-muted);font-weight:300}}
.imeta{{display:flex;align-items:center;gap:8px;margin:10px 0 0;padding-bottom:16px;border-bottom:1px solid var(--borderColor-default);color:var(--fgColor-muted)}}
.State{{display:inline-flex;align-items:center;gap:4px}}
.cols{{display:flex;gap:24px;margin-top:20px}}
.main{{flex:1;min-width:0;position:relative}}
.main:before{{content:"";position:absolute;left:72px;top:0;bottom:120px;width:2px;background:var(--borderColor-muted)}}
.tl-item{{display:flex;gap:16px;margin-bottom:22px;position:relative}}
.tl-avatar img,.tl-avatar .dana{{width:40px;height:40px;border-radius:50%}}
.dana{{display:flex;align-items:center;justify-content:center;background:#f2b880;color:#6b3a12;font-weight:600;border-radius:50%}}
.cbox{{flex:1;border:1px solid var(--borderColor-default);border-radius:6px;background:var(--bgColor-default);position:relative}}
.chead{{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:var(--bgColor-muted);border-bottom:1px solid var(--borderColor-default);border-radius:6px 6px 0 0;font-size:14px}}
.cbody{{padding:16px;font-size:14px}}
.creact{{display:flex;gap:8px;align-items:center;padding:0 16px 14px}}
.rx{{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:13px;border:1px solid var(--borderColor-accent-emphasis);background:var(--bgColor-accent-muted);font-size:12px;color:var(--fgColor-accent)}}
.react-add{{display:inline-flex;align-items:center;justify-content:center;width:28px;height:26px;border-radius:13px;border:1px solid var(--borderColor-default);color:var(--fgColor-muted)}}
.compose{{display:flex;gap:16px;padding-top:18px;border-top:2px solid var(--borderColor-default);position:relative;background:var(--bgColor-default)}}
.compose img{{width:40px;height:40px;border-radius:50%}}
.area{{flex:1;border:1px solid var(--borderColor-default);border-radius:6px;height:92px;padding:10px 12px;color:var(--fgColor-muted)}}
.side{{width:256px;flex:none;font-size:12px}}
.ssec{{padding:0 0 16px;margin-bottom:16px;border-bottom:1px solid var(--borderColor-muted)}}
.ssec h3{{font-size:12px;font-weight:600;color:var(--fgColor-muted);margin:0 0 8px;display:flex;justify-content:space-between}}
.ssec .v{{font-size:12px;color:var(--fgColor-muted)}}
.who{{display:flex;gap:8px;align-items:center;font-weight:600;font-size:12px;color:var(--fgColor-default)}}
.dev{{display:flex;gap:8px;font-size:12px;line-height:1.5;color:var(--fgColor-default)}}
.dev svg{{color:var(--fgColor-open);flex:none;margin-top:2px}}
</style></head><body><div class="win">
<div class="strip"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
<div class="ctab">{icon("mark-github")}<span class="t">Expired invite link shows a 404 · Issue #231 · acme/relay</span>{icon("x", 14)}</div><div class="ctab2">{icon("plus")}</div></div>
<div class="toolbar">{icon("arrow-left")}{icon("arrow-right")}{icon("sync")}<div class="omni"><span class="h">{icon("lock", 14)}</span><span>github.com<span class="h">/acme/relay/issues/231</span></span></div><img src="{DEAN}" style="width:24px;height:24px;border-radius:50%"></div>
<div class="appheader"><div class="ah1"><span class="ibtn">{icon("three-bars")}</span>{icon("mark-github", 32, style="color:var(--fgColor-default)")}
<span class="crumb"><img src="{ACME}"><a class="Link--primary">acme</a><span class="fgColor-muted">/</span><a class="Link--primary text-bold">relay</a></span>
<div class="search">{icon("search")}<span>Type <kbd style="margin:0">/</kbd> to search</span></div>
<span class="ibtn">{icon("copilot")}</span><span class="ibtn">{icon("plus")}</span><span class="ibtn">{icon("issue-opened")}</span><span class="ibtn">{icon("git-pull-request")}</span><span class="ibtn">{icon("inbox")}</span>
<img src="{DEAN}" style="width:32px;height:32px;border-radius:50%"></div>
<div class="rtabs">{nav}</div></div>
<div class="content">
<div class="ihead"><h1 class="ititle">Expired invite link shows a 404 <span>#231</span></h1>
<button class="btn btn-sm" style="margin-top:6px">Edit</button><button class="btn btn-sm btn-primary" style="margin-top:6px">New issue</button></div>
<div class="imeta"><span class="State State--open">{icon("issue-opened")} Open</span><span><a class="Link--primary text-bold">danamoreno</a> opened 9 minutes ago · 2 comments</span></div>
<div class="cols"><div class="main">
{comment(dana(40), "danamoreno", "opened 9 minutes ago", "<p>Opening an invite link after its 7 days lands on a bare 404. Seen on staging with sam@acme.dev's link.</p>", badge="Member")}
{comment(dana(40), "danamoreno", "commented 8 minutes ago", '<p><a class="user-mention text-bold Link--primary">@vespin-agent</a> can you take this? An expired link should read “This invite is no longer valid” and offer to ask for a new invite, as the plan says.</p>', badge="Member", reactions='<span class="rx">👀 1</span>')}
{comment(f'<img src="{BOT}">', "vespin-agent", "commented 2 minutes ago", '<p>Opened <a href="#">#232</a>. An expired invite link now reads “This invite is no longer valid”, with <strong>Ask for a new invite</strong>, which emails the member who sent it. I added a case for the expired link to <code>src/members/accept.test.ts</code>, and <code>pnpm test src/members</code> passes.</p><p><a href="#">Open in Vespin</a></p>', bot=True)}
<div class="compose"><img src="{DEAN}"><div class="area">Use Markdown to format your comment</div></div>
</div><div class="side">
<div class="ssec"><h3>Assignees {icon("gear")}</h3><div class="who">{dana(20)}danamoreno</div></div>
<div class="ssec"><h3>Labels {icon("gear")}</h3><span class="IssueLabel" style="background:#f8514933;color:#ff7b72;border:1px solid #f8514966;border-radius:2em;padding:0 7px;font-weight:500;line-height:18px;display:inline-block;margin-right:4px">bug</span><span class="IssueLabel" style="background:#388bfd33;color:#79c0ff;border:1px solid #388bfd66;border-radius:2em;padding:0 7px;font-weight:500;line-height:18px;display:inline-block">invites</span></div>
<div class="ssec"><h3>Projects {icon("gear")}</h3><div class="v">No projects</div></div>
<div class="ssec"><h3>Milestone {icon("gear")}</h3><div class="v">No milestone</div></div>
<div class="ssec"><h3>Development {icon("gear")}</h3><div class="dev">{icon("git-pull-request")}<span>Show an expired invite link as no longer valid <span class="fgColor-muted">#232</span></span></div></div>
<div class="ssec"><h3>Notifications</h3><button class="btn btn-sm btn-block">{icon("bell")} Unsubscribe</button><div class="v" style="margin-top:8px">You’re receiving notifications because you’re watching this repository.</div></div>
<div class="ssec" style="border:0"><h3>Participants</h3><div class="d-flex" style="gap:4px">{dana(26)}<img src="{BOT}" style="width:26px;height:26px;border-radius:50%"></div></div>
</div></div></div></div></body></html>'''

css = "\n".join(open(p).read() for p in CSS_FILES)
open(f"{ROOT}/.context/mock/github-mention.html", "w").write(page(css))
print("ok", os.path.getsize(f"{ROOT}/.context/mock/github-mention.html"))
