export const CSS = String.raw`
:root{
  /* theme tokens: light neutrals, calm blue brand, 12px controls, soft layered shadows */
  --brand:#0f6cbd;--brand-hover:#115ea3;--brand-pressed:#0f548c;--on-brand:#fff;
  --brand-tint:#ebf3fc;--brand-tint-border:#b4d6fa;--brand-ink:#0f548c;
  --bg:#fff;--surface:#f5f5f5;--surface-hover:#ebebeb;
  --line:#e0e0e0;--line-soft:#ebebeb;--line-strong:#616161;
  --ink:#242424;--muted:#616161;--code:#f0f0f0;--focus:#000;
  --success:#107c10;--danger:#b10e1c;
  --r-sm:6px;--r:12px;--r-lg:16px;--r-pill:999px;
  --sp-1:4px;--sp-2:8px;--sp-3:16px;--sp-4:24px;--sp-5:32px;--sp-6:48px;--sp-7:64px;--sp-8:96px;
  --shadow-low:0 0 2px rgba(0,0,0,.12),0 2px 4px rgba(0,0,0,.14);
  --shadow-high:0 0 8px rgba(0,0,0,.12),0 14px 28px rgba(0,0,0,.14);
  --font:Inter,"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
  --mono:"JetBrains Mono",Consolas,"Courier New",ui-monospace,monospace;
  --fs-xs:.75rem;--fs-sm:.875rem;--fs-md:1rem;--fs-lg:1.125rem;--fs-xl:1.375rem;
  --fs-2xl:clamp(1.75rem,2.6vw,2.25rem);--fs-3xl:clamp(2.25rem,4.4vw,3.5rem);
  /* category tints */
  --t-summary:#f3f1ea;--t-criteria:#efebf8;--t-issues:#fdebe9;--t-review:#fcf2d6;--t-suggestions:#f0f0f0;
  --t-scope:#e8f1fb;--t-fixes:#e3f4e7;--t-journeys:#dff3ef;--t-modalities:#ebe8f7;
  --critical:#f8d0cd;--serious:#fbdabb;--moderate:#f7eab0;--minor:#d3e4f7;
  --tool-axe:#dbe9f8;--tool-abledom:#e8e4f6;--tool-playwright:#dcf1e1;--tool-guidepup:#d9f0ec;--tool-agent:#fbeec6;--tool-manual:#ebebeb;
  --nav:60px;--max:1180px;
}
*{box-sizing:border-box}
html{scroll-padding-top:calc(var(--nav) + 16px);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--fs-md)/1.6 var(--font);font-feature-settings:"calt" 1,"liga" 1;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:var(--brand-ink);text-underline-offset:3px}
code,pre,kbd{font-family:var(--mono);font-size:.86em}
code{background:var(--code);padding:1px 6px;border-radius:var(--r-sm)}
kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:var(--r-sm);padding:0 6px;background:var(--bg);font-size:.82em}
pre{background:var(--code);border-radius:var(--r);padding:var(--sp-3) var(--sp-3);margin:0;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
pre code{background:none;padding:0}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:var(--r-sm)}
[hidden]{display:none!important}
.sr-only{position:absolute!important;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:12px;top:-60px;z-index:100;background:var(--brand);color:var(--on-brand);padding:10px 16px;border-radius:var(--r);text-decoration:none;font-weight:600}
.skip:focus{top:10px}
.wrap{max-width:var(--max);margin:0 auto;padding:0 var(--sp-4)}

/* nav */
.top{position:sticky;top:0;z-index:50;background:var(--bg);border-bottom:1px solid var(--line-soft);height:var(--nav)}
.top .wrap{display:flex;align-items:center;gap:var(--sp-4);height:100%}
.brand{font-weight:650;text-decoration:none;display:flex;align-items:center;gap:10px;white-space:nowrap;color:var(--ink);letter-spacing:-.01em}
.brand svg{flex:none}
.top nav{margin-left:auto;overflow-x:auto;scrollbar-width:none}
.top nav::-webkit-scrollbar{display:none}
.top ul{display:flex;gap:var(--sp-1);list-style:none;margin:0;padding:0}
.top nav a{display:block;padding:7px 12px;border-radius:var(--r);text-decoration:none;color:var(--muted);font-size:var(--fs-sm);font-weight:500;white-space:nowrap}
.top nav a:hover{color:var(--ink);background:var(--surface-hover)}
.top nav a[aria-current="true"]{color:var(--brand-ink);background:var(--brand-tint);font-weight:600}

/* hero */
.hero{padding:var(--sp-8) 0 var(--sp-7)}
.hero .wrap{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--sp-7);align-items:center}
.eyebrow{font-size:var(--fs-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--brand-ink);margin:0 0 var(--sp-3);font-weight:650}
h1{font-size:var(--fs-3xl);line-height:1.05;letter-spacing:-.03em;margin:0 0 var(--sp-4);font-weight:700;text-wrap:balance}
h1 span{display:block}
.lede{font-size:var(--fs-lg);line-height:1.55;color:var(--muted);max-width:34em;margin:0 0 var(--sp-3)}
.hero .note{font-size:var(--fs-sm);color:var(--muted);max-width:34em;margin:0 0 var(--sp-5);padding:var(--sp-2) var(--sp-3);background:var(--surface);border-radius:var(--r)}
.cta{display:flex;flex-wrap:wrap;gap:var(--sp-2);margin-bottom:var(--sp-6)}
.btn{display:inline-flex;align-items:center;gap:var(--sp-2);min-height:44px;padding:0 20px;border-radius:var(--r);border:1px solid var(--line-strong);background:var(--bg);color:var(--ink);text-decoration:none;font-weight:600;font-size:var(--fs-sm)}
.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}
.btn:hover{background:var(--surface-hover)}
.btn.primary:hover{background:var(--brand-hover);border-color:var(--brand-hover)}
.btn.primary:active{background:var(--brand-pressed)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:0;padding:0;border-top:1px solid var(--line)}
.stats div{padding:var(--sp-3) var(--sp-3) 0 0;display:flex;flex-direction:column-reverse}
.stats dt{font-size:var(--fs-xs);color:var(--muted);order:2}
.stats dd{margin:0;font-size:var(--fs-2xl);font-weight:700;letter-spacing:-.025em;line-height:1.15;font-variant-numeric:tabular-nums}
.frame{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--bg);overflow:hidden;box-shadow:var(--shadow-high)}
.frame .bar{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid var(--line-soft);background:var(--surface);font-size:var(--fs-xs);color:var(--muted)}
.frame .bar i{width:9px;height:9px;border-radius:50%;background:#c8c8c8;display:inline-block}
.frame .bar span{margin-left:8px;font-family:var(--mono)}

/* sections */
main>section{padding:var(--sp-8) 0}
main>section:nth-of-type(even){background:var(--surface)}
.shead{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);column-gap:var(--sp-6);row-gap:var(--sp-2);align-items:end;margin-bottom:var(--sp-6)}
.num{grid-column:1;font:600 var(--fs-sm)/1 var(--mono);color:var(--brand-ink);letter-spacing:.04em}
.shead h2{grid-column:1}
.shead p{grid-column:2;grid-row:1/3;margin:0;color:var(--muted);max-width:40em;font-size:var(--fs-md)}
h2{font-size:var(--fs-2xl);letter-spacing:-.025em;line-height:1.12;margin:0;font-weight:700}
h3{font-size:var(--fs-lg);margin:0;letter-spacing:-.01em;font-weight:650;line-height:1.3}
h4{font-size:var(--fs-md);margin:0 0 6px;font-weight:650}
p{margin:0 0 var(--sp-3)}
.muted{color:var(--muted)}
.small{font-size:var(--fs-sm)}

/* boxes: tinted title row joined to body */
.box{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--bg);overflow:hidden;box-shadow:var(--shadow-low)}
.box>.hd{padding:14px 20px;border-bottom:1px solid var(--line);background:var(--t-suggestions);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.box>.bd{padding:20px}
.hd h3 code,.hd h4 code{background:none;padding:0;font-size:.95em}
.skill h3{font-size:var(--fs-md)}
.t-summary>.hd{background:var(--t-summary)}.t-criteria>.hd{background:var(--t-criteria)}.t-issues>.hd{background:var(--t-issues)}
.t-review>.hd{background:var(--t-review)}.t-scope>.hd{background:var(--t-scope)}.t-fixes>.hd{background:var(--t-fixes)}
.t-journeys>.hd{background:var(--t-journeys)}.t-modalities>.hd{background:var(--t-modalities)}
.grid{display:grid;gap:var(--sp-4)}
.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}

/* chips */
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-xs);line-height:1;padding:6px 10px;border-radius:var(--r-sm);border:1px solid rgba(0,0,0,.1);background:var(--bg);white-space:nowrap;font-weight:550;letter-spacing:.01em}
.chip b{font-weight:650;color:var(--ink)}
.tool-axe-core{background:var(--tool-axe)}.tool-AbleDOM{background:var(--tool-abledom)}.tool-Playwright{background:var(--tool-playwright)}
.tool-Guidepup{background:var(--tool-guidepup)}.tool-agent{background:var(--tool-agent)}.tool-manual{background:var(--tool-manual)}
.imp-critical{background:var(--critical)}.imp-serious{background:var(--serious)}.imp-moderate{background:var(--moderate)}.imp-minor{background:var(--minor)}
.k-failure{background:var(--t-issues)}.k-review{background:var(--t-review)}.k-suggestion{background:var(--t-suggestions)}

/* workflow */
.flow{margin:0 0 var(--sp-6)}
.flow svg{width:100%;height:auto;display:block}
.flow .v{display:none}
.flow text{font-family:var(--font)}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--sp-4);counter-reset:s}
.steps>li{counter-increment:s}
.steps>li:last-child:nth-child(odd){grid-column:1/-1}
.steps .hd::before{content:counter(s,decimal-leading-zero);font:600 var(--fs-xs)/1 var(--mono);border:1px solid rgba(0,0,0,.14);border-radius:var(--r-sm);padding:6px 8px;background:var(--bg)}
.steps .who{margin-left:auto;font-size:var(--fs-xs);color:var(--muted)}
.steps pre{margin-top:var(--sp-3);font-size:var(--fs-xs)}
.io{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:var(--sp-3);font-size:var(--fs-sm);color:var(--muted)}
.io code{color:var(--ink)}
.never{display:flex;gap:14px;align-items:flex-start;margin-top:var(--sp-5);padding:20px 24px;border:1px solid var(--line);border-radius:var(--r-lg);background:var(--t-fixes)}
.never svg{flex:none;margin-top:2px}
.research{background:var(--t-review)}
#install .box .bd p{margin:0 0 var(--sp-3)}
.never p{margin:0}

/* skills */
.skill .bd{display:flex;flex-direction:column;gap:var(--sp-3);height:100%}
.skill{display:flex;flex-direction:column}
.skill .bd>ul{margin:0;padding-left:18px}
.skill .bd>ul li{margin:3px 0}
.prompt{font-size:var(--fs-sm);background:var(--surface);border-radius:var(--r);padding:12px 14px;margin:0}
.prompt::before{content:"Prompt";display:block;font-size:var(--fs-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px;font-weight:650}
.out{margin-top:auto;font-size:var(--fs-sm);color:var(--muted);border-top:1px solid var(--line-soft);padding-top:var(--sp-3)}

/* modalities */
.mods .box .bd p{margin:0 0 10px}
.mods dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:var(--fs-sm)}
.mods dt{color:var(--muted)}.mods dd{margin:0}
.ladder{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;background:var(--bg);box-shadow:var(--shadow-low)}
.ladder li{padding:var(--sp-3) 20px;border-left:1px solid var(--line)}
.ladder li:first-child{border-left:0}
.ladder .rung{font:600 var(--fs-xs)/1 var(--mono);color:var(--muted);display:block;margin-bottom:var(--sp-2)}
.ladder strong{display:block;margin-bottom:6px}
.ladder .chip{margin-top:var(--sp-2);white-space:normal;line-height:1.3}
.l0{background:var(--t-fixes)}.l1{background:var(--t-suggestions)}.l2{background:var(--t-review)}.l3{background:var(--t-issues)}.l4{background:var(--surface)}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.tags li{font:var(--fs-xs)/1 var(--mono);padding:6px 8px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg)}

/* reports */
.annot{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:var(--sp-5);align-items:start;margin-bottom:var(--sp-6)}
.shot{position:relative;margin:0}
.shot .pin{position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;background:var(--brand);color:var(--on-brand);font:700 12px/26px var(--font);text-align:center;box-shadow:0 0 0 3px #fff}
.legend-list{margin:0;padding:0;list-style:none;counter-reset:p;display:grid;gap:var(--sp-3)}
.legend-list li{counter-increment:p;display:grid;grid-template-columns:26px 1fr;gap:12px;align-items:start}
.legend-list li::before{content:counter(p);width:26px;height:26px;border-radius:50%;background:var(--brand);color:var(--on-brand);font:700 12px/26px var(--font);text-align:center}
.legend-list strong{display:block}
.legend-list span{color:var(--muted);font-size:var(--fs-sm)}
figure{margin:0}
figcaption{font-size:var(--fs-sm);color:var(--muted);padding:10px 2px 0}
.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-4)}
.gallery .box .bd{padding:0;background:var(--surface)}
.gallery .box img{width:100%}
.gallery .wide{grid-column:span 2}
.shots .box{display:flex;flex-direction:column}
.shots .box>.bd{flex:1;display:flex;align-items:center;justify-content:center;background:var(--surface);padding:var(--sp-4)}
.shots .box>.bd img{width:100%;border:1px solid var(--line);border-radius:var(--r);background:#fff}
.mobile{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:var(--sp-7);align-items:center;margin-top:var(--sp-7)}
.mobile figure{margin:0}
.mobile figcaption{margin-top:10px}
.mobile h3{margin:0 0 var(--sp-4);font-size:var(--fs-xl)}
.ticks{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--sp-4) var(--sp-5)}
.ticks li{display:grid;grid-template-columns:24px 1fr;gap:4px 12px;align-content:start}
.ticks li::before{content:"\2713";grid-row:span 2;width:22px;height:22px;border-radius:50%;background:var(--t-fixes);color:var(--success);font:700 12px/22px var(--font);text-align:center}
.ticks strong{display:block}
.ticks span{color:var(--muted);font-size:var(--fs-sm)}
.sub{margin:var(--sp-7) 0 var(--sp-3);display:flex;align-items:baseline;gap:var(--sp-3);flex-wrap:wrap}
.sub h3{font-size:var(--fs-xl)}
.sub p{margin:0;color:var(--muted)}
.status{display:flex;flex-wrap:wrap;gap:var(--sp-2);margin:var(--sp-3) 0 0;padding:0;list-style:none}

/* issues */
.issues{display:grid;gap:var(--sp-5)}
.issue>.hd h3{font-size:var(--fs-md)}
.issue>.hd .chips{margin-left:auto}
.issue .bd{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:var(--sp-5)}
.issue .bd>div{min-width:0}
.issue ol{margin:0 0 var(--sp-3);padding-left:20px}
.issue ol li{margin:4px 0}
.issue .shotbox{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:var(--surface)}
.fixbox{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin-top:var(--sp-3)}
.fixbox>.hd{background:var(--t-fixes);padding:10px 14px;font-weight:650;font-size:var(--fs-sm);border-bottom:1px solid var(--line)}
.fixbox>p{padding:12px 14px;margin:0}
.fixbox pre{border-radius:0;font-size:var(--fs-xs)}
.diff .del{background:#fbe2df;display:block}.diff .add{background:#dcf1e1;display:block}
.heard{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0 0 var(--sp-3);font-size:var(--fs-sm)}
.heard dt{color:var(--muted)}.heard dd{margin:0}

/* charts */
.charts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--sp-4);margin-bottom:var(--sp-5)}
.chart .bd{display:flex;flex-direction:column;align-items:center;gap:var(--sp-3)}
.chart svg{width:100%;max-width:220px;height:auto}
.chart .total{font:700 30px/1 var(--font);letter-spacing:-.02em}
.legend{list-style:none;margin:0;padding:0;width:100%;display:grid;gap:6px;font-size:var(--fs-sm)}
.legend li{display:flex;align-items:center;gap:var(--sp-2)}
.legend .sw{width:12px;height:12px;border-radius:3px;border:1px solid rgba(0,0,0,.2);flex:none}
.legend .n{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:650}
.bars{list-style:none;margin:0;padding:0;width:100%;display:grid;gap:10px;font-size:var(--fs-sm)}
.bars li{display:grid;grid-template-columns:84px 1fr 28px;align-items:center;gap:var(--sp-2)}
.bars .track{height:12px;background:var(--surface-hover);border-radius:var(--r-pill);overflow:hidden}
.bars .fill{display:block;height:100%;border-radius:var(--r-pill)}
.bars .n{text-align:right;font-weight:650;font-variant-numeric:tabular-nums}
.toolkey{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px var(--sp-4);margin:0 0 var(--sp-5);padding:0;list-style:none;font-size:var(--fs-sm)}
.toolkey li{display:flex;gap:10px;align-items:baseline}
.toolkey .chip{flex:none}

/* catalog */
.tabs{display:flex;gap:var(--sp-1);border-bottom:1px solid var(--line);margin-bottom:0}
.tabs [role=tab]{appearance:none;font:inherit;font-weight:600;font-size:var(--fs-sm);background:none;border:1px solid transparent;border-bottom:0;border-radius:var(--r) var(--r) 0 0;padding:12px 18px;margin-bottom:-1px;cursor:pointer;color:var(--muted)}
.tabs [role=tab]:hover{color:var(--ink);background:var(--surface-hover)}
.tabs [role=tab][aria-selected=true]{background:var(--bg);border-color:var(--line);color:var(--brand-ink)}
.tabs [role=tab] .c{font-weight:500;color:var(--muted);margin-left:4px}
.panel{border:1px solid var(--line);border-top:0;border-radius:0 0 var(--r-lg) var(--r-lg);background:var(--bg);box-shadow:var(--shadow-low)}
.filters{display:flex;flex-wrap:wrap;gap:var(--sp-3) var(--sp-4);align-items:flex-end;padding:var(--sp-3) 20px;border-bottom:1px solid var(--line);background:var(--surface)}
.field{display:flex;flex-direction:column;gap:6px;font-size:var(--fs-xs);font-weight:650;color:var(--ink)}
.field input,.field select{font:inherit;font-size:var(--fs-sm);font-weight:400;min-height:40px;padding:0 12px;border:1px solid var(--line-strong);border-radius:var(--r);background:var(--bg);color:var(--ink);min-width:0}
.field input{width:260px}
.toolbtns{display:flex;flex-wrap:wrap;gap:6px;border:0;margin:0;padding:0}
.toolbtns legend{font-size:var(--fs-xs);font-weight:650;color:var(--ink);margin-bottom:6px;padding:0}
.toolbtns button{font:inherit;font-size:var(--fs-sm);min-height:40px;padding:0 12px;border-radius:var(--r);border:1px solid var(--line-strong);background:var(--bg);color:var(--ink);cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.toolbtns button:hover{background:var(--surface-hover)}
.toolbtns button[aria-pressed=true]{background:var(--brand);color:var(--on-brand);border-color:var(--brand)}
.toolbtns button[aria-pressed=true]::before{content:"✓"}
.reset{font:inherit;font-size:var(--fs-sm);min-height:40px;padding:0 16px;border-radius:var(--r);border:1px solid var(--line-strong);background:var(--bg);color:var(--ink);cursor:pointer}
.reset:hover{background:var(--surface-hover)}
.count{padding:12px 20px;font-size:var(--fs-sm);color:var(--muted);border-bottom:1px solid var(--line-soft);margin:0}
.tblwrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:var(--fs-sm)}
th,td{text-align:left;padding:12px 16px;border-bottom:1px solid var(--line-soft);vertical-align:top}
thead th{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;font-weight:650}
tbody tr:hover{background:var(--surface)}
td.id{white-space:nowrap;font-weight:650}
td.id code{background:none;padding:0}
.lv{display:inline-block;min-width:34px;text-align:center;font-size:var(--fs-xs);font-weight:700;padding:4px 6px;border-radius:var(--r-sm);border:1px solid rgba(0,0,0,.1)}
.lv-A{background:#dbe9f8}.lv-AA{background:#e8e4f6}.lv-AAA{background:#f6e6d6}.lv-bp{background:#ebebeb;font-weight:600}
details summary{cursor:pointer;color:var(--muted);font-size:var(--fs-sm)}
details ul{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:4px}
details li code{font-size:11.5px}
.empty{padding:var(--sp-5) 20px;text-align:center;color:var(--muted)}

footer{padding:var(--sp-6) 0 var(--sp-7);font-size:var(--fs-sm);color:var(--muted);border-top:1px solid var(--line-soft)}
footer ul{margin:var(--sp-2) 0 0;padding-left:18px}

@media (prefers-reduced-motion:no-preference){
  html{scroll-behavior:smooth}
  .btn,.top nav a,.toolbtns button,.reset,.tabs [role=tab]{transition:background-color .15s,color .15s}
  .js .reveal{opacity:0;transform:translateY(10px);transition:opacity .5s ease,transform .5s ease}
  .js .reveal.in{opacity:1;transform:none}
  .flow .dash{stroke-dasharray:5 5;animation:dash 1.4s linear infinite}
  @keyframes dash{to{stroke-dashoffset:-20}}
}
@media (max-width:1000px){
  main>section{padding:var(--sp-7) 0}
  .hero{padding:var(--sp-7) 0 var(--sp-6)}
  .hero .wrap{grid-template-columns:1fr;gap:var(--sp-6)}
  .shead{grid-template-columns:1fr}
  .shead p{grid-column:1;grid-row:auto}
  .charts{grid-template-columns:repeat(2,minmax(0,1fr))}
  .g4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .g3,.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ladder{grid-template-columns:1fr}
  .ladder li{border-left:0;border-top:1px solid var(--line)}
  .ladder li:first-child{border-top:0}
  .annot{grid-template-columns:1fr}
  .issue .bd{grid-template-columns:1fr}
  .toolkey{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:760px){
  .flow .h{display:none}.flow .v{display:block;max-width:380px;margin:0 auto}
  .steps,.g2,.g3,.g4,.gallery,.charts,.toolkey{grid-template-columns:1fr}
  .gallery .wide{grid-column:auto}
  .mobile{grid-template-columns:1fr;gap:var(--sp-5);margin-top:var(--sp-6)}.mobile figure{max-width:300px;margin:0 auto}
  .ticks{grid-template-columns:1fr}
  .brand .long{display:none}
  .top .wrap{gap:var(--sp-3)}
}
@media (max-width:640px){
  .wrap{padding:0 var(--sp-3)}
  .hero{padding:var(--sp-6) 0 var(--sp-5)}
  main>section{padding:var(--sp-6) 0}
  .shead{margin-bottom:var(--sp-5)}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .stats div{padding-bottom:var(--sp-3)}
  .box>.bd{padding:var(--sp-3)}
  .box>.hd{padding:12px var(--sp-3)}
  .shot .pin{width:20px;height:20px;font-size:11px;line-height:20px}
  .field,.field input,.field select{width:100%}
  .issue>.hd .chips{margin-left:0}
  .tabs [role=tab]{padding:12px 12px}
  table.cat thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  table.cat,table.cat tbody,table.cat tr,table.cat td{display:block;width:100%}
  table.cat tr{border-bottom:1px solid var(--line);padding:var(--sp-2) 0}
  table.cat td{border:0;padding:4px var(--sp-3);display:grid;grid-template-columns:96px minmax(0,1fr);gap:var(--sp-2);overflow-wrap:anywhere}
  table.cat td.id{white-space:normal}
  table.cat .lv{justify-self:start}
  table.cat .chip{white-space:normal}
  table.cat td::before{content:attr(data-label);font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650;padding-top:2px}
}
@media (forced-colors:active){
  .chip,.lv,.legend .sw,.box,.tabs [role=tab][aria-selected=true]{border:1px solid CanvasText}
  .toolbtns button[aria-pressed=true]{outline:2px solid Highlight}
}
@media print{.top,.filters,.skip{display:none}main>section{padding:24px 0}}
`;
